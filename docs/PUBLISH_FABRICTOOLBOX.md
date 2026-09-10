# Publishing Fabric Atlas to Fabric Toolbox

## Current contribution

- Target repository: <https://github.com/microsoft/fabric-toolbox>
- Pull request: [microsoft/fabric-toolbox#659](https://github.com/microsoft/fabric-toolbox/pull/659)
- Fork branch: `fredgis/fabric-toolbox:contrib/fabric-atlas`
- Accelerator path: `accelerators/fabric-atlas/`
- Current status: CLA passed, review conversations resolved, maintainer approval required

## Publication model

Fabric Toolbox contains a vendored copy of Fabric Atlas. The
`fredgis/FabricAtlas` repository remains the source of truth.

Product fixes should be completed and validated in Fabric Atlas first. The
verified files are then copied into `accelerators/fabric-atlas/`, with the
Fabric Toolbox documentation links and contribution instructions preserved.

## Prerequisites

- A stable Fabric Atlas release on `main`
- MIT-compatible source and dependency licences
- No tenant IDs, workspace IDs, hosting URLs, tokens or deployment state
- A fork of `microsoft/fabric-toolbox`
- Microsoft CLA completed
- A focused branch and pull request

Do not copy local or generated deployment files:

- `.env.local`
- `rayfin/.env`
- `rayfin/.deployments.json`
- `rayfin/.temp/`
- `dist/`
- `node_modules/`
- `src/fabric.generated.ts`
- `.playwright-cli/`

The tracked `.playwright-config.json` must be included because
`npm run test:fabric` references it.

## Preparing an update

1. Complete the change in `fredgis/FabricAtlas`.
2. Run the Fabric Atlas validation suite.
3. Copy the changed product files into `accelerators/fabric-atlas/`.
4. Keep Toolbox-specific links in the accelerator README:
   - clone and contribution paths point to Fabric Toolbox;
   - security reports point to the Microsoft Security Response Center;
   - issues point to `microsoft/fabric-toolbox`.
5. Review the complete diff for deployment values and unrelated source-repo
   files.

## Validation

Run from `accelerators/fabric-atlas/`:

```bash
npm ci
npm test
npm run lint
npm run build
```

Also run:

```bash
git diff --check
```

UDF changes must pass the Python tests in the source Fabric Atlas repository
before they are copied.

## Pull request workflow

1. Push the update to the fork branch.
2. Open or update the PR against `microsoft/fabric-toolbox:main`.
3. Complete the repository PR checklist.
4. Confirm the CLA check passes.
5. Reply to each review thread with the commit and validation evidence.
6. Resolve a conversation only after the fix is present on the PR branch.
7. Request a new review. External contributors may need a maintainer to assign
   or re-request reviewers.
8. A maintainer approval is required before merge.

Future Fabric Atlas releases require a new Toolbox pull request. There is no
automatic synchronization between the repositories.

## Security requirements

- Keep all deployment configuration as placeholders.
- Never commit access tokens, SQL connection strings or Rayfin deployment
  state.
- Keep the UDF destination validation and redirect rejection enabled.
- Document the Fabric Administrator role, tenant settings and optional
  delegated scopes required for deep discovery.
- Preserve the immutable synchronizer subject and Rayfin row policies.
- Treat the Fabric app audience as the read boundary for the shared catalog and
  team notes.

## References

- [Fabric Toolbox PR template](https://github.com/microsoft/fabric-toolbox/blob/main/.github/PULL_REQUEST_TEMPLATE.md)
- [Fabric Toolbox contribution section](https://github.com/microsoft/fabric-toolbox#contributing)
- [Fabric Atlas installation guide](installation.md)
- [Fabric Atlas architecture](architecture.md)

