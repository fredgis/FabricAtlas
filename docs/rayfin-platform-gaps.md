# Rayfin platform gaps retained behind the Python UDF

Assessment date: 2026-10-02  
Rayfin version: 1.36.2

Fabric Atlas uses Rayfin Functions for every collector supported by a reviewed
deployed identity and public contract. The Python UDF is retained only as a
minimal compatibility adapter for the capabilities below. It must not remain
the default path for collectors already migrated to Rayfin.

## Escalation summary

| Capability | Rayfin 1.36.2 gap | Minimal UDF fallback | Requested Rayfin capability |
| --- | --- | --- | --- |
| Power BI admin scanner | No documented deployed Power BI REST application-token audience or scanner connector | Power BI `getInfo`, scan status and scan result only | Application-authenticated Power BI REST audience or first-party scanner connection for Functions |
| Semantic-model engine dependencies | `fabric-semanticmodel` is delegated-only and exposes query execution, not an application-authenticated INFO/DMV metadata surface | Engine-resolved dependency metadata only when static definition analysis is insufficient | Application-authenticated XMLA/metadata connector with INFO dependency support |
| Unattended continuation | Functions are bounded invocations with no documented timer, queue trigger or durable-workflow driver | No collector fallback; browser/external driver must invoke the next continuation | Documented non-interactive trigger/driver for `syncContinue` |
| Distributed task claims | Fluent Rayfin GraphQL has no verified compare-and-swap or transaction primitive for task ownership | Existing serialized Python path remains the safe publication fallback | Supported transactional claim/lease primitive, or documented same-database stored-procedure deployment path |

## Power BI scanner gap

The supported Rayfin replacement already collects:

- Semantic Model and Report identities through Fabric Items.
- TMSL structural model metadata through public `getDefinition`.
- Tables, columns, measures and selected sanitized DAX definitions.
- PBIR model bindings and documented PBIR page parts.
- Static dependency subsets and same-workspace model-to-report lineage.
- Optional Fabric Admin Preview ownership, tag and item-access evidence when
  the AppBackend identity is authorized.

The Python fallback remains only for scanner fields that require Power BI admin
scan operations and cannot be obtained through the public Fabric application
token supplied to Functions. Atlas must label those fields with scanner
provenance and must never treat an unavailable scan as empty evidence.

Required tenant configuration for a future Rayfin scanner connection:

- Service principal approved for read-only admin APIs.
- Detailed metadata responses enabled.
- DAX and mashup expression responses enabled.
- A documented Power BI application token bound to the Function runtime.

## Semantic-model dependency gap

Static DAX references and model relationships are available from reviewed
definition projections. They do not prove the complete engine dependency graph.
The UDF fallback is limited to the engine metadata needed to close that gap.
It must not return business query results, raw M source text, credentials or
unreviewed annotations.

## Durable execution gaps

The versioned server graph, deterministic checkpoints, cancellation barriers
and manifest-last snapshot publisher are implemented. Public v2 mutations stay
fail-closed until Atlas has:

1. a serializer that is valid across Function hosts;
2. immutable, checksum-verified collector payload references;
3. a non-interactive continuation driver.

These are orchestration gaps, not reasons to route migrated collectors back
through Python.

## Fallback removal criteria

Remove each Python function when the corresponding Rayfin capability is:

1. publicly documented;
2. available to deployed Fabric Apps;
3. validated with the AppBackend identity;
4. covered by bounded failure and privacy tests;
5. proven against the previous UDF evidence on the isolated candidate.

The repository documentation and #42 must identify the exact fallback still
enabled in each release.
