# FabCon Phase 12: compatibility and adoption decisions

Decision date: **2026-10-02**. Tracking: [issue #42][issue].
Repository baseline: `program/fabcon-2026` at `13af6cf`, Rayfin **1.36.2**.

Phase 12 is complete as a feasibility review with dated adopt/defer decisions.
Completion does not mean the deferred integrations are implemented, deployed,
or validated in a live tenant. This review changes documentation only.

The starting evidence is the 2026-10-02 primary-source audit,
`Fabric-Atlas-FabCon-Research.md`, sections K, M, N, O and P, and the repository's
[architecture](architecture.md), [installation guide](installation.md) and
[metadata coverage audit](fabric-metadata-coverage-audit.md). The original audit
used Rayfin 1.34.0. This record uses the current 1.36.2 guide for deployment
compatibility and adds direct source checks for Org Apps, Workload Hub and the
published Ossie specifications. Primary-source links below make these decisions
readable without the external audit.

## Closed Phase 12 checklist

These are the seven Phase 12 tasks, closed as decisions rather than feature
delivery. Their reopening conditions appear in the corresponding sections.

- [x] **2026-10-02: IQ Sharing go/defer review. Defer.** No dedicated public
  inventory API or identity contract was found in the reviewed sources.
- [x] **2026-10-02: Pro/PPU, Org Apps and F0 matrix. Adopt the existing
  capacity-backed baseline; defer alternative Atlas rollout claims.** Org Apps
  eligibility is documented, but related-item access and revocation need live
  validation. Workload Hub packaging also remains deferred.
- [x] **2026-10-02: PostgreSQL decision note. Defer migration.** Fabric-managed
  Rayfin remains MSSQL-only, and Atlas has no measured need for migration.
- [x] **2026-10-02: Storage decision tied to a concrete artifact workflow.
  Defer attachments.** No artifact workflow with approved provenance, retention
  and deletion rules has been accepted.
- [x] **2026-10-02: Semantic Views/Ossie mapping study. Study complete; defer
  the adapter.** Public Ossie specifications and a converter exist. Fidelity,
  identity and content boundaries prevent direct adoption.
- [x] **2026-10-02: Spark runtime lineage enrollment and contract study.
  Defer ingestion.** Private-preview partner documentation is not a Microsoft
  public capture contract or evidence of Atlas tenant enrollment.
- [x] **2026-10-02: Explicitly retain Q outside core implementation.
  Defer.** Execution-engine, ETL and specialized-workload announcements have
  no allocation without a concrete Atlas metadata use case.

## K. IQ Sharing

**Decision: defer, 2026-10-02.** The [Azure announcement][fabcon] says "now in
preview"; the [OneLake announcement][onelake] says "preview soon". Neither
provides the dedicated inventory API or identity/permission contract needed by
an Atlas collector. Record availability as unconfirmed by this review, rather
than choosing one announcement as proof of tenant availability.

The [ontology sharing documentation][ontology-sharing] concerns permissions on
an existing Ontology item. It is not the cross-organization IQ Sharing inventory
contract. The announcement's initial file-based scope is also not permission
to download shared data, Markdown instructions or RDF content into Atlas.

Reopen when Microsoft publishes an inventory contract with stable identifiers,
supported identities, cross-tenant disclosure rules and operational limits,
and the target tenant can validate it. Any future integration must collect
allowlisted sharing metadata, preserve provenance for Access Review and
external lineage, and keep shared content outside the default collector.

## M. Distribution compatibility

**Decision: adopt the existing capacity-backed Fabric Apps deployment as the
baseline, 2026-10-02.** Fabric Apps remains Preview. The [overview][apps] requires
a capacity-backed workspace and tenant enablement; the [pricing page][pricing]
assigns SQL, GraphQL, Functions and OneLake consumption to that capacity.
This is the existing deployment model, not a claim of GA or new runtime cutover.

| Deployment or distribution route | Evidence and Atlas decision, 2026-10-02 | Condition for changing the decision |
| --- | --- | --- |
| Existing capacity-backed Fabric App | **Adopt baseline.** Use the [installation guide](installation.md), Fabric SSO, managed MSSQL and the existing synchronization path. [Overview][apps], [pricing][pricing]. | Keep tenant settings, permissions and [region availability][regions] validated for each deployment. |
| Pro/PPU without assigned Fabric capacity | **Defer Atlas capacity-free claims.** [Announcements][powerbi-next] describe Preview eligibility, but that does not establish a supported complete Atlas stack. | Verify hosting, database, sync runtime, collector identity, limits and billing together in a live deployment. |
| F0 / zero-provisioned | **Defer Atlas capacity-free claims.** The [announcement][fabcon] discusses zero-provisioned Fabric; the research audit did not verify an F0 Atlas configuration. The [licensing reference][licenses] and [app prerequisites][apps] are not evidence of one. | Obtain a documented applicable SKU/rollout contract and validate every dependency below. |
| Org Apps | **Documented eligible; defer Atlas rollout.** [Microsoft Learn][org-apps] explicitly includes Fabric Apps (Preview). Org Apps grants/revokes Read and Execute on the included app, but does not manage its related-item access. | Complete live included-app and related-item access/revocation validation, including independently granted access. |
| Workload Hub package | **Defer.** [Publishing guidance][workload-publishing] describes a separate workload packaging/lifecycle process, not automatic publication of a Rayfin app. | Validate installation, upgrade, rollback and removal, consent, tenant isolation and applicable publishing requirements. |

### Complete-stack dependency check

App-hosting eligibility must not be presented as eligibility for the full Atlas
deployment. The Pro/PPU and F0 alternatives have no verified replacement for
the following baseline requirements.

| Dependency | Baseline and remaining compatibility boundary |
| --- | --- |
| Hosting and authentication | Protected static assets, Fabric SSO, app Read/Execute access, tenant enablement and supported region. [Fabric Apps overview][apps], [region availability][regions]. |
| App database and API | Managed MSSQL and GraphQL consume capacity. Personal state remains caller-scoped; catalog reads and team notes remain shared with the complete authenticated app audience. [Pricing][pricing], [data model](data-model.md). |
| Synchronization runtime | The active Python UDF still has its own deployment, identity and service limits. Rayfin Functions experiments do not prove an unattended or capacity-free replacement. [Architecture](architecture.md), [UDF limits][udf-limits]. |
| Scanner and owner/access evidence | Admin consent/settings and a supported execution identity remain necessary. The Functions replacement is partial and does not prove scanner parity. [Installation](installation.md), [Power BI replacement](powerbi-scanner-replacement.md). |
| SQL/KQL metadata access | Source-item/data-plane permissions and supported connector identities are independent of app hosting. An app license does not grant source metadata access or remove source workload requirements. [Metadata coverage](fabric-metadata-coverage-audit.md), [architecture](architecture.md). |
| Optional monitoring | Workspace monitoring and Monitor Hub alerts need their own enablement, identity and workload validation. No alert-rule inventory API was established by the research audit. [Monitor Hub alerts][monitor-alerts]. |

### Org Apps validation gate

The current [Org Apps reference][org-apps] supersedes the audit's announcement-only
"soon" classification: eligibility for included Fabric Apps (Preview) is now
documented. Atlas rollout remains deferred for a different reason.

Before rollout, validate a consumer with no workspace role, the configured
synchronizer and a removed consumer. Check embedded sign-in, opening Atlas,
catalog/team-note access and the personal-state boundary. Then remove the
consumer, remove the included app and test remaining direct/group grants.
Inventory the app's related items, verify the required grants separately and
prove the corresponding revocation procedure. Microsoft explicitly says Org
Apps does not propagate or revoke access to those related items.

Org Apps audiences must not be described as per-workspace authorization inside
Atlas: any admitted Atlas user can read its complete shared catalog and team
notes. The live checks above were not performed by this documentation review.

### Workload Hub validation gate

[Microsoft's publishing process][workload-flow] separates testing, preview
audiences, Preview and GA. The [publishing overview][workload-publishing]
distinguishes internal publication from cross-tenant distribution and requires
tenant configuration and authentication setup.

An Atlas package needs evidence for its item/backend lifecycle, upgrade and
rollback compatibility, consent and revocation, tenant-specific configuration,
and isolation of catalog data, notes and personal state. Until those tests pass,
retain the existing `rayfin up` deployment path. No workload registration,
manifest publication or consent change is authorized by this decision.

## N. Persistence and attachment storage

### PostgreSQL

**Decision: defer migration, 2026-10-02.** The official
`@microsoft/rayfin-guide@1.36.2`, `rayfin-guide:index.md`, "How to run Rayfin",
lists PostgreSQL for Rayfin Local and **MSSQL only** for Fabric-managed Rayfin.
The [Fabric Apps overview][apps] describes its managed SQL child service, and
Atlas's [configuration](../rayfin/rayfin.yml) retains `dialect: mssql`.
Local dialect support is not a supported Fabric deployment substitution.

No measured deployment, portability or operational need justifies a migration.
Reopen only with such evidence and a supported deployment target; require
authorization-policy, schema, snapshot, migration and rollback validation.
Do not change storage engines solely because a scaffolding option exists.

### Attachments

**Decision: defer attachment storage, 2026-10-02.** Atlas already enables the
storage service in [configuration](../rayfin/rayfin.yml), and the [platform
overview][apps] documents storage. Service availability does not approve a new
document-management workflow.

A concrete proposal, such as a generated review artifact, must first define its
metadata-only payload, source workspace/item and snapshot provenance, creator
and generation time, audience, retention period, deletion authority and cleanup
behavior. It must also address revocation and removal from retained copies.
Arbitrary uploads, shared instruction files and business-data attachments remain
outside scope. This decision does not change append-only team notes or existing
snapshot retention.

## O. Semantic Views and Apache Ossie

**Decision: mapping study complete; defer the adapter, 2026-10-02.**
[Microsoft's announcement][powerbi-next] describes an early look at Semantic
Views. The reviewed sources establish no public Semantic Views inventory or
definition contract for an Atlas adapter.

Apache Ossie is a separate Apache Software Foundation incubating project,
formerly Open Semantic Interchange. It has a public [core specification][ossie-spec],
[ontology specification][ossie-ontology] and an offline [Microsoft converter][ossie-converter]
for TMSL/TMDL and Ossie. The core specification currently identifies itself as
draft `0.2.0.dev0`. Deferral must not be justified by claiming these public
specifications or tooling do not exist. See also the [project site][ossie] and
[Microsoft's commitment post][ossie-microsoft].

### Completed metadata mapping and fidelity study

The table compares the published specifications/converter with
[`ModelTableSchema`, `ModelColumn` and `ModelMeasure`](../src/atlas/model.ts),
[`OntologyMetadata`](../src/atlas/item-metadata.ts), the
[persisted entities](data-model.md) and the
[sanitized Power BI projection](powerbi-scanner-replacement.md).
These are candidate mappings, not shipped import/export support. No converter,
round-trip test or live engine validation ran as part of this study.

| Subject | Candidate Atlas mapping | Fidelity or boundary preventing direct adoption |
| --- | --- | --- |
| Model and object identity | Bind an imported description to an independently verified Fabric workspace/item UUID and snapshot; retain names as labels. | Ossie model/dataset names and optional ontology IRIs are not Fabric UUIDs. Core documents do not define cross-model references. Never resolve identity or merge evidence by display-name equality. |
| Datasets and fields | Project approved table/column names and types into `ModelTableSchema.columns`. | Dataset `source` can contain a query. Atlas's structural shape cannot preserve every expression, key or vendor type detail; Ossie type declarations leave some precision/representation details unspecified. Do not populate row counts or read source data. |
| Metrics and DAX | Map a verified table-bound metric name and approved DAX definition to `ModelMeasure`. Retain dialect and source evidence in any future reviewed adapter contract. | The converter preserves expression dialects, not equivalent execution semantics. SQL-only metrics and computed SQL fields cannot be assumed to become valid DAX. Atlas expression sanitization also prevents a lossless raw-expression round trip. |
| Relationships and lineage | Preserve verified model relationship endpoints as relationship evidence; use Atlas's source-to-consumer rule only for separately justified dependencies. | Ossie's many-side `from` and one-side `to` describe a model join, not the direction of a data-flow edge. Filter behavior, cardinalities and other Power BI details can reside only in vendor extensions. They do not establish runtime or column lineage. |
| Ontology concepts | Compare Ossie concepts, relationships and IRIs with Atlas entity/property IDs, namespaces, bindings and contextualizations. | Atlas does not represent the complete Ossie inheritance, derivation, constraint or multi-role relationship semantics. An IRI does not prove a Fabric entity ID or source-item binding. The semantic-model converter does not establish Fabric Ontology equivalence. |
| Security and other vendor extensions | Keep Atlas access evidence tied to its original API and identity; exclude arbitrary extension blobs. | The converter preserves unconsumed Power BI properties in `POWER_BI` extensions, including roles, partitions and other unreviewed properties. A round-trip stash is not a portable authorization contract or a metadata allowlist. |
| Content and validation | Admit only reviewed structural fields and provenance. | Source queries, instruction/`ai_context` fields and extension payloads can contain business values or sensitive content. Offline TOM does not validate DAX. Optional live validation deploys, refreshes, queries and deletes real items, outside a read-only Atlas collector. |

Reopen with pinned specification/converter revisions, a field allowlist, a
stable identity/provenance envelope, and explicit supported-field and loss
reports. Test the allowed mapping without accepting raw partitions, instructions
or vendor stashes. Do not claim semantic or authorization equivalence after a
lossy conversion, translate DAX automatically, execute imported definitions,
or redesign Atlas persistence around the draft exchange format.

## P. Spark runtime lineage

**Decision: defer ingestion, 2026-10-02.** [Atlan's setup guide][atlan-lineage]
describes a Microsoft-gated private preview, tenant/workspace enrollment,
a validation runtime image and a `__private` subscription route. Atlan is the
primary source for its connector requirements, not the publisher of a Microsoft
public capture contract. No such Microsoft contract was identified by the
research audit; [Fabric lineage documentation][fabric-lineage] is not evidence
for this runtime event-capture API.

Enrollment for the Atlas tenant is unverified. Capture coverage, supported
runtime, identity, cost, retention and operational limits need a Microsoft
contract and live validation before adoption. No enrollment, runtime pinning,
tenant setting change or private-route call was attempted for this review.

Reopen only with legitimate enrollment and a supported public capture contract.
Preserve workspace/notebook/job/run identity, event time, source and
replay/deduplication semantics. Distinguish "no captured run" from "no dependency";
do not manufacture lineage edges from missing events. A private endpoint must
not become a normal production dependency.

## Q. Scope boundary

**Decision: defer and retain outside core implementation, 2026-10-02.**
Execution-engine, ETL and specialized-workload announcements receive no Atlas
implementation allocation without a concrete metadata use case. Atlas indexes
governance metadata; it does not execute those workloads or collect business
data. Reopening requires a separately scoped proposal with a documented public
metadata contract, identity, provenance and validation criteria.

[issue]: https://github.com/fredgis/FabricAtlas/issues/42
[fabcon]: https://azure.microsoft.com/en-us/blog/fabcon-and-sqlcon-2026-in-barcelona-building-the-data-foundation-for-microsoft-copilot-and-agents/
[onelake]: https://community.fabric.microsoft.com/blog/fbc_fabricupdatesblogs/fabcon-and-sqlcon-barcelona-2026-what%E2%80%99s-new-in-microsoft-onelake-and-its-rapidly/5369146
[ontology-sharing]: https://learn.microsoft.com/en-us/fabric/iq/ontology/how-to-share-permissions
[apps]: https://learn.microsoft.com/en-us/fabric/apps/overview
[pricing]: https://learn.microsoft.com/en-us/fabric/apps/pricing
[regions]: https://learn.microsoft.com/en-us/fabric/admin/region-availability
[licenses]: https://learn.microsoft.com/en-us/fabric/enterprise/licenses
[powerbi-next]: https://community.fabric.microsoft.com/blog/fbc_pbiupdatesblog/power-bi%E2%80%99s-next-chapter-the-evolution-of-business-intelligence/5369131
[org-apps]: https://learn.microsoft.com/en-us/power-bi/explore-reports/org-app-items
[workload-publishing]: https://learn.microsoft.com/en-us/fabric/extensibility-toolkit/publishing-overview
[workload-flow]: https://learn.microsoft.com/en-us/fabric/workload-development-kit/publish-workload-flow
[udf-limits]: https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/user-data-functions-service-limits
[monitor-alerts]: https://learn.microsoft.com/en-us/fabric/admin/monitoring-hub-alerts
[ossie]: https://ossie.apache.org/
[ossie-spec]: https://github.com/apache/ossie/blob/main/core-spec/spec.md
[ossie-ontology]: https://github.com/apache/ossie/blob/main/ontology/ontology.md
[ossie-converter]: https://github.com/apache/ossie/tree/main/converters/microsoft
[ossie-microsoft]: https://community.fabric.microsoft.com/blog/fbc_pbiupdatesblog/microsoft--snowflake's-commitment-to-apache-ossie/5369534
[atlan-lineage]: https://docs.atlan.com/apps/connectors/business-intelligence/microsoft-fabric/how-tos/set-up-spark-runtime-lineage
[fabric-lineage]: https://learn.microsoft.com/en-us/fabric/governance/lineage
