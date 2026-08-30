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
  (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "1.8.0";

export const BUILD_COMMIT =
  (import.meta.env.VITE_APP_BUILD_COMMIT as string | undefined) ?? "development";

export const BUILD_DATE =
  (import.meta.env.VITE_APP_BUILD_DATE as string | undefined) ??
  new Date(0).toISOString();

export const DEPLOYMENT_ID = `${APP_VERSION}:${BUILD_COMMIT}:${BUILD_DATE}`;

export const RELEASES: AtlasRelease[] = [
  {
    version: "1.8.0",
    date: "2026-08-30",
    title: "Faster history, lineage and responsive operations",
    sections: [
      {
        title: "Scale & reliability",
        items: [
          "Trusted snapshot retention keeps a configurable history window and retries partial cleanup safely.",
          "Manifest summaries load governance trends immediately while detailed comparisons hydrate only when selected.",
          "Lineage traversal and layout reuse adjacency indexes instead of rescanning the complete graph.",
        ],
      },
      {
        title: "Responsive experience",
        items: [
          "Access Review renders one keyboard-navigable responsive ledger instead of duplicate desktop and mobile trees.",
          "Jobs history becomes a mobile timeline and an aligned desktop grid from the same semantic content.",
          "Large grouped collections use Chromium render containment and active job filters become individually removable.",
        ],
      },
    ],
  },
  {
    version: "1.7.0",
    date: "2026-08-30",
    title: "Shareable and accessible workspace navigation",
    sections: [
      {
        title: "Navigation & productivity",
        items: [
          "Catalog, governance, access, jobs and workspace context now remain in shareable URLs.",
          "Overview signals open pre-filtered evidence, while active searches reveal matching grouped content.",
          "Global search is indexed once per snapshot and debounced without allowing stale selection.",
        ],
      },
      {
        title: "Accessible experience",
        items: [
          "Dialogs and mobile navigation manage focus, Escape dismissal, background inerting and restoration.",
          "Governance, lineage and workspace tabs support full keyboard navigation with linked panels.",
          "Skip navigation, route titles, live sync status, reduced motion and textual lineage evidence improve assistive access.",
        ],
      },
    ],
  },
  {
    version: "1.6.1",
    date: "2026-08-30",
    title: "Authoritative lineage and faster snapshots",
    sections: [
      {
        title: "Lineage",
        items: [
          "Documented Dataflow, Datamart and Semantic Model dependencies are mapped by immutable Fabric IDs.",
          "Authoritative scanner edges preserve source-to-consumer direction across visual stages.",
          "Malformed or cross-workspace lineage references fail closed.",
        ],
      },
      {
        title: "Synchronization",
        items: [
          "Snapshot rows are written in bounded batches of eight requests.",
          "Every in-flight batch is drained before failure, while the sync audit and workspace manifest remain strictly last.",
        ],
      },
    ],
  },
  {
    version: "1.6.0",
    date: "2026-08-30",
    title: "Trusted metadata synchronization",
    sections: [
      {
        title: "Reliability & security",
        items: [
          "The versioned sync contract records required, optional and metadata-capability status for every validated snapshot.",
          "UDF requests, retries, response reads and payload size share bounded execution limits below the Fabric public endpoint ceiling.",
          "Server-side writer filters and Rayfin create policies restrict snapshot publication to the configured synchronizer.",
        ],
      },
      {
        title: "Metadata accuracy",
        items: [
          "Governance views distinguish metadata that was not collected from a real missing value or zero.",
          "Fabric IDs stabilize principal access history, while legacy email and name references remain compatible.",
          "Documented owner provenance, raw endorsement, sensitivity-label IDs and tag IDs are preserved without storing business data.",
        ],
      },
    ],
  },
  {
    version: "1.5.1",
    date: "2026-08-30",
    title: "Fabric UX visual alignment",
    sections: [
      {
        title: "Experience",
        items: [
          "Light mode is now the default, matching the surrounding Fabric portal.",
          "Shell, navigation, cards, dialogs, filters and first sync follow Fluent 2 surface, spacing and elevation patterns.",
          "Fabric interaction colors are paired with a restrained Atlas spectrum for lineage and product identity.",
        ],
      },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-08-29",
    title: "Governance Center and workspace intelligence",
    sections: [
      {
        title: "Governance",
        items: [
          "Governance Center groups actionable findings, snapshot changes, trends and metadata coverage.",
          "Access Review provides additive permission evidence, personal review decisions and CSV export.",
          "Validated snapshot history powers change detection without weakening last-known-good fallback.",
        ],
      },
      {
        title: "Productivity",
        items: [
          "Global Ctrl+K search opens items, schema objects, principals, jobs, configuration and notes.",
          "Impact reports export verified upstream and downstream evidence for items and schema objects.",
          "Personal saved views persist governance, access and job filters through Rayfin.",
        ],
      },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-08-29",
    title: "Reliable snapshots and deep inventory",
    sections: [
      {
        title: "Reliability",
        items: [
          "Validated immutable snapshots preserve the last complete workspace index.",
          "Hydration rejects incomplete or malformed rows instead of emptying the application.",
          "Synchronization identity and token handling were hardened after OWASP review.",
        ],
      },
      {
        title: "Inventory & experience",
        items: [
          "Expanded Lakehouse, Warehouse, SQL Database, Semantic Model and Report metadata coverage.",
          "Lineage supports group selection, group movement, reliable reset and wider paths.",
          "Governance Overview was simplified around one hero and three high-signal sections.",
        ],
      },
    ],
  },
  {
    version: "1.3.1",
    date: "2026-08-29",
    title: "Interactive object lineage",
    sections: [
      {
        title: "Object mode",
        items: [
          "Object nodes can now be dragged and arranged like item nodes.",
          "Clicking an object highlights upstream and downstream paths in place.",
          "Connected object edges use the same animated lineage treatment as item mode.",
        ],
      },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-08-29",
    title: "Workspace Hub and open-source cleanup",
    sections: [
      {
        title: "Experience",
        items: [
          "Configuration and team notes merged into one Workspace Hub.",
          "Impact mode now starts disabled and lineage edges remain visually clean.",
          "Deployment sync details align at the bottom without exposing the workspace ID.",
          "About reduced to the open-source project essentials.",
        ],
      },
      {
        title: "Repository",
        items: [
          "Removed the unused analytics starter, preview assets and Fabric visual dependencies.",
          "Moved community policy files into .github and added focused contributor guidance.",
          "Rebuilt the README as the public open-source project landing page.",
        ],
      },
    ],
  },
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
