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

### Prerequisite: enable the Fabric Apps workload (tenant admin, one-time)

Creating a Fabric App item requires a tenant admin to turn the workload on. Otherwise `rayfin up`
returns `403 The feature is not available`.

1. Open the [Fabric admin portal](https://app.fabric.microsoft.com/admin-portal) → Tenant settings.
2. Under Fabric Apps (preview), set the switch to Enabled.
3. Scope it to the whole organization, or a security group that includes the deploying account.
4. Apply, wait a few minutes for it to propagate, then re-run `npx rayfin login`.

The workspace's capacity must also sit in a region that supports Fabric App (preview). FGIMain runs
on a France Central capacity, which is supported. Some regions are not (for example West US 3) — see
[region availability](https://learn.microsoft.com/en-us/fabric/admin/region-availability).

### Deploy

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
| Workspace | `FGIMain` (id `b210da17-0985-4bd0-a8ae-f257e89bd493`) |
| Requirement | The Fabric Apps (Rayfin) item type must be enabled for the workspace's capacity and tenant. If `rayfin up` returns `403 The feature is not available`, enable Fabric Apps in the Fabric admin portal (or deploy onto a capacity/region where it is enabled), then re-run. |

> Make sure `rayfin login` targets the tenant that owns the workspace:
> `npx rayfin login --tenant <tenant-id> --select`. A namesake workspace in a different tenant
> (on a paused capacity) will resolve but fail to deploy.

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
