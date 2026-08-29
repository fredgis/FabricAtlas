import json
import time
import uuid
import urllib.request
import urllib.error
import urllib.parse

import fabric.functions as fn

udf = fn.UserDataFunctions()

FABRIC = "https://api.fabric.microsoft.com/v1"
PBI = "https://api.powerbi.com/v1.0/myorg"
ADMIN = PBI + "/admin"


def _workspace_id(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise ValueError("workspaceId must be a valid UUID")


def _fabric_url(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.netloc.lower() != "api.fabric.microsoft.com":
        raise ValueError("Fabric continuation URL used an unexpected origin")
    return url


def _req(token, url, method="GET", body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=110) as r:
        txt = r.read().decode("utf-8")
        return json.loads(txt) if txt else {}


def _get(token, url):
    return _req(token, url)


def _get_all(token, path):
    items = []
    url = FABRIC + path
    guard = 0
    while url and guard < 50:
        guard += 1
        data = _get(token, _fabric_url(url))
        if isinstance(data, dict):
            items.extend(data.get("value", []))
            url = data.get("continuationUri")
        else:
            raise ValueError("Fabric list response was not an object")
    if url:
        raise RuntimeError("Fabric pagination exceeded the safety limit")
    return items


def _get_all_data(token, path):
    items = []
    url = FABRIC + path
    guard = 0
    while url and guard < 50:
        guard += 1
        data = _get(token, _fabric_url(url))
        if not isinstance(data, dict):
            raise ValueError("Fabric data-list response was not an object")
        values = data.get("data", [])
        if not isinstance(values, list):
            raise ValueError("Fabric data-list response did not contain a list")
        items.extend(values)
        url = data.get("continuationUri")
    if url:
        raise RuntimeError("Fabric data pagination exceeded the safety limit")
    return items


@udf.function()
def ping(name: str) -> str:
    return "pong: " + name


@udf.function()
def list_items(fabricToken: str, workspaceId: str) -> list:
    return _get_all(fabricToken, f"/workspaces/{_workspace_id(workspaceId)}/items")


@udf.function()
def list_role_assignments(fabricToken: str, workspaceId: str) -> list:
    return _get_all(fabricToken, f"/workspaces/{_workspace_id(workspaceId)}/roleAssignments")


@udf.function()
def get_workspace(fabricToken: str, workspaceId: str) -> dict:
    return _get(fabricToken, f"{FABRIC}/workspaces/{_workspace_id(workspaceId)}")


# ---- admin scanner: the one source that returns per-item access + lineage ----

def _scan_workspace(token, ws):
    start = _req(
        token,
        ADMIN + "/workspaces/getInfo?lineage=True&datasourceDetails=True&getArtifactUsers=True&datasetSchema=True&datasetExpressions=True",
        method="POST",
        body={"workspaces": [ws]},
    )
    scan_id = start.get("id")
    if not scan_id:
        return None
    succeeded = False
    for _ in range(30):
        st = _get(token, ADMIN + f"/workspaces/scanStatus/{scan_id}")
        if st.get("status") == "Succeeded":
            succeeded = True
            break
        if st.get("status") == "Failed":
            return None
        time.sleep(2)
    if not succeeded:
        return None
    res = _get(token, ADMIN + f"/workspaces/scanResult/{scan_id}")
    wss = res.get("workspaces") or []
    return wss[0] if wss else None


# scanner artifact array key -> Atlas item type
ART_KEYS = {
    "reports": "Report",
    "datasets": "SemanticModel",
    "dashboards": "Dashboard",
    "dataflows": "Dataflow",
    "datamarts": "Datamart",
    "Lakehouse": "Lakehouse",
    "Notebook": "Notebook",
    "DataPipeline": "DataPipeline",
    "warehouses": "Warehouse",
    "Warehouses": "Warehouse",
    "SQLDatabase": "SQLDatabase",
    "SQLDatabases": "SQLDatabase",
    "sqlDatabases": "SQLDatabase",
    "Eventhouse": "Eventhouse",
    "KQLDatabase": "KQLDatabase",
    "UserDataFunction": "UserDataFunction",
    "SQLAnalyticsEndpoint": "SQLEndpoint",
    "MirroredDatabase": "MirroredDatabase",
    "Eventstream": "Eventstream",
}

ITEM_TYPE_ALIASES = {
    "SQLAnalyticsEndpoint": "SQLEndpoint",
    "SqlDatabase": "SQLDatabase",
    "SQL Database": "SQLDatabase",
}

REL_LABEL = {
    "Datasource": "reads",
    "Association": "Direct Lake",
    "CascadeDelete": "SQL endpoint",
}


def _access_right(user):
    for k, v in user.items():
        if k.endswith("UserAccessRight") or k.endswith("AccessRight"):
            return v
    return None


def _lh_tables(token, ws, lid):
    try:
        rows = _get_all_data(
            token,
            f"/workspaces/{ws}/lakehouses/{lid}/tables?maxResults=100",
        )
        return _table_records(rows)
    except Exception:
        return []


def _table_records(value):
    """Flatten both legacy table lists and schema-enabled schema/table trees."""
    if isinstance(value, list):
        rows = []
        for entry in value:
            rows.extend(_table_records(entry))
        return rows
    if not isinstance(value, dict):
        return []

    nested = []
    for key in ("data", "value", "tables"):
        if isinstance(value.get(key), list):
            nested.extend(_table_records(value[key]))
    if nested:
        return nested
    if value.get("name") and (
        "columns" in value or "type" in value or "format" in value
    ):
        return [value]
    return []


DETAIL_PATHS = {
    "Lakehouse": "lakehouses",
    "Warehouse": "warehouses",
    "SQLDatabase": "sqlDatabases",
}


def _enrich_artifact(token, ws, artifact, errors):
    artifact_type = artifact.get("_type")
    artifact_id = artifact.get("id")
    detail_path = DETAIL_PATHS.get(artifact_type)
    if detail_path and artifact_id:
        try:
            artifact["_detail"] = _get(
                token,
                f"{FABRIC}/workspaces/{ws}/{detail_path}/{artifact_id}",
            )
        except urllib.error.HTTPError as error:
            artifact["_detailError"] = (
                f"Fabric REST returned HTTP {error.code} for item properties"
            )
            if error.code not in (400, 404):
                errors.append(
                    f"{artifact_type}Detail: failed for item {artifact_id}"
                )
        except Exception:
            artifact["_detailError"] = "Fabric REST item properties unavailable"
            errors.append(f"{artifact_type}Detail: failed for item {artifact_id}")

    if artifact_type == "Lakehouse" and artifact_id:
        try:
            artifact["_lakehouseTables"] = _get_all_data(
                token,
                f"/workspaces/{ws}/lakehouses/{artifact_id}/tables?maxResults=100",
            )
        except urllib.error.HTTPError as error:
            artifact["_lakehouseTables"] = []
            artifact["_lakehouseTablesError"] = (
                f"Lakehouse Tables REST returned HTTP {error.code}"
            )
            # 400/404 are observed for lakehouse variants where the preview
            # endpoint cannot enumerate tables. Other failures are privilege or
            # service failures and make the snapshot non-authoritative.
            if error.code not in (400, 404):
                errors.append(
                    f"LakehouseTables: failed for item {artifact_id}"
                )
        except Exception:
            artifact["_lakehouseTables"] = []
            artifact["_lakehouseTablesError"] = (
                "Lakehouse Tables REST enumeration failed"
            )
            errors.append(f"LakehouseTables: failed for item {artifact_id}")

    if artifact_type == "Report" and artifact_id:
        if artifact.get("reportType") == "PaginatedReport":
            artifact["_reportPagesError"] = (
                "Page inventory is not supported for paginated reports"
            )
        else:
            try:
                pages = _get(
                    token,
                    f"{PBI}/groups/{ws}/reports/{artifact_id}/pages",
                )
                values = pages.get("value", []) if isinstance(pages, dict) else []
                if not isinstance(values, list):
                    raise ValueError("Power BI pages response was not a list")
                artifact["_reportPages"] = values
            except urllib.error.HTTPError as error:
                artifact["_reportPagesError"] = (
                    f"Power BI Reports REST returned HTTP {error.code}"
                )
                if error.code not in (400, 404):
                    errors.append(
                        f"ReportPages: failed for item {artifact_id}"
                    )
            except Exception:
                artifact["_reportPagesError"] = (
                    "Power BI report page enumeration failed"
                )
                errors.append(f"ReportPages: failed for item {artifact_id}")


def _merge_schema_tables(*groups):
    """Deduplicate table names case-insensitively and retain all real columns."""
    merged = {}
    order = []
    for tables in groups:
        for table in tables or []:
            name = str(table.get("name") or "").strip()
            if not name:
                continue
            key = name.casefold()
            if key not in merged:
                leaf = key.rsplit(".", 1)[-1]
                leaf_matches = [
                    existing
                    for existing in order
                    if existing.rsplit(".", 1)[-1] == leaf
                    and ("." not in key or "." not in existing)
                ]
                if len(leaf_matches) == 1:
                    key = leaf_matches[0]
            if key not in merged:
                merged[key] = {
                    "name": name,
                    "objectType": table.get("objectType"),
                    "source": table.get("source"),
                    "description": table.get("description"),
                    "isHidden": table.get("isHidden"),
                    "columns": [],
                    "measures": [],
                }
                if table.get("rows") is not None:
                    merged[key]["rows"] = table.get("rows")
                order.append(key)
            target = merged[key]
            if not target.get("objectType") and table.get("objectType"):
                target["objectType"] = table.get("objectType")
            if table.get("source"):
                sources = [
                    value.strip()
                    for value in str(target.get("source") or "").split(" + ")
                    if value.strip()
                ]
                if table["source"] not in sources:
                    sources.append(table["source"])
                target["source"] = " + ".join(sources)
            if not target.get("description") and table.get("description"):
                target["description"] = table.get("description")
            if target.get("isHidden") is None and table.get("isHidden") is not None:
                target["isHidden"] = table.get("isHidden")
            column_names = {
                str(column.get("name") or "").casefold()
                for column in target["columns"]
            }
            for column in table.get("columns") or []:
                column_name = str(column.get("name") or "").strip()
                if column_name and column_name.casefold() not in column_names:
                    target["columns"].append({
                        "name": column_name,
                        "dataType": column.get("dataType")
                        or column.get("type")
                        or "column",
                        "description": column.get("description"),
                        "isHidden": column.get("isHidden"),
                    })
                    column_names.add(column_name.casefold())
            measure_names = {
                str(measure.get("name") or "").casefold()
                for measure in target["measures"]
            }
            for measure in table.get("measures") or []:
                measure_name = str(measure.get("name") or "").strip()
                if measure_name and measure_name.casefold() not in measure_names:
                    target["measures"].append({
                        "name": measure_name,
                        "expression": measure.get("expression")
                        or measure.get("expr"),
                        "description": measure.get("description"),
                        "isHidden": measure.get("isHidden"),
                    })
                    measure_names.add(measure_name.casefold())
    result = []
    for key in order:
        table = merged[key]
        table["columns"] = [
            {field: value for field, value in column.items() if value is not None}
            for column in table["columns"]
        ]
        table["measures"] = [
            {field: value for field, value in measure.items() if value is not None}
            for measure in table["measures"]
        ]
        result.append({
            field: value
            for field, value in table.items()
            if value is not None
        })
    return result


def _metadata_endpoint_ids(value):
    ids = set()
    if not isinstance(value, dict):
        return ids
    roots = [value]
    for key in ("properties", "extendedProperties"):
        if isinstance(value.get(key), dict):
            roots.append(value[key])
    for root in roots:
        endpoint = root.get("sqlEndpointProperties")
        if isinstance(endpoint, dict) and endpoint.get("id"):
            ids.add(str(endpoint["id"]))
        for key in ("sqlEndpointId", "sqlAnalyticsEndpointId"):
            if root.get(key):
                ids.add(str(root[key]))
        dw_properties = root.get("DwProperties")
        if isinstance(dw_properties, str):
            try:
                roots.append(json.loads(dw_properties))
            except (TypeError, ValueError):
                pass
    return ids


def _storage_endpoint_ids(token, ws, storage, arts):
    storage_id = storage.get("id")
    ids = set()
    for artifact in arts:
        if artifact.get("_type") != "SQLEndpoint":
            continue
        if any(
            relation.get("dependentOnArtifactId") == storage_id
            for relation in artifact.get("relations") or []
        ):
            ids.add(str(artifact.get("id")))
    ids.update(_metadata_endpoint_ids(storage))
    ids.update(_metadata_endpoint_ids(storage.get("_detail")))
    if storage.get("_type") == "Lakehouse":
        if not storage.get("_detail"):
            try:
                detail = _get(
                    token,
                    f"{FABRIC}/workspaces/{ws}/lakehouses/{storage_id}",
                )
                ids.update(_metadata_endpoint_ids(detail))
            except Exception:
                pass
    return ids


def _downstream_semantic_models(arts, start_ids):
    downstream = {}
    artifact_type = {}
    for artifact in arts:
        artifact_id = artifact.get("id")
        if artifact_id:
            artifact_type[str(artifact_id)] = artifact.get("_type")
        for relation in artifact.get("relations") or []:
            dependency = relation.get("dependentOnArtifactId")
            if dependency and artifact_id:
                downstream.setdefault(str(dependency), set()).add(
                    str(artifact_id)
                )

    models = set()
    pending = [str(value) for value in start_ids if value]
    visited = set()
    while pending:
        current = pending.pop()
        if current in visited:
            continue
        visited.add(current)
        for target in downstream.get(current, set()):
            target_type = artifact_type.get(target)
            if target_type == "SemanticModel":
                models.add(target)
            elif target_type == "SQLEndpoint" or target not in artifact_type:
                pending.append(target)
    return models


def _derive_storage_schemas(token, ws, arts, schema):
    for storage in arts:
        if storage.get("_type") not in (
            "Lakehouse",
            "Warehouse",
            "SQLDatabase",
        ):
            continue
        storage_id = storage.get("id")
        endpoint_ids = _storage_endpoint_ids(token, ws, storage, arts)
        model_ids = _downstream_semantic_models(
            arts,
            {storage_id, *endpoint_ids},
        )
        derived = []
        for model_id in model_ids:
            for table in schema.get(model_id, []):
                derived.append({
                    "name": table.get("name"),
                    "rows": table.get("rows"),
                    "objectType": table.get("objectType") or "Model table",
                    "source": "Downstream semantic model",
                    "description": table.get("description"),
                    "isHidden": table.get("isHidden"),
                    "columns": table.get("columns") or [],
                    "measures": [],
                })
        combined = _merge_schema_tables(schema.get(storage_id, []), derived)
        if combined:
            schema[storage_id] = combined
        storage["_derivedModelCount"] = len(model_ids)


def _qualified_object_name(value):
    name = str(value.get("name") or "").strip()
    schema_name = str(
        value.get("schema")
        or value.get("schemaName")
        or value.get("schema_name")
        or ""
    ).strip()
    if schema_name and name and not name.casefold().startswith(
        schema_name.casefold() + "."
    ):
        return f"{schema_name}.{name}"
    return name


def _schema_objects(values, object_type, source, include_measures=False):
    tables = []
    for value in values or []:
        name = _qualified_object_name(value)
        if not name:
            continue
        columns = []
        for column in value.get("columns") or []:
            column_name = str(column.get("name") or "").strip()
            if not column_name:
                continue
            columns.append({
                "name": column_name,
                "dataType": column.get("dataType")
                or column.get("type")
                or "column",
                "description": column.get("description"),
                "isHidden": column.get("isHidden"),
            })
        measures = []
        if include_measures:
            for measure in value.get("measures") or []:
                measure_name = str(measure.get("name") or "").strip()
                if not measure_name:
                    continue
                measures.append({
                    "name": measure_name,
                    "expression": measure.get("expression"),
                    "description": measure.get("description"),
                    "isHidden": measure.get("isHidden"),
                })
        row_count = value.get("rows")
        if row_count is None:
            row_count = value.get("rowCount")
        tables.append({
            "name": name,
            "rows": row_count,
            "objectType": value.get("objectType")
            or value.get("type")
            or object_type,
            "source": source,
            "description": value.get("description"),
            "isHidden": value.get("isHidden"),
            "columns": columns,
            "measures": measures,
        })
    return _merge_schema_tables(tables)


def _item_config(token, ws, a, typ, item_schema=None):
    rows = []

    def add(section, label, value):
        if label is not None and str(label).strip() and value is not None and value != "":
            rows.append({"itemId": a.get("id"), "section": section, "label": label, "value": str(value)})

    add("General", "Description", a.get("description"))
    add("General", "Configured by", a.get("configuredBy") or a.get("createdBy") or a.get("modifiedBy"))
    add("General", "Modified", a.get("modifiedDateTime") or a.get("lastUpdatedDate"))
    detail = a.get("_detail") or {}
    properties = detail.get("properties") or {}
    add("General", "REST metadata", a.get("_detailError"))

    if typ == "SemanticModel":
        add("Model", "Storage mode", a.get("targetStorageMode"))
        add("Model", "Provider", a.get("contentProviderType"))
        tables = item_schema or []
        if tables:
            add("Model", "Tables", len(tables))
            add(
                "Model",
                "Columns",
                sum(len(t.get("columns") or []) for t in tables),
            )
            add(
                "Model",
                "Measures",
                sum(len(t.get("measures") or []) for t in tables),
            )
    elif typ == "Lakehouse":
        ep = a.get("extendedProperties") or {}
        add(
            "OneLake",
            "Tables path",
            properties.get("oneLakeTablesPath")
            or ep.get("OneLakeTablesPath"),
        )
        add(
            "OneLake",
            "Files path",
            properties.get("oneLakeFilesPath")
            or ep.get("OneLakeFilesPath"),
        )
        add(
            "OneLake",
            "Default schema",
            properties.get("defaultSchema") or ep.get("DefaultSchema"),
        )
        sql_endpoint = properties.get("sqlEndpointProperties") or {}
        add("SQL endpoint", "Item ID", sql_endpoint.get("id"))
        add(
            "SQL endpoint",
            "Provisioning status",
            sql_endpoint.get("provisioningStatus"),
        )
        try:
            dw = json.loads(ep.get("DwProperties") or "{}")
            add(
                "SQL endpoint",
                "Metadata available",
                "Yes" if dw.get("tdsEndpoint") else None,
            )
        except Exception:
            pass
        direct = a.get("_lakehouseTables") or []
        if direct:
            add("Inventory", "Lakehouse Tables REST", f"{len(direct)} objects")
        add("Inventory", "Lakehouse Tables REST status", a.get("_lakehouseTablesError"))
        if a.get("_derivedModelCount"):
            add(
                "Inventory",
                "Downstream semantic models",
                a.get("_derivedModelCount"),
            )
    elif typ == "Warehouse":
        add("Warehouse", "Collation", properties.get("collationType"))
        add("Warehouse", "Created", properties.get("createdDate"))
        add("Warehouse", "Updated", properties.get("lastUpdatedTime"))
    elif typ == "SQLDatabase":
        add("SQL database", "Database name", properties.get("databaseName"))
        add("SQL database", "Collation", properties.get("collation"))
        add(
            "SQL database",
            "Backup retention days",
            properties.get("backupRetentionDays"),
        )
    elif typ == "Report":
        add("Report", "Type", a.get("reportType"))
        add("Report", "Semantic model", a.get("datasetId"))
        pages = a.get("_reportPages")
        if isinstance(pages, list):
            add("Report", "Pages", len(pages))
            for page in sorted(
                pages,
                key=lambda value: int(value.get("order") or 0),
            ):
                page_name = page.get("displayName") or page.get("name")
                internal_name = page.get("name")
                order = page.get("order")
                detail_value = (
                    f"{internal_name} · order {order}"
                    if internal_name and order is not None
                    else internal_name or order
                )
                add("Report pages", page_name, detail_value)
        add("Report", "Page inventory status", a.get("_reportPagesError"))
        add(
            "Report",
            "Visual and binding inventory",
            "Not exposed by the admin scanner or Reports REST; requires the Power BI report authoring/embed API.",
        )

    if typ in ("Warehouse", "SQLDatabase"):
        native_inventory = any(
            "admin scanner" in str(table.get("source") or "").lower()
            for table in (item_schema or [])
        )
        if native_inventory:
            add(
                "Inventory",
                "Coverage",
                "Tables/views and columns returned by the Power BI admin scanner.",
            )
        elif item_schema:
            add(
                "Inventory",
                "Coverage",
                "Downstream semantic-model subset only; complete tables, views and columns require SQL connectivity.",
            )
        else:
            add(
                "Inventory",
                "Coverage",
                "Fabric REST exposes item properties only; complete tables, views and columns require SQL connectivity.",
            )

    for table in item_schema or []:
        add(
            "Tables",
            table.get("name"),
            table.get("objectType") or table.get("source") or "Table",
        )

    return rows


def _item_schema(token, ws, a, typ):
    """Return only object metadata supplied by supported Fabric/Power BI APIs."""
    if typ == "SemanticModel":
        return _schema_objects(
            a.get("tables"),
            "Model table",
            "Power BI admin scanner",
            include_measures=True,
        )
    elif typ == "Lakehouse":
        direct_values = (
            a["_lakehouseTables"]
            if "_lakehouseTables" in a
            else _lh_tables(token, ws, a.get("id"))
        )
        direct = _schema_objects(
            direct_values,
            "Table",
            "Fabric Lakehouse Tables REST",
        )
        scanned = _schema_objects(
            a.get("tables"),
            "Table",
            "Power BI admin scanner",
        )
        return _merge_schema_tables(direct, scanned)
    elif typ in ("Warehouse", "SQLDatabase"):
        tables = _schema_objects(
            a.get("tables"),
            "Table",
            "Power BI admin scanner",
        )
        views = _schema_objects(
            a.get("views"),
            "View",
            "Power BI admin scanner",
        )
        return _merge_schema_tables(tables, views)
    return []


@udf.function()
def sync_all(fabricToken: str, workspaceId: str) -> dict:
    """One-shot sync for Fabric Atlas. Uses the Fabric item APIs for the catalog
    and the admin scanner for the two hard things: real lineage between items and
    per-item access (who can see each item, not just the workspace)."""
    ws = _workspace_id(workspaceId)
    out = {
        "workspace": None,
        "items": [],
        "roleAssignments": [],
        "access": [],
        "lineage": [],
        "config": [],
        "schema": {},
        "jobs": [],
        "errors": [],
    }

    try:
        out["workspace"] = _get(fabricToken, f"{FABRIC}/workspaces/{ws}")
    except Exception as e:
        out["errors"].append("workspace: " + str(e))

    try:
        out["items"] = _get_all(fabricToken, f"/workspaces/{ws}/items")
    except Exception as e:
        out["errors"].append("items: " + str(e))

    try:
        out["roleAssignments"] = _get_all(fabricToken, f"/workspaces/{ws}/roleAssignments")
    except Exception as e:
        out["errors"].append("roleAssignments: " + str(e))

    # Admin scanner: per-item access + lineage + config.
    scan = None
    try:
        scan = _scan_workspace(fabricToken, ws)
        if scan is None:
            out["errors"].append("scan: no result (needs Tenant.Read.All + admin API tenant settings)")
    except Exception as e:
        out["errors"].append("scan: " + str(e))

    if scan:
        scanner_arts = []
        for key, typ in ART_KEYS.items():
            for a in scan.get(key, []) or []:
                a["_type"] = typ
                scanner_arts.append(a)
        scanned_ids = {
            str(a.get("id")) for a in scanner_arts if a.get("id")
        }
        expected_scan_ids = {
            str(item.get("id"))
            for item in out["items"]
            if item.get("id")
            and item.get("type") in ("SemanticModel", "Report")
        }
        missing_scan_ids = expected_scan_ids - scanned_ids
        if missing_scan_ids:
            out["errors"].append(
                f"scan: incomplete artifact result ({len(missing_scan_ids)} missing)"
            )
        missing_model_schema = [
            a.get("id")
            for a in scanner_arts
            if a.get("_type") == "SemanticModel"
            and not isinstance(a.get("tables"), list)
        ]
        if missing_model_schema:
            out["errors"].append(
                f"scan: semantic model schema unavailable ({len(missing_model_schema)} models)"
            )

        artifacts_by_id = {}
        for artifact in scanner_arts:
            artifact_id = artifact.get("id")
            if artifact_id:
                artifacts_by_id[str(artifact_id)] = artifact
        for item in out["items"]:
            item_id = item.get("id")
            if not item_id:
                continue
            item_type = ITEM_TYPE_ALIASES.get(
                item.get("type"),
                item.get("type"),
            )
            artifact = artifacts_by_id.get(str(item_id))
            if artifact:
                artifact.setdefault("_type", item_type)
                artifact.setdefault("displayName", item.get("displayName"))
                artifact.setdefault("description", item.get("description"))
            else:
                artifact = dict(item)
                artifact["_type"] = item_type
                artifacts_by_id[str(item_id)] = artifact
        arts = list(artifacts_by_id.values())
        ids = {a.get("id") for a in arts}

        for a in arts:
            aid = a.get("id")
            typ = a["_type"]
            _enrich_artifact(fabricToken, ws, a, out["errors"])
            for u in a.get("users", []) or []:
                out["access"].append({
                    "itemId": aid,
                    "principalName": u.get("displayName") or u.get("emailAddress") or u.get("identifier"),
                    "principalEmail": u.get("emailAddress"),
                    "principalType": u.get("principalType"),
                    "accessRight": _access_right(u),
                })
            for r in a.get("relations", []) or []:
                dep = r.get("dependentOnArtifactId")
                if dep and dep in ids:
                    out["lineage"].append({
                        "source": dep,
                        "target": aid,
                        "relation": REL_LABEL.get(r.get("relationType"), r.get("relationType") or "depends"),
                    })
            if typ == "Report" and a.get("datasetId"):
                out["lineage"].append({"source": a["datasetId"], "target": aid, "relation": "report"})
            try:
                sch = _item_schema(fabricToken, ws, a, typ)
                if sch:
                    out["schema"][aid] = sch
            except Exception:
                out["errors"].append(f"schema: failed for item {aid}")

        # Schema-enabled lakehouses have no reliable /tables REST result.
        # Follow real metadata IDs across Lakehouse -> SQL endpoint -> semantic
        # model and reuse only scanner-provided table/column metadata.
        _derive_storage_schemas(fabricToken, ws, arts, out["schema"])

        for a in arts:
            aid = a.get("id")
            try:
                out["config"].extend(
                    _item_config(
                        fabricToken,
                        ws,
                        a,
                        a["_type"],
                        out["schema"].get(aid, []),
                    )
                )
            except Exception:
                out["errors"].append(f"config: failed for item {aid}")

    # Recent job instances per item. Unsupported item types return 400/404;
    # other failures mark the result incomplete so old job history is retained.
    for it in out["items"]:
        iid = it.get("id")
        if not iid:
            continue
        try:
            jobs = _get_all(fabricToken, f"/workspaces/{ws}/items/{iid}/jobs/instances")
            for j in jobs[:3]:
                j["itemId"] = iid
                j["itemDisplayName"] = it.get("displayName")
                j["itemType"] = it.get("type")
                out["jobs"].append(j)
        except urllib.error.HTTPError as e:
            if e.code not in (400, 404):
                out["errors"].append(f"jobs: failed for item {iid}")
        except Exception:
            out["errors"].append(f"jobs: failed for item {iid}")

    import datetime
    out["syncedAt"] = datetime.datetime.utcnow().isoformat() + "Z"
    return out
