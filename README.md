<div align="center">

# 🧭 FabricAtlas

### Everything in your Microsoft Fabric workspace, in one place.

Items, lineage, catalog, access, jobs, config — and a team comment layer that lives in the database.
Built as a [Rayfin](https://github.com/microsoft/rayfin) Data App and deployed straight into Fabric.

</div>

![Overview](docs/screenshots/overview.png)

---

## What is FabricAtlas?

A Fabric workspace grows fast: lakehouses, notebooks, pipelines, semantic models, reports. Nobody has
the full picture — what depends on what, who can see what, what just failed, who owns it.

FabricAtlas gives you that picture. Click **Sync** and it reads your workspace from the Fabric APIs
and stores everything in its own data model. Then it draws it: a living map of your items and their
lineage, a catalog you can browse as a tree or as cards, an access matrix down to each object, a jobs
board, an exhaustive config tree per item, and a comment thread your whole team shares.

No business data required. FabricAtlas only reads your workspace metadata, so you can point it at any
workspace and get value on the first Sync.

## A tour

### Map & lineage
A cartography of every item and how they connect. Broken lineage is called out in red. Click any node
to inspect it, walk upstream and downstream, and jump around.

![Map & lineage](docs/screenshots/map.png)

### Catalog
Every item as a collapsible tree and as rich cards — owner, health, endorsement, tags, freshness.

![Catalog](docs/screenshots/catalog.png)

### Access
Who can reach what. A matrix by principal, and a drill-down by object that explains where each grant
comes from (workspace role, direct share, group, org link). Risks are surfaced automatically.

![Access](docs/screenshots/access.png)

### Config
Everything retrievable about an item — settings, schedules, tables, measures, bindings — as an
expandable tree.

![Config](docs/screenshots/config.png)

### Comments
Team notes on the workspace or any item, stored in the Fabric-backed database so they persist and
everyone sees them.

![Comments](docs/screenshots/comments.png)

### Dark and light
Dark by default, with a one-click light theme. When embedded, it follows the Fabric portal theme.

![Map in light theme](docs/screenshots/map-light.png)

## Why Rayfin

FabricAtlas is a Rayfin Data App, so the whole backend is described in TypeScript and provisioned by
Rayfin on Fabric:

- The **data model** is nine decorator classes in `rayfin/data/`. Rayfin turns them into a governed
  Fabric SQL database with a typed Data API — that is where the synced metadata and the comments live.
- **Auth** is Fabric brokered (Entra ID). **Hosting** is Rayfin static hosting. **Storage** is ready
  for attachments.
- One command deploys everything and applies schema changes: `rayfin up`.

And because it is declarative, you can grow it by prompting an AI agent. See
[docs/evolving-with-rayfin.md](docs/evolving-with-rayfin.md).

> ### ℹ️ Why a Fabric User Data Function?
>
> A deployed Rayfin app is a browser SPA with a Fabric SSO session, but Rayfin never
> exposes a Fabric access token to app code, and the Fabric REST APIs don't allow browser
> CORS. So the app cannot call the Fabric management APIs (list items, lineage,
> permissions, jobs) directly from the browser. FabricAtlas therefore ships a small Fabric
> User Data Function (`atlas_sync_functions`, Python) that runs server-side, receives the
> user's token, calls the Fabric REST APIs on their behalf, and returns the results, which
> the Sync button writes into the Atlas database. The semantic-model deep lineage (tables,
> columns, measures) is read in-app through the Fabric embed proxy (DAX `INFO` functions),
> which is the one Fabric data path a browser app is allowed to use. Fabric does not expose
> a REST API to publish a User Data Function, so that one step is done once in the Fabric
> portal (Publish), after which the app invokes it.

## How it works

```mermaid
flowchart LR
  subgraph B["🌐 FabricAtlas — browser SPA (Rayfin app)"]
    UI["React UI · 7 tabs<br/>Overview · Map · Catalog<br/>Access · Jobs · Config · Comments"]
    MSAL["MSAL<br/>Power BI token"]
  end

  subgraph F["☁️ Microsoft Fabric · FGI-MAIN"]
    UDF["User Data Function<br/>atlas_sync_functions · sync_all"]
    REST["Fabric REST APIs<br/>items · roleAssignments · jobs"]
    SM["Semantic model<br/>embed proxy · DAX INFO"]
    DB[("Rayfin database<br/>Fabric SQL")]
  end

  UI -- "① Sync" --> MSAL
  MSAL -- "② bearer token" --> UDF
  UDF -- "③ fabricToken" --> REST
  REST -- "④ items · users + access · jobs" --> UDF
  UDF -- "⑤ JSON" --> UI
  UI -- "⑥ write catalog" --> DB
  UI -- "⑦ deep lineage" --> SM
  UI -- "comments" --> DB
  DB -- "reload on open" --> UI

  classDef browser fill:#3b82f6,stroke:#1e40af,color:#fff;
  classDef udf fill:#7c5cff,stroke:#4c1d95,color:#fff;
  classDef rest fill:#0ea5b7,stroke:#0f766e,color:#fff;
  classDef db fill:#22a565,stroke:#15803d,color:#fff;
  classDef sm fill:#d9a520,stroke:#a16207,color:#fff;

  class UI,MSAL browser;
  class UDF udf;
  class REST rest;
  class DB db;
  class SM sm;
```

The **Sync** button acquires a Power BI token (MSAL), the `sync_all` User Data
Function reads the workspace with it, and the result — items, the list of
workspace **users and their access**, and jobs — is written into the Rayfin
database and rendered. Comments and the last sync are read back on open.

> ### 💡 Rayfin improvements that would simplify this
>
> Building FabricAtlas surfaced a few gaps. These would remove the UDF hop and
> most of the glue code above:
>
> - Expose a scoped, opt-in brokered Fabric token to app code, so the app can call
>   Fabric REST without a separate User Data Function and app registration.
> - Add first-class server functions to the Data App template — a place to run
>   trusted server-side code (like `sync_all`) without provisioning a separate UDF.
> - Provide a REST/CLI way to publish a UDF and read its invoke URL, so deployment
>   is fully scriptable instead of a manual portal click.
> - Offer a native Fabric lineage API (item level and intra-item: tables, columns,
>   measures), so lineage isn't stitched from the scanner API and DAX `INFO`.
> - Support bulk `upsert` and CLI seeding for `@authenticated` entities, so a first
>   dataset can load at deploy time, not only from the signed-in app.
> - Enable CORS on Fabric management endpoints for delegated browser calls.

## Quickstart

```bash
git clone https://github.com/fredgis/FabricAtlas.git
cd FabricAtlas
npm install

# explore locally with sample data (no Fabric needed)
npm run dev            # http://localhost:5173

# deploy into your Fabric workspace
npx rayfin login --tenant <your-tenant-id> --select
npx rayfin up --workspace "FGIMain"
```

Full steps in [docs/installation.md](docs/installation.md).

## Docs

| Doc | About |
| --- | --- |
| [Installation & deployment](docs/installation.md) | Prerequisites, local preview, deploy to Fabric |
| [Architecture](docs/architecture.md) | How the SPA, Rayfin data layer and Sync fit together |
| [Data model](docs/data-model.md) | The nine entities and their fields |
| [Evolving with Rayfin](docs/evolving-with-rayfin.md) | Grow the app with prompts and `rayfin up` |

## Repo layout

```
rayfin/
  rayfin.yml            # services: auth, data (mssql), storage, static hosting
  data/                 # 9 entity classes + schema.ts
src/
  App.tsx               # shell: sidebar, top bar, theme, sync, tab routing
  atlas/
    model.ts            # types, item-type metadata, sample dataset
    store.tsx           # data + sync + comments (preview / Rayfin backed)
    backend.ts          # persistence + Fabric sync boundary
    ui.tsx              # avatars, glyphs, health chips, cards
    views/              # Overview, Map, Catalog, Access, Jobs, Config, Comments
docs/                   # this documentation + screenshots
```

## License

MIT © 2026. Built with [Rayfin](https://github.com/microsoft/rayfin) on Microsoft Fabric.
