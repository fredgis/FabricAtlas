import json
import urllib.request
import urllib.error

import fabric.functions as fn

udf = fn.UserDataFunctions()

FABRIC = "https://api.fabric.microsoft.com/v1"


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


@udf.function()
def sync_all(fabricToken: str, workspaceId: str) -> dict:
    """One-shot sync for FabricAtlas: workspace metadata, every item, the full
    list of workspace principals + their access, and recent job runs."""
    out = {
        "workspace": None,
        "items": [],
        "roleAssignments": [],
        "jobs": [],
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
