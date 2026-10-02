# Item Relations evidence contract

`src/atlas/item-relations-evidence.ts` holds the reusable part of the Fabric
Item Relations API (Beta) experiment. It is a pure frontend/test-side module:
it does not call Fabric, acquire tokens, persist rows, change the Python UDF or
write `LineageEdge`. No screen imports it yet, and production synchronization
is unchanged.

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
- An authorization, throttling, transient, not-found or malformed-response
  failure keeps the previous response and `observedAt` and records the new
  failure code.
- A failure with no prior observation carries no response. The graph counts it
  as `failed` coverage and never infers absence.
- The new run defines scope. Root items that were not requested again are not
  carried forward.
- Evidence is never merged across workspaces. If the whole envelope is invalid,
  callers keep the previous evidence unchanged.

Edges whose observations are all preserved have `preserved: true`.

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
  owns collection as a Functions collector behind the same flag.
- `ItemRelationsBetaSnapshot` and its chunked persistence. Phase 5 must add a
  separate, additive evidence entity that stores the schema-version 1 envelope;
  Preview rows stay separate from `LineageEdge`.
- `MapBeta.tsx`, the `map-beta` tab, routing and navigation. Phase 5 replaces
  them with the single **Map & lineage** entry, the
  `Include Item Relations API evidence (Preview)` checkbox and the Graph,
  Evidence and Changes tabs. Legacy `#map-beta` URLs redirect there.
- The `StagedLayoutItem` widening of `buildStagedLayout`, which Phase 5 adds
  only if it lays out non-snapshot nodes.
- The experiment Rayfin application ID, package version, release version and
  redirect URIs.

The experiment's GraphQL write retries and cancellation fixes were already
released in 1.12.2 to 1.12.4 and are not part of this port.

## Phase 5 integration checklist

- Persist and load `ItemRelationsEvidence` through a dedicated entity, then
  merge each new collection with `mergeItemRelationsEvidence`.
- Pass `normalizeLineageEdges` output to `compareItemRelationsWithLineage`.
- Draw verified scanner edges with the existing teal treatment, Preview edges
  with dashed purple and conflicts in amber. Keep control, lifecycle and
  visibility edges visually separate from data flow.
- Show `unresolved`, `cycles`, coverage counts, failure codes and
  `observedAt` in the evidence inspector.
- Confirm the `CascadeDelete` and `HiddenInWorkspace` orientations against real
  tenant responses before C is adopted.
