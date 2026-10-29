# Contributing to Fabric Atlas

Contributions are welcome.

## Development

```powershell
git clone https://github.com/fredgis/FabricAtlas.git
Set-Location FabricAtlas
npm ci
npm test
npm run lint
npm run build
```

`npm ci` also restores the typed Rayfin Functions dependencies.

`npm run build` runs `npm run typecheck` first. Run it on its own when you
only need the TypeScript check.

The Fabric User Data Function has its own Python tests:

```powershell
Set-Location fabric/udf/atlas_sync_functions
python -m pip install -r requirements.txt pytest
python -m pytest
```

The repository has no CI workflow yet. Run these checks locally before you
open a pull request.

## Releases

1. Bump `version` in `package.json` and `APP_VERSION` in
   `src/atlas/release.ts`.
2. Add the release notes at the top of `RELEASES` in `src/atlas/release.ts`.
3. Move the `[Unreleased]` entries in `CHANGELOG.md` under a new
   `## [x.y.z] - YYYY-MM-DD` heading. Add its `releases/tag/vx.y.z` link and
   update the `[Unreleased]` compare link.
4. Run `npm test`, `npm run lint` and `npm run build`.
5. Tag `vx.y.z`, push the tag and publish the GitHub release.

## Pull requests

- Keep each pull request focused.
- Preserve the metadata-only security boundary.
- Use the semantic design tokens from `src/global.css`.
- Keep grouped lists collapsed by default.
- Keep lineage direction source-to-consumer and selection position stable.
- Add tests for synchronization, state or graph behavior changes.
- Update `CHANGELOG.md` when behavior changes.
- Keep the shared catalog read scope and append-only note behavior explicit in
  README, architecture, data-model and security documentation.
- Run the real TypeScript check through `npm run typecheck`; do not enable
  `noCheck`.

Do not commit tenant IDs, workspace IDs, tokens, secrets or generated Rayfin
environment files.
