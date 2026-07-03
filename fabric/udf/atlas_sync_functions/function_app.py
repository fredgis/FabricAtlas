import json
import time
import urllib.request
import urllib.error

import fabric.functions as fn

udf = fn.UserDataFunctions()

FABRIC = "https://api.fabric.microsoft.com/v1"
PBI = "https://api.powerbi.com/v1.0/myorg"
ADMIN = PBI + "/admin"


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
        data = _get(token, url)
        if isinstance(data, dict):
            items.extend(data.get("value", []))
            url = data.get("continuationUri")
        else:
            break
    return items


@udf.function()
def ping(name: str) -> str:
    return "pong: " + name


@udf.function()
def list_items(fabricToken: str, workspaceId: str) -> list:
    return _get_all(fabricToken, f"/workspaces/{workspaceId}/items")


@udf.function()
def list_role_assignments(fabricToken: str, workspaceId: str) -> list:
    return _get_all(fabricToken, f"/workspaces/{workspaceId}/roleAssignments")


@udf.function()
def get_workspace(fabricToken: str, workspaceId: str) -> dict:
    return _get(fabricToken, f"{FABRIC}/workspaces/{workspaceId}")


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
    for _ in range(30):
        st = _get(token, ADMIN + f"/workspaces/scanStatus/{scan_id}")
        if st.get("status") == "Succeeded":
            break
        if st.get("status") == "Failed":
            return None
        time.sleep(2)
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
    "Eventhouse": "Eventhouse",
    "KQLDatabase": "KQLDatabase",
    "UserDataFunction": "UserDataFunction",
    "SQLAnalyticsEndpoint": "SQLEndpoint",
    "MirroredDatabase": "MirroredDatabase",
    "Eventstream": "Eventstream",
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
        d = _get(token, f"{FABRIC}/workspaces/{ws}/lakehouses/{lid}/tables")
        return d.get("data", []) if isinstance(d, dict) else []
    except Exception:
        return []


def _item_config(token, ws, a, typ):
    rows = []

    def add(section, label, value):
        if value is not None and value != "":
            rows.append({"itemId": a.get("id"), "section": section, "label": label, "value": str(value)})

    add("General", "Description", a.get("description"))
    add("General", "Configured by", a.get("configuredBy") or a.get("createdBy") or a.get("modifiedBy"))
    add("General", "Modified", a.get("modifiedDateTime") or a.get("lastUpdatedDate"))

    if typ == "SemanticModel":
        add("Model", "Storage mode", a.get("targetStorageMode"))
        add("Model", "Provider", a.get("contentProviderType"))
        tables = a.get("tables") or []
        if tables:
            add("Model", "Tables", len(tables))
            meas = sum(len(t.get("measures") or []) for t in tables)
            add("Model", "Measures", meas)
    elif typ == "Lakehouse":
        ep = a.get("extendedProperties") or {}
        add("OneLake", "Tables path", ep.get("OneLakeTablesPath"))
        add("OneLake", "Default schema", ep.get("DefaultSchema"))
        try:
            dw = json.loads(ep.get("DwProperties") or "{}")
            add("SQL endpoint", "TDS endpoint", dw.get("tdsEndpoint"))
        except Exception:
            pass
        for t in _lh_tables(token, ws, a.get("id")):
            add("Tables", t.get("name"), t.get("type", "Table"))
    elif typ == "Warehouse":
        add("Tables", "Detail", "Table-level detail requires a SQL connection, which the app can't open — open the warehouse in Fabric to browse tables.")
    elif typ == "Report":
        add("Report", "Type", a.get("reportType"))
        add("Report", "Semantic model", a.get("datasetId"))

    return rows


def _item_schema(token, ws, a, typ):
    """Sub-objects of an item: a semantic model's tables/columns/measures, or a
    lakehouse's tables. Keyed by the real item id at sync time."""
    tables = []
    if typ == "SemanticModel":
        for t in a.get("tables") or []:
            cols = [
                {"name": c.get("name"), "dataType": c.get("dataType") or c.get("type") or "column"}
                for c in (t.get("columns") or [])
            ]
            meas = [{"name": m.get("name")} for m in (t.get("measures") or [])]
            tables.append({"name": t.get("name"), "columns": cols, "measures": meas})
    elif typ == "Lakehouse":
        for t in _lh_tables(token, ws, a.get("id")):
            tables.append({"name": t.get("name"), "columns": [], "measures": []})
    return tables


@udf.function()
def sync_all(fabricToken: str, workspaceId: str) -> dict:
    """One-shot sync for Fabric Atlas. Uses the Fabric item APIs for the catalog
    and the admin scanner for the two hard things: real lineage between items and
    per-item access (who can see each item, not just the workspace)."""
    ws = workspaceId
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
        arts = []
        for key, typ in ART_KEYS.items():
            for a in scan.get(key, []) or []:
                a["_type"] = typ
                arts.append(a)
        ids = {a.get("id") for a in arts}
        for a in arts:
            aid = a.get("id")
            typ = a["_type"]
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
                out["config"].extend(_item_config(fabricToken, ws, a, typ))
            except Exception:
                pass
            try:
                sch = _item_schema(fabricToken, ws, a, typ)
                if sch:
                    out["schema"][aid] = sch
            except Exception:
                pass

        # Schema-enabled lakehouses (and warehouses) have no usable /tables REST,
        # so derive their tables from the Direct Lake semantic model(s) that read
        # them (the scanner already gave us those tables + columns).
        for a in arts:
            if a.get("_type") not in ("Lakehouse", "Warehouse"):
                continue
            lid = a.get("id")
            if out["schema"].get(lid):
                continue
            derived = {}
            for ds in arts:
                if ds.get("_type") != "SemanticModel":
                    continue
                if not any(r.get("dependentOnArtifactId") == lid for r in (ds.get("relations") or [])):
                    continue
                for t in out["schema"].get(ds.get("id"), []):
                    derived[t["name"]] = {"name": t["name"], "columns": t.get("columns", []), "measures": []}
            if derived:
                out["schema"][lid] = list(derived.values())

    # Recent job instances per item (best-effort, capped).
    for it in out["items"][:50]:
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
        except Exception:
            pass

    import datetime
    out["syncedAt"] = datetime.datetime.utcnow().isoformat() + "Z"
    return out
