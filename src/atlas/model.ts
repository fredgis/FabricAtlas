// FabricAtlas — UI data model, item-type metadata, and a rich sample dataset.
// The sample dataset powers preview/standalone mode and the README screenshots.
// When deployed inside Fabric, the same shapes are populated from the Rayfin
// entities (rayfin/data) after a Sync reads the Fabric REST APIs.

export type ItemType =
  | "Lakehouse"
  | "Warehouse"
  | "Eventhouse"
  | "KQLDatabase"
  | "Notebook"
  | "DataPipeline"
  | "Dataflow"
  | "SemanticModel"
  | "Report"
  | "Dashboard";

export type Health = "healthy" | "stale" | "failing" | "unknown";
export type Endorsement = "none" | "promoted" | "certified";
export type PrincipalKind = "user" | "group" | "servicePrincipal" | "guest";
export type AccessLevel = "owner" | "edit" | "view" | "none";
export type AccessSource =
  | "workspaceRole"
  | "directShare"
  | "group"
  | "orgLink"
  | "itemOwner";
export type JobStatus = "completed" | "failed" | "running" | "cancelled";
export type WorkspaceRole = "Admin" | "Member" | "Contributor" | "Viewer";

export interface TypeMeta {
  label: string;
  code: string; // 2-letter glyph
  color: string; // glyph background (works on light + dark)
  icon: string; // lucide icon name
}

export const ITEM_TYPES: Record<ItemType, TypeMeta> = {
  Lakehouse: { label: "Lakehouse", code: "LH", color: "#2f9e6f", icon: "Database" },
  Warehouse: { label: "Warehouse", code: "DW", color: "#3b82f6", icon: "Warehouse" },
  Eventhouse: { label: "Eventhouse", code: "EH", color: "#0ea5b7", icon: "Zap" },
  KQLDatabase: { label: "KQL Database", code: "KQ", color: "#14b8a6", icon: "Table2" },
  Notebook: { label: "Notebook", code: "NB", color: "#ef7a45", icon: "NotebookText" },
  DataPipeline: { label: "Data pipeline", code: "PL", color: "#7c5cff", icon: "Workflow" },
  Dataflow: { label: "Dataflow Gen2", code: "DF", color: "#d158c4", icon: "Shuffle" },
  SemanticModel: { label: "Semantic model", code: "SM", color: "#d9a520", icon: "Boxes" },
  Report: { label: "Report", code: "RP", color: "#eab308", icon: "BarChart3" },
  Dashboard: { label: "Dashboard", code: "DB", color: "#f59e0b", icon: "LayoutDashboard" },
};

export const HEALTH_COLOR: Record<Health, string> = {
  healthy: "#22a565",
  stale: "#e0a417",
  failing: "#e5484d",
  unknown: "#8b95a5",
};

export interface WorkspaceInfo {
  fabricId: string;
  displayName: string;
  capacity: string;
  region: string;
}

export interface Item {
  fabricId: string;
  displayName: string;
  itemType: ItemType;
  description?: string;
  ownerName?: string;
  ownerEmail?: string;
  health: Health;
  endorsement: Endorsement;
  sensitivity?: string;
  tags: string[];
  lastRefresh?: string; // ISO
  createdAt?: string;
  updatedAt?: string;
  size?: string;
}

export interface Edge {
  source: string; // fabricId
  target: string; // fabricId
  relation: string;
  broken?: boolean;
}

export interface Principal {
  principalId: string;
  displayName: string;
  kind: PrincipalKind;
  email?: string;
  external?: boolean;
  workspaceRole: WorkspaceRole;
}

export interface Grant {
  itemFabricId?: string; // empty = workspace-level
  principalRef: string;
  accessLevel: AccessLevel;
  source: AccessSource;
  roleName?: string;
  flag?: "external" | "broad" | "servicePrincipal" | "admin";
}

export interface Job {
  itemFabricId: string;
  itemName: string;
  jobType: string;
  status: JobStatus;
  startedAt: string;
  durationSec: number;
  message?: string;
}

export interface ConfigKV {
  itemFabricId: string;
  section: string;
  label: string;
  value: string;
}

export interface Comment {
  id: string;
  itemFabricId?: string;
  authorId: string;
  authorName: string;
  authorEmail?: string;
  body: string;
  createdAt: string;
}

export interface SyncRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "failed";
  itemsSynced?: number;
  triggeredBy?: string;
  summary?: string;
}

export interface AtlasData {
  workspace: WorkspaceInfo;
  items: Item[];
  edges: Edge[];
  principals: Principal[];
  grants: Grant[];
  jobs: Job[];
  config: ConfigKV[];
  comments: Comment[];
  syncRuns: SyncRun[];
}

// ---------- helpers ----------

export function initials(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = [
  "#3b82f6", "#22a565", "#d9a520", "#7c5cff", "#0ea5b7",
  "#ef7a45", "#d158c4", "#e5484d", "#14b8a6", "#6366f1",
];
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function relativeTime(iso?: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (Number.isNaN(then)) return "—";
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60000).toISOString();

// ---------- sample dataset (Sales Analytics workspace) ----------

export const SAMPLE_DATA: AtlasData = {
  workspace: {
    fabricId: "ws-sales-analytics",
    displayName: "Sales Analytics",
    capacity: "F64 · West Europe",
    region: "West Europe",
  },
  items: [
    { fabricId: "lh-sales", displayName: "Sales LH", itemType: "Lakehouse", health: "healthy", endorsement: "certified", ownerName: "Jordan Lee", ownerEmail: "jordan@contoso.com", tags: ["sales", "bronze"], lastRefresh: iso(12), size: "42 GB", description: "Raw + curated sales tables (bronze/silver)." },
    { fabricId: "dw-finance", displayName: "Finance DW", itemType: "Warehouse", health: "healthy", endorsement: "none", ownerName: "Priya N.", ownerEmail: "priya@contoso.com", tags: ["finance"], lastRefresh: iso(63), size: "18 GB", description: "Governed finance warehouse." },
    { fabricId: "eh-web", displayName: "Web Events", itemType: "Eventhouse", health: "healthy", endorsement: "none", ownerName: "Sam Ortiz", ownerEmail: "sam@contoso.com", tags: ["web", "realtime"], lastRefresh: iso(2), size: "7 GB" },
    { fabricId: "kql-web", displayName: "Web Events DB", itemType: "KQLDatabase", health: "healthy", endorsement: "none", ownerName: "Sam Ortiz", tags: ["web", "kql"], lastRefresh: iso(2) },
    { fabricId: "nb-clean", displayName: "Clean & Enrich", itemType: "Notebook", health: "healthy", endorsement: "none", ownerName: "Jordan Lee", tags: ["etl", "gold"], lastRefresh: iso(12), description: "PySpark cleanup + enrichment into the gold layer." },
    { fabricId: "nb-features", displayName: "Feature Build", itemType: "Notebook", health: "stale", endorsement: "none", ownerName: "Alex Kim", tags: ["ml"], lastRefresh: iso(3200) },
    { fabricId: "pl-daily", displayName: "Daily Load", itemType: "DataPipeline", health: "failing", endorsement: "promoted", ownerName: "Alex Kim", tags: ["etl"], lastRefresh: iso(125), description: "Orchestrates ingestion + notebook runs." },
    { fabricId: "df-fx", displayName: "FX Rates", itemType: "Dataflow", health: "stale", endorsement: "none", ownerName: "Priya N.", tags: ["finance"], lastRefresh: iso(4320) },
    { fabricId: "sm-sales", displayName: "Sales Model", itemType: "SemanticModel", health: "healthy", endorsement: "certified", ownerName: "Jordan Lee", tags: ["sales", "gold-layer"], sensitivity: "Confidential", lastRefresh: iso(12), description: "Star schema over gold sales tables." },
    { fabricId: "sm-finance", displayName: "Finance Model", itemType: "SemanticModel", health: "stale", endorsement: "none", ownerName: "Priya N.", tags: ["finance"], lastRefresh: iso(190) },
    { fabricId: "rp-exec", displayName: "Exec Dashboard", itemType: "Report", health: "healthy", endorsement: "promoted", ownerName: "Sam Ortiz", tags: ["exec"], sensitivity: "Confidential", lastRefresh: iso(20) },
    { fabricId: "rp-pipeline", displayName: "Pipeline Report", itemType: "Report", health: "healthy", endorsement: "none", ownerName: "Jordan Lee", tags: ["sales"], lastRefresh: iso(30) },
    { fabricId: "rp-revenue", displayName: "Revenue Deep Dive", itemType: "Report", health: "stale", endorsement: "none", tags: ["sales"], lastRefresh: iso(2600) },
    { fabricId: "rp-finance", displayName: "Finance Board", itemType: "Report", health: "failing", endorsement: "none", ownerName: "Priya N.", tags: ["finance"], lastRefresh: iso(210) },
  ],
  edges: [
    { source: "eh-web", target: "kql-web", relation: "feeds" },
    { source: "lh-sales", target: "nb-clean", relation: "read" },
    { source: "kql-web", target: "nb-clean", relation: "read" },
    { source: "nb-clean", target: "sm-sales", relation: "produces" },
    { source: "lh-sales", target: "nb-features", relation: "read" },
    { source: "dw-finance", target: "pl-daily", relation: "read" },
    { source: "pl-daily", target: "sm-finance", relation: "produces", broken: true },
    { source: "df-fx", target: "sm-finance", relation: "read" },
    { source: "sm-sales", target: "rp-exec", relation: "binds" },
    { source: "sm-sales", target: "rp-pipeline", relation: "binds" },
    { source: "sm-sales", target: "rp-revenue", relation: "binds" },
    { source: "sm-finance", target: "rp-finance", relation: "binds", broken: true },
    { source: "sm-finance", target: "rp-exec", relation: "binds" },
  ],
  principals: [
    { principalId: "u-jordan", displayName: "Jordan Lee", kind: "user", email: "jordan@contoso.com", workspaceRole: "Admin" },
    { principalId: "u-priya", displayName: "Priya N.", kind: "user", email: "priya@contoso.com", workspaceRole: "Member" },
    { principalId: "u-sam", displayName: "Sam Ortiz", kind: "user", email: "sam@contoso.com", workspaceRole: "Member" },
    { principalId: "u-alex", displayName: "Alex Kim", kind: "user", email: "alex@contoso.com", workspaceRole: "Contributor" },
    { principalId: "u-dana", displayName: "Dana Wolfe", kind: "user", email: "dana@contoso.com", workspaceRole: "Viewer" },
    { principalId: "g-finance", displayName: "Finance Team", kind: "group", workspaceRole: "Viewer" },
    { principalId: "g-sales", displayName: "Sales Guild", kind: "group", workspaceRole: "Contributor" },
    { principalId: "sp-etl", displayName: "svc-etl", kind: "servicePrincipal", workspaceRole: "Contributor" },
    { principalId: "gu-ext", displayName: "ext-consultant@vendor.com", kind: "guest", email: "ext-consultant@vendor.com", external: true, workspaceRole: "Viewer" },
    { principalId: "g-marketing", displayName: "Marketing Team", kind: "group", workspaceRole: "Viewer" },
  ],
  grants: [
    { principalRef: "Jordan Lee", accessLevel: "owner", source: "workspaceRole", roleName: "Admin", flag: "admin" },
    { principalRef: "Priya N.", accessLevel: "edit", source: "workspaceRole", roleName: "Member" },
    { principalRef: "Sam Ortiz", accessLevel: "edit", source: "workspaceRole", roleName: "Member" },
    { principalRef: "Alex Kim", accessLevel: "edit", source: "workspaceRole", roleName: "Contributor" },
    { principalRef: "Dana Wolfe", accessLevel: "view", source: "workspaceRole", roleName: "Viewer" },
    { principalRef: "Finance Team", accessLevel: "view", source: "workspaceRole", roleName: "Viewer" },
    { principalRef: "Sales Guild", accessLevel: "edit", source: "workspaceRole", roleName: "Contributor" },
    { principalRef: "svc-etl", accessLevel: "edit", source: "workspaceRole", roleName: "Contributor", flag: "servicePrincipal" },
    { principalRef: "ext-consultant@vendor.com", accessLevel: "view", source: "workspaceRole", roleName: "Viewer", flag: "external" },
    { principalRef: "Marketing Team", accessLevel: "view", source: "directShare", flag: "broad" },
    { itemFabricId: "rp-exec", principalRef: "Sam Ortiz", accessLevel: "owner", source: "itemOwner" },
    { itemFabricId: "rp-exec", principalRef: "Jordan Lee", accessLevel: "edit", source: "workspaceRole", roleName: "Admin" },
    { itemFabricId: "rp-exec", principalRef: "Priya N.", accessLevel: "edit", source: "workspaceRole", roleName: "Member" },
    { itemFabricId: "rp-exec", principalRef: "Alex Kim", accessLevel: "view", source: "workspaceRole", roleName: "Contributor" },
    { itemFabricId: "rp-exec", principalRef: "Dana Wolfe", accessLevel: "view", source: "directShare" },
    { itemFabricId: "rp-exec", principalRef: "Finance Team", accessLevel: "view", source: "workspaceRole", roleName: "Viewer" },
    { itemFabricId: "rp-exec", principalRef: "Marketing Team", accessLevel: "view", source: "directShare", flag: "broad" },
    { itemFabricId: "rp-exec", principalRef: "ext-consultant@vendor.com", accessLevel: "view", source: "directShare", flag: "external" },
    { itemFabricId: "rp-exec", principalRef: "Entire organization", accessLevel: "view", source: "orgLink", flag: "broad" },
    { itemFabricId: "sm-sales", principalRef: "Jordan Lee", accessLevel: "owner", source: "itemOwner" },
    { itemFabricId: "sm-sales", principalRef: "Sales Guild", accessLevel: "edit", source: "workspaceRole", roleName: "Contributor" },
    { itemFabricId: "sm-sales", principalRef: "Dana Wolfe", accessLevel: "view", source: "workspaceRole", roleName: "Viewer" },
  ],
  jobs: [
    { itemFabricId: "pl-daily", itemName: "Daily Load", jobType: "Pipeline run", status: "failed", startedAt: iso(125), durationSec: 92, message: "Activity 'Copy FX' failed: source timeout" },
    { itemFabricId: "nb-clean", itemName: "Clean & Enrich", jobType: "Notebook run", status: "completed", startedAt: iso(12), durationSec: 214 },
    { itemFabricId: "sm-sales", itemName: "Sales Model", jobType: "Refresh", status: "completed", startedAt: iso(12), durationSec: 47 },
    { itemFabricId: "sm-finance", itemName: "Finance Model", jobType: "Refresh", status: "failed", startedAt: iso(190), durationSec: 12, message: "Upstream 'Daily Load' failed" },
    { itemFabricId: "df-fx", itemName: "FX Rates", jobType: "Dataflow refresh", status: "completed", startedAt: iso(4320), durationSec: 63 },
    { itemFabricId: "nb-features", itemName: "Feature Build", jobType: "Notebook run", status: "cancelled", startedAt: iso(3200), durationSec: 5 },
    { itemFabricId: "sm-sales", itemName: "Sales Model", jobType: "Refresh", status: "completed", startedAt: iso(1450), durationSec: 51 },
    { itemFabricId: "pl-daily", itemName: "Daily Load", jobType: "Pipeline run", status: "completed", startedAt: iso(1560), durationSec: 180 },
    { itemFabricId: "eh-web", itemName: "Web Events", jobType: "Ingestion", status: "running", startedAt: iso(1), durationSec: 0 },
  ],
  config: [
    { itemFabricId: "sm-sales", section: "General", label: "Storage mode", value: "Direct Lake" },
    { itemFabricId: "sm-sales", section: "General", label: "Default label", value: "Confidential" },
    { itemFabricId: "sm-sales", section: "Refresh", label: "Schedule", value: "Every 30 min · 06:00-22:00 UTC" },
    { itemFabricId: "sm-sales", section: "Refresh", label: "Last refresh", value: "Success · 12 min ago" },
    { itemFabricId: "sm-sales", section: "Tables", label: "Fact_Sales", value: "12 columns · 4.2M rows" },
    { itemFabricId: "sm-sales", section: "Tables", label: "Dim_Customer", value: "9 columns · 84k rows" },
    { itemFabricId: "sm-sales", section: "Tables", label: "Dim_Date", value: "7 columns · 3.6k rows" },
    { itemFabricId: "sm-sales", section: "Measures", label: "Total Revenue", value: "SUM(Fact_Sales[Amount])" },
    { itemFabricId: "sm-sales", section: "Measures", label: "Revenue YoY %", value: "DIVIDE([Revenue]-[Revenue PY],[Revenue PY])" },
    { itemFabricId: "sm-sales", section: "Source", label: "Lakehouse", value: "Sales LH" },
    { itemFabricId: "pl-daily", section: "General", label: "Activities", value: "6 (Copy x3, Notebook x2, Refresh x1)" },
    { itemFabricId: "pl-daily", section: "Schedule", label: "Trigger", value: "Daily · 05:00 UTC" },
    { itemFabricId: "pl-daily", section: "Last run", label: "Status", value: "Failed · Copy FX timeout" },
    { itemFabricId: "lh-sales", section: "General", label: "Tables", value: "18 Delta tables" },
    { itemFabricId: "lh-sales", section: "General", label: "Shortcuts", value: "2 (ADLS gen2)" },
    { itemFabricId: "rp-exec", section: "General", label: "Pages", value: "4" },
    { itemFabricId: "rp-exec", section: "Binding", label: "Semantic model", value: "Sales Model, Finance Model" },
  ],
  comments: [
    { id: "c1", itemFabricId: "pl-daily", authorId: "u-alex", authorName: "Alex Kim", body: "Daily Load has failed twice this week on the Copy FX activity. Raising with the source team.", createdAt: iso(90) },
    { id: "c2", itemFabricId: "rp-exec", authorId: "u-jordan", authorName: "Jordan Lee", body: "This report is shared org-wide - we should restrict it to the exec group before the board review.", createdAt: iso(140) },
    { id: "c3", authorId: "u-priya", authorName: "Priya N.", body: "Kicked off the first Atlas sync for the workspace. Finance Model is stale because of the Daily Load failure.", createdAt: iso(30) },
  ],
  syncRuns: [
    { id: "s1", startedAt: iso(31), finishedAt: iso(30), status: "completed", itemsSynced: 14, triggeredBy: "Priya N.", summary: "14 items, 13 lineage edges, 10 principals, 9 jobs" },
  ],
};
