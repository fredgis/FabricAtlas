# Publishing Fabric Atlas to Awesome Rayfin

## Status

This publication is still under evaluation. No issue or pull request has been
opened in `microsoft/awesome-rayfin`.

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

## Decisions required before implementation

1. **Node.js version:** Fabric Atlas currently requires Node.js 24, while the
   Awesome Rayfin validation workflow uses Node.js 20.
2. **Template identity:** decide whether the deployed Rayfin ID can change from
   `fabricatlas` to `fabric-atlas`.
3. **Template scope:** decide which screenshots, whitepaper files and project
   documentation belong in the scaffolded output.
4. **UDF onboarding:** confirm that a template requiring separate UDF
   publication provides an acceptable first-run experience.
5. **Distribution mode:** choose between a complete gallery template and a
   lighter resource link to the Fabric Atlas repository.

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
