# Architecture

Fabric Atlas is one place to see everything in a Fabric workspace, plus a team comment layer. It is a
Rayfin Data App, so the backend is described in TypeScript and provisioned by Rayfin on Fabric.

## The pieces

```
Fabric portal (iframe)
        │  brokered auth (Entra ID)
        ▼
React + Vite SPA  ── Rayfin static hosting (dist/)
        ├──────────► Published User Data Function ──► Fabric + Power BI APIs
        │
        │  RayfinClient
        ▼
Rayfin Data API (Data API Builder)  ──  Fabric SQL database (mssql)
        ▲
        │  Sync writes here
   synchronized metadata  (items · lineage · jobs · permissions · definitions)
```

- The front end lives in `src/`. Atlas feature code is in `src/atlas/` (model, store, UI helpers,
  lineage logic and product views).
- The data model lives in `rayfin/data/` as decorator classes and is registered in
  `rayfin/data/schema.ts`. `rayfin.yml` enables `auth`, `data` (mssql), `storage` and `staticHosting`.
- `RayfinClient` (`src/lib/rayfin-client.ts`) talks to the Rayfin Data API, which serves the Fabric
  SQL database. Auth is Fabric brokered (`src/services/rayfin-auth.service.ts`).

## Data model

Eleven entities capture the workspace, team context and personal review state.
See [data-model.md](data-model.md) for fields.

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
| `SavedView` | User-scoped filter and navigation presets |
| `AccessReview` | User-scoped access-review decisions and notes |

## Sync

The Sync button calls `runFabricSync` (`src/atlas/backend.ts`). When deployed, the browser invokes
the published `sync_all` Fabric User Data Function. That server-side function reads Fabric and
Power BI metadata APIs with the user's delegated token. The app maps the response, writes it through
the Rayfin Data API, and records a `SyncRun`.

Each refresh writes a new immutable snapshot. Content rows are written first and
the `Workspace` manifest is written last. A failed or incomplete refresh never
becomes active. On startup, hydration validates manifest counts and falls back
to the previous complete snapshot when necessary.

Snapshot creation is bound to the configured synchronization administrator.
Rayfin create policies compare the authenticated email with each row's
`writerEmail`, and hydration ignores manifests from any other writer.

The workspace manifest stores the deployed build ID. A new build shows the
guided sync screen until the authorized synchronizer publishes its snapshot.
After that one sync, every user loads the same validated build snapshot.

The MSAL account used for Sync must match the current Rayfin user and tenant.
Tokens use session storage so switching Fabric users cannot silently reuse the
first account from a persistent browser cache.

## Governance history

`loadHistoryFromDb` reads older trusted manifests with snapshot-scoped queries.
Each candidate passes the same writer, row-count, schema and item validation as
the active catalog. Invalid historical snapshots are skipped.

`src/atlas/history.ts` compares validated snapshots without depending on row
order. It detects changes to items, schema objects, access grants, sensitivity,
lineage and jobs, then derives the trend series used by Governance Center.

## Personal governance state

Saved views and access-review decisions are separate from synchronized
snapshots. Rayfin policies bind their `user_id` field to the authenticated
subject claim, so each user reads and changes only their own records.

Governance Center groups findings, snapshot changes, trends and metadata
coverage. Access Review uses the same additive effective-access engine as the
Asset Catalog and lineage inspector.

## Object inventory

- Lakehouse tables come from the paginated Fabric Tables API when available.
- Schema-enabled lakehouse columns can be derived through the real Lakehouse to
  SQL endpoint to Semantic Model lineage.
- Warehouse and SQL Database objects use scanner metadata, with a clearly
  labelled downstream model subset when complete SQL catalog access is not
  available.
- Semantic Models include tables, columns, measures, descriptions, hidden
  flags and measure expressions.
- Reports include pages. Fabric APIs do not expose complete visual field
  bindings through this flow.

In preview / standalone mode there is no token, so Sync just refreshes the sample dataset. The data
layer is one abstraction (`src/atlas/store.tsx`) so the UI code is identical in both modes.

## Workspace Hub

Posting a comment calls `addComment`, which optimistically updates the UI and persists a `Comment`
row through `client.data.Comment.create`. Because comments are stored in the Fabric SQL database,
they persist and are shared across the whole team. Configuration and comments are presented together
in Workspace Hub so technical facts and human context stay adjacent.

## Theming

Light is the default so the embedded app follows the surrounding Fabric portal.
`src/hooks/use-theme.ts` stores an explicit light or dark preference and toggles
the `.dark` class for Tailwind.

Design tokens in `src/global.css` map the Atlas semantic palette to Fabric UX
and Fluent 2 neutrals, brand actions, status colors, spacing, radii and
elevation. Atlas keeps a restrained purple-to-teal spectrum for product
identity and lineage while standard interactions use the Fabric brand color.

## Preview vs deployed

| | Preview / standalone | Deployed in Fabric |
| --- | --- | --- |
| Auth | none | Fabric brokered (Entra ID) |
| Data | in-memory sample set | Fabric SQL via RayfinClient |
| Sync | refreshes the sample | validates UDF result, writes a new snapshot |
| Comments | in-memory | persisted to `Comment` |
| Saved views and reviews | current preview session | user-scoped Rayfin entities |

This lets the app be fully explorable (and screenshot-able) offline, while the same code runs for
real once deployed.
