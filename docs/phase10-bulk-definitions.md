# Phase 10: bulk definition benchmark and runtime gate

Reviewed against Microsoft public contracts on **2026-10-02**.

## Decision

Ship an offline, bounded comparison tool, not a deployed bulk collector.
`BULK_DEFINITION_RUNTIME_GATE.enabled` is `false`; the CLI rejects `--live`.
There is no bulk function registration, token input, HTTP transport, database
client, snapshot publisher or browser switch. Changing that constant alone
cannot enable live collection.

The existing Python and Rayfin per-item collectors remain unchanged.
The benchmark uses the same reviewed projection functions before retaining
anything for comparison, and serializes only counts, UUIDs, fixed error codes
and timings. Raw definitions and projected field values never enter its report.
It does not write a snapshot or authorize publication.

## Contract findings

| Surface | Public contract | Consequence for Atlas |
| --- | --- | --- |
| [Bulk Export Item Definitions][bulk] | `POST /v1/workspaces/{workspaceId}/items/bulkExportDefinitions`; body `{"mode":"Selective","items":[{"id":"<item-id>"}]}` | Explicit item selection only. No `All` mode in the harness or proposed runtime path. |
| Bulk response | `itemDefinitionsIndex: [{id, rootPath}]` plus shared `definitionParts: [{path, payload, payloadType}]` | Match canonical IDs, validate roots, split at the root plus `/` boundary, then remove that prefix. Never write these paths to disk. |
| Bulk operation | `200` or `202` with operation headers; `429` with `Retry-After` | Count initial request, every poll, and result retrieval. Stop on throttling rather than fanning out into fallback requests. |
| Bulk permissions | Workspace Contributor or higher; selected items all require read/write; delegated `Item.ReadWrite.All` | A successful per-item read does not prove bulk workspace permission. No permission escalation or automatic consent. |
| Bulk identities | Service principal/managed identity only if every selected item supports that identity | Verify each item type and the deployed application identity. The item-management table is not evidence of every definition endpoint. |
| Bulk limits | 128 MB maximum **request** payload; Fabric items need F capacity, including trial | Not a safe response-size limit for Atlas. Atlas applies much smaller replay bounds below. |
| [Per-item definition][single] | `definition.parts`; optional `format`; read/write permission; sensitivity label omitted | Preserve the existing per-item retrieval and explicit capability evidence. Definitions do not replace sensitivity/access collectors. |
| Formats | Bulk has no documented per-item `format` selector; the public bulk example contains TMDL and a report `byPath` reference | Existing semantic projection requires TMSL. Existing report projection does not resolve `byPath`. Both fall back, rather than silently losing metadata. |

Bulk documentation links to the [definition overview][definitions], whose
support list is not a complete, synchronized identity matrix. Graph Model,
Report and Semantic Model have public definition documentation. Ontology and
Data Agent have existing Atlas per-item collectors, but are not promoted to
bulk-supported merely because another API accepts their item type.

Current per-item collectors inspected:

- `fabric/udf/atlas_sync_functions/function_app.py`: `_get_definition` handles
  individual definition LROs, then the Ontology, Graph Model and Data Agent
  projectors select metadata. Its invocation has a 180-second budget.
- `rayfin/functions/src/workspace-definitions.ts`: up to eight items,
  type-specific routes, 150-second deadline, 120 attempts, 12 LRO polls,
  16 MiB per-definition response cap and non-authoritative output.
- `rayfin/functions/src/workspace-powerbi.ts`: individual semantic-model
  requests use `format=TMSL`; report and model projections remain separate
  from scanner/access evidence.
- `rayfin/functions/src/fabric-rest.ts`: the current bounded POST LRO helper
  accepts no request body. No shared transport change was necessary for this
  offline work.

## Reproduce

Use the repository's Node 24/npm 11 versions. Restore both lockfiles on a new
checkout, then run:

```powershell
npm ci
npm ci --prefix rayfin\functions
npm run benchmark:definitions -- --iterations 10

# After the Functions build, direct execution produces JSON without npm banners:
node scripts\benchmark-bulk-definitions.mjs --scenario lro --iterations 10
node scripts\benchmark-bulk-definitions.mjs --scenario missing-item --iterations 10
node scripts\benchmark-bulk-definitions.mjs --scenario bulk-forbidden --iterations 10
node scripts\benchmark-bulk-definitions.mjs --scenario bulk-throttled --iterations 10
node scripts\benchmark-bulk-definitions.mjs --scenario operation-failed --iterations 10

npm test -- scripts\bulk-definitions-benchmark.spec.ts src\atlas\workspace-definitions.spec.ts src\atlas\workspace-powerbi.spec.ts
```

The default fixture in `scripts/fixtures/bulk-definitions.fixture.ts` is a
sanitized reconstruction of public Microsoft contract examples, **not a
captured tenant benchmark**. Its provenance lists the source pages and
transformations. Two repeated Graph Model specimens exercise batching; the
Report and Semantic Model specimens preserve the public bulk example's
`byPath` and TMDL format differences. Per-item structural specimens exercise
the existing fallback projections. No business rows, prompts, scripts,
partition sources, connection strings or real workspace identities are used.

### What the metrics mean

| Field | Meaning |
| --- | --- |
| `requests` | Replayed HTTP exchanges, including LRO polls/result and fallback. No real requests are sent. |
| `requestBytes`, `responseBytes` | UTF-8 JSON body bytes in the sanitized replay. Headers, URLs, compression and service framing are excluded. Per-item POST bodies are empty. |
| `projectedBytes` | Metadata projection JSON accepted in memory before comparison. It is not persisted. |
| `durationMs`, `replayTiming` | Measured local replay/projection wall time; min/median/max across iterations. It excludes parity comparison and initial fixture validation. Not Fabric latency. |
| `networkDurationMs` | Always `null`; service duration has not been measured. |
| `requestFailures`, `projectionFailures` | Fixed-code transport/operation failures and projection/format failures. |
| `failedItems` | Items failed or not attempted after either path; successful fallback removes an item from this count, not from the failure counters. |
| `fallbackRequested`, `fallbackAttempted`, `fallbackSucceeded` | Separate counts; throttling or a spent request budget can prevent an attempt. Each item records its reason and result. |
| `parity` | Exact canonical projection match/mismatch/unavailable counts. Matching is not an authority or completeness claim. |

The checked default fixture yields:

| Path | Replayed requests | Request bytes | Response bytes | Projected bytes | Successful fallbacks |
| --- | ---: | ---: | ---: | ---: | ---: |
| Per item | 4 | 0 | 1,886 | 1,390 | 0 |
| Bulk plus fallback | 3 | 214 | 3,116 | 1,390 | 2 |

All four final projections match. Bulk transfers **more** fixture bytes despite
one fewer replayed request. The LRO scenario raises bulk plus fallback to six
requests; a bulk `403` raises it to five. These are fixture results, not a
performance improvement claim.

### Bounds and failure rules

- 1-8 unique strict UUID/type pairs, no token/URL/persistence parameters.
- Fixture input at most 8 MiB, at most 4,096 parts, path length at most 512.
- One response at most 4 MiB; aggregate response budget 16 MiB per path;
  accepted projections at most 4 MiB.
- At most 64 requests per path (lowerable, not raisable), 12 LRO polls,
  10 seconds per replay path checked between exchanges.
- CLI at most 50 iterations with a 30-second outer deadline checked between
  iterations. Bounded synchronous projection is not preempted mid-operation.
- Duplicate IDs/paths, overlapping roots, unknown item IDs, foreign parts,
  traversal/encoded paths, malformed Base64 and incomplete graph parts fail
  closed. Missing items or unreviewed formats fall back individually.
- Types without reviewed bulk support go directly to per-item replay and are
  excluded from the selective bulk request. An entirely ineligible batch makes
  no bulk request.
- No HTTP retry model or sleep is included. A `429` stops the bulk path without
  fallback. Production must honor `Retry-After` within its shared deadline.

### Operator-supplied sanitized fixtures

`--fixture .\path\sanitized.json` accepts this versioned shape:

```json
{
  "version": 1,
  "items": [{"id": "<strict-uuid>", "type": "GraphModel"}],
  "bulk": [{"status": 200, "body": {"itemDefinitionsIndex": [], "definitionParts": []}}],
  "perItem": {"<same-strict-uuid>": [{"status": 200, "body": {"definition": {"parts": []}}}]}
}
```

The placeholder is deliberately not runnable; replace it with an anonymized
UUID and reviewed structural parts. A tape can instead contain a `202`, up to
12 `200` status bodies (`Running`, `NotStarted`, `Succeeded` or `Failed`), and a
final `200` result body. A failure tape ends at the failure. No response URLs,
tokens, timestamps or measured network delays belong in this fixture schema.

Obtain any future tenant samples only in an approved test workspace. Keep raw
responses in process memory, strip error text, identifiers/names and every
nonstructural field, then encode only reviewed parts. Never dump raw definitions
to a log, Git, a support ticket or a browser. Have another reviewer check the
sanitized file, record its provenance outside the payload, and use the identical
selection for both paths. An operator-provided file is labeled unverified by the
report; passing schema validation is not proof of sanitization.

## Gate for a future deployed Function

All of the following are required before replacing the offline-only gate:

1. Confirm current public bulk support and application identity support for each
   proposed type, plus Contributor/item read-write authorization in the canary.
2. Add a reviewed, fixed-host selective POST transport with shared request,
   response, decoding and monotonic execution budgets; reuse bounded LRO and
   safe-error handling. Never accept arbitrary paths or tokens from the browser.
3. Resolve format differences without lowering coverage: reviewed TMDL support
   or per-item TMSL fallback; verified path-to-ID report references or per-item
   fallback. Test partial/empty exports, permission failures, labels, oversized
   payloads, malformed roots, throttling, deadlines and cancellation.
4. Keep the existing synchronizer gate and per-item collectors. Project each
   response immediately, discard raw parts, and preserve per-item failure
   evidence before any persistence. Do not publish an incomplete snapshot.
5. Capture real request counts, service duration, body bytes, failures and
   fallback rate from same-identity canary comparisons, without payload logging.
   Review all projection mismatches and demonstrate rollback to per-item.
6. Add an explicit server-owned default-off flag and deployment rollback
   procedure. An environment flag must not bypass authorization or validation.

No live API probe or deployment was performed for this phase. Deployment
component support and installation/update/recovery are documented in the
[deployment runbook](deployment-plan-runbook.md).

[bulk]: https://learn.microsoft.com/en-us/rest/api/fabric/core/items/bulk-export-item-definitions
[single]: https://learn.microsoft.com/en-us/rest/api/fabric/core/items/get-item-definition
[definitions]: https://learn.microsoft.com/en-us/rest/api/fabric/articles/item-management/definitions/item-definition-overview
