# Source and security provenance

Phase 8 extends the [#18](https://github.com/fredgis/FabricAtlas/issues/18)
external-lineage principles to mirrored and shortcut sources. Atlas tracks
mirroring and shortcut relationships that documented Fabric contracts expose
with explicit identifiers. It builds no ingestion connectors and no bespoke
partner adapters, and it never matches anything by name.

## Read-only adapter

`workspaceCollectSourceProvenance` in
`rayfin/functions/src/workspace-source-provenance.ts` declares only the Fabric
audience, runs behind the `SynchronizerAuthority` gate and uses the Fabric
application identity. It is **adapter only**: the browser does not call it
yet, nothing is written to Rayfin and nothing becomes authoritative lineage.

```ts
await client.functions.workspaceCollectSourceProvenance.invoke({
  protocolVersion: 1,
  workspaceId,
  items: [
    { id: lakehouseId, type: "Lakehouse" },
    { id: mirroredDatabaseId, type: "MirroredDatabase" },
  ],
  correlationId: null,
});
```

Inputs are 1-16 unique `{ id, type }` items with strict UUIDs. Other item
types return `unsupported/item-type-unsupported` without a request.

| Section | Item types | Documented contract | Kept | Dropped |
| --- | --- | --- | --- | --- |
| Shortcuts | Lakehouse, Warehouse, KQL database | [List Shortcuts](https://learn.microsoft.com/en-us/rest/api/fabric/core/onelake-shortcuts/list-shortcuts), GA, user/SP/MI | Name, path, target type, OneLake target workspace/item ID and path, external `connectionId`, transform type, SharePoint label-sync flag | `location`, `bucket`, `subpath`, `environmentDomain`, `deltaLakeFolder`, `tableName` and undocumented fields |
| Mirroring | Mirrored database | [Get Mirrored Database](https://learn.microsoft.com/en-us/rest/api/fabric/mirroreddatabase/items/get-mirrored-database), [Get Definition](https://learn.microsoft.com/en-us/rest/api/fabric/mirroreddatabase/items/get-mirrored-database-definition) with [`mirroring.json`](https://learn.microsoft.com/en-us/rest/api/fabric/articles/item-management/definitions/mirrored-database-definition), [Get Mirroring Status](https://learn.microsoft.com/en-us/rest/api/fabric/mirroreddatabase/mirroring/get-mirroring-status) | SQL endpoint ID, default schema, source type and subtype, source and external-storage connection IDs, landing-zone workspace/item IDs, target format and retention, selected `schema.table` names, replication state | Source database name, landing-zone root folder, OneLake and SQL connection URLs |
| MLV execution definitions | Lakehouse | [List MLV Execution Definitions](https://learn.microsoft.com/en-us/rest/api/fabric/lakehouse/materialized-lake-views/list-mlv-execution-definitions), user/SP/MI | Definition ID and name, refresh mode, selected view names, lakehouse and environment references by ID, count of Variable Library references | Description and Variable Library references, which are never resolved |

`getDefinition` needs read **and write** permission on the mirrored database.
A denial is reported as `unsupported/read-write-permission-required` and the
properties and replication state remain usable. Other denials are
`unsupported/authorization-failed`. Throttling beyond the bounded
`Retry-After`, deadlines, budgets and cancellation stop the batch and mark
the remaining work `not-attempted`.

Bounds: 150-second budget, 160 requests, 20 list pages, 1,000 shortcuts and
200 MLV definitions per item, 500 references per definition, 2,000 mirrored
tables, 2 MiB decoded definition part and a 16 MiB envelope. Truncation is
explicit as `projection-truncated`.

## Provenance contract

`buildSourceProvenance(envelope, snapshotItemIds)` in
`src/atlas/source-provenance.ts` turns one envelope into contract version 1:

- **Nodes.** Fabric items use `fabric-item:{workspaceId}:{itemId}` and record
  whether they are in the current snapshot. External sources use the
  namespaced `fabric-connection:{connectionId}` with the verbatim provider type
  (`AdlsGen2`, `Snowflake`, `Oracle`, ...). No URL is stored.
- **Edges** go from the upstream provider to the consuming item:
  `onelake-shortcut`, `external-shortcut`, `mirroring-source`,
  `mirroring-external-storage`, `mirroring-landing-zone` and
  `mirrored-sql-endpoint`. Each edge records the documented field that carried
  the identifier, the shortcut location when relevant, the observation time and
  `authoritative: false`.
- **Keys** are deterministic from relation, source, consumer, field and
  location. Replaying the same evidence or reordering items yields identical,
  de-duplicated output.
- **Unresolved records** replace edges when an identifier is missing: a
  OneLake target without IDs, an external target without a connection ID, or
  a Variable Library reference. Missing evidence never produces an edge.
- **MLV refresh scope** is Lakehouse-adjacent orchestration evidence, not
  directed lineage.

## Policy origin versus destination enforcement

`PolicyOriginEvidence` records where a policy originates and what Atlas
observed. Its `destinationEnforcement` is always `not-verified`:

| Mechanism | Origin | Evidence |
| --- | --- | --- |
| `sensitivity-label-sync` | OneDrive/SharePoint source | `configured` or `not-configured` from the documented `updateFabricItemSensitivity` flag; the resulting Fabric label is not verified |
| `target-access-evaluation` | Shortcut target | `unavailable`; target OneLake security is not collected |
| `source-permission-replication` | Mirroring source | `unavailable`; `mirroring.json` exposes no replicated roles, and replicated source roles (for example Snowflake security-role replication, Preview) have no public read API |

Access Review keeps its own restriction layers (OneLake security, Purview DLP,
Fabric Policies) as unsupported or unavailable; provenance never upgrades them.

## Real-tenant verification (2026-10-02)

Run with a delegated user token against the four reference workspaces:

- 16 Lakehouse, Warehouse and KQL database items: every shortcut and MLV
  section `complete`; all shortcuts were OneLake targets with explicit IDs,
  including cross-workspace targets and targets of type MirroredDatabase.
- A workspace on an inactive capacity: `unsupported/endpoint-unsupported`.
- One mirrored database: properties, definition and status `complete`, Oracle
  source with a connection ID, 5 selected tables, SQL endpoint ID and
  `Running` replication.

Not yet verified: the same calls under the deployed Functions application
identity. The documented contracts list service principal and managed
identity support for every route used here.

## Deferred

- Publishing provenance into snapshots and Map & lineage: waits for the
  durable snapshot cutover and a reviewed persistence shape.
- Partner-specific adapters (BigQuery, Salesforce, lakeFS, Business Central,
  Snowflake role replication): no stable common provenance API. Their Fabric
  mirroring or shortcut surface is covered generically when Fabric returns
  explicit IDs, for example a `GoogleBigQuery` mirroring source type.
- Shortcut target security, DLP and replicated source policies: no public
  read API.

## Validation

```powershell
npx --no-install rayfin functions init
npm test -- src\atlas\workspace-source-provenance.spec.ts src\atlas\source-provenance.spec.ts src\atlas\durable-sync.spec.ts src\lib\rayfin-client.spec.ts
npm --prefix rayfin\functions run build
```
