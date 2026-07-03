# Architecture

FabricAtlas is one place to see everything in a Fabric workspace, plus a team comment layer. It is a
Rayfin Data App, so the backend is described in TypeScript and provisioned by Rayfin on Fabric.

## The pieces

```
Fabric portal (iframe)
        │  brokered auth (Entra ID)
        ▼
React + Vite SPA  ── Rayfin static hosting (dist/)
        │
        │  RayfinClient (typed)
        ▼
Rayfin Data API (Data API Builder)  ──  Fabric SQL database (mssql)
        ▲
        │  Sync writes here
   Fabric REST APIs  (items · lineage · jobs · permissions · definitions)
```

- The front end lives in `src/`. The Atlas feature code is in `src/atlas/` (model, store, ui, and one
  file per tab in `src/atlas/views/`).
- The data model lives in `rayfin/data/` as decorator classes and is registered in
  `rayfin/data/schema.ts`. `rayfin.yml` enables `auth`, `data` (mssql), `storage` and `staticHosting`.
- `RayfinClient` (`src/lib/rayfin-client.ts`) talks to the Rayfin Data API, which serves the Fabric
  SQL database. Auth is Fabric brokered (`src/services/rayfin-auth.service.ts`).

## Data model

Nine entities capture the workspace and the team layer. See [data-model.md](data-model.md) for fields.

| Entity | Holds |
| --- | --- |
| `Workspace` | The indexed workspace |
| `FabricItem` | Every item (Lakehouse, Notebook, Pipeline, Semantic model, Report, …) |
| `LineageEdge` | Directed dependency between two items |
| `Principal` | Users, groups, service principals, guests |
| `AccessGrant` | Effective access (workspace or item level) + where it comes from |
| `JobRun` | Refresh / pipeline / notebook run history |
| `ConfigEntry` | Flat key/value config facts per item (drives the expandable tree) |
| `Comment` | Team notes on the workspace or an item |
| `SyncRun` | Audit of each Sync |

## Sync

The Sync button calls `runFabricSync` (`src/atlas/backend.ts`). When deployed and embedded in Fabric,
it reads the Fabric REST APIs (list items, lineage/relations, job history, permissions, item
definitions) using the brokered token, upserts the results into the entities via
`client.data.*.create`, and reloads. A `SyncRun` row records what happened. Everything the UI shows
after a Sync comes from the Fabric-backed table model.

In preview / standalone mode there is no token, so Sync just refreshes the sample dataset. The data
layer is one abstraction (`src/atlas/store.tsx`) so the UI code is identical in both modes.

## Comments

Posting a comment calls `addComment`, which optimistically updates the UI and persists a `Comment`
row through `client.data.Comment.create`. Because comments are stored in the Fabric SQL database,
they persist and are shared across the whole team.

## Theming

Dark is the default. `src/hooks/use-theme.ts` follows the host `data-appearance` attribute
(so it matches the Fabric portal when embedded) and toggles the `.dark` class for Tailwind. Design
tokens are Fluent-style CSS variables in `src/global.css`.

## Preview vs deployed

| | Preview / standalone | Deployed in Fabric |
| --- | --- | --- |
| Auth | none | Fabric brokered (Entra ID) |
| Data | in-memory sample set | Fabric SQL via RayfinClient |
| Sync | refreshes the sample | reads Fabric REST → entities |
| Comments | in-memory | persisted to `Comment` |

This lets the app be fully explorable (and screenshot-able) offline, while the same code runs for
real once deployed.
