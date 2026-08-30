# Contributing to Fabric Atlas

Contributions are welcome.

## Development

```powershell
git clone https://github.com/fredgis/FabricAtlas.git
Set-Location FabricAtlas
npm install
npm test
npm run lint
npm run build
```

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
