import {
  createLineageIndex,
  getLineageImpact,
  normalizeLineageEdges,
} from "./lineage";
import type { AtlasData, ItemType } from "./model";
import { searchJobId } from "./search";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Evidence class shown beside every operational signal. Observed signals were
 * recorded by a source; inferred signals are derived from snapshot lineage and
 * have not been confirmed by any operational source.
 */
export type OperationalEvidence = "observed" | "inferred";

export interface ObservedIncident {
  evidence: "observed";
  id: string;
  source: "fabric-job-history";
  workspaceId: string;
  itemId: string;
  itemName: string;
  itemType?: ItemType;
  jobType: string;
  /** When the failed run started, as reported by Fabric. */
  occurredAt: string;
  /** When Atlas captured the run: the snapshot synchronization time. */
  observedAt?: string;
  durationSec: number;
  message?: string;
}

export interface InferredImpact {
  evidence: "inferred";
  incidentId: string;
  itemId: string;
  itemName: string;
  itemType?: ItemType;
  /** Lineage hops from the failed item. */
  distance: number;
  basis: "snapshot-lineage";
}

export interface IncidentImpact {
  incident: ObservedIncident;
  impact: InferredImpact[];
}

export type MonitoringSourceId =
  | "fabric-job-history"
  | "workspace-monitoring"
  | "monitor-hub-alerts"
  | "app-metrics";

export type MonitoringSourceStatus =
  | "collected"
  | "not-collected"
  | "fabric-only";

export interface MonitoringSource {
  id: MonitoringSourceId;
  label: string;
  status: MonitoringSourceStatus;
  maturity: "generally-available" | "preview";
  summary: string;
  prerequisites: string[];
  documentationUrl: string;
}

export const MONITORING_SOURCES: readonly MonitoringSource[] = [
  {
    id: "fabric-job-history",
    label: "Fabric job history",
    status: "collected",
    maturity: "generally-available",
    summary:
      "Recent job instances are captured at each synchronization and stored with the snapshot.",
    prerequisites: [
      "Read access to the items whose jobs are listed.",
      "A completed Atlas synchronization; nothing newer than the snapshot is shown.",
    ],
    documentationUrl:
      "https://learn.microsoft.com/en-us/rest/api/fabric/core/job-scheduler/list-item-job-instances",
  },
  {
    id: "workspace-monitoring",
    label: "Workspace monitoring",
    status: "not-collected",
    maturity: "preview",
    summary:
      "Atlas has no workspace-monitoring collector and cannot tell whether monitoring is enabled for this workspace.",
    prerequisites: [
      "A workspace admin configures a Monitoring Item and turns on collection; earlier activity is not backfilled.",
      "The workspace runs on Power BI Premium or Fabric capacity, and the tenant allows workspace admins to turn on monitoring.",
      "Querying the read-only monitoring KQL database needs at least the Contributor role or a shared Monitoring Item.",
      "Data is kept for 30 days by default; retention and caching are set on the monitoring KQL database.",
      "Ingestion, storage and queries consume Fabric capacity (Eventhouse and Eventstream).",
    ],
    documentationUrl:
      "https://learn.microsoft.com/en-us/fabric/fundamentals/workspace-monitoring-overview",
  },
  {
    id: "monitor-hub-alerts",
    label: "Monitor hub job alerts",
    status: "fabric-only",
    maturity: "preview",
    summary:
      "Alert rules and notifications are configured in the Fabric portal. No public API reads them.",
    prerequisites: [
      "Failure emails need the Contributor role in the workspace or Write permission on the item, and cover scheduled runs only.",
      "Activator-based rules need workspace Owner or Contributor and are unavailable where workspace monitoring is unavailable.",
    ],
    documentationUrl:
      "https://learn.microsoft.com/en-us/fabric/admin/monitoring-hub-alerts",
  },
  {
    id: "app-metrics",
    label: "Fabric App Metrics",
    status: "fabric-only",
    maturity: "preview",
    summary:
      "Sign-ins, app loads and GraphQL query volume, errors and duration for this app. No public read API is documented.",
    prerequisites: [
      "Write permission on the app to open Manage app > Metrics.",
      "The Monitor hub Applications page shows the same always-on platform metrics to users who can view the app.",
    ],
    documentationUrl: "https://learn.microsoft.com/en-us/fabric/apps/app-metrics",
  },
];

/**
 * Failed runs whose item and job type have no newer recorded run. A failure
 * followed by a later run is history, not a current incident.
 */
export function observedIncidents(
  data: Pick<AtlasData, "workspace" | "items" | "jobs">,
  observedAt?: string,
): ObservedIncident[] {
  const itemById = new Map(data.items.map((item) => [item.fabricId, item]));
  const latest = new Map<string, AtlasData["jobs"][number]>();
  for (const job of data.jobs) {
    const started = new Date(job.startedAt).getTime();
    if (Number.isNaN(started)) continue;
    const key = `${job.itemFabricId}\u0000${job.jobType}`;
    const current = latest.get(key);
    if (!current || new Date(current.startedAt).getTime() < started) {
      latest.set(key, job);
    }
  }
  return [...latest.values()]
    .filter((job) => job.status === "failed")
    .map((job) => {
      const item = itemById.get(job.itemFabricId);
      return {
        evidence: "observed" as const,
        id: searchJobId(job.itemFabricId, job.jobType, job.startedAt),
        source: "fabric-job-history" as const,
        workspaceId: data.workspace.fabricId,
        itemId: job.itemFabricId,
        itemName: item?.displayName ?? job.itemName,
        itemType: item?.itemType,
        jobType: job.jobType,
        occurredAt: job.startedAt,
        observedAt,
        durationSec: job.durationSec,
        message: job.message?.trim() || undefined,
      };
    })
    .sort(
      (left, right) =>
        new Date(right.occurredAt).getTime() -
          new Date(left.occurredAt).getTime() ||
        left.itemName.localeCompare(right.itemName),
    );
}

/** Joins each observed incident to the consumers reachable in snapshot lineage. */
export function incidentImpact(
  data: Pick<AtlasData, "workspace" | "items" | "edges" | "jobs">,
  observedAt?: string,
): IncidentImpact[] {
  const incidents = observedIncidents(data, observedAt);
  if (incidents.length === 0) return [];
  const itemById = new Map(data.items.map((item) => [item.fabricId, item]));
  const index = createLineageIndex(
    normalizeLineageEdges(data.items, data.edges),
  );
  return incidents.map((incident) => {
    const downstream = getLineageImpact(index, incident.itemId).downstream;
    const impact = [...downstream.ids]
      .filter((id) => id !== incident.itemId)
      .map((id) => {
        const item = itemById.get(id);
        return {
          evidence: "inferred" as const,
          incidentId: incident.id,
          itemId: id,
          itemName: item?.displayName ?? id,
          itemType: item?.itemType,
          distance: downstream.distance.get(id) ?? Number.POSITIVE_INFINITY,
          basis: "snapshot-lineage" as const,
        };
      })
      .sort(
        (left, right) =>
          left.distance - right.distance ||
          left.itemName.localeCompare(right.itemName),
      );
    return { incident, impact };
  });
}

export type MonitorHubPage = "jobs" | "alerts" | "applications";

/** Monitor hub routes verified in the Fabric portal on 2026-10-02. */
export const MONITOR_HUB_PAGES: Record<MonitorHubPage, string> = {
  jobs: "monitoringhub/jobs",
  alerts: "monitoringhub/alerts",
  applications: "monitoringhub/applications",
};

export interface FabricPortalContext {
  portalBase?: string;
  tenantId?: string;
}

const DEFAULT_PORTAL = "https://app.fabric.microsoft.com";

function portalOrigin(portalBase: string | undefined): string {
  try {
    const url = new URL(portalBase?.trim() || DEFAULT_PORTAL);
    return url.protocol === "https:" ? url.origin : DEFAULT_PORTAL;
  } catch {
    return DEFAULT_PORTAL;
  }
}

function portalQuery(tenantId: string | undefined): string {
  const params = new URLSearchParams({ experience: "fabric-developer" });
  if (tenantId && UUID.test(tenantId.trim())) {
    params.set("ctid", tenantId.trim().toLowerCase());
  }
  return params.toString();
}

export function monitorHubUrl(
  page: MonitorHubPage,
  { portalBase, tenantId }: FabricPortalContext = {},
): string {
  return `${portalOrigin(portalBase)}/${MONITOR_HUB_PAGES[page]}?${portalQuery(tenantId)}`;
}

/**
 * Opens the deployed Atlas app item, where Manage app > Metrics lives. Returns
 * undefined unless both the deployment workspace and app item IDs are valid.
 */
export function fabricAppItemUrl({
  portalBase,
  tenantId,
  workspaceId,
  itemId,
}: FabricPortalContext & {
  workspaceId?: string;
  itemId?: string;
}): string | undefined {
  const workspace = workspaceId?.trim() ?? "";
  const item = itemId?.trim() ?? "";
  if (!UUID.test(workspace) || !UUID.test(item)) return undefined;
  return `${portalOrigin(portalBase)}/groups/${workspace.toLowerCase()}/appbackends/${item.toLowerCase()}?${portalQuery(tenantId)}`;
}
