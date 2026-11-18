# Rayfin platform gaps

Last review: **18 November 2026, Rayfin 2.0.1 (GA)**. First assessment:
3 October 2026, Rayfin 1.36.2.

Fabric Atlas collects almost everything with typed Rayfin Functions. Python
(`sync_compatibility`) stays only where Rayfin lacks a usable contract, and
scheduled sync stays off until Rayfin can run work without a browser.

## Summary

| Gap | Rayfin 2.0.1 | Atlas today | Closes when |
|---|---|---|---|
| Power BI admin scanner (application identity) | New **custom audiences**: a Function can request a token for `https://analysis.windows.net/powerbi/api` as the app identity | Python UDF | A deployed probe calls `getInfo` and the scan result with that token |
| Kusto live schema | KQL connector (`eventhouse`, renamed `kusto` on `main`) exists but its **authoring is held** and it is experimental ([source](https://github.com/microsoft/rayfin/blob/main/packages/guide/assets/docs/cli/connectors/index.md)). Custom audiences are the other path | Python UDF | Rayfin lifts the hold, or a custom-audience probe passes |
| PBIR-Legacy report pages | No contract | Python UDF | A supported page path exists |
| Semantic model engine metadata | `fabric-semanticmodel` connector is still `delegated` only | Static DAX references | An application-identity metadata connector exists |
| Unattended timer or trigger | None | Sync starts in the browser | A Function can run on a schedule as the app |
| Claim, lease and fencing across hosts | Raw SQL in Functions (`ctx.sql.execute`) allows a single-statement compare-and-set, but bypasses entity policies | Not adopted | A supported transaction or fencing contract exists |
| OneLake security detail | No public contract for group expansion or constraint text | Partial evidence | Public API |
| Purview DLP restriction state | No public contract | Marked unsupported | Public API |
| Fabric Policies evaluation | No public operation | Unavailable unless a tenant contract is supplied | Public API |

Atlas never stores or replays browser tokens to work around these gaps.

## What Rayfin 2.0 changes

- **Custom audiences** (`functions/connections`): any resource URI or app ID,
  token issued to the app identity (the app item's owner). This is the
  candidate replacement for the Power BI and Kusto parts of the Python UDF.
  Not yet tested on a tenant.
- **Raw SQL** (`ctx.sql.query` / `ctx.sql.execute`, MSSQL): runs as the app
  and skips row policies, so Atlas does not use it for sync ownership.
- **Caller identity** (`ctx.user.id`, `ctx.getClaims()`): available; Atlas
  keeps the `SynchronizerAuthority` row as the authorization check.
- **Still missing**: timer/trigger, application-identity semantic model
  metadata, PBIR-Legacy pages, and a usable KQL connector.

## Entity naming constraint

Data API Builder treats a GraphQL type whose name ends in `Connection` as a
pagination type, so create and read fail with an internal error. The entity is
named `ConnectionEntry` since 2.8.2 and a schema test rejects such names.

## Rayfin collection in use

`workspaceCollectCore`, `workspaceCollectDefinitions`, `workspaceCollectPowerBi`,
`workspaceCollectItemRelations`, `workspaceCollectKqlMetadata`,
`workspaceCollectSqlMetadata`, `workspaceCollectSourceProvenance`,
`workspaceCollectAccessPolicyEvidence`, `workspaceCollectGovernance` (2.6) and
`tenantCollectConnections` (2.8, once per batch). The browser merges these
envelopes, requests only the needed compatibility plan, then publishes the
snapshot manifest last.

## Python compatibility UDF

`sync_compatibility` collects only what is requested: Power BI scanner
evidence, semantic model scanner fallback, PBIR-Legacy pages and Kusto live
metadata. `sync_all` and `sync_items` remain rollback paths. It has a
180-second deadline, bounded retries, page and size limits, and metadata-only
allowlists; it never returns business rows, credentials, connection strings,
prompts or query text.

It can be removed when Power BI scanner parity, PBIR-Legacy pages and Kusto
schema parity pass in the target tenant, no compatibility collector remains in
the browser plan, and failure isolation still passes. Removing it does not
enable scheduling, which needs the trigger and fencing contracts above.
