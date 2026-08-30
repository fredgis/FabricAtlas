# Data model

Rayfin entity classes live in `rayfin/data/` and are registered in
`rayfin/data/schema.ts`.

Fabric Atlas stores synchronized metadata as immutable snapshots. Every catalog
row carries a `snapshotId`. A `Workspace` manifest is written last and makes the
snapshot visible only after every row succeeds. Hydration ignores incomplete
snapshots and falls back to the previous valid one.

Synchronized entities allow reads to authenticated users. Creates require the
authenticated email to match the row's `writerEmail`, and hydration only trusts
the writer configured for the deployment. They do not expose update or delete
actions to ordinary users. The configured synchronizer alone can delete stale
snapshot rows for retention; update remains disabled. Comments allow
authenticated reads and policy-checked creates whose
`authorEmail` matches the authenticated claim.

`SavedView` and `AccessReview` records are user-scoped. Their read, create,
update and delete policies require the authenticated subject claim to match
`user_id`.

## Workspace

The manifest for a complete synchronized snapshot.

`snapshotId`, `writerEmail?`, `deploymentId?`, `fabricId`, `displayName`, `capacity?`, `region?`, `itemCount?`,
`edgeCount?`, `principalCount?`, `grantCount?`, `jobCount?`, `configCount?`,
`schemaEntryCount?`, `syncSectionsJson?`, `summaryVersion?`, `healthyCount?`,
`staleCount?`, `failingCount?`, `labelCount?`, `externalPrincipalCount?`,
`failedJobCount?`, `brokenEdgeCount?`, `tableCount?`, `columnCount?`,
`measureCount?`, `syncedAt?`

`syncSectionsJson` persists the versioned UDF section and metadata-capability
status used by Governance Center. It contains collection state, not business
data.

Summary version 1 reproduces the Governance history metrics without loading
child rows. Older manifests remain compatible and fall back to full validated
catalog loading.

## FabricItem

One row per Fabric item.

`workspace_id`, `snapshotId`, `writerEmail?`, `fabricId`, `displayName`, `itemType`,
`description?`, `ownerName?`, `ownerEmail?`, `configuredBy?`, `modifiedBy?`,
`health`, `endorsement`, `endorsementRaw?`, `endorsementBy?`, `sensitivity?`,
`sensitivityLabelId?`, `tags?`, `tagIds?`, `ownerMetadataAvailable?`,
`sensitivityMetadataAvailable?`, `endorsementMetadataAvailable?`,
`tagMetadataAvailable?`, `lastRefresh?`, `itemCreatedAt?`, `itemUpdatedAt?`

The availability flags distinguish an observed empty value from metadata that
was not collected. Label and tag IDs remain IDs unless a separate trusted
directory resolves their display names.

## LineageEdge

A directed dependency from source to consumer.

`workspace_id`, `snapshotId`, `writerEmail?`, `sourceFabricId`, `targetFabricId`, `relation`,
`broken`

## Principal

A user, group, service principal or guest.

`workspace_id`, `snapshotId`, `writerEmail?`, `principalId`, `displayName`, `kind`, `email?`,
`external`

## AccessGrant

Effective workspace-level or item-level access.

`workspace_id`, `snapshotId`, `writerEmail?`, `itemFabricId?`, `principalRef`, `accessLevel`,
`source`, `roleName?`, `flag?`

## JobRun

A refresh, pipeline or notebook run.

`workspace_id`, `snapshotId`, `writerEmail?`, `itemFabricId`, `itemName`, `jobType`, `status`,
`startedAt?`, `durationSec?`, `message?`

## ConfigEntry

A configuration fact or a chunk of serialized object schema.

`workspace_id`, `snapshotId`, `writerEmail?`, `itemFabricId`, `section`, `label`, `value?`

Schema chunks use the private `__schema__` section. Chunking preserves complete
column and measure lists within the bounded SQL text field.

## Comment

A team note on the workspace or an item.

`workspace_id`, `itemFabricId?`, `authorId`, `authorName`, `authorEmail?`,
`body`, `createdAt`

Comments are not tied to a catalog snapshot, so they survive every refresh.

## SyncRun

The audit record for a completed snapshot.

`workspace_id`, `snapshotId`, `writerEmail?`, `startedAt`, `finishedAt?`, `status`,
`itemsSynced?`, `triggeredBy?`, `summary?`

## SavedView

A personal named view over Atlas navigation and filters.

`workspace_id`, `user_id`, `name`, `section`, `filtersJson`, `createdAt`,
`updatedAt`

## AccessReview

A personal decision for one effective principal and item pair.

`workspace_id`, `user_id`, `recordKey`, `rowKey`, `itemFabricId`,
`principalRef`, `status`, `note?`, `reviewedAt`, `updatedAt`

The status is `reviewed`, `accepted` or `needsAction`.

## Snapshot history

History does not require another table. Atlas uses trusted `Workspace`
manifests as the index and loads older child rows by `workspace_id` and
`snapshotId`. Comments, saved views and access-review decisions are not part of
snapshot comparisons.

The configured retention window keeps 12 snapshots by default. Retention runs
after publication, removes child entities before their manifest, and leaves a
temporarily over-retained history when cleanup fails.

Writer rotation is explicit: former synchronizer emails can be allowlisted for
historical reads and cleanup. They cannot create or delete rows after the
current deployment policies are generated.

## Adding a field

Add the bounded Rayfin decorator, update the snapshot writer and reader, add a
test, then deploy:

```ts
@set("low", "medium", "high", "critical")
criticality!: string;
```

```powershell
npm test
npx rayfin up
```
