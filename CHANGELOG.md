# Changelog

All notable changes to Fabric Atlas are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-08-29

### Added

- Immutable workspace snapshots with manifest validation and fallback to the last complete index.
- Multi-selection and group movement in item and object lineage.
- Expanded object metadata for Lakehouse, Warehouse, SQL Database, Semantic Model and Report items.
- Focused regression tests for snapshot integrity, account selection and UDF schema derivation.

### Changed

- Synchronization now rejects incomplete Fabric responses before persistence.
- Lineage Reset restores positions, zoom, selection and scroll; lifecycle spacing is wider.
- Governance Overview is reduced to one hero and three operational sections.
- README and `/docs` now describe snapshot behavior, object coverage and contribution paths.
- Security handling was hardened following an OWASP Top 10:2025 and ASVS 5.0 review.

## [1.3.1] - 2026-08-29

### Changed

- Object lineage nodes are now draggable.
- Object selection highlights upstream and downstream nodes without moving the layout.
- Connected object edges use the same animated violet/teal treatment as item lineage.
- Object mode now dims unrelated objects and exposes relationship names through native tooltips.

## [1.3.0] - 2026-08-29

### Added

- Workspace Hub combining configuration and persistent team notes.
- MIT license and repository-specific contribution and security guidance.

### Changed

- Impact mode now starts disabled so the complete workspace is visible by default.
- Lineage relationship names moved to native SVG tooltips, leaving animated edges unobstructed.
- Deployment sync content aligns at the bottom of both hero columns and no longer displays the workspace ID.
- About now focuses only on the open-source project, clone command and essential build context.
- README rebuilt as an open-source project landing page.

### Removed

- Separate Config and Comments navigation entries.
- Unused semantic-model starter hook, Fabric client, DataTable helpers, preview screen and related tests/assets.
- Unused Fabric visual, DataGrid and app-data runtime dependencies.
- Unused `components.json` and empty `fabric.yaml`.

## [1.2.0] - 2026-08-29

### Changed

- Redesigned Catalog and Asset Catalog with clearer command headers, grouped navigation, denser cards and structured inspectors.
- Redesigned Access and Sensitivity as higher-signal governance and risk workspaces.
- Redesigned Jobs, Config and Comments for faster operational scanning and better empty states.
- Simplified About into an open-source project page with clone, source, release and license context.
- Grouped the sidebar navigation into Explore, Govern, Operate and System sections.
- Added a shared content-width frame and strengthened shared cards, chips and section labels.

## [1.1.2] - 2026-08-29

### Changed

- Rebuilt the first-sync experience as a responsive full-width hero with animated lineage, live workspace metrics and a stronger synchronization panel.
- Enhanced Governance Overview with animated depth and a circular health pulse.
- Replaced conflicting named `max-w-*` utilities with dedicated layout classes.
- Added a Rayfin workspace-name variable and robust fallbacks so deployment screens never show `undefined`.

## [1.1.1] - 2026-08-29

### Changed

- Every newly deployed build now opens on the synchronization screen once, even when an older catalog already exists.
- Lineage selection no longer recalculates the focused layout or moves the selected node.
- Added an explicit **Focus selection** action for intentionally rebuilding the visible path.

## [1.1.0] - 2026-08-29

### Added

- First-sync command screen with real synchronization stages and progress.
- Synchronization progress and status in the persistent application header.
- Connected-component grouping for large lineage maps.

### Changed

- Dark theme is now the default; a light preference is stored when selected.
- Scanner lineage is normalized into source-to-consumer direction.
- Impact mode shows only the selected dependency path instead of dimming the entire workspace.
- The lifecycle layout now separates orchestration, transformation, storage, serving and consumption.
- Catalog, Asset Catalog, Config and Sensitivity groups start collapsed.
- Governance Overview uses a stronger workspace banner and clearer operational hierarchy.

## [1.0.0] - 2026-08-29

### Added

- Transitive upstream and downstream impact analysis in Map & lineage.
- Directional arrows and relationship labels for active lineage paths.
- Staged `Ingest & transform → Store → Model → Consume` layout.
- Minimap, zoom, fit, type, health and search controls.
- Item and object lineage modes for tables, columns, measures and consumers.
- Inspector tabs for summary, schema, effective access and run history.
- Deep-linkable lineage item, mode, filters and selected table.
- About page with version, build, repository, workspace and release information.

### Changed

- Polished the existing Fabric Atlas shell without replacing its navigation model.
- Improved responsive layouts across catalog, access, jobs, configuration and sensitivity views.
- Centralized lineage, object and status colors in the shared theme.
- Improved keyboard focus, semantic control states, scrollbars and reduced-motion behavior.

[1.4.0]: https://github.com/fredgis/FabricAtlas/releases/tag/v1.4.0
[1.3.1]: https://github.com/fredgis/FabricAtlas/releases/tag/v1.3.1
[1.3.0]: https://github.com/fredgis/FabricAtlas/releases/tag/v1.3.0
[1.2.0]: https://github.com/fredgis/FabricAtlas/releases/tag/v1.2.0
[1.1.2]: https://github.com/fredgis/FabricAtlas/releases/tag/v1.1.2
[1.1.1]: https://github.com/fredgis/FabricAtlas/releases/tag/v1.1.1
[1.1.0]: https://github.com/fredgis/FabricAtlas/releases/tag/v1.1.0
[1.0.0]: https://github.com/fredgis/FabricAtlas/releases/tag/v1.0.0
