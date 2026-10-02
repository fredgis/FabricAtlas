# Atlas deployment support and recovery runbook

Support review: **2026-10-02**. Deployment plans are in preview.
This is an operator runbook, not an executed deployment record.

## Component support matrix

A deployment plan adds order and actions to a supported deployment operation.
It does not make an unsupported item deployable, provision workspace settings,
or replace Rayfin's app deployment.

| Atlas component | Deployment-pipeline item support | Deployment-plan action support | Atlas deployment decision |
| --- | --- | --- | --- |
| Python `atlas_sync_functions` (`UserDataFunction`) | Listed by Microsoft [1, 4] | User data function, `Execute` [2] | Eligible as a standalone item. Validate the target libraries/connections and invoke `ping` before use. Do not put delegated tokens into action parameters. |
| Standalone Fabric SQL database | Listed [1, 5] | Not listed [2] | Schema promotion is supported independently. This does not prove that a Rayfin-managed database plus policies/API configuration can be promoted as a whole app. Use Rayfin for Atlas-owned schema changes. |
| Fabric App / `AppBackend` | **Absent from Microsoft's supported-item list** [1] | **Absent from the action matrix** [2] | No deployment-plan compatibility claim. Install/update the app with the pinned Rayfin CLI. |
| Rayfin Functions in `rayfin/functions/` | No separately established item promotion contract for this AppBackend component | Do not equate these functions with a standalone `UserDataFunction` item | Deploy through `rayfin up`; do not invent a plan action for `workspaceCollect*`, `sync*` or the offline bulk harness. |
| Static bundle, Rayfin data API/policies, app storage | Not listed as separate plan-deployable items | Not listed | Rayfin-owned deployment; retain the app identity and origin on update. |
| Deployment plan item | Listed, preview [1] | Not an executable action itself [2, 3] | Optional for supported standalone Fabric components only. No plan file claiming end-to-end Atlas compatibility is supplied. |
| Optional Notebook, Data pipeline, Dataflow Gen2, Copy job | Listed [1] | Each supports `Execute` [2] | Can be actions only after separate review. None is required by this Atlas phase. |
| Workspace identity, connections, gateway bindings, Spark settings | Workspace configuration is outside plan deployment [3] | No automatic provisioning | Configure target workspace before any dependent action. |
| Entra registration/consent/redirects, tenant settings, app audience | Not Fabric item deployment scope | No plan action for these resources | Tenant/Entra/application owner performs and verifies each separately. |
| Atlas metadata snapshots, team notes and personal state | Item deployment does not migrate application rows | No generic data-copy action | Preserve target data, shared-read policy, append-only team notes and user-scoped review state. Use a separately reviewed database recovery procedure if needed. |

`OrgApp` support does not imply Fabric App or `AppBackend` support. A Fabric
SQL database row in the matrix does not imply support for its owning app.
Recheck the sources before every release because preview support can change.

## What a plan can and cannot do

Microsoft lists these API attachment surfaces [6]:

| Operation | Plan reference | Additional requirements |
| --- | --- | --- |
| Update From Git | `ByLogicalId`, `logicalId` | `options.deploymentPlan`, `beta=true`, original scope plus `Item.Execute.All` |
| Deploy Stage Content | `ByItemId`, `itemId` | Same placement/preview query; original deployment scope plus `Item.Execute.All` |
| Bulk Import Item Definitions | `ByLogicalId`, `logicalId` | Same placement/preview query; `Item.ReadWrite.All` plus `Item.Execute.All` |

Bulk **export** for metadata collection does not accept a deployment plan.
The plan does not select every referenced item automatically. Select the
intended items and make action dependencies available in the target.
Fabric combines explicit dependencies with lineage. Groups/actions run
serially; an item's position in JSON does not specify its order.

A plan applies to one operation in one target workspace. Single-item import
and `fabric-cicd` do not support it. Limits include 1 MB per plan, 1,000 groups,
one item per group, 20 pre-deploy and 20 post-deploy actions per group, and
20 parameters per action [3]. A UDF action output above 512 KB is truncated
while the action still succeeds [2]. Therefore an Atlas sync envelope is not
a safe action-output/health protocol. Use a small reviewed health probe, never
the metadata payload or a token-bearing sync invocation.

**A failed operation stops without rollback.** Previously deployed items and
completed actions remain changed. Action completion also does not guarantee
that produced data is already queryable [2, 3].

## Installation

Use [installation.md](installation.md) for the full existing SPA/UDF setup.
Perform this sequence for a new target:

1. Record the release commit, Node/npm versions and both lockfiles. Resolve the
   target tenant/workspace and item IDs from the authenticated workspace/item
   list. Never reuse source-environment IDs by name guesswork.
2. Confirm Fabric capacity, region eligibility, Fabric Apps tenant setting,
   deployer workspace rights and the authorized synchronizer. Keep the existing
   Python scanner/UDF prerequisites until replacement coverage is approved.
3. Inventory the target components against the matrix. Provision workspace
   settings and connections separately. Do not create an Atlas deployment plan
   for `AppBackend` or assume a bulk import can install the app.
4. Restore dependencies and validate the release:

   ```powershell
   npm ci
   npm ci --prefix rayfin\functions
   npm test
   npm run lint
   npm run build
   npm run build --prefix rayfin\functions
   npm run benchmark:definitions -- --iterations 10
   ```

5. Publish/verify the standalone Python UDF using its
   [full-definition runbook](../fabric/udf/atlas_sync_functions/README.md).
   Preserve all returned parts, including platform/library metadata. The
   documented UDF API identity restrictions remain separate from Rayfin.
6. Configure git-ignored `rayfin/.env` and the deployment process with the
   target SPA/UDF URLs and synchronizer subject/contact. Grant only reviewed
   delegated/application permissions. Do not enable bulk: this release has no
   live bulk switch.
7. Deploy using the supported Atlas route:

   ```powershell
   npx rayfin login --tenant "<tenant-id>" --select
   $env:RAYFIN_PUBLIC_ATLAS_SYNC_ADMIN_EMAIL = "<authorized-sync-user>"
   $env:RAYFIN_PUBLIC_ATLAS_SYNC_ADMIN_SUBJECT = "<authorized-sync-subject>"
   npx rayfin up --tenant "<tenant-id>" --workspace "<workspace-name>"
   npx rayfin up status
   ```

8. Confirm every deployment phase, especially database configuration; a static
   publish alone is insufficient. Keep generated deployment records private.
   Register the actual hosting origin in the SPA and verify Fabric-embedded
   authentication, Functions `ping` and metadata reads.
9. Test first-sync as the configured synchronizer. Test a second authenticated
   app user: the first-sync gate must show the synchronizer contact and deny
   unauthorized sync. After a successful complete sync, verify shared catalog
   reads and team notes, and isolation of personal state. No validation step
   may manufacture a complete snapshot from failed coverage.

Acceptance evidence is a release SHA, deployment phase/health outcomes,
correlation IDs, coverage counts and access-check results. Do not collect
tokens, definition bodies, query content or user data as release evidence.

## Updating an existing deployment

1. Record the known-good release SHA, runtime/library versions, current app
   identity/origin, deployment record, last complete manifest ID and any
   in-flight sync job IDs. Arrange a maintenance window; let active sync finish
   or cancel it through the existing supported control. Do not modify durable
   records directly.
2. Verify a recoverable database backup/restore point for shared team notes and
   personal state. Snapshot retention is not a backup of all app data.
   Keep secrets and backup credentials outside Git.
3. Review schema/policy changes before deployment. Use additive compatible
   changes; never run `--force` to bypass a destructive migration without a
   separate reviewed plan.
4. Run the validation commands above. Compare offline bulk metrics only as
   regression evidence; they do not justify activating a live collector.
5. Update supported standalone UDF components separately when their source
   changed. Read back full definitions, compare intended part hashes and invoke
   `ping`. If using a plan for those supported components, validate permissions,
   pairing, dependencies and plan selection before submitting the operation.
6. Run the same `rayfin up --tenant ... --workspace ...` against the existing
   deployment. Do not delete/recreate the Fabric App; that changes its identity
   and hosting origin and can break redirects.
7. Repeat health/access/first-sync checks where applicable and run an authorized
   bounded synchronization. Confirm all required coverage before accepting the
   new snapshot; the prior complete snapshot remains the recovery reference.
   Inspect fallback/error evidence rather than just the UI's latest timestamp.

## Failure and recovery

| Failure | Immediate response | Recovery/verification |
| --- | --- | --- |
| Bulk replay regression or parity mismatch | Keep the live gate closed | Continue unchanged per-item collection. Fix the isolated harness/format projection and rerun focused tests. Do not publish benchmark output as metadata. |
| A future bulk canary returns `403`, protected-label or unsupported errors | Do not increase privileges automatically | Verify explicit item selection and documented identity support. Use reviewed per-item fallback with item-level evidence. |
| Throttling, deadline, oversized response | Stop new work within its budget; retain the last complete snapshot | Honor `Retry-After`, reduce the reviewed batch where supported, retry through normal sync controls. Never truncate metadata and mark it complete. |
| Deployment-plan group/action fails | Record completed groups, failed step and operation ID | No automatic rollback exists. Inspect target state and pairing, fix the prerequisite, then deliberately retry or redeploy a known-good definition. Never blindly rerun a non-idempotent action. |
| Database/configuration phase fails but static hosting succeeds | Treat the release as failed | Stop promotion, correct the configuration/migration problem, rerun canonical `rayfin up` and verify every phase. |
| App or Functions regression after update | Retain app/database identity and existing data | Check out the known-good release in a clean checkout and redeploy with the same private target configuration. Confirm schema compatibility first; restoring code does not undo migrations. |
| Schema/data corruption | Stop sync/publication via supported controls | Use the separately approved Fabric SQL restore procedure and backup point. Reconcile target IDs/policies/configuration before redeploying and validating. This runbook does not authorize dropping tables or overwriting notes. |
| SPA redirect/auth failure | Preserve the app; inspect tenant and origin configuration | Correct the existing hosting-origin registration/allowlist and consent. Do not solve it by deleting the app. |
| Broken deployment-pipeline pairing | Stop promotion and inspect source/target IDs | Escalate for reviewed repair. Unassigning a stage can destroy deployment history/rules; never do it as an automatic retry. |

A rollback is accepted only after the target's health, permissions, retained
notes/personal state and complete metadata snapshot have been checked. Do not
retire the previous release or backup until that evidence is recorded.

## Sources

1. [Deployment pipelines: supported items](https://learn.microsoft.com/en-us/fabric/cicd/deployment-pipelines/intro-to-deployment-pipelines#supported-items).
2. [Deployment plan actions and item/job matrix](https://learn.microsoft.com/en-us/fabric/cicd/deployment-plan/deployment-plan-actions).
3. [Deployment plan overview, limits and failure semantics](https://learn.microsoft.com/en-us/fabric/cicd/deployment-plan/deployment-plan-overview).
4. [User data functions Git/deployment pipelines](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/git-and-deployment-pipelines).
5. [SQL database deployment pipelines](https://learn.microsoft.com/en-us/fabric/database/sql/deployment-pipelines). Data stays in place; data-loss changes require manual action; database settings are not all included.
6. [Deployment-plan API automation](https://learn.microsoft.com/en-us/fabric/cicd/deployment-plan/deployment-plan-automation).

The public deployment-plan pages and supported-items page read for this review
were updated 2026-09-29. Revalidate the specific item, action and identity
contracts rather than inferring compatibility from a product announcement.
