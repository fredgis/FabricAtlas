import contextlib
import contextvars
import datetime
import email.utils
import json
import math
import numbers
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
EXECUTION_BUDGET_SECONDS = 92
REQUEST_TIMEOUT_SECONDS = 20
MAX_REQUEST_ATTEMPTS = 4
MAX_BACKOFF_SECONDS = 8
MAX_RESPONSE_BYTES = 25 * 1024 * 1024
MAX_UPSTREAM_RESPONSE_BYTES = 25 * 1024 * 1024
RESPONSE_READ_CHUNK_BYTES = 64 * 1024


class DeadlineExceeded(RuntimeError):
    pass


class ResponseSizeExceeded(RuntimeError):
    pass


class ScannerError(RuntimeError):
    pass


class _ExecutionDeadline:
    def __init__(self, seconds=EXECUTION_BUDGET_SECONDS, clock=None):
        self.clock = clock or time.monotonic
        self.expires_at = self.clock() + seconds

    def remaining(self):
        return self.expires_at - self.clock()

    def request_timeout(self, bounded_timeout=REQUEST_TIMEOUT_SECONDS):
        remaining = self.remaining()
        if remaining <= 0:
            raise DeadlineExceeded("execution deadline exhausted")
        return min(max(0.001, bounded_timeout), remaining)

    def sleep(self, seconds, sleeper=None):
        if seconds <= 0:
            return
        if seconds >= self.remaining():
            raise DeadlineExceeded("execution deadline exhausted")
        (sleeper or time.sleep)(seconds)


_ACTIVE_DEADLINE = contextvars.ContextVar(
    "atlas_sync_deadline",
    default=None,
)


@contextlib.contextmanager
def _deadline_scope(deadline):
    token = _ACTIVE_DEADLINE.set(deadline)
    try:
        yield deadline
    finally:
        _ACTIVE_DEADLINE.reset(token)


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


def _retry_after_seconds(headers, wall_clock=None):
    value = headers.get("Retry-After") if headers else None
    if value is None:
        return None
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        try:
            retry_at = email.utils.parsedate_to_datetime(str(value))
        except (TypeError, ValueError, OverflowError):
            return None
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=datetime.timezone.utc)
        now = (
            wall_clock()
            if wall_clock
            else datetime.datetime.now(datetime.timezone.utc)
        )
        if now.tzinfo is None:
            now = now.replace(tzinfo=datetime.timezone.utc)
        return max(0.0, (retry_at - now).total_seconds())


def _set_response_timeout(response, timeout):
    candidates = [
        getattr(getattr(getattr(response, "fp", None), "raw", None), "_sock", None),
        getattr(getattr(response, "fp", None), "_sock", None),
        getattr(getattr(response, "raw", None), "_sock", None),
    ]
    for candidate in candidates:
        if candidate is not None and hasattr(candidate, "settimeout"):
            candidate.settimeout(timeout)
            return


def _read_response_bytes(response, deadline, attempt_expires_at):
    payload = bytearray()
    while True:
        remaining = min(
            deadline.remaining(),
            attempt_expires_at - deadline.clock(),
        )
        if remaining <= 0:
            raise DeadlineExceeded("request deadline exhausted")
        _set_response_timeout(response, max(0.001, remaining))
        chunk = response.read(
            min(
                RESPONSE_READ_CHUNK_BYTES,
                MAX_UPSTREAM_RESPONSE_BYTES + 1 - len(payload),
            )
        )
        if not chunk:
            break
        payload.extend(chunk)
        if len(payload) > MAX_UPSTREAM_RESPONSE_BYTES:
            raise ResponseSizeExceeded(
                "upstream response exceeded the safe size limit"
            )
        if (
            deadline.remaining() <= 0
            or deadline.clock() >= attempt_expires_at
        ):
            raise DeadlineExceeded("request deadline exhausted")
    return bytes(payload)


def _req(
    token,
    url,
    method="GET",
    body=None,
    deadline=None,
    per_request_timeout=REQUEST_TIMEOUT_SECONDS,
    max_attempts=MAX_REQUEST_ATTEMPTS,
    sleeper=None,
    wall_clock=None,
):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    active_deadline = (
        deadline
        or _ACTIVE_DEADLINE.get()
        or _ExecutionDeadline()
    )
    for attempt in range(max_attempts):
        timeout = active_deadline.request_timeout(per_request_timeout)
        attempt_expires_at = active_deadline.clock() + timeout
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                payload = _read_response_bytes(
                    response,
                    active_deadline,
                    attempt_expires_at,
                )
                text = payload.decode("utf-8")
                return json.loads(text) if text else {}
        except urllib.error.HTTPError as error:
            retryable = error.code == 429 or 500 <= error.code <= 599
            if not retryable or attempt + 1 >= max_attempts:
                raise
            retry_after = _retry_after_seconds(
                error.headers,
                wall_clock=wall_clock,
            )
            delay = (
                retry_after
                if retry_after is not None
                else min(MAX_BACKOFF_SECONDS, 0.5 * (2 ** attempt))
            )
            active_deadline.sleep(delay, sleeper=sleeper)
    raise RuntimeError("request attempts exhausted")


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
        ADMIN
        + "/workspaces/getInfo"
        + "?lineage=True&getArtifactUsers=True"
        + "&datasetSchema=True&datasetExpressions=True",
        method="POST",
        body={"workspaces": [ws]},
    )
    scan_id = start.get("id")
    if not scan_id:
        raise ScannerError("scanner did not return an operation id")
    for _ in range(30):
        st = _get(token, ADMIN + f"/workspaces/scanStatus/{scan_id}")
        if st.get("status") == "Succeeded":
            break
        if st.get("status") == "Failed":
            raise ScannerError("scanner operation failed")
        deadline = _ACTIVE_DEADLINE.get() or _ExecutionDeadline()
        deadline.sleep(2)
    else:
        raise ScannerError("scanner operation did not complete")
    res = _get(token, ADMIN + f"/workspaces/scanResult/{scan_id}")
    wss = res.get("workspaces") or []
    if not isinstance(wss, list) or not wss:
        raise ScannerError("scanner result omitted the workspace")
    return wss[0]


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


def _normalized_id(value):
    text = _strict_text(value)
    if not text:
        return None
    try:
        return str(uuid.UUID(text))
    except ValueError:
        return text


def _artifact_id(value):
    if not isinstance(value, dict):
        return None
    return _normalized_id(value.get("id")) or _normalized_id(
        value.get("objectId")
    )


def _normalize_timestamp(value):
    if not isinstance(value, str) or not value.strip():
        return value
    text = value.strip()
    try:
        parsed = datetime.datetime.fromisoformat(
            text[:-1] + "+00:00" if text.endswith("Z") else text
        )
    except ValueError:
        return value
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    parsed = parsed.astimezone(datetime.timezone.utc)
    return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _safe_row_count(value):
    if isinstance(value, bool) or not isinstance(value, numbers.Real):
        return None
    numeric = float(value)
    if not math.isfinite(numeric) or numeric < 0:
        return None
    return value


def _safe_text(value):
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, dict):
        for key in (
            "displayName",
            "emailAddress",
            "email",
            "identifier",
            "graphId",
            "id",
        ):
            text = _safe_text(value.get(key))
            if text:
                return text
    return None


def _strict_text(value):
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _sanitize_workspace(value):
    if not isinstance(value, dict):
        raise ValueError("workspace response was not an object")
    allowed = (
        "id",
        "displayName",
        "description",
        "type",
        "capacityId",
        "capacityRegion",
    )
    return {
        key: value[key]
        for key in allowed
        if isinstance(value.get(key), str) and value.get(key).strip()
    }


def _sanitize_item(value):
    if not isinstance(value, dict):
        return None
    item_id = _artifact_id(value)
    item_type = _strict_text(value.get("type"))
    if not item_id or not item_type:
        return None
    item = {"id": item_id, "type": item_type}
    for key in ("displayName", "description", "workspaceId", "folderId"):
        text = _strict_text(value.get(key))
        if text:
            item[key] = text
    return item


def _sanitize_role_assignment(value):
    if not isinstance(value, dict):
        return None
    role = _strict_text(value.get("role"))
    principal = value.get("principal")
    if not role or not isinstance(principal, dict):
        return None
    safe_principal = {}
    for key in ("id", "displayName", "type"):
        text = (
            _normalized_id(principal.get(key))
            if key == "id"
            else _strict_text(principal.get(key))
        )
        if text:
            safe_principal[key] = text
    details = principal.get("userDetails")
    if isinstance(details, dict):
        user_principal_name = _strict_text(
            details.get("userPrincipalName")
        )
        if user_principal_name:
            safe_principal["userDetails"] = {
                "userPrincipalName": user_principal_name,
            }
    if not safe_principal.get("id"):
        fallback = (
            safe_principal.get("userDetails", {}).get("userPrincipalName")
            or safe_principal.get("displayName")
        )
        if fallback:
            safe_principal["id"] = fallback
    if not safe_principal.get("id"):
        return None
    return {"role": role, "principal": safe_principal}


def _sanitize_job(value, item):
    if not isinstance(value, dict):
        return None
    job_type = _strict_text(value.get("jobType") or value.get("invokeType"))
    status = _strict_text(value.get("status"))
    if not job_type or not status:
        return None
    job = {
        "itemId": item["id"],
        "itemDisplayName": item.get("displayName"),
        "itemType": item.get("type"),
        "jobType": job_type,
        "status": status,
    }
    for key in ("id", "invokeType"):
        text = _strict_text(value.get(key))
        if text:
            job[key] = text
    for key in (
        "startTimeUtc",
        "endTimeUtc",
        "createdTimeUtc",
        "lastUpdatedTimeUtc",
    ):
        timestamp = _strict_text(value.get(key))
        if timestamp:
            job[key] = _normalize_timestamp(timestamp)
    return {key: value for key, value in job.items() if value is not None}


def _metadata_for_item(artifact, scanner_matched):
    """Map scanner metadata to the documented itemMetadata DTO shape.

    The DTO contains scannerMatched plus configuredBy, modifiedBy,
    modifiedDateTime, endorsement {value, certifiedBy}, sensitivity
    {labelId, displayName}, and tags [{id, displayName}] when supplied.
    """
    metadata = {"scannerMatched": scanner_matched}
    if not scanner_matched:
        return metadata
    configured_by = _safe_text(artifact.get("configuredBy"))
    modified_by = _safe_text(artifact.get("modifiedBy"))
    modified = _safe_text(
        artifact.get("modifiedDateTime")
        or artifact.get("lastUpdatedDate")
        or artifact.get("lastUpdatedTime")
    )
    if configured_by:
        metadata["configuredBy"] = configured_by
    if modified_by:
        metadata["modifiedBy"] = modified_by
    if modified:
        metadata["modifiedDateTime"] = _normalize_timestamp(modified)

    artifact_type = artifact.get("_type")
    owner_available = artifact_type in (
        "SemanticModel",
        "Dataflow",
        "Datamart",
    ) or (
        artifact_type == "Report"
        and ("createdBy" in artifact or "createdById" in artifact)
    )
    metadata["ownerAvailable"] = owner_available
    owner_name = None
    owner_id = None
    owner_source = None
    if artifact_type in ("SemanticModel", "Dataflow", "Datamart"):
        owner_name = _safe_text(artifact.get("configuredBy"))
        owner_id = _safe_text(artifact.get("configuredById"))
        owner_source = "workspaceInfo.configuredBy"
    elif artifact_type == "Report":
        owner_name = _safe_text(artifact.get("createdBy"))
        owner_id = _safe_text(artifact.get("createdById"))
        owner_source = "workspaceInfo.createdBy"
    if owner_name or owner_id:
        owner = {"source": owner_source}
        if owner_id:
            owner["principalId"] = owner_id
        if owner_name:
            owner["displayName"] = owner_name
            if "@" in owner_name:
                owner["email"] = owner_name
        metadata["owner"] = owner

    endorsement = artifact.get("endorsement")
    if not isinstance(endorsement, dict):
        endorsement = artifact.get("endorsementDetails")
    if isinstance(endorsement, dict):
        value = _safe_text(
            endorsement.get("value") or endorsement.get("endorsement")
        )
        certified_by = _safe_text(endorsement.get("certifiedBy"))
        if value or certified_by:
            metadata["endorsement"] = {}
            if value:
                metadata["endorsement"]["value"] = value
            if certified_by:
                metadata["endorsement"]["certifiedBy"] = certified_by

    sensitivity = artifact.get("sensitivity")
    if not isinstance(sensitivity, dict):
        sensitivity = artifact.get("sensitivityLabel")
    if isinstance(sensitivity, dict):
        label_id = _safe_text(
            sensitivity.get("labelId") or sensitivity.get("id")
        )
        display_name = _safe_text(
            sensitivity.get("displayName") or sensitivity.get("name")
        )
        if label_id or display_name:
            metadata["sensitivity"] = {}
            if label_id:
                metadata["sensitivity"]["labelId"] = label_id
            if display_name:
                metadata["sensitivity"]["displayName"] = display_name

    tags = []
    for tag in artifact.get("tags") or []:
        if isinstance(tag, str):
            tag_id = _safe_text(tag)
            display_name = None
        elif isinstance(tag, dict):
            tag_id = _safe_text(tag.get("id") or tag.get("tagId"))
            display_name = _safe_text(
                tag.get("displayName") or tag.get("name")
            )
        else:
            continue
        if tag_id:
            entry = {"id": tag_id}
            if display_name:
                entry["displayName"] = display_name
            tags.append(entry)
    if tags:
        metadata["tags"] = tags
    return metadata


def _safe_error_code(error, optional=False):
    if isinstance(error, DeadlineExceeded):
        return "deadline-exhausted"
    if isinstance(error, urllib.error.HTTPError):
        if optional and error.code in (400, 404):
            return "endpoint-unsupported"
        if error.code in (401, 403):
            return "authorization-failed"
        if error.code == 429:
            return "rate-limited"
        if 500 <= error.code <= 599:
            return "transient-upstream"
        return "upstream-http-error"
    if isinstance(error, (ValueError, json.JSONDecodeError)):
        return "invalid-response"
    if isinstance(error, ScannerError):
        return "scanner-failed"
    return "upstream-failure"


def _set_section(out, name, status, code=None):
    section = {"status": status}
    if code:
        section["code"] = code
    out["sections"][name] = section


def _record_failure(out, section, error, optional=False):
    code = _safe_error_code(error, optional=optional)
    status = (
        "unsupported"
        if optional and code == "endpoint-unsupported"
        else "failed"
    )
    _set_section(out, section, status, code)
    out["errors"].append(f"{section}: {code}")
    return code


def _new_optional_tracker():
    return {"success": 0, "unsupported": 0, "failed": 0, "codes": []}


def _track_optional(tracker, result, code=None):
    tracker[result] += 1
    if code and code not in tracker["codes"]:
        tracker["codes"].append(code)


def _finish_optional_section(out, name, tracker):
    if tracker["failed"]:
        _set_section(
            out,
            name,
            "failed",
            tracker["codes"][0] if tracker["codes"] else "upstream-failure",
        )
    elif tracker["success"]:
        _set_section(
            out,
            name,
            "complete",
            "partial-unsupported" if tracker["unsupported"] else None,
        )
    elif tracker["unsupported"]:
        _set_section(
            out,
            name,
            "unsupported",
            tracker["codes"][0]
            if tracker["codes"]
            else "endpoint-unsupported",
        )
    else:
        _set_section(out, name, "unsupported", "not-applicable")


def _set_metadata_capabilities(out):
    scanner = out["sections"].get(
        "scanner",
        {"status": "failed", "code": "scanner-failed"},
    )
    if scanner["status"] == "complete":
        endorsement = {"status": "complete"}
        sensitivity = {"status": "complete", "code": "label-ids"}
        tags = {"status": "complete", "code": "tag-ids"}
        ownership = {"status": "complete", "code": "type-specific"}
    else:
        unavailable = {
            "status": "failed",
            "code": scanner.get("code") or "scanner-failed",
        }
        endorsement = dict(unavailable)
        sensitivity = dict(unavailable)
        tags = dict(unavailable)
        ownership = dict(unavailable)
    out["capabilities"] = {
        "endorsement": endorsement,
        "sensitivity": sensitivity,
        "tags": tags,
        "ownership": ownership,
    }


def _access_right(user):
    for k, v in user.items():
        if k.endswith("UserAccessRight") or k.endswith("AccessRight"):
            return v
    return None


def _lh_tables(token, ws, lid):
    rows = _get_all_data(
        token,
        f"/workspaces/{ws}/lakehouses/{lid}/tables?maxResults=100",
    )
    return _table_records(rows)


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


def _enrich_artifact(token, ws, artifact, trackers, errors):
    artifact_type = artifact.get("_type")
    artifact_id = artifact.get("id")
    detail_path = DETAIL_PATHS.get(artifact_type)
    if detail_path and artifact_id:
        artifact["_detailAttempted"] = True
        try:
            artifact["_detail"] = _get(
                token,
                f"{FABRIC}/workspaces/{ws}/{detail_path}/{artifact_id}",
            )
            _track_optional(trackers["itemDetails"], "success")
        except urllib.error.HTTPError as error:
            code = _safe_error_code(error, optional=True)
            if code == "endpoint-unsupported":
                artifact["_detailError"] = "Item properties are unsupported"
                _track_optional(
                    trackers["itemDetails"],
                    "unsupported",
                    code,
                )
            else:
                artifact["_detailError"] = "Item properties unavailable"
                _track_optional(trackers["itemDetails"], "failed", code)
                errors.append(f"itemDetails: {code}")
        except Exception as error:
            code = _safe_error_code(error, optional=True)
            artifact["_detailError"] = "Fabric REST item properties unavailable"
            _track_optional(trackers["itemDetails"], "failed", code)
            errors.append(f"itemDetails: {code}")

    if artifact_type == "Lakehouse" and artifact_id:
        try:
            artifact["_lakehouseTables"] = _get_all_data(
                token,
                f"/workspaces/{ws}/lakehouses/{artifact_id}/tables?maxResults=100",
            )
            _track_optional(trackers["lakehouseTables"], "success")
        except urllib.error.HTTPError as error:
            artifact["_lakehouseTables"] = []
            code = _safe_error_code(error, optional=True)
            if code == "endpoint-unsupported":
                artifact["_lakehouseTablesError"] = (
                    "Lakehouse table enumeration is unsupported"
                )
                _track_optional(
                    trackers["lakehouseTables"],
                    "unsupported",
                    code,
                )
            else:
                artifact["_lakehouseTablesError"] = (
                    "Lakehouse table enumeration unavailable"
                )
                _track_optional(
                    trackers["lakehouseTables"],
                    "failed",
                    code,
                )
                errors.append(f"lakehouseTables: {code}")
        except Exception as error:
            code = _safe_error_code(error, optional=True)
            artifact["_lakehouseTables"] = []
            artifact["_lakehouseTablesError"] = (
                "Lakehouse Tables REST enumeration failed"
            )
            _track_optional(trackers["lakehouseTables"], "failed", code)
            errors.append(f"lakehouseTables: {code}")

    if artifact_type == "Report" and artifact_id:
        if artifact.get("reportType") == "PaginatedReport":
            artifact["_reportPagesError"] = (
                "Page inventory is not supported for paginated reports"
            )
            _track_optional(
                trackers["reportPages"],
                "unsupported",
                "report-type-unsupported",
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
                _track_optional(trackers["reportPages"], "success")
            except urllib.error.HTTPError as error:
                code = _safe_error_code(error, optional=True)
                if code == "endpoint-unsupported":
                    artifact["_reportPagesError"] = (
                        "Report page inventory is unsupported"
                    )
                    _track_optional(
                        trackers["reportPages"],
                        "unsupported",
                        code,
                    )
                else:
                    artifact["_reportPagesError"] = (
                        "Power BI report page enumeration unavailable"
                    )
                    _track_optional(
                        trackers["reportPages"],
                        "failed",
                        code,
                    )
                    errors.append(f"reportPages: {code}")
            except Exception as error:
                code = _safe_error_code(error, optional=True)
                artifact["_reportPagesError"] = (
                    "Power BI report page enumeration failed"
                )
                _track_optional(trackers["reportPages"], "failed", code)
                errors.append(f"reportPages: {code}")


def _merge_schema_tables(*groups):
    """Deduplicate table names case-insensitively and retain all real columns."""
    merged = {}
    order = []
    for tables in groups:
        for table in tables or []:
            name = _strict_text(table.get("name"))
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
                    "objectType": _strict_text(table.get("objectType")),
                    "source": _strict_text(table.get("source")),
                    "description": _strict_text(table.get("description")),
                    "isHidden": (
                        table.get("isHidden")
                        if isinstance(table.get("isHidden"), bool)
                        else None
                    ),
                    "columns": [],
                    "measures": [],
                }
                safe_rows = _safe_row_count(table.get("rows"))
                if safe_rows is not None:
                    merged[key]["rows"] = safe_rows
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
                (_strict_text(column.get("name")) or "").casefold()
                for column in target["columns"]
            }
            for column in table.get("columns") or []:
                column_name = _strict_text(column.get("name"))
                if column_name and column_name.casefold() not in column_names:
                    target["columns"].append({
                        "name": column_name,
                        "dataType": _strict_text(
                            column.get("dataType") or column.get("type")
                        ) or "column",
                        "description": _strict_text(
                            column.get("description")
                        ),
                        "isHidden": (
                            column.get("isHidden")
                            if isinstance(column.get("isHidden"), bool)
                            else None
                        ),
                    })
                    column_names.add(column_name.casefold())
            measure_names = {
                (_strict_text(measure.get("name")) or "").casefold()
                for measure in target["measures"]
            }
            for measure in table.get("measures") or []:
                measure_name = _strict_text(measure.get("name"))
                if measure_name and measure_name.casefold() not in measure_names:
                    target["measures"].append({
                        "name": measure_name,
                        "expression": _strict_text(
                            measure.get("expression")
                        ),
                        "description": _strict_text(
                            measure.get("description")
                        ),
                        "isHidden": (
                            measure.get("isHidden")
                            if isinstance(measure.get("isHidden"), bool)
                            else None
                        ),
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
            endpoint_id = _normalized_id(endpoint["id"])
            if endpoint_id:
                ids.add(endpoint_id)
        for key in ("sqlEndpointId", "sqlAnalyticsEndpointId"):
            if root.get(key):
                endpoint_id = _normalized_id(root[key])
                if endpoint_id:
                    ids.add(endpoint_id)
        dw_properties = root.get("DwProperties")
        if isinstance(dw_properties, str):
            try:
                parsed_properties = json.loads(dw_properties)
                if isinstance(parsed_properties, dict):
                    roots.append(parsed_properties)
            except (TypeError, ValueError):
                pass
    return ids


def _storage_endpoint_ids(token, ws, storage, arts):
    storage_id = _artifact_id(storage)
    ids = set()
    for artifact in arts:
        if artifact.get("_type") != "SQLEndpoint":
            continue
        if any(
            _normalized_id(relation.get("dependentOnArtifactId"))
            == storage_id
            for relation in artifact.get("relations") or []
            if isinstance(relation, dict)
        ):
            endpoint_id = _artifact_id(artifact)
            if endpoint_id:
                ids.add(endpoint_id)
    ids.update(_metadata_endpoint_ids(storage))
    ids.update(_metadata_endpoint_ids(storage.get("_detail")))
    if storage.get("_type") == "Lakehouse":
        if (
            not storage.get("_detail")
            and not storage.get("_detailAttempted")
        ):
            try:
                detail = _get(
                    token,
                    f"{FABRIC}/workspaces/{ws}/lakehouses/{storage_id}",
                )
                ids.update(_metadata_endpoint_ids(detail))
            except (TypeError, ValueError):
                pass
    return ids


def _downstream_semantic_models(arts, start_ids):
    downstream = {}
    artifact_type = {}
    for artifact in arts:
        artifact_id = _artifact_id(artifact)
        if artifact_id:
            artifact_type[artifact_id] = artifact.get("_type")
        for relation in artifact.get("relations") or []:
            if not isinstance(relation, dict):
                continue
            dependency = _normalized_id(
                relation.get("dependentOnArtifactId")
            )
            if dependency and artifact_id:
                downstream.setdefault(dependency, set()).add(artifact_id)

    models = set()
    pending = [
        normalized
        for value in start_ids
        if (normalized := _normalized_id(value))
    ]
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
        storage_id = _artifact_id(storage)
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
    name = _strict_text(value.get("name")) or ""
    schema_name = _strict_text(
        value.get("schema")
        or value.get("schemaName")
        or value.get("schema_name")
    ) or ""
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
            if not isinstance(column, dict):
                continue
            column_name = _strict_text(column.get("name"))
            if not column_name:
                continue
            columns.append({
                "name": column_name,
                "dataType": _strict_text(
                    column.get("dataType") or column.get("type")
                ) or "column",
                "description": _strict_text(column.get("description")),
                "isHidden": (
                    column.get("isHidden")
                    if isinstance(column.get("isHidden"), bool)
                    else None
                ),
            })
        measures = []
        if include_measures:
            for measure in value.get("measures") or []:
                if not isinstance(measure, dict):
                    continue
                measure_name = _strict_text(measure.get("name"))
                if not measure_name:
                    continue
                measures.append({
                    "name": measure_name,
                    "expression": _strict_text(
                        measure.get("expression")
                    ),
                    "description": _strict_text(
                        measure.get("description")
                    ),
                    "isHidden": (
                        measure.get("isHidden")
                        if isinstance(measure.get("isHidden"), bool)
                        else None
                    ),
                })
        row_source = (
            value.get("rowCount")
            if "rowCount" in value
            else value.get("rows")
        )
        row_count = _safe_row_count(row_source)
        table = {
            "name": name,
            "objectType": _strict_text(
                value.get("objectType") or value.get("type")
            ) or object_type,
            "source": source,
            "description": _strict_text(value.get("description")),
            "isHidden": (
                value.get("isHidden")
                if isinstance(value.get("isHidden"), bool)
                else None
            ),
            "columns": columns,
            "measures": measures,
        }
        if row_count is not None:
            table["rows"] = row_count
        tables.append(table)
    return _merge_schema_tables(tables)


def _item_config(token, ws, a, typ, item_schema=None):
    rows = []

    def add(section, label, value):
        if (
            isinstance(label, (str, int, float))
            and str(label).strip()
            and isinstance(value, (str, int, float, bool))
            and value != ""
        ):
            rows.append({
                "itemId": a.get("id"),
                "section": str(section),
                "label": str(label),
                "value": str(value),
            })

    add("General", "Description", a.get("description"))
    add("General", "Configured by", _safe_text(a.get("configuredBy")))
    add("General", "Modified by", _safe_text(a.get("modifiedBy")))
    add(
        "General",
        "Modified",
        _normalize_timestamp(
            a.get("modifiedDateTime") or a.get("lastUpdatedDate")
        ),
    )
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
        raw_dw = ep.get("DwProperties")
        if isinstance(raw_dw, dict):
            dw = raw_dw
        elif isinstance(raw_dw, str):
            try:
                parsed_dw = json.loads(raw_dw or "{}")
            except (TypeError, ValueError):
                parsed_dw = {}
            dw = parsed_dw if isinstance(parsed_dw, dict) else {}
        else:
            dw = {}
        add(
            "SQL endpoint",
            "Metadata available",
            "Yes" if dw.get("tdsEndpoint") else None,
        )
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
        add(
            "Warehouse",
            "Created",
            _normalize_timestamp(properties.get("createdDate")),
        )
        add(
            "Warehouse",
            "Updated",
            _normalize_timestamp(properties.get("lastUpdatedTime")),
        )
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


def _lineage_collection(artifact, name):
    if name not in artifact or artifact[name] is None:
        return []
    values = artifact[name]
    if not isinstance(values, list):
        raise ValueError(f"scanner {name} collection was invalid")
    if not all(isinstance(value, dict) for value in values):
        raise ValueError(f"scanner {name} record was invalid")
    return values


def _official_lineage(artifacts, workspace_item_ids, workspace_id):
    edges = []
    seen = set()
    normalized_workspace_id = _normalized_id(workspace_id)

    def add(source, target, relation):
        source_id = _normalized_id(source)
        target_id = _normalized_id(target)
        edge = (source_id, target_id, relation)
        if (
            source_id in workspace_item_ids
            and target_id in workspace_item_ids
            and source_id != target_id
            and edge not in seen
        ):
            seen.add(edge)
            edges.append({
                "source": source_id,
                "target": target_id,
                "relation": relation,
            })

    def is_local(value, field):
        if field not in value or value[field] is None:
            return True
        group_id = value[field]
        if not isinstance(group_id, str) or not group_id.strip():
            raise ValueError(
                f"scanner {field} workspace identifier was invalid"
            )
        return _normalized_id(group_id) == normalized_workspace_id

    def add_upstreams(artifact, name, id_field, relation):
        artifact_id = _artifact_id(artifact)
        for upstream in _lineage_collection(artifact, name):
            if is_local(upstream, "groupId"):
                add(upstream.get(id_field), artifact_id, relation)

    for artifact in artifacts:
        artifact_id = _artifact_id(artifact)
        for relation in _lineage_collection(artifact, "relations"):
            dependency = relation.get("dependentOnArtifactId")
            relation_type = relation.get("relationType")
            add(
                dependency,
                artifact_id,
                REL_LABEL.get(
                    relation_type,
                    _safe_text(relation_type) or "depends",
                ),
            )
        if artifact.get("_type") == "Report":
            if is_local(artifact, "datasetWorkspaceId"):
                add(artifact.get("datasetId"), artifact_id, "report")
        if artifact.get("_type") in (
            "Dataflow",
            "Datamart",
            "SemanticModel",
        ):
            add_upstreams(
                artifact,
                "upstreamDataflows",
                "targetDataflowId",
                "dataflow",
            )
            add_upstreams(
                artifact,
                "upstreamDatamarts",
                "targetDatamartId",
                "datamart",
            )
        if artifact.get("_type") == "SemanticModel":
            add_upstreams(
                artifact,
                "upstreamDatasets",
                "targetDatasetId",
                "semantic model",
            )
        if artifact.get("_type") == "Dashboard":
            for tile in _lineage_collection(artifact, "tiles"):
                add(tile.get("reportId"), artifact_id, "dashboard report")
                add(tile.get("datasetId"), artifact_id, "dashboard dataset")
    return edges


def _guard_response_size(value, max_bytes=MAX_RESPONSE_BYTES):
    try:
        size = len(
            json.dumps(
                value,
                ensure_ascii=False,
                separators=(",", ":"),
                allow_nan=False,
            ).encode("utf-8")
        )
    except (TypeError, ValueError) as error:
        raise ResponseSizeExceeded(
            "sync response could not be safely serialized"
        ) from error
    if size > max_bytes:
        raise ResponseSizeExceeded(
            "sync response exceeded the safe size limit"
        )
    return value


@udf.function()
def sync_all(fabricToken: str, workspaceId: str) -> dict:
    """Return the v2 metadata-only Fabric Atlas synchronization envelope."""
    ws = _workspace_id(workspaceId)
    out = {
        "schemaVersion": 2,
        "workspace": None,
        "items": [],
        "roleAssignments": [],
        "access": [],
        "lineage": [],
        "config": [],
        "schema": {},
        "jobs": [],
        "itemMetadata": {},
        "capabilities": {},
        "sections": {
            name: {"status": "failed", "code": "not-run"}
            for name in (
                "workspace",
                "items",
                "roleAssignments",
                "scanner",
                "schema",
                "lineage",
                "access",
                "config",
            )
        },
        "errors": [],
    }
    deadline = _ExecutionDeadline()
    trackers = {
        "itemDetails": _new_optional_tracker(),
        "lakehouseTables": _new_optional_tracker(),
        "reportPages": _new_optional_tracker(),
        "jobs": _new_optional_tracker(),
    }

    with _deadline_scope(deadline):
        try:
            out["workspace"] = _sanitize_workspace(
                _get(fabricToken, f"{FABRIC}/workspaces/{ws}")
            )
            _set_section(out, "workspace", "complete")
        except Exception as error:
            _record_failure(out, "workspace", error)

        try:
            raw_items = _get_all(
                fabricToken,
                f"/workspaces/{ws}/items",
            )
            items = [_sanitize_item(item) for item in raw_items]
            if any(item is None for item in items):
                raise ValueError("workspace items contained invalid metadata")
            out["items"] = items
            _set_section(out, "items", "complete")
        except Exception as error:
            _record_failure(out, "items", error)

        try:
            raw_assignments = _get_all(
                fabricToken,
                f"/workspaces/{ws}/roleAssignments",
            )
            assignments = [
                _sanitize_role_assignment(value)
                for value in raw_assignments
            ]
            if any(value is None for value in assignments):
                raise ValueError(
                    "role assignments contained invalid metadata"
                )
            out["roleAssignments"] = assignments
            _set_section(out, "roleAssignments", "complete")
        except Exception as error:
            _record_failure(out, "roleAssignments", error)

        scan = None
        scanner_artifacts = []
        try:
            scan = _scan_workspace(fabricToken, ws)
            if not isinstance(scan, dict):
                raise ScannerError("scanner result was not an object")
            artifacts_by_id = {}
            for key, artifact_type in ART_KEYS.items():
                values = scan.get(key, [])
                if values is None:
                    values = []
                if not isinstance(values, list):
                    raise ScannerError(
                        "scanner artifact collection was invalid"
                    )
                for value in values:
                    if not isinstance(value, dict):
                        raise ScannerError(
                            "scanner artifact record was invalid"
                        )
                    artifact = dict(value)
                    artifact_id = _artifact_id(artifact)
                    if not artifact_id:
                        continue
                    artifact["id"] = artifact_id
                    artifact["_type"] = artifact_type
                    existing = artifacts_by_id.get(artifact_id)
                    if existing:
                        for field, field_value in artifact.items():
                            existing.setdefault(field, field_value)
                    else:
                        artifacts_by_id[artifact_id] = artifact
            scanner_artifacts = list(artifacts_by_id.values())
            scanned_ids = set(artifacts_by_id)
            expected_scan_ids = {
                item["id"]
                for item in out["items"]
                if item.get("type") in ("SemanticModel", "Report")
            }
            if expected_scan_ids - scanned_ids:
                raise ScannerError(
                    "scanner result omitted expected artifacts"
                )
            missing_model_schema = [
                artifact["id"]
                for artifact in scanner_artifacts
                if artifact.get("_type") == "SemanticModel"
                and not isinstance(artifact.get("tables"), list)
            ]
            if missing_model_schema:
                _set_section(
                    out,
                    "schema",
                    "failed",
                    "scanner-schema-unavailable",
                )
                out["errors"].append(
                    "schema: scanner-schema-unavailable"
                )
            _set_section(out, "scanner", "complete")
        except Exception as error:
            _record_failure(out, "scanner", error)
        _set_metadata_capabilities(out)

        workspace_item_ids = {item["id"] for item in out["items"]}
        scanner_by_id = {
            artifact["id"]: artifact
            for artifact in scanner_artifacts
            if artifact.get("id")
        }
        artifacts_by_id = dict(scanner_by_id)
        for item in out["items"]:
            item_id = item["id"]
            item_type = ITEM_TYPE_ALIASES.get(
                item.get("type"),
                item.get("type"),
            )
            artifact = artifacts_by_id.get(item_id)
            if artifact:
                artifact.setdefault("_type", item_type)
                artifact.setdefault("displayName", item.get("displayName"))
                artifact.setdefault("description", item.get("description"))
            else:
                artifact = dict(item)
                artifact["_type"] = item_type
                artifacts_by_id[item_id] = artifact
            out["itemMetadata"][item_id] = _metadata_for_item(
                artifact,
                item_id in scanner_by_id,
            )
        artifacts = list(artifacts_by_id.values())

        if out["sections"].get("scanner", {}).get("status") == "complete":
            access_failed = False
            for artifact in artifacts:
                artifact_id = _artifact_id(artifact)
                if artifact_id not in workspace_item_ids:
                    continue
                try:
                    _enrich_artifact(
                        fabricToken,
                        ws,
                        artifact,
                        trackers,
                        out["errors"],
                    )
                    users = artifact.get("users") or []
                    if not isinstance(users, list):
                        raise ValueError(
                            "scanner users collection was invalid"
                        )
                    for user in users:
                        if not isinstance(user, dict):
                            raise ValueError(
                                "scanner user record was invalid"
                            )
                        principal_type = _safe_text(
                            user.get("principalType")
                        )
                        user_type = _safe_text(user.get("userType"))
                        tenant_wide = (
                            str(principal_type or "").casefold()
                            in ("none", "entiretenant")
                        )
                        principal_id = (
                            "entire-tenant"
                            if tenant_wide
                            else (
                                _normalized_id(user.get("graphId"))
                                or _safe_text(user.get("identifier"))
                                or _safe_text(user.get("emailAddress"))
                            )
                        )
                        principal_name = (
                            _safe_text(user.get("displayName"))
                            or _safe_text(user.get("emailAddress"))
                            or principal_id
                        )
                        if not principal_id or not principal_name:
                            raise ValueError(
                                "scanner user identity was incomplete"
                            )
                        access = {
                            "itemId": artifact_id,
                            "principalId": principal_id,
                            "principalName": principal_name,
                            "principalType": principal_type,
                            "userType": user_type,
                            "tenantWide": tenant_wide,
                            "accessRight": _safe_text(
                                _access_right(user)
                            ),
                        }
                        email = _safe_text(user.get("emailAddress"))
                        if email:
                            access["principalEmail"] = email
                        out["access"].append({
                            key: value
                            for key, value in access.items()
                            if value is not None
                        })
                except Exception as error:
                    access_failed = True
                    code = _safe_error_code(error)
                    out["errors"].append(f"access: {code}")
            if access_failed:
                _set_section(out, "access", "failed", "invalid-response")
            else:
                _set_section(out, "access", "complete")
            try:
                out["lineage"] = _official_lineage(
                    artifacts,
                    workspace_item_ids,
                    ws,
                )
                _set_section(out, "lineage", "complete")
            except Exception as error:
                out["lineage"] = []
                _record_failure(out, "lineage", error)

            schema_state = out["sections"].get("schema", {})
            schema_failed = (
                schema_state.get("status") == "failed"
                and schema_state.get("code") != "not-run"
            )
            all_schema = {}
            for artifact in artifacts:
                artifact_id = _artifact_id(artifact)
                try:
                    item_schema = _item_schema(
                        fabricToken,
                        ws,
                        artifact,
                        artifact["_type"],
                    )
                    if item_schema:
                        all_schema[artifact_id] = item_schema
                except Exception as error:
                    schema_failed = True
                    out["errors"].append(
                        f"schema: {_safe_error_code(error)}"
                    )
            try:
                _derive_storage_schemas(
                    fabricToken,
                    ws,
                    artifacts,
                    all_schema,
                )
            except Exception as error:
                schema_failed = True
                out["errors"].append(
                    f"schema: {_safe_error_code(error)}"
                )
            out["schema"] = {
                item_id: tables
                for item_id, tables in all_schema.items()
                if item_id in workspace_item_ids
            }
            if schema_failed:
                _set_section(
                    out,
                    "schema",
                    "failed",
                    out["sections"]
                    .get("schema", {})
                    .get("code", "upstream-failure"),
                )
            else:
                _set_section(out, "schema", "complete")

            config_failed = False
            for artifact in artifacts:
                artifact_id = _artifact_id(artifact)
                if artifact_id not in workspace_item_ids:
                    continue
                try:
                    out["config"].extend(
                        _item_config(
                            fabricToken,
                            ws,
                            artifact,
                            artifact["_type"],
                            out["schema"].get(artifact_id, []),
                        )
                    )
                except Exception as error:
                    config_failed = True
                    out["errors"].append(
                        f"config: {_safe_error_code(error)}"
                    )
            _set_section(
                out,
                "config",
                "failed" if config_failed else "complete",
                "upstream-failure" if config_failed else None,
            )
        else:
            scanner_code = out["sections"].get("scanner", {}).get(
                "code",
                "scanner-failed",
            )
            for name in ("access", "lineage", "schema", "config"):
                _set_section(out, name, "failed", scanner_code)
                out["errors"].append(f"{name}: {scanner_code}")

        for item in out["items"]:
            try:
                jobs = _get_all(
                    fabricToken,
                    f"/workspaces/{ws}/items/{item['id']}/jobs/instances",
                )
                _track_optional(trackers["jobs"], "success")
                for value in jobs[:3]:
                    job = _sanitize_job(value, item)
                    if job is None:
                        raise ValueError("job record was invalid")
                    out["jobs"].append(job)
            except urllib.error.HTTPError as error:
                code = _safe_error_code(error, optional=True)
                if code == "endpoint-unsupported":
                    _track_optional(
                        trackers["jobs"],
                        "unsupported",
                        code,
                    )
                else:
                    _track_optional(trackers["jobs"], "failed", code)
                    out["errors"].append(f"jobs: {code}")
            except Exception as error:
                code = _safe_error_code(error, optional=True)
                _track_optional(trackers["jobs"], "failed", code)
                out["errors"].append(f"jobs: {code}")
                if isinstance(error, DeadlineExceeded):
                    break

    for name, tracker in trackers.items():
        _finish_optional_section(out, name, tracker)
    out["syncedAt"] = (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )
    return _guard_response_size(out)
