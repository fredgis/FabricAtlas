# Rayfin platform gaps and retained compatibility

Assessment: **2026-10-02, Rayfin 1.36.2**.

## Active collection boundary

Fabric Atlas now uses a browser-serialized, Rayfin-first collector path:

- `workspaceCollectCore`
- `workspaceCollectDefinitions`
- `workspaceCollectItemRelations`
- `workspaceCollectKqlMetadata`
- `workspaceCollectSqlMetadata`
- `workspaceCollectPowerBi`

The browser validates and merges those bounded envelopes, requests only the
remaining compatibility gaps from the Python UDF, then uses the existing
manifest-last snapshot writer. `VITE_ATLAS_COLLECTOR_ROLLBACK=true` restores
the previous Python-first collection path without changing publication rules.

Rayfin collector output is authoritative only after the browser composition
passes the complete snapshot contract. Item Relations evidence remains Beta,
non-authoritative and separate from `LineageEdge`.

## Retained Python compatibility

`sync_compatibility` accepts an exact collector plan, echoes it in the result
and cannot rediscover the workspace or run an unrequested collector.

| Gap | Retained Python evidence | Why Rayfin does not replace it yet |
|---|---|---|
| Power BI admin scanner | Access, scanner metadata and authoritative item lineage | The optional Secret Store service-principal scanner needs operator credentials, tenant settings and live parity before activation |
| Semantic-model scanner fallback | Schema only for definitions that explicitly report unsupported | Definition access can require write permission or be blocked by sensitivity labels |
| Lakehouse object coverage | REST object kinds and selected downstream-model merges | SQL catalog structure does not reproduce every existing object/source boundary |
| Legacy report pages | PBIR-Legacy page fallback | The supported definition path does not cover every legacy report |
| Kusto data plane | Live schema fallback where available | Rayfin Functions expose no documented Kusto audience |
| SQL data plane | Exact per-item fallback after an explicit Sql-stage failure | Application-identity catalog visibility varies by endpoint permission |

The UDF keeps its 180-second execution deadline, bounded retries,
same-origin continuation validation, page/record limits, 25 MiB envelope cap
and metadata-only allowlists. It never returns business rows, credentials,
connection strings, prompts, few-shot examples or query text.

## Capabilities deliberately not claimed

- Background continuation and scheduled refresh
- Distributed task claiming across Function hosts
- Transactional fencing of Rayfin GraphQL mutations with SQL application locks
- Engine-complete XMLA/DMV DAX dependencies
- Public read APIs for OneLake role membership or Purview DLP restriction state
- Verified central Fabric Policies evaluation, whose operation contract is not public
- Kusto application-audience support in Fabric Apps Functions

These gaps remain explicit capability states. They do not invalidate the
validated catalog and do not block browser-driven multi-workspace Sync.

## Scheduling blocker

The active collector still needs a browser-held delegated identity for the
remaining compatibility calls. Fabric Apps backend Functions expose no
documented timer or unattended trigger, and Atlas never stores or replays
browser access or refresh tokens.

Closing the browser can preserve committed rows but does not execute another
slice. Scheduled refresh therefore stays disabled. This is the Phase 2
platform blocker; it does not block multi-workspace scope, per-workspace Sync
or the active Rayfin collector cutover.

## Requested platform capabilities

The following additions would remove the remaining compatibility layer:

1. A documented Power BI audience or first-party scanner connector for Fabric
   Apps Functions.
2. A documented Kusto audience for Function application identities.
3. A same-database transaction/procedure path that can fence publication and
   checkpoint mutations atomically.
4. A supported unattended trigger with application identity and bounded
   continuation semantics.
5. A public Fabric Policies evaluation operation contract and read contracts
   for OneLake security and DLP evidence.

Until those contracts exist and pass live tenant parity, Atlas keeps only the
bounded compatibility paths listed above.
