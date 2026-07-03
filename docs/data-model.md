# Data model

All entities live in `rayfin/data/` as Rayfin decorator classes and are registered in
`rayfin/data/schema.ts`. Cross-entity links are stored as plain ids (`workspace_id`, `itemFabricId`)
so the sync can upsert rows in any order. Every entity is readable/writable by authenticated members
of the workspace (`@role('authenticated', '*')`).

## Workspace
The indexed Fabric workspace.
`fabricId`, `displayName`, `capacity?`, `region?`, `itemCount?`, `syncedAt?`

## FabricItem
One row per Fabric item.
`workspace_id`, `fabricId`, `displayName`, `itemType`, `description?`, `ownerName?`, `ownerEmail?`,
`health` (healthy | stale | failing | unknown), `endorsement` (none | promoted | certified),
`sensitivity?`, `tags?`, `lastRefresh?`, `itemCreatedAt?`, `itemUpdatedAt?`

## LineageEdge
A directed dependency between two items.
`workspace_id`, `sourceFabricId`, `targetFabricId`, `relation`, `broken`

## Principal
A user, group, service principal or guest.
`workspace_id`, `principalId`, `displayName`, `kind`, `email?`, `external`

## AccessGrant
Effective access, at workspace level (`itemFabricId` empty) or on a specific item.
`workspace_id`, `itemFabricId?`, `principalRef`, `accessLevel` (owner | edit | view | none),
`source` (workspaceRole | directShare | group | orgLink | itemOwner), `roleName?`, `flag?`

## JobRun
A refresh / pipeline / notebook run.
`workspace_id`, `itemFabricId`, `itemName`, `jobType`,
`status` (completed | failed | running | cancelled), `startedAt?`, `durationSec?`, `message?`

## ConfigEntry
One flat config fact per item, grouped into an expandable tree in the UI.
`workspace_id`, `itemFabricId`, `section`, `label`, `value?`

## Comment
A team note on the workspace or an item.
`workspace_id`, `itemFabricId?`, `authorId`, `authorName`, `authorEmail?`, `body`, `createdAt`

## SyncRun
An audit record of a Sync.
`workspace_id`, `startedAt`, `finishedAt?`, `status` (running | completed | failed), `itemsSynced?`,
`triggeredBy?`, `summary?`

## Adding a field

Add a decorator to the entity, then deploy. `rayfin up` diffs and applies the migration:

```ts
// rayfin/data/FabricItem.ts
@set('low', 'medium', 'high', 'critical') criticality!: string;
```

```bash
npx rayfin up
```
