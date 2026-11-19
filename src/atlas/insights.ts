import { buildGovernanceFindings, type GovernanceSeverity } from "./governance";
import type { AtlasData } from "./model";
import type { SnapshotSummary } from "./history";
import { snapshotCatalogFromData } from "./history";
import { scorePosture, type PillarScore, type PosturePillar } from "./posture";
import {
  aggregateByDomain,
  domainGovernanceInputs,
  type DomainGovernanceRow,
} from "./domain-governance";
import type { PersistedWorkspaceSyncStatus } from "./workspace-sync";
import type { ConnectionInventoryView } from "./connections";
import { buildRetirementRadar, type RetirementSignalId } from "./retirement-radar";

/** Atlas Insights: chart-ready aggregates derived only from collected snapshot evidence. */
export interface InsightSlice {
  key: string;
  label: string;
  value: number;
}

export type InsightPeriod = 3 | 6 | 12;

export interface WorkspaceInsight {
  id: string;
  name: string;
  active: boolean;
  /** Undefined when the workspace has no governance summary yet (Unknown). */
  findings?: Record<GovernanceSeverity, number>;
  labeled?: { labeled: number; total: number; unknown: number };
}

export interface JobDay {
  date: string;
  runs: number;
  failed: number;
}

export interface AtlasInsights {
  posture: number | null;
  pillars: PillarScore[];
  findings: Record<GovernanceSeverity, number>;
  items: number;
  jobs: { runs: number; succeeded: number; failed: number; rate: number | null };
  labeled: { labeled: number; total: number; rate: number | null };
  trend: SnapshotSummary[];
  workspaces: WorkspaceInsight[];
  domains: DomainGovernanceRow[];
  itemTypes: InsightSlice[];
  access: InsightSlice[];
  externalPrincipals: number;
  lineage: {
    edges: number;
    resolved: number;
    itemsWithLineage: number;
    lineageKnown: boolean;
  };
  retirement: { candidates: number; profile: Record<RetirementSignalId, number> };
  jobCalendar: JobDay[];
  owners: InsightSlice[];
  /** Undefined when no connection inventory is available (Unknown). */
  connectors?: InsightSlice[];
}

const DAY_MS = 86_400_000;
export const JOB_CALENDAR_DAYS = 14 * 7;
const TOP_TYPES = 7;
const TOP_OWNERS = 6;
const TOP_CONNECTORS = 6;

function topSlices(counts: Map<string, number>, limit: number, otherLabel = "Other"): InsightSlice[] {
  const sorted = [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const head = sorted.slice(0, limit).map(([label, value]) => ({ key: label, label, value }));
  const rest = sorted.slice(limit).reduce((sum, [, value]) => sum + value, 0);
  return rest ? [...head, { key: "other", label: otherLabel, value: rest }] : head;
}

function count<T>(values: readonly T[], key: (value: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(key(value), (counts.get(key(value)) ?? 0) + 1);
  return counts;
}

function severityCounts(severities: readonly GovernanceSeverity[]): Record<GovernanceSeverity, number> {
  const counts: Record<GovernanceSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const severity of severities) counts[severity] += 1;
  return counts;
}

const ACCESS_LABELS: Record<string, string> = { owner: "Owner", edit: "Edit", view: "View", none: "No access" };

export function buildAtlasInsights(input: {
  data: AtlasData;
  trend: readonly SnapshotSummary[];
  statuses: Readonly<Record<string, PersistedWorkspaceSyncStatus>>;
  targets?: Partial<Record<PosturePillar, number>>;
  connections?: ConnectionInventoryView;
  period?: InsightPeriod;
  now?: number;
}): AtlasInsights {
  const { data, statuses } = input;
  const now = input.now ?? Date.now();
  const findings = buildGovernanceFindings(data);
  const posture = scorePosture(snapshotCatalogFromData(data), input.targets);
  const counted = severityCounts(findings.map((finding) => finding.severity));

  const runs = data.jobs.filter((job) => job.status === "completed" || job.status === "failed");
  const succeeded = runs.filter((job) => job.status === "completed").length;
  const labeled = data.items.filter((item) => !!item.sensitivity?.trim()).length;

  const since = now - (input.period ?? 12) * 30 * DAY_MS;
  const trend = [...input.trend]
    .filter((point) => Date.parse(point.syncedAt) >= since)
    .sort((left, right) => left.syncedAt.localeCompare(right.syncedAt));

  const activeId = data.workspace.fabricId.toLowerCase();
  const workspaces: WorkspaceInsight[] = [
    {
      id: data.workspace.fabricId,
      name: data.workspace.displayName,
      active: true,
      findings: counted,
      labeled: { labeled, total: data.items.length, unknown: 0 },
    },
    ...Object.entries(statuses)
      .filter(([id, status]) => id.toLowerCase() !== activeId && status.snapshotId)
      .map(([id, status]): WorkspaceInsight => {
        const summary = status.governanceSummary;
        const coverage = summary?.coverage.labeled;
        return {
          id,
          name: status.displayName ?? id,
          active: false,
          ...(summary ? { findings: summary.findings } : {}),
          ...(coverage ? { labeled: { labeled: coverage.numerator, total: coverage.denominator, unknown: coverage.unknown } } : {}),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name)),
  ];

  const lineageEdges = data.edges.filter((edge) => edge.source !== edge.target);
  const connected = new Set(lineageEdges.flatMap((edge) => [edge.source, edge.target]));
  const radar = buildRetirementRadar(data, findings);

  const calendarStart = Math.floor(now / DAY_MS) * DAY_MS - (JOB_CALENDAR_DAYS - 1) * DAY_MS;
  const days = new Map<string, JobDay>();
  for (let index = 0; index < JOB_CALENDAR_DAYS; index += 1) {
    const date = new Date(calendarStart + index * DAY_MS).toISOString().slice(0, 10);
    days.set(date, { date, runs: 0, failed: 0 });
  }
  for (const job of runs) {
    const day = days.get(job.startedAt.slice(0, 10));
    if (!day) continue;
    day.runs += 1;
    if (job.status === "failed") day.failed += 1;
  }

  const owners = count(data.items, (item) => item.ownerName?.trim() || item.ownerEmail?.trim() || "No owner");
  const ownerSlices = topSlices(owners, TOP_OWNERS, "Other owners");

  return {
    posture: posture.global,
    pillars: posture.pillars,
    findings: counted,
    items: data.items.length,
    jobs: { runs: runs.length, succeeded, failed: runs.length - succeeded, rate: runs.length ? Math.round((succeeded / runs.length) * 100) : null },
    labeled: { labeled, total: data.items.length, rate: data.items.length ? Math.round((labeled / data.items.length) * 100) : null },
    trend,
    workspaces,
    domains: aggregateByDomain(domainGovernanceInputs(statuses, data, input.targets), data.governanceEvidence)
      .filter((row) => !row.empty),
    itemTypes: topSlices(count(data.items, (item) => item.itemType), TOP_TYPES),
    access: [...count(data.grants, (grant) => grant.accessLevel)]
      .map(([key, value]) => ({ key, label: ACCESS_LABELS[key] ?? key, value }))
      .sort((left, right) => right.value - left.value),
    externalPrincipals: data.principals.filter((principal) => principal.external).length,
    lineage: {
      edges: lineageEdges.length,
      resolved: lineageEdges.filter((edge) => !edge.broken).length,
      itemsWithLineage: data.items.filter((item) => connected.has(item.fabricId)).length,
      lineageKnown: data.workspace.syncSections?.lineage?.status !== "failed",
    },
    retirement: { candidates: radar.candidates.length, profile: radar.profile },
    jobCalendar: [...days.values()],
    owners: ownerSlices,
    ...(input.connections
      ? { connectors: topSlices(count(input.connections.connections, (connection) => connection.connectorType || connection.connectivityType || "Unknown"), TOP_CONNECTORS) }
      : {}),
  };
}

/**
 * Least-squares linear projection of a series, for a dashed "Projection" line.
 * Needs at least three points; values are clamped at zero.
 */
export function projectSeries(values: readonly number[], steps: number): number[] {
  if (values.length < 3 || steps < 1) return [];
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY);
    denominator += (index - meanX) ** 2;
  });
  const slope = denominator ? numerator / denominator : 0;
  const intercept = meanY - slope * meanX;
  return Array.from({ length: steps }, (_, step) => Math.max(0, Math.round(intercept + slope * (n + step))));
}
