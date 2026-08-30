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

Contract version 2 separates required sections from optional enrichment and
records metadata capabilities for ownership, sensitivity, endorsement and
tags. Required-section failure rejects the refresh. Optional endpoint failures
remain visible as evidence but do not invalidate otherwise authoritative
metadata. Valid empty workspaces are accepted.

The UDF shares one 92-second monotonic deadline across API calls, incremental
response reads, retries and sleeps. It retries bounded `429` and transient
`5xx` responses, caps upstream and final payloads at 25 MiB, and returns
structured safe errors. The browser independently streams and caps the response
at 26 MiB before parsing.

Each refresh writes a new immutable snapshot. Content rows are written first and
the `Workspace` manifest is written last. A failed or incomplete refresh never
becomes active. On startup, hydration validates manifest counts and falls back
to the previous complete snapshot when necessary.

Content rows are created in bounded batches of eight requests. Entity groups
remain sequential, each in-flight batch settles before an error is propagated,
and neither the `SyncRun` audit nor the `Workspace` visibility manifest starts
after a failed batch.

After the new manifest is visible, Atlas applies trusted snapshot retention.
Every candidate is filtered by workspace, snapshot and writer, child rows are
deleted in bounded batches, and the Workspace manifest is deleted last. Only
the configured synchronizer has delete permission. Cleanup failures are logged
and retried by a later sync without invalidating the published snapshot.
When the synchronizer changes, explicitly configured former writers remain
trusted for reads and cleanup while only the current writer can create or
delete rows.

Snapshot creation is bound to the configured synchronization administrator.
Rayfin create policies compare the authenticated email with each row's
`writerEmail` and with the deployment's configured synchronizer. Database reads
also filter that writer before pagination, and hydration ignores any manifest
that fails the same trust boundary.

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
Fabric principal IDs are authoritative. Unique normalized email correlation
keeps legacy snapshots comparable when older access rows used a name or email.

Workspace manifests from summary version 1 also carry the complete trend
metrics. Startup loads those compact summaries for the ledger and trend, plus
the current and previous detailed catalogs. Selecting another Change Center
snapshot lazily loads and validates that catalog through a snapshot-scoped
query; in-flight loads are discarded when a newer sync starts.

## Personal governance state

Saved views and access-review decisions are separate from synchronized
snapshots. Rayfin policies bind their `user_id` field to the authenticated
subject claim, so each user reads and changes only their own records.

Governance Center groups findings, snapshot changes, trends and metadata
coverage. Access Review uses the same additive effective-access engine as the
Asset Catalog and lineage inspector.

## Navigation state

`src/atlas/routing.ts` parses and serializes Atlas-owned URL parameters while
preserving unrelated Fabric host parameters. Catalog, Asset Catalog,
Governance Center, Access Review, Jobs and Workspace Hub use namespaced keys;
Map retains its established lineage query keys. Browser back/forward therefore
restores the active section, filters, selected evidence and Change Center
snapshot pair.

Live filter changes use `replaceState`, while destination changes use
`pushState`. Re-selecting the exact current route is a no-op so browser history
does not accumulate duplicate entries.

## Object inventory

- Lakehouse tables come from the paginated Fabric Tables API when available.
- Schema-enabled lakehouse columns can be derived through the real Lakehouse to
  SQL endpoint to Semantic Model lineage.
- Warehouse and SQL Database objects use scanner metadata, with a clearly
  labelled downstream model subset when complete SQL catalog access is not
  available.
- Semantic Models include tables, columns, measures, descriptions, hidden
  flags and measure expressions. Dataset expressions are requested only because
  the scanner requires that option for measure DAX.
- Dataflows, Datamarts and Semantic Models include documented upstream
  Dataflow, Datamart and Semantic Model relationships by immutable ID. Scanner
  workspace IDs prevent cross-workspace edges from entering the single-workspace
  graph.
- Reports include pages. Fabric APIs do not expose complete visual field
  bindings through this flow.

Scanner payloads cross an explicit metadata allowlist. Atlas never serializes
table rows, datasource or connection details, dataset/table Mashup expressions,
Power Query definitions, notebook source or pipeline definitions. Ownership is
reported only where Microsoft documents a type-specific field:
`configuredBy` for Semantic Models, Dataflows and Datamarts, and `createdBy` for
Reports. Unknown collection state remains `N/A` instead of becoming a false
missing-owner or unlabeled finding.

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

Radix dialog and tab primitives provide modal focus containment, restoration
and keyboard navigation without changing the Fabric-aligned visual layer.
Global search builds one metadata index per loaded snapshot and applies a short
debounce before ranking results. Item and object lineage retain their visual
graph while also exposing selected relationships as assistive text.

The lineage engine builds incoming, outgoing, incident and neighbor indexes
once per edge set. Traversal is proportional to the reachable subgraph, layout
scores do not filter all edges inside sort comparators, and Map reuses active
impact when focus and selection match.

Dense Access, Asset Catalog and Jobs blocks use Chromium
`content-visibility:auto` containment. Access has one responsive selectable
list, and Jobs has one semantic definition-list timeline that changes layout
without duplicating content.

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
