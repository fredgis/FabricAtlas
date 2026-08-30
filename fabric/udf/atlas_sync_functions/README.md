# atlas_sync_functions — Fabric User Data Function

This is the server-side function Fabric Atlas calls when you click **Sync**. It
runs inside Fabric, receives the signed-in user's token, and returns the whole
workspace picture: items, **per-item access** (who can see each item, not just the
workspace), the real **lineage** between items, per-item **config**, and recent
jobs. Contract version 2 also reports collection status for each section and
metadata capability. See the "Why a Fabric User Data Function?" note in the
[root README](../../../README.md) for the reasoning.

Per-item access and lineage come from the Fabric **admin scanner** (`getInfo`),
which needs the `Tenant.Read.All` delegated permission (already consented on the
`FabricAtlas Sync` app registration) and the tenant's read-only admin API settings
enabled. The browser rejects any failed required section and keeps the previous
database snapshot active. Optional enrichment failures remain visible in the
contract without invalidating complete required metadata. Scanner access is
therefore required for a synchronized result to become authoritative.

Lineage uses documented immutable identifiers for Report bindings, Dashboard
tiles and upstream Dataflow, Datamart and Semantic Model dependencies. A
dependency is accepted only when its scanner `groupId` is absent or matches the
current workspace. Display names are never used to invent an edge.

`sync_all` uses one 92-second monotonic deadline, including response reads,
bounded retries and `Retry-After` sleeps. It caps upstream and final payloads at
25 MiB, below the 100-second and 30 MB public endpoint limits.

For schema-enabled lakehouses, the lakehouse `/tables` endpoint may return a
schema wrapper or no usable result. The UDF flattens schema/table responses when
available and otherwise follows real Fabric metadata IDs through **Lakehouse →
SQL analytics endpoint → Semantic model**. Tables and columns come from the
admin scanner's semantic-model schema; names are deduplicated without inventing
objects or columns.

## Object inventory coverage

| Fabric item | Inventory returned |
| --- | --- |
| Lakehouse | All objects returned by the paginated Lakehouse Tables REST API (managed/external type). Columns are merged from scanner metadata and downstream semantic models reached through the real SQL endpoint ID. |
| Warehouse | Tables/views/columns when the admin scanner supplies them. Otherwise downstream semantic-model objects are returned as a clearly labelled subset. Fabric REST item properties are captured, but complete inventory requires SQL catalog access. |
| SQL Database | Same safe behavior as Warehouse: scanner objects first, downstream model subset second, REST properties/config facts always. Complete inventory requires SQL catalog access. |
| Semantic Model | Scanner tables, columns, measures, descriptions, hidden flags and measure expressions. |
| Report | Pages from the supported Power BI `Get Pages In Group` API. The admin scanner and Reports REST do not expose visuals or field bindings, so those are explicitly reported as unavailable rather than fabricated. |

The supported calls require the corresponding delegated permissions:
`Tenant.Read.All`, `Lakehouse.Read.All`, `Warehouse.Read.All` or `Item.Read.All`,
`SQLDatabase.Read.All` or `Item.Read.All`, and `Report.Read.All`. A privilege or
service failure on a required metadata call is added to `errors`; the browser
then retains the last known-good snapshot. Optional enrichment failures and
expected unsupported cases, such as table enumeration requiring a SQL
connection, are returned as section evidence or config facts.

API references: [Lakehouse List Tables](https://learn.microsoft.com/rest/api/fabric/lakehouse/tables/list-tables),
[Get Warehouse](https://learn.microsoft.com/rest/api/fabric/warehouse/items/get-warehouse),
[Get SQL Database](https://learn.microsoft.com/rest/api/fabric/sqldatabase/items/get-sql-database),
[Power BI scanner result](https://learn.microsoft.com/rest/api/power-bi/admin/workspace-info-get-scan-result),
and [Get Pages In Group](https://learn.microsoft.com/rest/api/power-bi/reports/get-pages-in-group).

> Fabric now exposes
> [`getDefinition`](https://learn.microsoft.com/rest/api/fabric/userdatafunction/items/get-user-data-function-definition)
> and
> [`updateDefinition`](https://learn.microsoft.com/rest/api/fabric/userdatafunction/items/update-user-data-function-definition)
> REST APIs for User
> Data Functions. They require a delegated **user** token with
> `Item.ReadWrite.All`; service principals and managed identities are not
> supported. Always round-trip the deployed definition and preserve every
> returned part, replacing `function_app.py` and the library version in
> `definition.json` only when those changes are intentional.

## Functions

| Function | Params | Returns |
| --- | --- | --- |
| `ping` | `name` | smoke test |
| `list_items` | `fabricToken, workspaceId` | workspace items |
| `list_role_assignments` | `fabricToken, workspaceId` | users/groups + their workspace role |
| `get_workspace` | `fabricToken, workspaceId` | workspace metadata |
| `sync_all` | `fabricToken, workspaceId` | Schema v2 payload with workspace data, required/optional section status, metadata capabilities and safe errors |

Required sections are `workspace`, `items`, `roleAssignments`, `scanner`,
`schema`, `lineage`, `access` and `config`. Optional sections are `jobs`,
`itemDetails`, `lakehouseTables` and `reportPages`. Valid empty workspaces are
authoritative when every required section completes.

## Publish or update

1. Open your workspace in the Fabric portal.
2. Open the item **`atlas_sync_functions`** (User Data Function).
3. In the editor, make sure the code matches [`function_app.py`](./function_app.py)
   (paste it if the editor is empty) and that `requirements.txt` keeps the
   pinned `fabric-user-data-functions` version from this directory.
4. Click **Publish**. When it finishes, copy the **invoke URL** of `sync_all`.

For repeatable automation, first call the UDF `getDefinition` endpoint, poll its
long-running operation, preserve the returned `definition.json` and `.platform`
parts, replace the Base64 payloads of `function_app.py` and
`requirements.txt`, and submit the complete part set to `updateDefinition`.
Poll the update operation, read the definition back, compare both content
hashes, and invoke `ping` before testing `sync_all`. Do not send a hand-built
partial definition: deployed UDF generations can return different metadata
part sets.

## Wire the app

1. Add the invoke URL to the git-ignored `rayfin/.env` file:
   `RAYFIN_PUBLIC_ATLAS_UDF_URL=https://<...>/functions/sync_all/invoke`.
2. Run `npx rayfin up` so the public URL is included in the deployed bundle.
3. Open Fabric Atlas and click **Start first sync** (or **Sync** after the workspace has already
   been indexed). Approve the sign-in popup once
   (`UserDataFunction.Execute.All` + Power BI read). The catalog loads and is
   written to the Atlas database.

The app authenticates with the Entra app registration you created (see
[docs/installation.md](../../../docs/installation.md)), whose client id is provided
through `VITE_ATLAS_SPA_CLIENT_ID`, with the delegated permissions consented and the
app's hosting origin registered as a SPA redirect URI.

## Security boundary

- `workspaceId` must be a UUID, pagination is fail-closed, and continuation URLs
  are restricted to `https://api.fabric.microsoft.com`.
- The caller's delegated token still determines which Fabric workspaces can be
  read.
- After metadata is persisted, Rayfin controls application access. Fabric Atlas
  v1.x gives the complete authenticated app audience shared read access to the
  synchronized governance graph and team notes; personal review state remains
  user-scoped.
- Scanner output is allowlisted. Table rows, datasource and connection details,
  dataset/table Mashup expressions, Power Query definitions and source code are
  never emitted. `datasetExpressions=True` is used only to retain measure DAX.
- Ownership is emitted only from documented type-specific fields. Sensitivity
  labels and tags remain stable IDs when no trusted display-name lookup exists.
- The current portable Fabric UDF Python API does not expose the containing
  workspace/item identity to this function. Consequently, the UDF cannot
  independently enforce “only its deployed workspace” without a deployment-time
  workspace setting. No workspace ID is hardcoded in tracked source; this remains
  a deployment/runtime limitation.
