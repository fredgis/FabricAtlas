# Installation & deployment

Fabric Atlas is a [Rayfin](https://github.com/microsoft/rayfin) Data App: a Vite + React front end
served by Rayfin static hosting, backed by a Fabric SQL database (the Rayfin data model) and Fabric
brokered authentication. It runs as an item inside a Microsoft Fabric workspace.

> All identifiers below (tenant, workspace, client id, hosting URL, emails) are shown as
> **placeholders** like `<tenant-id>`. Fill in your own — nothing in this repo is tied to a specific
> tenant.

## Prerequisites

### To run locally (preview)
- Node.js 20+ (`node --version`) — that's it. Preview mode uses a bundled sample workspace.

### To deploy and use the live Sync
1. A Microsoft Fabric workspace on a capacity in a **region that supports Fabric Apps (preview)**.
2. **Fabric Apps (preview)** enabled by a tenant admin (see below), otherwise `rayfin up` returns
   `403 The feature is not available`.
3. An **Entra ID app registration** (SPA) used by the Sync button — see
   [Live Sync setup](#5-live-sync-setup-app-registration--udf).
4. The **read-only admin APIs** tenant settings enabled, so the Sync can read per-item access and
   lineage from the Fabric admin scanner:
   - *Service principals / users can access read-only admin APIs*
   - *Enhance admin APIs responses with detailed metadata* and *…with user information*
5. The `atlas_sync_functions` **User Data Function published** in the workspace (portal), because
   Fabric doesn't persist UDF code through the REST API — see
   [`fabric/udf/atlas_sync_functions/`](../fabric/udf/atlas_sync_functions/).

## 1. Clone and install

```bash
git clone https://github.com/fredgis/FabricAtlas.git
cd FabricAtlas
npm install
```

## 2. Run it locally (preview mode, no Fabric needed)

Fabric Atlas boots in preview mode when it is not embedded in Fabric, backed by a rich sample
workspace. This is the fastest way to explore the UI and is what powers the screenshots.

```bash
npm run dev
# open http://localhost:5173
```

Everything works against the sample dataset: overview, map, catalog, asset catalog, access matrix,
sensitivity, jobs, config and comments. Nothing is written anywhere.

## 3. Enable the Fabric Apps workload (tenant admin, one-time)

Creating a Fabric App item requires a tenant admin to turn the workload on.

1. Open the [Fabric admin portal](https://app.fabric.microsoft.com/admin-portal) → Tenant settings.
2. Under **Fabric Apps (preview)**, set the switch to Enabled.
3. Scope it to the whole organization, or a security group that includes the deploying account.
4. Apply, wait a few minutes for it to propagate.

The workspace's capacity must also sit in a region that supports Fabric Apps (preview). Some regions
are not supported — see
[region availability](https://learn.microsoft.com/en-us/fabric/admin/region-availability).

## 4. Deploy to Fabric

Deployment provisions the backend (Fabric SQL database + Rayfin Data API, storage, static hosting,
Fabric auth), applies the schema, and publishes the app — in one command.

```bash
npx rayfin login                       # sign in with Entra ID (target the tenant that owns the workspace)
npx rayfin up --workspace "<workspace-name>"
```

`rayfin up` writes the runtime configuration (`VITE_RAYFIN_*`, `VITE_FABRIC_*`) into `.env.local`
(git-ignored), records the deployment in `rayfin/.deployments.json` (git-ignored), and prints the
live hosting URL (`https://<app>.fabricapps.net`). Open that URL from inside the Fabric portal —
Fabric brokered auth only works embedded in the portal.

> `rayfin login` must target the tenant that owns the workspace:
> `npx rayfin login --tenant <tenant-id> --select`.

## 5. Live Sync setup (app registration + UDF)

The **Sync** button reads the live workspace. A deployed Rayfin app can't call the Fabric REST APIs
directly (no token in app code, no browser CORS), so Sync acquires a Power BI token with **MSAL** and
calls the `atlas_sync_functions` **User Data Function**, which calls Fabric on the user's behalf. See
the "Why a Fabric User Data Function?" note in the [root README](../README.md).

### 5a. Create the Entra app registration (once)

Create a **single-page application** registration and grant it delegated Power BI/Fabric scopes. With
the Azure CLI (replace nothing that is already a placeholder):

```bash
# 1. Create the SPA app
appId=$(az ad app create --display-name "Fabric Atlas Sync" --sign-in-audience AzureADMyOrg \
  --query appId -o tsv)

# 2. Add delegated permissions on the Power BI Service (resource 00000009-0000-0000-c000-000000000000):
#    UserDataFunction.Execute.All, Workspace.Read.All, Item.Read.All,
#    Report.Read.All, Dataset.Read.All, Tenant.Read.All
#    (add each with: az ad app permission add --id $appId --api 00000009-0000-0000-c000-000000000000
#     --api-permissions <scope-id>=Scope), then grant admin consent:
az ad sp create --id $appId
az ad app permission admin-consent --id $appId

# 3. Register the SPA redirect URIs (your app origin + localhost) via Microsoft Graph:
#    PATCH https://graph.microsoft.com/v1.0/applications/<object-id>
#    body: { "spa": { "redirectUris": [ "https://<app>.fabricapps.net", "http://localhost:5173" ] } }
```

> The tenant, client and workspace ids are **not secrets**, but they are also not committed. Provide
> them to the build through git-ignored env vars (next step).

### 5b. Point the app at your registration

Add these to `.env.local` (git-ignored). `VITE_FABRIC_WORKSPACE_ID` is written automatically by
`rayfin up`; you provide the client and tenant:

```bash
VITE_ATLAS_SPA_CLIENT_ID=<client-id>
VITE_ATLAS_TENANT_ID=<tenant-id>
# optional — otherwise pasted in the app's first-run screen and kept in localStorage:
# VITE_ATLAS_UDF_URL=https://<...>/functions/sync_all/invoke
```

Then `npx rayfin up` again so the values are baked into the deployed bundle, and add the new hosting
origin to the app registration's SPA redirect URIs.

### 5c. Publish the UDF and run Sync

1. Open the `atlas_sync_functions` item in your workspace (Fabric portal). Make sure its code matches
   [`function_app.py`](../fabric/udf/atlas_sync_functions/function_app.py), then click **Publish** and
   copy the `sync_all` invoke URL.
2. Open the app, paste the `sync_all` invoke URL on the first-run screen, and click **Sync**. The
   catalog, lineage, per-item access, sensitivity and config are written into the Atlas database.

## 6. Redeploy after a change

Any change — a new entity field, a new tab — ships the same way:

```bash
npx rayfin up
```

Use `--force` only when you have reviewed a destructive schema change (drop column / alter type). If
the app was deleted and re-created, remove `rayfin/.deployments.json` first so a fresh item is
created, then re-add the new hosting origin to the app registration.

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
