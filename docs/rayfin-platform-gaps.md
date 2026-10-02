# Phase 4 collector migration and retained UDF fallbacks

Assessment: **2026-10-02, Rayfin 1.36.2**. Cleanup baseline:
`d335f7487955b1cfe7ad0bfa0ac02fe725a6b694`.

## Verified production boundary

The repository has supported Rayfin collector implementations, but it has not
cut the authoritative product Sync over to them. In `src/atlas/backend.ts`,
`runFabricSync` starts the Core/definition/Item Relations/KQL/SQL/Power BI
shadows, then awaits `invokeSyncAll` and publishes only the validated Python
result. `src/atlas/live-sync.ts` still obtains the base through `sync_all` and
all deep slices through `sync_items`.

The installation guide explicitly calls the Functions non-authoritative and
records unverified deployed definition permissions and SQL/TDS identity/runtime
requirements. Fixture/replay parity, a successful build, a shadow count summary
or an Item Relations evidence snapshot is not deployed identity/coverage parity.
No committed removal gate authorizes deleting an active Python collector at
this baseline.

Consequently the UDF is **not yet a minimal scanner-only adapter**. Treat that as
the target architecture, not a description of the current release. Deleting
Core, definition, SQL or KQL collection now would break product Sync or silently
discard required evidence. This cleanup does not invent validation, change the
publisher, activate v2 mutations, provision credentials or deploy either runtime.

## Exact cleanup and retired paths

| Path | State after cleanup | Reason |
| --- | --- | --- |
| `sync_item_relations` | Absent; regression guard prevents reintroduction | The experiment-only Python path was never ported to this branch. `workspaceCollectItemRelations` owns the separate Preview evidence path; authoritative scanner lineage remains separate. |
| `_lh_tables` and the HTTP fallback in `_item_schema` | Removed | Redundant indirect collector. Authoritative deep slices already collect Lakehouse tables through `_enrich_artifact`; schema projection now consumes only that cache or scanner metadata. A failed inventory read cannot secretly retry through a second path. |
| `_sql_metadata_projection` | Removed | Test/offline fixture projector with no production call site. Its regression now exercises the actual `_sql_catalog_projection`; no SQL/TDS fallback was removed. |
| Rayfin shadow payloads | Still non-authoritative | They cannot authorize deleting a compatibility path or publishing a Python-less snapshot. |

These removals are dead/redundant path cleanup, **not a claim that an active
collector passed a deployed Rayfin cutover gate**.

## Exact retained public-function matrix

The only Python UDF registrations remain:

| Function | Retained contract | Why it remains |
| --- | --- | --- |
| `ping(name)` | Bounded smoke response | Existing UDF health/publication compatibility; no metadata collector |
| `sync_all(fabricToken, workspaceId, correlationId?, definitionToken?, kustoToken?, sqlToken?, storageToken?, deferEnrichment?)` | Authoritative v2 base envelope, or existing complete-mode compatibility | The product still requires Python workspace/items/roles, scanner/access/lineage/schema/config and the full enrichment plan before any snapshot can publish |
| `sync_items(fabricToken, workspaceId, itemIds, correlationId?, definitionToken?, kustoToken?, sqlToken?, storageToken?)` | Bounded deep slices, completed/remaining IDs and safe capability statuses | The product still invokes this path for deep collection, job samples and browser-driven continuation |

`storageToken` is an ignored reserved compatibility parameter, not an
implemented OneLake collector. No new entry point, token destination or identity
path is introduced.

## Exact retained collector/helper matrix

All rows are reached by `sync_all` and/or `sync_items`; helper families are
listed so a future cleanup cannot mistake a live projection for a redundant
collector.

| Retained Python call path | Evidence/operation | Rayfin alternative | Exact remaining blocker |
| --- | --- | --- | --- |
| `_get`, `_get_all`, `_sanitize_workspace`, `_sanitize_item`, `_sanitize_role_assignment` from `sync_all` | Fabric workspace, item inventory and workspace roles | `workspaceCollectCore` | Product consumes only Python; approve deployed AppBackend-identity Core parity and wire a validated authoritative composition before removing these required reads |
| `_get_all`, `_sanitize_job` from complete-mode `sync_all` and `sync_items` | Up to three projected recent jobs per item | `workspaceCollectCore` | Preserve the product's per-item deep-slice sampling and statuses; shadow sampling/counts are not a validated authoritative replacement |
| `_scan_workspace` | Power BI `getInfo`, status polling, result; scanner schema/owners/users and item bindings | Optional `workspaceCollectPowerBiScanner` | Dedicated Secret Store credentials/scope and tenant admin-scanning settings have not been deployed/validated; scanner merge/publication integration also remains gated |
| `_metadata_for_item`, `_access_right`, `_official_lineage`, `_lineage_collection` | Selected owner/access/endorsement/sensitivity/tags and verified scanner lineage | Power BI/definition/Item Relations stages | Scanner evidence remains required. Do not substitute Preview Item Relations, static bindings or missing access with empty/complete evidence |
| `_enrich_artifact` with `DETAIL_PATHS`, `_merge_detail_metadata` | Public item properties for Lakehouse, Warehouse, SQLDatabase, Eventhouse, KQLDatabase, Ontology, GraphModel and DataAgent | KQL/SQL/definition stages | No complete deployed identity/field parity and no authoritative stage consumer for these property/config facts |
| `_enrich_artifact` with `_get_all_data`, `_table_records`, cached `_lakehouseTables` | Public Lakehouse Tables inventory | SQL metadata stage for supported SQL catalog evidence | Lakehouse REST object kinds and scanner/downstream-model merging are not replaced by a shadow SQL catalog. Keep this single direct collector until equivalent inventory parity is approved |
| `_enrich_artifact` Report branch | Public Power BI report pages, with explicit unsupported paginated-report status | PBIR pages in `workspaceCollectPowerBi` | PBIR-Legacy pages are not covered, definition read/write identity parity is unverified, and the optional scanner does not collect pages |
| `_get_definition`, `_project_definition`, `_project_ontology_definition`, `_project_graph_definition`, `_project_data_agent_definition` | Selected public definitions, objects, bindings and config facts | `workspaceCollectDefinitions` | Deployed read/write definition token/owner permissions and complete schema/object-edge/config parity remain unverified; replay parity alone is insufficient |
| `_collect_kql_schema`, `_kusto_schema`, `_kusto_entities`, `_kusto_url` | Fixed read-only Kusto metadata management query; no function bodies or business results | KQL `DatabaseSchema.kql` structural definition stage | No documented Kusto Functions audience; held/delegated-only connector authoring and definition-only coverage do not replace external tables, live schemas or query-derived columns |
| `_collect_sql_schema`, `_sql_endpoint`, `_sql_database_name`, `_pack_sql_access_token`, `_load_mssql_driver`, `_sql_connect`, `_sql_fetch_rows`, `_sql_catalog_projection` | Constant `sys.*` objects/columns, primary keys and foreign keys for SQLDatabase | `workspaceCollectSqlMetadata` | Deployed outbound TDS, Sql-token principal/catalog permissions, driver cleanup and parity still need validation; do not remove this fallback merely because a Function compiles |
| `_storage_endpoint_ids`, `_metadata_endpoint_ids`, `_downstream_semantic_models`, `_derive_storage_schemas` | Verified storage-to-endpoint-to-model joins and labeled downstream schema subsets | Future authoritative composed Core/SQL/model stages | No validated replacement for the existing subset merge/source-boundary behavior; no display-name matching is permitted |
| `_item_schema`, `_schema_objects`, `_merge_schema_tables`, `_finalize_schema_object_ids`, `_public_schema` | Pure projection of collected metadata and stable object identities | Existing Functions projections | Required compatibility DTO/source labels and downstream merge semantics must remain until the authoritative consumer changes; `_item_schema` performs no HTTP collection |
| `_item_config`, `_collect_atlas_object_edges`, definition/object-reference helpers | Required config, verified object edges and selected artifact metadata | Definition/SQL/model projections | Preserve the required schema/config/object-edge contract and privacy boundary; a partial structural stage cannot silently erase richer compatibility evidence |
| `_ExecutionDeadline`, `_deadline_scope`, `_req_response`, `_req`, `_read_response_bytes`, `_guard_response_size`, validators and trackers | Common bounds, strict inputs, continuation and safe status/serialization | Functions' bounded clients | Retained safeguards for every active fallback, not alternate metadata sources or a durable execution engine |

## Retained fallback bounds

- Each invocation has one 180-second monotonic budget below Fabric's 200-second
  timeout, with 20 seconds reserved for projection/serialization.
- HTTP attempts have 20-second request/read limits, at most four attempts,
  bounded backoff/Retry-After and no redirects.
- Upstream and final envelopes are capped at 25 MiB. Definition decoding is
  capped at 8 MiB and 500 parts, with bounded facts/selected elements.
- Both Fabric list collectors stop at **100 pages or 50,000 aggregate records**.
  Exhaustion fails with `pagination-invalid`, never a truncated success.
- The admin scanner makes at most 30 status polls. It does not request
  datasource details or ordinary DAX/business query results.
- SQL uses only the three constant `sys.*` catalog queries, 50,000 object rows
  and 5,000 PK/FK rows, explicit query/connection deadlines and cleanup.
- A deep slice stops before another item when fewer than 30 seconds remain.
  The browser's split/retry/no-progress and final snapshot validation gates are
  unchanged.

Focused regressions prove retired names have no definition/call site, schema
projection cannot issue HTTP requests, retained Lakehouse inventory is collected
once, errors cannot re-enter the retired path, page/record limits fail closed,
scanner polling stays bounded, and a valid deferred empty workspace still
satisfies every required base section.

## Identity and capability gaps

The generic Power BI Functions audience is absent, but the optional Secret Store
service-principal scanner is a documented alternative in 1.36.2. The blocker is
now **operator provisioning, tenant validation and authoritative integration**,
not a fabricated assertion that Secret Store cannot support it. Exact required
secrets/settings are in [powerbi-scanner-secret-store.md](powerbi-scanner-secret-store.md).

The tenant must approve the scanner service principal for read-only admin APIs
and enable detailed metadata and DAX/mashup responses. The application must not
have admin-consent-required Power BI permissions. No credentials are provisioned
by this cleanup; the Python delegated scanner stays active.

Neither the Python UDF nor the active product executes INFO/DMV/XMLA engine
dependency queries. Python collects scanner measure DAX, and the frontend
resolves a static dependency subset. A complete engine graph is an **unsupported
capability**, not an existing engine fallback that can be removed or promised.

The Kusto application-identity and deployed SQL/definition identity/coverage
gates remain explicit; keep their compatibility paths as listed above.

## Durable execution and scheduled refresh

Python is not a timer, queue trigger, lease manager or unattended continuation
driver. The product still needs its browser/external caller to invoke the next
slice. The implemented v2 graph/checkpoint/SQL-control framework does not activate
itself: cross-host serialization, immutable checksum-verified payload activation
and a non-interactive driver must be validated before that cutover.

Scheduled refresh remains disabled. Closing the browser may preserve committed
records but does not execute the remaining slices. These orchestration gaps
must not be described as a Python durable fallback or as proof that all
Functions collectors are ready to replace production.

## Removal gate

Delete an active compatibility call path only when its replacement is:

1. publicly documented and available in deployed Fabric Apps;
2. exercised with the actual deployed identity and tenant/resource permissions;
3. compared against the previous UDF's fields, statuses, item/object identities,
   config, privacy and lineage boundaries;
4. consumed by the authoritative Sync path behind its existing validation and
   manifest-last publication gates;
5. covered by bounded failure/regression tests.

Until those gates pass, the exact minimal safe cleanup is the retired/redundant
paths above. Documentation and #42 must describe this retained matrix rather
than claim a scanner-only UDF or a completed Phase 4 runtime cutover.
