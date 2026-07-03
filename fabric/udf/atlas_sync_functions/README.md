# atlas_sync_functions — Fabric User Data Function

This is the server-side function Fabric Atlas calls when you click **Sync**. It
runs inside Fabric, receives the signed-in user's token, calls the Fabric REST
APIs on their behalf, and returns the workspace catalog — items, the list of
**workspace users and their access**, and recent jobs. See the
"Why a Fabric User Data Function?" note in the [root README](../../../README.md)
for the reasoning.

> Fabric has **no REST API to publish a UDF** and does not persist the Python
> through `updateDefinition`, so the code is kept here and published once from the
> portal.

## Functions

| Function | Params | Returns |
| --- | --- | --- |
| `ping` | `name` | smoke test |
| `list_items` | `fabricToken, workspaceId` | workspace items |
| `list_role_assignments` | `fabricToken, workspaceId` | users/groups + their workspace role |
| `get_workspace` | `fabricToken, workspaceId` | workspace metadata |
| `sync_all` | `fabricToken, workspaceId` | `{ workspace, items, roleAssignments, jobs }` — used by the app |

## Publish (once)

1. Open the workspace **FGI-MAIN** in the Fabric portal.
2. Open the item **`atlas_sync_functions`** (User Data Function).
3. In the editor, make sure the code matches [`function_app.py`](./function_app.py)
   (paste it if the editor is empty) and that the library
   `fabric-user-data-functions` is listed.
4. Click **Publish**. When it finishes, copy the **invoke URL** of `sync_all`.

## Wire the app

1. Open Fabric Atlas (the `fabricatlas` app item / its hosting URL).
2. On the first-run screen, paste the `sync_all` invoke URL in **Sync endpoint**
   and click **Save**.
3. Click **Sync this workspace**. Approve the sign-in popup once
   (`UserDataFunction.Execute.All` + Power BI read). The catalog loads and is
   written to the Atlas database.

The app authenticates with the Entra app registration **FabricAtlas Sync**
(client id `16998994-9439-4e94-a401-4ac8ce7c8c02`), which already has the
delegated permissions consented and the app's hosting origin as a SPA redirect
URI.
