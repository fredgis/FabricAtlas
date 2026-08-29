export interface ReleaseSection {
  title: string;
  items: string[];
}

export interface AtlasRelease {
  version: string;
  date: string;
  title: string;
  sections: ReleaseSection[];
}

export const REPOSITORY_URL =
  (import.meta.env.VITE_APP_REPOSITORY_URL as string | undefined) ??
  "https://github.com/fredgis/FabricAtlas";

export const APP_VERSION =
  (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "1.2.0";

export const BUILD_COMMIT =
  (import.meta.env.VITE_APP_BUILD_COMMIT as string | undefined) ?? "development";

export const BUILD_DATE =
  (import.meta.env.VITE_APP_BUILD_DATE as string | undefined) ??
  new Date(0).toISOString();

export const RELEASES: AtlasRelease[] = [
  {
    version: "1.2.0",
    date: "2026-08-29",
    title: "Workspace experience refresh",
    sections: [
      {
        title: "Catalog & governance",
        items: [
          "Catalog and Asset Catalog redesigned for faster scanning and clearer master-detail navigation.",
          "Access and Sensitivity rebuilt as focused governance and risk workspaces.",
          "Grouped content remains collapsed until users choose the detail they need.",
        ],
      },
      {
        title: "Operations & project",
        items: [
          "Jobs, Config and Comments redesigned with stronger operational hierarchy.",
          "About simplified into an open-source project page with clone, source and release actions.",
          "Sidebar navigation grouped into Explore, Govern, Operate and System sections.",
        ],
      },
    ],
  },
  {
    version: "1.1.2",
    date: "2026-08-29",
    title: "Animated sync and overview heroes",
    sections: [
      {
        title: "First sync",
        items: [
          "Rebuilt the deployment sync screen as a full-width animated hero.",
          "Added an animated topology preview, live estate metrics and staged synchronization panel.",
          "Added robust workspace-name fallbacks for deployment refreshes.",
        ],
      },
      {
        title: "Overview",
        items: [
          "Enhanced the governance command banner with animated depth and a health dial.",
          "Removed named max-width utility collisions from hero and authentication surfaces.",
        ],
      },
    ],
  },
  {
    version: "1.1.1",
    date: "2026-08-29",
    title: "Deployment sync and stable selection",
    sections: [
      {
        title: "Synchronization",
        items: [
          "Every newly deployed build opens on its synchronization screen once.",
          "Completing the sync records the exact build locally before opening the dashboard.",
        ],
      },
      {
        title: "Lineage",
        items: [
          "Selecting a node highlights it without recalculating or moving the current layout.",
          "Focus selection is now an explicit action when a new centered path is wanted.",
        ],
      },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-08-29",
    title: "Governance command center",
    sections: [
      {
        title: "Experience",
        items: [
          "Dark theme by default with a persistent light-theme preference.",
          "First-sync command screen with staged progress and configuration status.",
          "Live synchronization progress in the application header.",
          "Governance overview redesigned around a workspace command banner.",
        ],
      },
      {
        title: "Navigation",
        items: [
          "Lineage direction normalized from source to consumer.",
          "Focused lineage paths and connected-component layout reduce graph clutter.",
          "Catalog, assets, configuration and sensitivity groups start collapsed.",
        ],
      },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-08-29",
    title: "First public release",
    sections: [
      {
        title: "Lineage",
        items: [
          "Transitive upstream and downstream impact analysis.",
          "Directional arrows, relationship labels, staged layout, minimap, zoom and filters.",
          "Item and object lineage modes with tables, columns, measures and consumers.",
          "Tabbed inspector for summary, schema, access and run history.",
        ],
      },
      {
        title: "Experience",
        items: [
          "Responsive layouts that preserve the existing Fabric Atlas navigation.",
          "Keyboard focus, accessible interactive states and reduced-motion support.",
          "Deep-linkable lineage selection, filters and object context.",
          "Project information page with version, source and release history.",
        ],
      },
    ],
  },
];

export const CURRENT_RELEASE = RELEASES[0];

export function releaseUrl(version = APP_VERSION): string {
  return `${REPOSITORY_URL}/releases/tag/v${version}`;
}
