# Evolving FabricAtlas with prompts (vibe coding)

FabricAtlas is built to be grown by talking to an AI agent, not just by hand. Rayfin ships the pieces
that make that reliable, and this repo already includes them.

## Why it works

- The backend is declarative. Entities are TypeScript decorators in `rayfin/data/`. An agent edits a
  class, and `rayfin up` diffs the schema and applies the migration — no hand-written SQL.
- The front end is plain React in `src/atlas/`, one file per tab. Adding a view is a local edit.
- Rayfin ships agent context in this repo: `.agents/skills/rayfin` (data model, decorators, deploy),
  plus `app-design`, `schema-discovery`, `fabric-sdk` and more. The `AGENTS.md` at the root wires
  them in. There is also a Rayfin MCP server (`@microsoft/rayfin-mcp`, configured in `.mcp.json`) and
  a docs CLI:

  ```bash
  npx rayfin docs search "row level security" --module guide
  npx rayfin docs get --symbol "@role"
  ```

## The loop

1. Prompt an agent (GitHub Copilot CLI, VS Code, …) from the repo root.
2. The agent edits `rayfin/data/*.ts` (data) and/or `src/atlas/*` (UI).
3. `npm run dev` to preview against the sample data.
4. `npx rayfin up` to apply the schema change and redeploy.

## Prompts to try

Data model:

> "Add a `criticality` field to `FabricItem` (low/medium/high/critical) and show it as a colored
> badge on the catalog cards and the map inspector."

> "Add row-level security so a `Comment` can only be edited or deleted by its author."

New surface area:

> "Add a Shortcuts tab that lists every OneLake shortcut across all lakehouses, grouped by target."

> "On the Access page, add a button that exports the object-level access of the selected item to CSV."

Sync:

> "In `runFabricSync`, call the Fabric items REST API for the current workspace, map each item to a
> `FabricItem`, and upsert it with `client.data.FabricItem.create`."

Look and feel:

> "Make the map nodes draggable and remember their position per workspace."

Each of these is a small, well-scoped edit because the data layer is declarative and the UI is
componentized. Ship it with `rayfin up` and it is live in Fabric.

## Guardrails

- Keep `@text` fields bounded with `max` (MSSQL requirement).
- Every entity needs a permission decorator (`@role` / `@authenticated`).
- Review any destructive migration before running `rayfin up --force`.
