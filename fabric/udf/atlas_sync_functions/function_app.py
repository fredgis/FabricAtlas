import json
import urllib.request
import urllib.error

import fabric.functions as fn

udf = fn.UserDataFunctions()

FABRIC = "https://api.fabric.microsoft.com/v1"
PBI = "https://api.powerbi.com/v1.0/myorg"


def _get(token: str, url: str):
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=110) as r:
        return json.loads(r.read().decode("utf-8"))


def _get_all(token: str, path: str):
    """GET a Fabric list endpoint, following continuationUri pagination."""
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
    # Workspace users/groups/service principals and their workspace role
    # (Admin / Member / Contributor / Viewer) - feeds the Access tab.
    return _get_all(fabricToken, f"/workspaces/{workspaceId}/roleAssignments")


@udf.function()
def get_workspace(fabricToken: str, workspaceId: str) -> dict:
    return _get(fabricToken, f"{FABRIC}/workspaces/{workspaceId}")


def _compute_lineage(token: str, ws: str, items: list) -> list:
    """Real edges between items, derived from the Fabric/Power BI REST APIs:
       Lakehouse -> its SQL endpoint, Report -> its semantic model, and
       semantic model -> its Direct Lake source (lakehouse / SQL endpoint)."""
    edges = []

    def find_item(key):
        if not key:
            return None
        k = str(key).lower()
        for it in items:
            if str(it.get("id", "")).lower() == k or str(it.get("displayName", "")).lower() == k:
                return it.get("id")
        return None

    # Lakehouse -> SQL endpoint (exact, from the lakehouse properties).
    for it in items:
        if it.get("type") == "Lakehouse":
            try:
                lh = _get(token, f"{FABRIC}/workspaces/{ws}/lakehouses/{it['id']}")
                ep = (((lh or {}).get("properties") or {}).get("sqlEndpointProperties") or {}).get("id")
                if ep:
                    edges.append({"source": it["id"], "target": ep, "relation": "SQL endpoint"})
            except Exception:
                pass

    # Report -> semantic model (report.datasetId).
    try:
        reports = (_get(token, f"{PBI}/groups/{ws}/reports") or {}).get("value", [])
        for r in reports:
            ds = r.get("datasetId")
            rid = r.get("id")
            if ds and rid:
                edges.append({"source": ds, "target": rid, "relation": "report"})
    except Exception:
        pass

    # Semantic model -> Direct Lake source (lakehouse / SQL endpoint).
    for it in items:
        if it.get("type") == "SemanticModel":
            try:
                dss = (_get(token, f"{PBI}/groups/{ws}/datasets/{it['id']}/datasources") or {}).get("value", [])
                for d in dss:
                    cd = d.get("connectionDetails") or {}
                    tgt = find_item(cd.get("database")) or find_item(cd.get("path"))
                    if tgt and tgt != it["id"]:
                        edges.append({"source": tgt, "target": it["id"], "relation": "Direct Lake"})
            except Exception:
                pass

    # De-duplicate on (source, target).
    seen = set()
    out = []
    for e in edges:
        k = (e["source"], e["target"])
        if k not in seen:
            seen.add(k)
            out.append(e)
    return out


@udf.function()
def sync_all(fabricToken: str, workspaceId: str) -> dict:
    """One-shot sync for Fabric Atlas: workspace metadata, every item, the full
    list of workspace principals + their access, recent job runs, and the real
    lineage between items."""
    out = {
        "workspace": None,
        "items": [],
        "roleAssignments": [],
        "jobs": [],
        "lineage": [],
        "syncedAt": None,
        "errors": [],
    }

    try:
        out["workspace"] = _get(fabricToken, f"{FABRIC}/workspaces/{workspaceId}")
    except Exception as e:
        out["errors"].append("workspace: " + str(e))

    try:
        out["items"] = _get_all(fabricToken, f"/workspaces/{workspaceId}/items")
    except Exception as e:
        out["errors"].append("items: " + str(e))

    # Users of the workspace and their accesses (for the Access tab).
    try:
        out["roleAssignments"] = _get_all(
            fabricToken, f"/workspaces/{workspaceId}/roleAssignments"
        )
    except Exception as e:
        out["errors"].append("roleAssignments: " + str(e))

    # Real lineage between items.
    try:
        out["lineage"] = _compute_lineage(fabricToken, workspaceId, out["items"])
    except Exception as e:
        out["errors"].append("lineage: " + str(e))

    # Recent job instances per item (best-effort, capped to stay within limits).
    for it in out["items"][:50]:
        iid = it.get("id")
        if not iid:
            continue
        try:
            jobs = _get_all(
                fabricToken, f"/workspaces/{workspaceId}/items/{iid}/jobs/instances"
            )
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
