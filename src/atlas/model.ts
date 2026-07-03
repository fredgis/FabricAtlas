// FabricAtlas — UI data model, item-type metadata, and the workspace dataset.
// This dataset mirrors the real contents of the FGI-MAIN workspace (the "AlpineRent"
// demo: an alpine ski & bike rental analytics estate) so the deployed app shows the
// actual items, lineage, config and jobs that live in the workspace. When a live
// Fabric sync is wired, the same shapes are refreshed from the Fabric REST APIs.

export type ItemType =
  | "Lakehouse"
  | "Warehouse"
  | "Eventhouse"
  | "KQLDatabase"
  | "SQLEndpoint"
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
  SQLEndpoint: { label: "SQL endpoint", code: "SE", color: "#0f6cbd", icon: "Table2" },
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

const OWNER = "System Administrator";
const OWNER_EMAIL = "admin@mngenvmcap029985.onmicrosoft.com";

// ---------- FGI-MAIN workspace (AlpineRent) ----------

// Fabric item ids below are the real ids returned by GET /items on FGI-MAIN.
const LH = "b20fd55a-079f-4e02-9fcb-2f05e570f1f1";
const SE = "1247af1c-9bae-458b-9e6e-1d8444b5ca9e";
const NB_BRONZE = "caee1cc0-eb9b-422a-9455-54bc6b67a13e";
const NB_SILVER = "b6533038-d69a-4232-8508-fdeb3a257503";
const NB_GOLD = "6deab4bf-9865-4dc9-8731-a3bf15c263bd";
const NB_FCAST = "2c14c0e0-3a2d-4822-b976-c51ebd346a27";
const DW = "9726212a-34aa-4648-85a0-d64f0eb36129";
const SM = "8c3cf29e-6e4d-4a51-a104-19c472aa177a";
const RP_EXEC = "261f72de-0c7b-462f-a64f-e3d94d7c702c";
const RP_STATION = "8e51161c-6e4a-4971-bec1-b1fd14770abe";
const PL = "2a39a2ad-16b0-40db-afa9-7678de154524";
const EH = "c48c77f2-ec31-4570-bdcd-92f867b988a1";
const KQL_DEFAULT = "5e4188b1-4aca-4cb6-b77a-63f1f0b4af52";
const KQL_EVENTS = "8fca2138-fddb-4207-bb51-cee081b93f8b";

export const SAMPLE_DATA: AtlasData = {
  workspace: {
    fabricId: "6bf4c521-7412-4e6b-8867-68253bbfb18a",
    displayName: "FGI-MAIN",
    capacity: "F16 · Central US",
    region: "Central US",
  },
  items: [
    { fabricId: PL, displayName: "AlpineRent Daily Load", itemType: "DataPipeline", health: "healthy", endorsement: "none", ownerName: OWNER, ownerEmail: OWNER_EMAIL, tags: ["orchestration"], lastRefresh: iso(20), description: "Orchestrates Bronze → Silver → Gold → Forecast." },
    { fabricId: NB_BRONZE, displayName: "01_bronze_ingest", itemType: "Notebook", health: "healthy", endorsement: "none", ownerName: OWNER, ownerEmail: OWNER_EMAIL, tags: ["etl", "bronze"], lastRefresh: iso(40), description: "Generates AlpineRent sample data into the bronze schema." },
    { fabricId: NB_SILVER, displayName: "02_silver_transform", itemType: "Notebook", health: "healthy", endorsement: "none", ownerName: OWNER, ownerEmail: OWNER_EMAIL, tags: ["etl", "silver"], lastRefresh: iso(35), description: "Cleans and conforms bronze into silver." },
    { fabricId: NB_GOLD, displayName: "03_gold_aggregate", itemType: "Notebook", health: "healthy", endorsement: "none", ownerName: OWNER, ownerEmail: OWNER_EMAIL, tags: ["etl", "gold"], lastRefresh: iso(30), description: "Builds the gold analytics tables." },
    { fabricId: NB_FCAST, displayName: "04_demand_forecast", itemType: "Notebook", health: "healthy", endorsement: "none", ownerName: OWNER, ownerEmail: OWNER_EMAIL, tags: ["ml", "gold"], lastRefresh: iso(26), description: "Simple demand forecast into gold.demand_forecast." },
    { fabricId: LH, displayName: "alpinerent_lakehouse", itemType: "Lakehouse", health: "healthy", endorsement: "certified", ownerName: OWNER, ownerEmail: OWNER_EMAIL, tags: ["alpinerent", "medallion"], lastRefresh: iso(28), size: "bronze / silver / gold", description: "Schema-enabled lakehouse with bronze, silver and gold schemas." },
    { fabricId: DW, displayName: "alpinerent_dw", itemType: "Warehouse", health: "healthy", endorsement: "none", ownerName: OWNER, ownerEmail: OWNER_EMAIL, tags: ["star-schema"], lastRefresh: iso(55), description: "Star schema: dim_date, dim_station, dim_equipment, fact_rentals." },
    { fabricId: EH, displayName: "AlpineRent Telemetry", itemType: "Eventhouse", health: "healthy", endorsement: "none", ownerName: OWNER, ownerEmail: OWNER_EMAIL, tags: ["realtime"], lastRefresh: iso(15), description: "Real-time telemetry host for station and bike events." },
    { fabricId: SE, displayName: "alpinerent_lakehouse", itemType: "SQLEndpoint", health: "healthy", endorsement: "none", ownerName: OWNER, ownerEmail: OWNER_EMAIL, tags: ["sql"], lastRefresh: iso(28), description: "SQL analytics endpoint auto-provisioned over the lakehouse." },
    { fabricId: SM, displayName: "AlpineRent Sales Model", itemType: "SemanticModel", health: "healthy", endorsement: "certified", ownerName: OWNER, ownerEmail: OWNER_EMAIL, tags: ["gold", "direct-lake"], sensitivity: "Confidential", lastRefresh: iso(12), description: "Direct Lake model over the gold schema, 6 tables + measures." },
    { fabricId: KQL_DEFAULT, displayName: "AlpineRent Telemetry", itemType: "KQLDatabase", health: "unknown", endorsement: "none", ownerName: OWNER, ownerEmail: OWNER_EMAIL, tags: ["realtime"], lastRefresh: iso(15), description: "Default database of the Eventhouse (empty)." },
    { fabricId: KQL_EVENTS, displayName: "AlpineRent Telemetry Events", itemType: "KQLDatabase", health: "healthy", endorsement: "none", ownerName: OWNER, ownerEmail: OWNER_EMAIL, tags: ["realtime", "kql"], lastRefresh: iso(15), description: "StationTelemetry, BikeEvents, LiftRideEvents + StationHourlyLoad()." },
    { fabricId: RP_EXEC, displayName: "AlpineRent Executive Dashboard", itemType: "Report", health: "healthy", endorsement: "promoted", ownerName: OWNER, ownerEmail: OWNER_EMAIL, tags: ["exec"], lastRefresh: iso(10), description: "KPIs, daily revenue trend, top stations, monthly table." },
    { fabricId: RP_STATION, displayName: "AlpineRent Station Utilization", itemType: "Report", health: "healthy", endorsement: "none", ownerName: OWNER, ownerEmail: OWNER_EMAIL, tags: ["ops"], lastRefresh: iso(10), description: "Station utilization and demand forecast." },
  ],
  edges: [
    { source: PL, target: NB_BRONZE, relation: "orchestrates" },
    { source: PL, target: NB_SILVER, relation: "orchestrates" },
    { source: PL, target: NB_GOLD, relation: "orchestrates" },
    { source: PL, target: NB_FCAST, relation: "orchestrates" },
    { source: NB_BRONZE, target: LH, relation: "writes bronze" },
    { source: NB_SILVER, target: LH, relation: "writes silver" },
    { source: NB_GOLD, target: LH, relation: "writes gold" },
    { source: NB_FCAST, target: LH, relation: "writes forecast" },
    { source: LH, target: SE, relation: "endpoint" },
    { source: LH, target: SM, relation: "Direct Lake" },
    { source: SM, target: RP_EXEC, relation: "binds" },
    { source: SM, target: RP_STATION, relation: "binds" },
    { source: EH, target: KQL_DEFAULT, relation: "default db" },
    { source: EH, target: KQL_EVENTS, relation: "database" },
  ],
  principals: [
    { principalId: "u-admin", displayName: "System Administrator", kind: "user", email: OWNER_EMAIL, workspaceRole: "Admin" },
    { principalId: "u-lea", displayName: "Léa Martin", kind: "user", email: "lea@alpinerent.com", workspaceRole: "Member" },
    { principalId: "u-tom", displayName: "Tom Berg", kind: "user", email: "tom@alpinerent.com", workspaceRole: "Contributor" },
    { principalId: "g-de", displayName: "Data Engineering", kind: "group", workspaceRole: "Contributor" },
    { principalId: "g-bi", displayName: "BI Analysts", kind: "group", workspaceRole: "Viewer" },
    { principalId: "gu-partner", displayName: "ext-partner@vendor.com", kind: "guest", email: "ext-partner@vendor.com", external: true, workspaceRole: "Viewer" },
  ],
  grants: [
    { principalRef: "System Administrator", accessLevel: "owner", source: "workspaceRole", roleName: "Admin", flag: "admin" },
    { principalRef: "Léa Martin", accessLevel: "edit", source: "workspaceRole", roleName: "Member" },
    { principalRef: "Tom Berg", accessLevel: "edit", source: "workspaceRole", roleName: "Contributor" },
    { principalRef: "Data Engineering", accessLevel: "edit", source: "workspaceRole", roleName: "Contributor" },
    { principalRef: "BI Analysts", accessLevel: "view", source: "workspaceRole", roleName: "Viewer" },
    { principalRef: "ext-partner@vendor.com", accessLevel: "view", source: "workspaceRole", roleName: "Viewer", flag: "external" },
    { itemFabricId: RP_EXEC, principalRef: "System Administrator", accessLevel: "owner", source: "itemOwner" },
    { itemFabricId: RP_EXEC, principalRef: "Léa Martin", accessLevel: "edit", source: "workspaceRole", roleName: "Member" },
    { itemFabricId: RP_EXEC, principalRef: "BI Analysts", accessLevel: "view", source: "workspaceRole", roleName: "Viewer" },
    { itemFabricId: RP_EXEC, principalRef: "ext-partner@vendor.com", accessLevel: "view", source: "directShare", flag: "external" },
    { itemFabricId: SM, principalRef: "System Administrator", accessLevel: "owner", source: "itemOwner" },
    { itemFabricId: SM, principalRef: "Data Engineering", accessLevel: "edit", source: "workspaceRole", roleName: "Contributor" },
    { itemFabricId: SM, principalRef: "BI Analysts", accessLevel: "view", source: "workspaceRole", roleName: "Viewer" },
  ],
  jobs: [
    { itemFabricId: NB_BRONZE, itemName: "01_bronze_ingest", jobType: "Notebook run", status: "completed", startedAt: iso(40), durationSec: 182 },
    { itemFabricId: NB_SILVER, itemName: "02_silver_transform", jobType: "Notebook run", status: "completed", startedAt: iso(35), durationSec: 151 },
    { itemFabricId: NB_GOLD, itemName: "03_gold_aggregate", jobType: "Notebook run", status: "completed", startedAt: iso(30), durationSec: 168 },
    { itemFabricId: NB_FCAST, itemName: "04_demand_forecast", jobType: "Notebook run", status: "completed", startedAt: iso(26), durationSec: 74 },
    { itemFabricId: PL, itemName: "AlpineRent Daily Load", jobType: "Pipeline run", status: "completed", startedAt: iso(20), durationSec: 615 },
    { itemFabricId: SM, itemName: "AlpineRent Sales Model", jobType: "Refresh", status: "completed", startedAt: iso(12), durationSec: 44, message: "Direct Lake framing refresh" },
  ],
  config: [
    { itemFabricId: LH, section: "General", label: "Schemas", value: "bronze, silver, gold" },
    { itemFabricId: LH, section: "Gold tables", label: "rentals_daily_summary", value: "210 rows" },
    { itemFabricId: LH, section: "Gold tables", label: "station_utilization", value: "34 rows" },
    { itemFabricId: LH, section: "Gold tables", label: "equipment_performance", value: "7 rows" },
    { itemFabricId: LH, section: "Gold tables", label: "member_segments", value: "4 rows" },
    { itemFabricId: LH, section: "Gold tables", label: "revenue_by_month", value: "7 rows" },
    { itemFabricId: LH, section: "Gold tables", label: "demand_forecast", value: "14 rows" },
    { itemFabricId: DW, section: "Tables", label: "dim_date", value: "210 rows" },
    { itemFabricId: DW, section: "Tables", label: "dim_station", value: "15 rows" },
    { itemFabricId: DW, section: "Tables", label: "dim_equipment", value: "20 rows" },
    { itemFabricId: DW, section: "Tables", label: "fact_rentals", value: "900 rows" },
    { itemFabricId: DW, section: "General", label: "Constraints", value: "PK/FK not enforced" },
    { itemFabricId: SM, section: "General", label: "Storage mode", value: "Direct Lake" },
    { itemFabricId: SM, section: "General", label: "Datasource", value: "AzureDataLakeStorage (SSO, no gateway)" },
    { itemFabricId: SM, section: "General", label: "Tables", value: "6 (gold schema)" },
    { itemFabricId: SM, section: "Measures", label: "Total Rentals", value: "11,936" },
    { itemFabricId: SM, section: "Measures", label: "Total Revenue", value: "CHF 533,821.21" },
    { itemFabricId: SM, section: "Measures", label: "Avg Rental Duration", value: "19.7 h" },
    { itemFabricId: SM, section: "Measures", label: "Revenue MoM %", value: "-8.1% … +6.1% (Dec → Jun)" },
    { itemFabricId: RP_EXEC, section: "General", label: "Pages", value: "1" },
    { itemFabricId: RP_EXEC, section: "General", label: "Visuals", value: "6" },
    { itemFabricId: RP_EXEC, section: "Binding", label: "Semantic model", value: "AlpineRent Sales Model" },
    { itemFabricId: KQL_EVENTS, section: "Tables", label: "StationTelemetry", value: "telemetry stream" },
    { itemFabricId: KQL_EVENTS, section: "Tables", label: "BikeEvents", value: "GPS + status" },
    { itemFabricId: KQL_EVENTS, section: "Tables", label: "LiftRideEvents", value: "lift ridership" },
    { itemFabricId: KQL_EVENTS, section: "Functions", label: "StationHourlyLoad()", value: "KQL function" },
    { itemFabricId: PL, section: "General", label: "Activities", value: "4 (Bronze, Silver, Gold, Forecast)" },
    { itemFabricId: PL, section: "Schedule", label: "Trigger", value: "Manual" },
  ],
  comments: [
    { id: "c1", authorId: "u-admin", authorName: OWNER, authorEmail: OWNER_EMAIL, body: "First Atlas sync of FGI-MAIN done — 14 items across 9 types, zero failures. Gold layer has 210 daily rows.", createdAt: iso(6) },
    { id: "c2", itemFabricId: SM, authorId: "u-admin", authorName: OWNER, authorEmail: OWNER_EMAIL, body: "Direct Lake model validated live: Total Revenue CHF 533,821, 11,936 rentals, avg 19.7 h.", createdAt: iso(5) },
    { id: "c3", itemFabricId: RP_EXEC, authorId: "u-tom", authorName: "Tom Berg", body: "Exec dashboard looks good — can we add a week-over-week view next to MoM?", createdAt: iso(3) },
  ],
  syncRuns: [
    { id: "s1", startedAt: iso(7), finishedAt: iso(6), status: "completed", itemsSynced: 14, triggeredBy: OWNER, summary: "14 items · 14 lineage edges · 6 principals · 6 jobs" },
  ],
};
