# Installation & deployment

Fabric Atlas is a [Rayfin](https://github.com/microsoft/rayfin) Data App: a Vite + React front end
served by Rayfin static hosting, backed by a Fabric SQL database (the Rayfin data model) and Fabric
brokered authentication. It runs as an item inside a Microsoft Fabric workspace.

> All identifiers below (tenant, workspace, client id, hosting URL, emails) are shown as
> **placeholders** like `<tenant-id>`. Fill in your own — nothing in this repo is tied to a specific
> tenant.

## Prerequisites

### To run locally (preview)
- Node.js 24 (`node --version`). The repository pins the tested runtime in
  `.nvmrc` and `.node-version`.

### To deploy and use the live Sync
1. A Microsoft Fabric workspace on a capacity in a **region that supports Fabric Apps (preview)**.
2. **Fabric Apps (preview)** enabled by a tenant admin (see below), otherwise `rayfin up` returns
   `403 The feature is not available`.
3. An **Entra ID app registration** (SPA) used by the Sync button, **and an account with enough Entra
   privileges to create and manage it** — ownership of the app registration, or a directory role such
   as *Application Administrator* / *Cloud Application Administrator*. You need this to grant admin
   consent and to add SPA redirect URIs; without it, Microsoft Graph returns
   `Authorization_RequestDenied — Insufficient privileges`. See
   [Live Sync setup](#5-live-sync-setup-app-registration--udf).
4. The **read-only admin APIs** tenant settings enabled, so the Sync can read per-item access and
   lineage from the Fabric admin scanner:
   - *Service principals / users can access read-only admin APIs*
   - *Enhance admin APIs responses with detailed metadata* and *…with user information*
5. The `atlas_sync_functions` **User Data Function published** in the workspace. Initial publication
   can be done in the portal; later source updates can use the full-definition
   `getDefinition` / `updateDefinition` REST flow described in
   [`fabric/udf/atlas_sync_functions/`](../fabric/udf/atlas_sync_functions/).
   Keep its pinned `fabric-user-data-functions` version from `requirements.txt`.

| Responsibility | Required identity or role |
|---|---|
| Run scanner-backed synchronization | A **Fabric Administrator** using the configured synchronizer account |
| Enable Fabric Apps and enhanced read-only admin API metadata | Fabric tenant administrator |
| Create the SPA, add redirects and grant delegated consent | Entra application/consent administrator or application owner with sufficient directory permissions |
| Deploy the Rayfin app into the target workspace | Workspace contributor or higher with Fabric App creation rights |

## 1. Clone and install

```bash
git clone https://github.com/fredgis/FabricAtlas.git
cd FabricAtlas
npm ci
npm ci --prefix rayfin/functions
```

The Rayfin Functions package in `rayfin/functions/` has its own lockfile. `npx rayfin up` builds it
but does not install its dependencies.

To scaffold from the reusable template instead:

```bash
npx rayfin init my-atlas -t https://github.com/fredgis/FabricAtlas
```

## 2. Run it locally (preview mode, no Fabric needed)

Preview data is explicit and never activates because production authentication
failed. Enable it only for local exploration:

```bash
export VITE_RAYFIN_ATLAS_DEMO_MODE=true
npm run dev
# open http://localhost:5173
```

In PowerShell, use
`$env:VITE_RAYFIN_ATLAS_DEMO_MODE = "true"` before `npm run dev`.

Everything works against the sample dataset: overview, map, catalog, asset catalog, access matrix,
sensitivity, jobs and Workspace Hub. Nothing is written anywhere.

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
Rayfin Functions, Fabric auth), applies the schema, and publishes the app — in one command.

```powershell
npx rayfin login                       # sign in with Entra ID (target the tenant that owns the workspace)
$env:RAYFIN_PUBLIC_ATLAS_SYNC_ADMIN_EMAIL = "<authorized-sync-user>"
$env:RAYFIN_PUBLIC_ATLAS_SYNC_ADMIN_SUBJECT = "<authorized-sync-subject>"
npx rayfin up --workspace "<workspace-name>"
```

`rayfin up` writes the runtime configuration (`VITE_RAYFIN_*`, `VITE_FABRIC_*`) into `.env.local`
(git-ignored), records the deployment in `rayfin/.deployments.json` (git-ignored), and prints the
live hosting URL (`https://<app>.fabricapps.net`). Open that URL from inside the Fabric portal —
Fabric brokered auth only works embedded in the portal.

> `rayfin login` must target the tenant that owns the workspace:
> `npx rayfin login --tenant <tenant-id> --select`.

The deployed app uses a shared authenticated catalog read scope. Every user
admitted to the Fabric app can read the complete synchronized governance graph
and team notes for the configured workspace. Restrict the Fabric app audience
accordingly. Personal saved views, review decisions and Radar acknowledgements
remain user-scoped.

## 5. Live Sync setup (app registration + UDF)

The **Sync** button reads the live workspace. A deployed Rayfin app can't call the Fabric REST APIs
directly (no token in app code, no browser CORS), so Sync acquires a Power BI token with **MSAL** and
calls the `atlas_sync_functions` **User Data Function**, which calls Fabric on the user's behalf. See
the [How it works](../README.md#how-it-works) section in the root README.

### 5a. Create the Entra app registration (once)

Create a **single-page application** registration and grant it delegated Power BI/Fabric scopes. With
the Azure CLI (replace nothing that is already a placeholder):

```bash
# 1. Create the SPA app
appId=$(az ad app create --display-name "Fabric Atlas Sync" --sign-in-audience AzureADMyOrg \
  --query appId -o tsv)

# 2. Add the required delegated Power BI permissions:
#    UserDataFunction.Execute.All, Workspace.Read.All, Item.Read.All,
#    Report.Read.All, Dataset.Read.All and Tenant.Read.All.
#    Item.ReadWrite.All is requested separately and only for optional Ontology,
#    Graph Model and Data Agent definition enrichment.
#    (add each with: az ad app permission add --id $appId --api 00000009-0000-0000-c000-000000000000
#     --api-permissions <scope-id>=Scope), then grant admin consent:
#
# 3. Add delegated user_impersonation permissions for Azure Data Explorer
#    and Azure SQL Database to enable KQL and SQL system-catalog discovery.
az ad sp create --id $appId
az ad app permission admin-consent --id $appId

# 4. Register the SPA redirect URIs (your app origin + localhost) via Microsoft Graph:
#    PATCH https://graph.microsoft.com/v1.0/applications/<object-id>
#    body: { "spa": { "redirectUris": [ "https://<app>.fabricapps.net", "http://localhost:5173" ] } }
```

> The tenant, client and workspace ids are **not secrets**, but they are also not committed. Provide
> them to the build through git-ignored env vars (next step).

### 5b. Point the app at your registration and UDF

Add these public values to `rayfin/.env` (git-ignored). `rayfin env` maps custom
`RAYFIN_PUBLIC_*` values to Vite variables, and `rayfin up` supplies the Fabric workspace and tenant:

```bash
RAYFIN_PUBLIC_ATLAS_SPA_CLIENT_ID=<client-id>
RAYFIN_PUBLIC_ATLAS_UDF_URL=https://<...>/functions/sync_all/invoke
RAYFIN_PUBLIC_ATLAS_WORKSPACE_NAME=<workspace-display-name>
RAYFIN_PUBLIC_ATLAS_SYNC_ADMIN_EMAIL=<authorized-sync-user>
RAYFIN_PUBLIC_ATLAS_SYNC_ADMIN_SUBJECT=<authorized-sync-subject>
RAYFIN_PUBLIC_ATLAS_SNAPSHOT_RETENTION_COUNT=12
# Optional during synchronizer rotation:
RAYFIN_PUBLIC_ATLAS_PREVIOUS_SYNC_WRITERS=<former-user@example.com>
RAYFIN_PUBLIC_ATLAS_SENSITIVITY_RANKS='{"<label-id>":3,"<lower-label-id>":1}'
```

Then `npx rayfin up` again so the values are baked into the deployed bundle, and add the new hosting
origin to the app registration's SPA redirect URIs.

`RAYFIN_PUBLIC_ATLAS_SYNC_ADMIN_SUBJECT` is compiled into Rayfin create, update
and delete policies and must match the authenticated Rayfin `session.user.id`
(`claims.sub`). The email is retained as the visible contact and historical
snapshot writer. Set both before schema generation and deployment; changing
either requires another `npx rayfin up`. Snapshot retention defaults to 12 and
is clamped between 2 and 50.

The synchronizer setting must also be available to the CLI process that
compiles these policies. Keep it in `rayfin/.env` for frontend generation and
export it in the deployment shell as shown above. Confirm that the database
configuration phase succeeds: some CLI versions continue publishing static
content after a database configuration failure.

Only the configured immutable subject can run the first synchronization or
publish later snapshots. Resolve the account's stable object identifier through
Entra or the authenticated Rayfin session and keep the email for contact.

Deep discovery is capability-based. Without optional definition, Kusto or Azure SQL delegated
consent, those items remain visible and Atlas reports their deep schema as
unavailable. Ontology, Graph Model and Data Agent definitions require
the separately acquired `Item.ReadWrite.All` token and read/write permission on
the item because that is the current Fabric API contract. Encrypted sensitivity
labels can block Ontology definition retrieval.

`rayfin up` adds the deployment origin to Rayfin's authentication allowlist.
The Entra SPA redirect URI is managed separately and must contain the same
hosting origin.

Atlas uses these permissions only for read operations. It never calls
definition update/delete APIs, never elevates the signed-in user and never
stores rows, prompts, few-shots or graph instances.

Sensitivity downgrade alerts are tenant-specific. Optionally map Purview label
IDs or normalized aliases to numeric ranks in
`RAYFIN_PUBLIC_ATLAS_SENSITIVITY_RANKS`; higher numbers mean stronger
protection. Unknown labels intentionally produce no downgrade alert.

> **One SPA redirect URI per hosting origin.** MSAL signs in against the app's own origin
> (`https://<app>.fabricapps.net`), so that exact origin must be listed under the app registration's
> **Authentication → Single-page application** redirect URIs — otherwise the Sync popup fails with an
> `AADSTS` redirect-mismatch error. `rayfin up` gives a **new** origin every time the app is *deleted
> and re-created*, which means re-registering it. **Don't delete the app**: a plain `npx rayfin up`
> reuses the same item and origin, so you register the redirect URI only once. Adding it (portal →
> App registration → Authentication → SPA, or the Graph `PATCH` in step 5a) requires the Entra
> privilege listed in the prerequisites.

### 5c. Publish the UDF and run Sync

1. Open the `atlas_sync_functions` item in your workspace (Fabric portal). Make sure its code matches
   [`function_app.py`](../fabric/udf/atlas_sync_functions/function_app.py), then click **Publish** and
   confirm both `sync_all` and `sync_items` are public endpoints. Copy the `sync_all` invoke URL; the
   app derives the sibling `sync_items` URL for resumable per-type enrichment.
2. Put the `sync_all` invoke URL in `RAYFIN_PUBLIC_ATLAS_UDF_URL` as shown above, redeploy, open the
   app and click **Start first sync**. The first-run screen shows live progress but never asks users
   to paste configuration values. After a successful index, future visits open the dashboard
   directly and later refreshes use the header Sync button.

For an existing published UDF, retrieve the complete definition, replace only
the Base64 `function_app.py` and `requirements.txt` payloads, submit every
definition part to `updateDefinition`, then read the definition back and
compare both hashes before invoking `sync_all`.

## 6. Redeploy after a change

Any change, including the `SavedView` and `AccessReview` entities introduced in
Fabric Atlas 1.5, ships the same way:

```bash
npx rayfin up
```

Use `--force` only when you have reviewed a destructive schema change (drop column / alter type). If
the app was deleted and re-created, remove `rayfin/.deployments.json` first so a fresh item is
created, then re-add the new hosting origin to the app registration.

Rayfin Functions ship with the same `npx rayfin up`. To debug them against an existing deployment,
run `npx rayfin dev functions apply` (requires Azure Functions Core Tools). It starts a local host,
keeps `rayfin/functions/src/types.ts` generated and writes the host URL to
`RAYFIN_PUBLIC_FUNCTIONS_URL`. `npm run dev` exposes that value as `VITE_RAYFIN_FUNCTIONS_URL`, which
only development builds use. After changing a `udf.func()` signature without the dev host running,
rerun `npx rayfin functions init` without `--force` to rebuild and regenerate the types.

## Phase 2 integration status

The durable synchronization spike registers `syncStart`, `syncContinue`, `syncStatus` and
`syncCancel` alongside `ping`. It only writes its three additive checkpoint entities. Browser
Sync still uses the published Python UDF and existing snapshot writer.

Generate Functions contracts and runtime metadata through the supported CLI, never by editing
`src/types.ts` or `runtimemetadata.json`. The re-run preserves existing source and performs the
Functions dependency install/build locally:

```powershell
npx --no-install rayfin functions init
npm test -- src\atlas\durable-sync.spec.ts src\atlas\durable-sync-policy.spec.ts src\lib\rayfin-client.spec.ts
npm test
npm run lint
npm run build
npm --prefix rayfin\functions run build
npx rayfin up --tenant <tenant-id> --workspace <workspace-name>
npx rayfin up status
```

All inputs require `protocolVersion: 1` and strict RFC UUIDs. Start with a fresh request UUID,
retain it if an invocation fails, and serialize all mutating invocations across hosts. The first
continue request commits a completed task and a `waiting` job. Retrying that request reads the
same slice; a fresh continue UUID finalizes the probe. A running claim can only resume with its
original request UUID or be cancelled. Status is read-only and queries only shared job rows.
None of these calls schedules subsequent execution, and closing the browser does not keep a
worker running.

Rayfin 1.36.2 typegen emits an optional handler parameter as a required property whose type
includes `undefined`. Runtime metadata correctly marks `syncStatus.jobId` optional. Until that
CLI limitation is resolved, a typed client must explicitly supply `jobId: undefined` to ask for
the active/latest job; JSON serialization omits the value:

```ts
await client.functions.syncStatus.invoke({ protocolVersion: 1, workspaceId, jobId: undefined });
```

The generated files remain unmodified by hand. Resolve this optional-input typing limitation
before exposing a consumer that requires the exact omission-friendly typed signature.

The additive schema and Functions package have been deployed to the isolated FabCon candidate.
The candidate SQL Database contains `SyncJobs`, `SyncTasks` and `SyncCommands`. Deployment and
schema generation therefore pass, while the following runtime checks remain open:

- invoke the four sync functions through an embedded authenticated Rayfin session
- close and reopen the app, then read the same persisted job
- exercise cancellation and duplicate requests against the deployed Data API
- verify uniqueness and policy enforcement under concurrent hosts

Direct automated sign-in requires a delegated Power BI token with `Item.Execute.All`. The cached
builder token exposes only `user_impersonation`, so it must not be used as proof of caller-scoped
execution. External Entra exchange remains disabled after validation. Do not persist browser
tokens, weaken entity policies or enable a broader auth path to bypass this requirement.

The Phase 2 decision is **hybrid**. Keep the checkpoint entities and bounded Functions available
for follow-up integration, but leave Python collection and browser snapshot publication
authoritative. Distributed claims, transactional publication, unattended triggers and embedded
recovery remain blockers. There is no browser cutover in this spike.

## Phase 3 workspace discovery foundation

The `workspaceDiscover` Function declares the Fabric audience and therefore runs Fabric REST
workspace discovery with the AppBackend application identity. In current Fabric Apps deployments,
that identity follows the AppBackend owner. The owner must retain access to every workspace that
the Atlas administrator needs to evaluate.

The Function is not a general app-audience workspace browser. It first reads the deterministic
`SynchronizerAuthority` sentinel using the caller's Rayfin token. The first authorized invocation
creates it through the same synchronizer-only policy. Other authenticated users either cannot
read or cannot create the sentinel and fail closed before the Fabric request. Successful responses
contain only workspace ID, display name, type and capacity ID, with bounded pagination, retries
and response size.

`WorkspaceScope` persists only the rows the administrator selects. Its rows are shared with the
authenticated app audience; all mutations require the configured synchronizer subject. Removal is
blocked while shared Atlas rows still reference the workspace. Do not bypass that guard until a
reviewed archival and deletion workflow covers synchronized rows, shared governance state and
append-only team notes. Deploy the additive entity and Function contract with the normal command:

```powershell
npx rayfin up --tenant <tenant-id> --workspace <workspace-name>
```

The store can switch and rehydrate an active selected workspace, and every backend read/write takes
that workspace ID explicitly. The visible selector and multi-workspace synchronization action are
not added yet. The configured deployment workspace remains the fallback until an explicit scope
is persisted.

## Fabric Core collector stage

`workspaceCollectCore` also declares the Fabric audience and runs behind the same
synchronizer-only gate. It is a read-only dual-run stage for comparison with the Python UDF: it is
not wired to the Sync button, writes no Rayfin rows and must not be published as a snapshot. Its
excluded sections and capabilities are `unsupported` with `collector-not-migrated`, so
`validateRawSync` rejects it by design; validate it with `validateCoreCollectorEnvelope` instead.
Typed callers pass the correlation explicitly:

```ts
await client.functions.workspaceCollectCore.invoke({
  protocolVersion: 1,
  workspaceId,
  correlationId: null,
});
```

The defaulted nullable parameter keeps the generated type and runtime metadata aligned, so this
Function does not have the `syncStatus.jobId` optional-input limitation. The AppBackend owner must
be able to read the workspace, its items, role assignments and item job instances. A missing
permission fails only the affected section; job failures never invalidate workspace, item or role
data. Regenerate and validate the contract with:

```powershell
npx --no-install rayfin functions init
npm test -- src\atlas\workspace-collector.spec.ts src\atlas\core-collector-parity.spec.ts src\atlas\durable-sync.spec.ts src\lib\rayfin-client.spec.ts
npm --prefix rayfin\functions run build
```

`rayfin functions init` also refreshes Rayfin agent-skill files and `rayfin/.lockfile.json`;
revert those unrelated changes before committing generated Functions contracts.

For an isolated parity deployment only, enable the browser shadow adapter:

```dotenv
VITE_ATLAS_CORE_COLLECTOR_SHADOW=true
VITE_ATLAS_DEFINITION_COLLECTOR_SHADOW=true
VITE_ATLAS_ITEM_RELATIONS_COLLECTOR_SHADOW=true
VITE_ATLAS_KQL_COLLECTOR_SHADOW=true
```

The existing Python sync and the Rayfin Core Function then start under the same
correlation ID. Supported definition items from the Core inventory are passed
to `workspaceCollectDefinitions` in bounded batches. The browser parity probe
passes a deterministic sample of at most 16 Core item IDs to
`workspaceCollectItemRelations`. Only the Python result can publish the snapshot. Atlas
stores bounded Core, definition and Item Relations status summaries in
`SyncRun`. The KQL shadow adds only structural table/function/view counts and
the dated data-plane blocker. Atlas never stores or logs the raw shadow
payloads.
Leave the flag unset in stable deployments until the real comparison gate
passes.

Definition and Item Relations shadows share a three-minute browser deadline.
They may report a timeout, but cannot delay authoritative Python snapshot
publication indefinitely. Full-workspace Item Relations collection belongs to
the durable server orchestration, not the browser parity probe.

## Fabric definition stage

`workspaceCollectDefinitions` declares the Fabric audience and runs behind the same gate. It is a
read-only dual-run stage that never publishes snapshots. Callers send an allowlisted batch of up
to eight items:

```ts
await client.functions.workspaceCollectDefinitions.invoke({
  protocolVersion: 1,
  workspaceId,
  items: [{ id: ontologyId, type: "Ontology" }],
  correlationId: null,
});
```

The Fabric getDefinition APIs require read **and write** permission on each item and, for
delegated tokens, the `Item.ReadWrite.All` scope. The Python UDF uses a separate delegated
definition token for that reason. This Function uses the AppBackend application identity, so the
AppBackend owner or service principal must hold at least Contributor on every workspace whose
definitions are compared. Whether the platform-minted Fabric token satisfies the write
requirement is not yet verified in a deployed run; missing permission is reported per item as
`unsupported/read-write-permission-required` and never invalidates other items. Items protected by
an encrypted sensitivity label return `encrypted-label-blocked`.

Validate this stage with:

```powershell
npx --no-install rayfin functions init
npm test -- src\atlas\workspace-definitions.spec.ts src\atlas\durable-sync.spec.ts src\lib\rayfin-client.spec.ts
npm --prefix rayfin\functions run build
```

If a stale generated `types.ts` breaks the CLI's pre-generation build, restore the last committed
`types.ts` and `runtimemetadata.json` with `git checkout --` and rerun the CLI; do not edit them
by hand.

## Item Relations API (Beta) collector

`workspaceCollectItemRelations` declares the Fabric audience, runs behind the same gate and is not
called by the browser yet:

```ts
await client.functions.workspaceCollectItemRelations.invoke({
  protocolVersion: 1,
  workspaceId,
  itemIds: [semanticModelId],
  correlationId: null,
});
```

The upstream and downstream relations APIs require read permission on each root item and, for
delegated tokens, `Item.Read.All` or `Item.ReadWrite.All`; service principals are supported.
This Function uses the AppBackend application identity, so that identity must be able to read the
root items. Missing access is recorded per query as `unauthorized` or `insufficient-privileges`.
The API is Beta and not recommended for production use. Its real-tenant response size,
pagination and relation coverage are not yet verified; keep it behind the default-off
`VITE_ATLAS_FEATURE_ITEM_RELATIONS` flag. Validate with:

```powershell
npx --no-install rayfin functions init
npm test -- src\atlas\workspace-item-relations.spec.ts src\atlas\item-relations-evidence.spec.ts src\atlas\durable-sync.spec.ts src\lib\rayfin-client.spec.ts
npm --prefix rayfin\functions run build
```

## KQL metadata stage

`workspaceCollectKqlMetadata` declares only the Fabric audience and returns Eventhouse and KQL
database properties plus KQL structural schema from the documented KQL Database definition. It is
read-only, non-authoritative and not called by the browser yet:

```ts
await client.functions.workspaceCollectKqlMetadata.invoke({
  protocolVersion: 1,
  workspaceId,
  items: [{ id: kqlDatabaseId, type: "KQLDatabase" }],
  correlationId: null,
});
```

The AppBackend application identity needs read permission on each Eventhouse and KQL database,
and read **and write** permission on each KQL database for `getDefinition`. Missing write access is
reported per database as `schema: unsupported/read-write-permission-required` and never fails the
item properties. The Kusto data-plane schema query remains **blocked as of 2026-10-02 on Rayfin
1.36.2** because Functions expose no Kusto audience; the definition's `DatabaseSchema.kql` is the
supported structural replacement for the Atlas cutover. Do not forward browser tokens to the
Function. Validate with:

```powershell
npx --no-install rayfin functions init
npm test -- src\atlas\kql-schema.spec.ts src\atlas\workspace-kql-metadata.spec.ts src\atlas\durable-sync.spec.ts src\lib\rayfin-client.spec.ts
npm --prefix rayfin\functions run build
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (preview mode with sample data) |
| `npm run build` | Type-check and build the production bundle to `dist/` |
| `npm run typecheck` | Run the full TypeScript project check |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |
| `npx rayfin up` | Deploy app + apply schema to Fabric |

Team notes are shared and append-only in v1.x. Atlas stores the authenticated
session email as the author label and binds the note to the authenticated
subject. That label survives reload, but notes cannot currently be edited or
deleted.

See [architecture.md](architecture.md) for how it all fits together.
