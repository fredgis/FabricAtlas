# atlas_sync_functions — Fabric User Data Function

This is the server-side function Fabric Atlas calls when you click **Sync**. It
runs inside Fabric, receives the signed-in user's token, and returns the whole
workspace picture: items, **per-item access** (who can see each item, not just the
workspace), the real **lineage** between items, per-item **config**, and recent
jobs. See the "Why a Fabric User Data Function?" note in the
[root README](../../../README.md) for the reasoning.

Per-item access and lineage come from the Fabric **admin scanner** (`getInfo`),
which needs the `Tenant.Read.All` delegated permission (already consented on the
`FabricAtlas Sync` app registration) and the tenant's read-only admin API settings
enabled. If the scanner is unavailable, `sync_all` still returns items, workspace
roles and jobs, and reports the reason in `errors`.

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
| `sync_all` | `fabricToken, workspaceId` | `{ workspace, items, roleAssignments, access, lineage, config, jobs }` — used by the app |

## Publish (once)

1. Open your workspace in the Fabric portal.
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

The app authenticates with the Entra app registration you created (see
[docs/installation.md](../../../docs/installation.md)), whose client id is provided
through `VITE_ATLAS_SPA_CLIENT_ID`, with the delegated permissions consented and the
app's hosting origin registered as a SPA redirect URI.
