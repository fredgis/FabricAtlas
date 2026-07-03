# Installation & deployment

FabricAtlas is a [Rayfin](https://github.com/microsoft/rayfin) Data App: a Vite + React front end
served by Rayfin static hosting, backed by a Fabric SQL database (the Rayfin data model) and Fabric
brokered authentication. It runs as an item inside a Microsoft Fabric workspace.

## Prerequisites

- Node.js 20+ (`node --version`)
- A Microsoft Fabric workspace on a capacity that supports Fabric Apps
- An Entra ID (Azure AD) account with access to that workspace

## 1. Clone and install

```bash
git clone https://github.com/fredgis/FabricAtlas.git
cd FabricAtlas
npm install
```

## 2. Run it locally (preview mode, no Fabric needed)

FabricAtlas boots in preview mode when it is not embedded in Fabric, backed by a rich sample
workspace. This is the fastest way to explore the UI and is what powers the screenshots.

```bash
npm run dev
# open http://localhost:5173
```

Everything works against the sample dataset: the map, catalog tree, access matrix, jobs, config
tree and comments. Nothing is written anywhere.

## 3. Deploy to Fabric

Deployment provisions the backend (Fabric SQL database + Rayfin Data API, storage, static hosting,
Fabric auth), applies the schema, and publishes the app — in one command.

```bash
npx rayfin login          # sign in with Entra ID
npx rayfin up             # provision + apply schema + deploy the static app
npx rayfin up status      # verify endpoint health
```

On the first run, select (or pass) the target workspace:

```bash
npx rayfin up --workspace "FGIMain"
```

`rayfin up` writes the runtime configuration (`VITE_RAYFIN_*`, `VITE_FABRIC_*`) and records the
deployment in `rayfin/.deployments.json`, then prints the live hosting URL
(`https://<...>.fabricapps.net`). Open that URL from inside the Fabric portal — Fabric brokered
auth only works embedded in the portal.

### Target used for this build

| Setting | Value |
| --- | --- |
| Tenant | `a699f329-c8e1-4cf2-ae4f-6ff073b6b3db` |
| Workspace | `FGIMain` |

## 4. Redeploy after a change

Any change — a new entity field, a new tab — ships the same way. `rayfin up` diffs the schema,
applies pending migrations and redeploys the static bundle:

```bash
npx rayfin up
```

Use `--force` only when you have reviewed a destructive schema change (drop column / alter type).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (preview mode with sample data) |
| `npm run build` | Type-check and build the production bundle to `dist/` |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |
| `npx rayfin up` | Deploy app + apply schema to Fabric |

See [architecture.md](architecture.md) for how it all fits together and
[evolving-with-rayfin.md](evolving-with-rayfin.md) for how to grow the app with prompts.
