# Item Relations evidence contract

`src/atlas/item-relations-evidence.ts` holds the reusable part of the Fabric
Item Relations API (Beta) experiment. It is a pure frontend/test-side module:
it does not call Fabric, acquire tokens, persist rows, change the Python UDF or
write `LineageEdge`. **Map & lineage** reads it through
`src/atlas/lineage-evidence.ts` (see [Phase 5 UI](#phase-5-unified-lineage-ui));
production synchronization is unchanged.

## Capability boundary

- Feature ID: `ITEM_RELATIONS_FEATURE_ID` (`item-relations`), registered in
  `src/atlas/preview-api.ts` with maturity `beta`.
- Flag: `VITE_ATLAS_FEATURE_ITEM_RELATIONS`, off by default
  (`src/atlas/feature-flags.ts`). Every Phase 5 caller must check
  `isFeatureEnabled(ITEM_RELATIONS_FEATURE_ID)` and show `PreviewApiNotice`.
- Preview edges carry `evidenceSource: "fabric-item-relations-api-beta"` and
  use their own `ItemRelationsGraphEdge` type. They are never converted to the
  authoritative `Edge` model or written to `LineageEdge`.

## Selective port from `experiment/item-relations-api`

Source baseline: commit `0b78960`. The branch was not merged or cherry-picked.

| Experiment code | Result on this branch |
| --- | --- |
| `item-relations-beta.ts` field validators, UUID/text bounds | Ported into `parseItemRelationsResponse` for the raw Fabric `RelationsResponse` |
| `itemRelationsNodeKey`, cross-workspace graph builder | Ported as `itemRelationsNodeKey` and `buildItemRelationsGraph` with `workspaceId:itemId` keys |
| `classifyItemRelation` | Replaced by `describeItemRelation`; unknown types are no longer coerced to `association` |
| `compareItemRelationsWithCurrent` | Ported as `compareItemRelationsWithLineage`, reusing `lineageEdgeKey` |
| Persisted collection validation | Reworked into the versioned `ItemRelationsEvidence` envelope |
| Per-item, per-direction failure records | Kept as query evidence with fixed failure codes |
| Python `_sanitize_relation_*` allowlists | Reflected in the TypeScript response parser; the UDF is unchanged |

Behavior changed during the port:

- `PushData` and `Orchestration` are drawn from `itemId` to
  `dependentOnItemId`. The experiment drew every relation in raw dependency
  orientation, which reversed both data push and orchestration flow.
- Unknown relation types keep their verbatim value, use the raw dependency
  orientation and are marked `directionVerified: false`.
- Relations whose endpoint metadata is missing or ambiguous are kept as
  `unresolved` evidence instead of rejecting the whole response.
- Self relations and cycles are accepted and reported, not rejected.
- Failed queries can keep prior evidence (see below). The experiment kept only
  whole persisted scans.

## Contract

| Function | Purpose |
| --- | --- |
| `itemRelationsRequestPath(workspaceId, itemId, direction)` | Builds `/v1/workspaces/{workspaceId}/items/{itemId}/relations/{direction}?beta=true` after UUID validation; the host is not included |
| `parseItemRelationsResponse(value)` | Validates `items`, `relations` and `workspaces`, keeps only allowlisted fields, lowercases UUIDs, collapses exact duplicates and preserves unknown item and relation types |
| `classifyItemRelationsFailure({ status, errorCode, timedOut })` | Maps HTTP status and Fabric `errorCode` to `unauthorized`, `insufficient-privileges`, `item-not-found`, `throttled`, `transient` or `failed`; error messages and bodies are never read |
| `isRetryableItemRelationsFailure(code)` | `throttled`, `transient` and `not-attempted` are retryable |
| `recordItemRelationsResponse` / `recordItemRelationsFailure` | Build one query observation; a contract violation becomes `malformed-response` |
| `createItemRelationsEvidence` / `parseItemRelationsEvidence` | Build and validate the schema-version 1 envelope (`source: fabric-item-relations-api-beta`, `apiVersion: v1-beta`); transport wrappers, duplicate queries and inconsistent query states are rejected |
| `mergeItemRelationsEvidence(previous, next)` | Applies the prior-evidence rules |
| `buildItemRelationsGraph(evidence, options)` | Builds nodes, oriented edges, unresolved relations, cycles and coverage counts |
| `compareItemRelationsWithLineage(graph, edges)` | Compares Preview edges with normalized authoritative item lineage without mutating either input |

### Direction by relation family

In the raw API edge, `itemId` depends on `dependentOnItemId`.

| Relation type | Flow | Drawn edge |
| --- | --- | --- |
| `Datasource` | data | `dependentOnItemId -> itemId` |
| `Shortcut` | data | `dependentOnItemId -> itemId` |
| `PushData` | data | `itemId -> dependentOnItemId` |
| `Orchestration` | control | `itemId -> dependentOnItemId` |
| `CascadeDelete` | lifecycle | `dependentOnItemId -> itemId` (parent to child, consistent with scanner Lakehouse to SQL endpoint evidence) |
| `WeakAssociation` | association | `dependentOnItemId -> itemId` |
| `HiddenInWorkspace` | visibility | `dependentOnItemId -> itemId`, excluded from lineage comparison |
| Any other value | unknown | `dependentOnItemId -> itemId`, `directionVerified: false` |

Matching is case-insensitive; the raw `relationType` is always kept. Every
graph edge also keeps the raw relation, `itemKey`, `dependentOnKey` and each
query observation that reported it.

### Prior-evidence preservation

Each query is one root item and one direction. A failed query can still carry a
response; this is prior evidence. `observedAt` dates the evidence and
`attemptedAt` records the latest attempt.

- A complete query replaces prior evidence, including with an empty response.
- An authorization, throttling, transient, not-found, malformed-response or
  not-attempted failure keeps the previous response and `observedAt` and
  records the new failure code.
- A failure with no prior observation carries no response. The graph counts it
  as `failed` coverage and never infers absence.
- The new run defines scope. Root items that were not requested again are not
  carried forward.
- Evidence is never merged across workspaces. If the whole envelope is invalid,
  callers keep the previous evidence unchanged.

Edges whose observations are all preserved have `preserved: true`.

### Contract extension: `not-attempted`

Schema version 1 adds one failure code, `not-attempted`, for the Phase 4
collector. It marks a query whose upstream request did not complete because the
collector stopped on its execution deadline, request budget, cancellation or
persistent throttling. Its `attemptedAt` is the time the collector skipped or
abandoned the query. It is retryable and preserves prior evidence like any
other failure. Omitting such a query would drop prior evidence, because the new
run defines scope, and `transient` would misreport a collector stop as an
upstream fault. Earlier envelopes remain valid; older readers that reject
unknown codes must be updated before they consume collector output.

## Phase 4 Functions collector

`workspaceCollectItemRelations` in
`rayfin/functions/src/workspace-item-relations.ts` collects this evidence
server-side. It is read-only and non-authoritative: it writes no Rayfin rows,
creates no `LineageEdge` values, interprets no direction and is not called by
the browser yet.

- Input: `protocolVersion: 1`, a strict workspace UUID, 1-16 unique root item
  UUIDs and a strict correlation UUID or `null`. No token, URL, endpoint or
  query value is accepted. Input validation and the `SynchronizerAuthority`
  gate run before the Fabric application token is read.
- Requests: for each root item, upstream then downstream,
  `GET https://api.fabric.microsoft.com` plus `itemRelationsRequestPath`. The
  shared REST client only accepts the typed `{ beta: true }` query flag. No
  body is sent, redirects are rejected and error bodies are never read.
- Continuations: the documented response has no continuation fields. If one is
  returned anyway, `continuationUri` or `continuationToken` is followed only on
  the same origin and path with `beta=true` plus `continuationToken`, rebuilt
  locally, with loop detection and at most 5 pages per query.
- Response: the same allowlist and bounds as `parseItemRelationsResponse`
  (50,000 entries per collection, 100-character types, 300-character names),
  merged across pages with first-wins duplicates. Unknown item and relation
  types, cross-workspace endpoints, self relations and cycles are kept
  verbatim. A violation fails only that query as `malformed-response`.
- Failures by HTTP status, without reading `errorCode`: 401 `unauthorized`, 403
  `insufficient-privileges`, 404 `item-not-found`, 429 `throttled`, 408/500/
  502/503/504 or request timeout `transient`, redirects, oversized pages,
  page-limit overruns and other statuses `failed`. `429` and `5xx` are retried
  up to three attempts; `Retry-After` above 10 seconds is not slept.
- Bounds: 150-second execution budget, 64 HTTP attempts per batch, 8 MiB per
  page, 16 MiB of serialized evidence and a 24 MiB final envelope. Deadline,
  request budget, cancellation and persistent throttling stop the batch; the
  remaining queries are `not-attempted` and `stopReason` explains why. A query
  that would exceed the evidence budget is `failed`.
- Envelope: the schema-version 1 evidence plus `authoritative: false`, an
  optional `correlationId` and an optional `stopReason`.
  `parseItemRelationsEvidence` ignores these fields, so callers persist only
  the parsed contract.

### Comparison statuses

| Status | Meaning |
| --- | --- |
| `matching` | Same local endpoints and orientation as an authoritative edge |
| `direction-conflict` | Authoritative lineage has the reverse orientation |
| `preview-only` | No authoritative edge between the endpoints |
| `unverified-direction` | Unknown relation type whose endpoints appear in authoritative lineage |
| `cross-workspace` | One endpoint is outside the scoped workspace |
| `not-lineage` | `HiddenInWorkspace` visibility relation |

Authoritative edges without a Preview edge are `authoritativeOnly` only when an
endpoint was queried with evidence. Otherwise they are `notCovered`, because a
missing Beta response does not prove that a dependency is absent.

## Intentionally left for later phases

Not ported from the experiment:

- `sync_item_relations` in the Python UDF, the browser collection loop, UDF
  URL retargeting, Item Relations token scopes and batch splitting. Phase 4
  replaces collection with the `workspaceCollectItemRelations` Function; the
  browser shadow call, batching across Function invocations and persistence
  are not wired yet.
- `ItemRelationsBetaSnapshot` and its chunked persistence. A separate,
  additive evidence entity that stores the schema-version 1 envelope is still
  required; Preview rows stay separate from `LineageEdge`.
- `MapBeta.tsx`, the `map-beta` tab and its navigation entry. They are replaced
  by the single **Map & lineage** screen described below.
- The `StagedLayoutItem` widening of `buildStagedLayout`. The Phase 5 overlay
  places non-snapshot endpoints in a separate lane instead, so the staged
  layout still receives snapshot items only.
- The experiment Rayfin application ID, package version, release version and
  redirect URIs.

The experiment's GraphQL write retries and cancellation fixes were already
released in 1.12.2 to 1.12.4 and are not part of this port.

## Phase 5 unified lineage UI

**Map & lineage** stays the only lineage navigation entry. Legacy `#map-beta`
links resolve to `#map` with Preview evidence included.

- **Local tabs.** Graph, Evidence and Changes, kept in the URL as `view`.
- **Preview control.** `Include Item Relations API evidence (Preview)` renders
  only when `VITE_ATLAS_FEATURE_ITEM_RELATIONS` is on, is unchecked by default
  and is kept in the URL as `preview=item-relations`. When checked, it shows
  `PreviewApiNotice` and a status line for loading, none persisted, error with
  retry, or collection time and coverage.
- **Evidence source.** `useItemRelationsEvidence` loads only persisted
  envelopes through an `ItemRelationsEvidenceLoader` and validates them with
  `parseItemRelationsEvidence` for the active workspace. The default
  `loadPersistedItemRelationsEvidence` returns `null` because no evidence
  entity exists yet, so production shows "No persisted Item Relations
  evidence" and draws nothing. The UI never collects or invents evidence.
- **Unified model.** `buildLineageEvidence` normalizes snapshot `Edge` values
  from source to consumer, compares them with Preview edges through
  `compareItemRelationsWithLineage`, and groups both by endpoint pair. Each
  relationship gets one agreement status: `conflict`, `agree`, `unverified`,
  `preview-only`, `cross-workspace`, `snapshot-only`, `not-covered`,
  `not-lineage` or `snapshot` (Preview not loaded).
- **Graph.** `buildPreviewOverlay` draws disagreeing Beta edges only: dashed
  purple for data flow, dash-dot purple for control or lifecycle, amber for
  direction conflicts. Agreeing and visibility relations are not drawn twice.
  Endpoints outside the snapshot sit in a right-hand lane ordered by
  workspace and name, so snapshot node positions never move. Midpoint buttons
  open the relationship evidence pane. The legend lists sources: Atlas
  snapshot (verified), Item Relations API (Beta, observed), Beta control or
  lifecycle, and Conflict (review needed).
- **Evidence.** Coverage counts, failure codes, unresolved relations and
  cycles; a searchable, filterable relationship list; and the provenance
  pane, which shows each source's own statement, drawn direction, relation
  family, observation time, preserved state and the conflict callout.
- **Changes.** Atlas snapshot lineage added, removed or changed broken state
  between the last two snapshots. Beta evidence has no history and is never
  mixed into these changes.

## Phase 5 integration checklist

- [x] Pass `normalizeLineageEdges` output to `compareItemRelationsWithLineage`.
- [x] Draw verified snapshot edges with the existing treatment, Preview edges
  with dashed purple and conflicts in amber, with control and lifecycle edges
  visually separate from data flow.
- [x] Show `unresolved`, `cycles`, coverage counts, failure codes and
  `observedAt` in the evidence inspector.
- [ ] Persist and load `ItemRelationsEvidence` through a dedicated entity,
  then merge each new collection with `mergeItemRelationsEvidence`. Plug the
  reader in as the `ItemRelationsEvidenceLoader`.
- [ ] Confirm the `CascadeDelete` and `HiddenInWorkspace` orientations against
  real tenant responses before C is adopted.
