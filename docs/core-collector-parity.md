# Core collector dual-run comparison

`src/atlas/core-collector-parity.ts` is a frontend/test-side comparison utility.
It does not call Fabric, publish snapshots, persist responses, or replace
`validateRawSync`. A Core-only envelope must still fail the production v2
validator because scanner, schema, access, lineage and configuration are not
complete.

## Stage contract

`validateCoreCollectorEnvelope(payload, expectedWorkspaceId?)` validates the
direct envelope, not a Functions or UDF transport wrapper. It returns no payload
and throws a fixed diagnostic on invalid input.

- `schemaVersion` is `2`; `syncMode` is `base`.
- `correlationId`, when present, is a hyphenated UUID. Workspace and item IDs
  are UUIDs; UUID case is insignificant. `syncedAt` is a valid timestamp.
- Workspace, items and role assignments have explicit `complete` sections.
  The validator accepts future, nonempty item types, but rejects generic `Item`.
- Jobs have an explicit `complete`, `unsupported` or `failed` section.
  Unsupported/failed jobs need a code. Failed collection may retain jobs
  collected successfully; unsupported collection cannot contain jobs.
- `scanner`, `schema`, `lineage`, `access`, `config`, `definitions`, `kqlSchema`
  and `sqlSchema` sections are explicitly `unsupported`, with
  `collector-not-migrated` or `not-collected`.
- `endorsement`, `sensitivity`, `tags`, `ownership`, `definitionEnrichment`,
  `kqlSchema`, `sqlSchema` and `objectLineage` capabilities have the same
  unsupported requirement.
- `lineage`, `access`, `config`, `objectEdges`, `schema` and `artifactMetadata`
  are empty arrays/objects. An optional `objectLineage` array must also be empty.
- Every item has exactly one `itemMetadata` entry with `scannerMatched: false`
  and `ownerAvailable: false`. No scanner metadata or other availability claims
  are accepted.
- `errors` is explicit. Core errors must be section/code diagnostics such as
  `jobs: upstream-failure`; errors cannot contradict complete sections.
- The Core envelope and nested records reject fields outside their allowlists.
  Duplicate canonical item IDs, item-metadata IDs and item/job-ID pairs fail
  validation. Repeated role assignments and unidentified job tuples retain
  their multiplicity.

## Comparing two captured runs

Pass the parsed Rayfin Core envelope and the Python UDF v2 `base` or `complete`
envelope to `compareCoreCollectorParity(rayfinPayload, pythonPayload, options?)`.
The Python projection reads the same Core fields and actual coverage statuses;
it does not copy or reinterpret advanced content.

```ts
const report = compareCoreCollectorParity(rayfinPayload, pythonPayload, {
  maxDiscrepancies: 50,
});
```

The comparison uses these allowlists:

| Records | Compared fields |
| --- | --- |
| Workspace | `id`, `displayName`, `description`, `type`, `capacityId`, `capacityRegion` |
| Items | `id`, `type`, `displayName`, `description`, `workspaceId`, `folderId` |
| Role assignments | `role`; principal `id`, `displayName`, `type`, `userType`; `userDetails.userPrincipalName`, `userDetails.userType` |
| Jobs | `itemId`, `id`, `jobType`, `status`, `itemDisplayName`, `itemType`, `invokeType`, `startTimeUtc`, `endTimeUtc`, `createdTimeUtc`, `lastUpdatedTimeUtc` |
| Sections/capabilities | `status`, `code` for the contract's fixed names |
| Item metadata | `scannerMatched`, `ownerAvailable` |

Items match by canonical ID; roles form multisets keyed by principal ID and
role. Jobs match by item ID and job ID, or by the fallback tuple
`(itemId, jobType, invokeType, startTimeUtc, createdTimeUtc)` when no job ID
exists. The fallback excludes mutable outcome fields, so a changed status or
end time remains a field discrepancy. Identical fallback tuples also form
multisets.

Timestamps normalize to UTC milliseconds. Zone-free Fabric timestamps mean
UTC. Invalid calendar dates are rejected rather than silently rolled forward.
The comparison excludes `syncedAt`, correlation IDs and free-form errors;
it never truncates compared text before determining equality.

`coreEqual` covers workspace, items, roles, jobs and their section statuses.
`coverageEqual` covers advanced sections, capabilities and item-metadata
booleans. Real Python scanner coverage should differ from an honest Core-only
collector, even when `coreEqual` is true. `equal` requires both flags, and
`authoritative` is always false. These flags do not prove successful collection
or authorize publication; matching failed jobs can still compare equal.

The report includes counts, field names and UUID/ordinal identities, never
source field values, names, descriptions, error bodies or tokens. Role/job
ordinals follow deterministic sorted identity order within that comparison.
The default discrepancy limit is 50, with a hard maximum of 100. The total
discrepancy count and a truncation flag remain available. Report text is limited
to 160 characters per value. Validation failures also omit upstream values.

For FGI-MAIN or any other workspace, capture both runs with the same identity,
workspace scope and job sampling policy, as close in time as practical. Review
mutable job differences and expected coverage gaps separately. Do not adjust
counts or statuses to force parity, and do not log the input payloads.
The utility contains no workspace names, IDs or expected catalog counts.
The unit fixtures are not evidence of a completed live dual-run validation.
