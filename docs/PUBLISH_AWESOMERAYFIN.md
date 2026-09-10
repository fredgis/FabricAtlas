# Publishing Fabric Atlas to Awesome Rayfin

## Current contribution

- Proposal: [microsoft/awesome-rayfin#164](https://github.com/microsoft/awesome-rayfin/issues/164)
- Pull request: [microsoft/awesome-rayfin#165](https://github.com/microsoft/awesome-rayfin/pull/165)
- Fork branch: `fredgis/awesome-rayfin:feat/fabric-atlas-template`
- Template path: `templates/fabric-atlas/`
- Upstream snapshot: Fabric Atlas `1.12.1`, commit
  `9f2a2fd62b6a24a5062a4041d7da92fc8e5753ab`

The intended result is a CLI-selectable template under:

```text
templates/fabric-atlas/
```

Users would then scaffold it from the Awesome Rayfin gallery.

## Publication model

Awesome Rayfin stores a self-contained copy of each template. Fabric Atlas
would remain the source of truth, but the gallery copy would need its own
metadata and a small number of gallery-specific adaptations.

An alternative is to publish Fabric Atlas only as a resource link. That is
easier to maintain, but it would not appear in the Rayfin template picker.

## Prerequisites

- Open a template proposal issue before writing the PR.
- Fork `microsoft/awesome-rayfin`.
- Complete the Microsoft CLA.
- Use a focused branch and a Conventional Commit PR title.
- Disclose AI-assisted work in the issue or PR.
- Provide test results and screenshots or logs where useful.

## Required template files

Awesome Rayfin expects these files inside `templates/fabric-atlas/`:

- `package.json`
- `manifest.json`
- `rayfin-template.yml`
- `rayfin/rayfin.yml`
- `rayfin/data/schema.ts`
- `rayfin/tsconfig.json`
- `README.md`
- `index.html`
- `src/main.tsx`
- `tsconfig.json`
- `vite.config.ts`
- `vitest.config.ts`
- `eslint.config.js`
- `.gitignore`

Fabric Atlas already contains all required files except `manifest.json`.

## Required adaptations

### Template metadata

Add this metadata to `package.json`:

```json
{
  "template": {
    "name": "fabric-atlas",
    "displayName": "Fabric Atlas",
    "description": "<one-line gallery description>"
  }
}
```

Create `manifest.json` with:

- `templateId`
- `icon`
- `services.auth`
- `services.data`
- `services.storage`
- `services.staticHosting`
- `hasDabSchema`
- replacement `tokens`

The following identifiers must agree:

- directory: `fabric-atlas`
- `package.json.template.name`
- `manifest.json.templateId`
- `rayfin/rayfin.yml` `id`
- `rayfin/rayfin.yml` `name`

The current Fabric Atlas `rayfin.yml` uses `fabricatlas` and `FabricAtlas`, so
the gallery naming decision must be reviewed before copying the template.

### Documentation

The template README must contain:

- `Getting started`
- `Project structure`
- `Scripts`

It must explain:

- explicit local demo mode;
- Fabric SSO for deployed use;
- Rayfin deployment;
- manual publication of the Fabric User Data Function;
- required tenant settings and delegated permissions;
- the metadata-only security boundary.

### Generated gallery files

Run from the Awesome Rayfin repository root:

```bash
node scripts/generate-manifest.mjs
node scripts/generate-manifest.mjs --check
```

The generator updates:

- the root `rayfin-template.yml`;
- the template leaf `rayfin-template.yml`;
- the templates table in the root README.

## Validation

Test the gallery scaffold:

```bash
rayfin init <temporary-directory> -t . --template-name "Fabric Atlas" --overwrite
```

Run inside `templates/fabric-atlas/`:

```bash
npm install
npm run lint
npm run build
npm test
```

The repository CI currently runs on Ubuntu with Node.js 20.

## Reusable checklist for another template

Use the same sequence for any future template:

1. Open the required template proposal issue.
2. Record the upstream repository, version and commit.
3. Work only in the Awesome Rayfin fork. Do not change the upstream project to
   satisfy gallery packaging or CI.
4. Export tracked source files with `git archive` or an equivalent clean
   snapshot.
5. Remove anything that does not belong in a generated project:
   - `.git/`
   - `node_modules/`
   - `dist/`
   - coverage output
   - `.env.local`
   - `rayfin/.env`
   - `rayfin/.deployments.json`
   - `rayfin/.temp/`
   - `.playwright-cli/`
   - `__pycache__/`
   - `*.pyc`
   - source-repository workflows and publishing notes
6. Add the gallery-only overlay:
   - `package.json.template`
   - `manifest.json`
   - gallery-safe identifiers
   - template-specific README instructions
   - `UPSTREAM.md`
7. Add generated-language caches to the template `.gitignore`. For Python,
   include `__pycache__/`, `*.pyc`, `*.pyo` and `*.pyd`.
8. Run `node scripts/generate-manifest.mjs`.
9. Run `node scripts/generate-manifest.mjs --check`.
10. Scaffold the template into a clean temporary directory.
11. Inspect the scaffold before installing dependencies. It must not contain
    deployment state, credentials, caches or compiled output.
12. Run the template lint, build and test commands.
13. Commit the template, generated root manifest and generated README row.
14. Open the pull request with the proposal reference, validation results and
    AI disclosure.

## Decisions recorded for the current contribution

1. **Node.js version:** the gallery copy keeps the upstream Node.js 24
   requirement. Fabric Atlas is not changed to match the gallery's Node.js 20
   workflow.
2. **Template identity:** the gallery overlay uses `fabric-atlas`; the upstream
   deployment ID remains unchanged.
3. **Template scope:** application code, tests, UDF source, operational docs and
   product screenshots are included. The whitepaper, source `.github` folder
   and publication notes are excluded.
4. **UDF onboarding:** the UDF source is included, but the deployer publishes it
   separately in the target workspace. The template README explains why and
   lists the required permissions.
5. **Distribution mode:** the contribution is a complete gallery template, not
   a resource-only link.

## Security requirements

- Do not include `.env.local`, `rayfin/.env`, deployment registries, generated
  endpoints or tenant-specific values.
- Use placeholders for workspace, tenant, SPA and UDF configuration.
- Keep demo mode explicit so production authentication failures never load
  sample data.
- Preserve the synchronizer subject policy and the shared-catalog audience
  documentation.
- Keep optional Kusto, SQL and definition permissions separate from the base
  Fabric metadata scopes.
- Do not include tokens, connection strings, business data or UDF deployment
  responses in the template.

## References

- [Awesome Rayfin contributing guide](https://github.com/microsoft/awesome-rayfin/blob/main/CONTRIBUTING.md)
- [Template guidelines](https://github.com/microsoft/awesome-rayfin/blob/main/docs/template-guidelines.md)
- [PR template](https://github.com/microsoft/awesome-rayfin/blob/main/.github/PULL_REQUEST_TEMPLATE.md)
- [Template validation workflow](https://github.com/microsoft/awesome-rayfin/blob/main/.github/workflows/validate-templates.yml)
