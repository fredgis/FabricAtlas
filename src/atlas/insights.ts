import { buildGovernanceFindings, type GovernanceSeverity } from "./governance";
import type { AtlasData } from "./model";
import type { SnapshotSummary } from "./history";
import type { PosturePillar } from "./posture";
import {
  aggregateByDomain,
  domainGovernanceInputs,
  domainKey,
  type DomainGovernanceRow,
} from "./domain-governance";
import type { MicrosoftGovernancePillar } from "./ms-pillars";
import type { PersistedWorkspaceSyncStatus } from "./workspace-sync";
import type { ConnectionInventoryView } from "./connections";
import { buildRetirementRadar, RETIREMENT_SIGNAL_ORDER, type RetirementSignalId } from "./retirement-radar";

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
  domainKey: string;
  /** Undefined when the workspace has no governance summary yet (Unknown). */
  findings?: Record<GovernanceSeverity, number>;
  labeled?: { labeled: number; total: number; unknown: number };
}

export interface JobDay {
  date: string;
  runs: number;
  failed: number;
}

export interface InsightScope {
  /** Domain key from `domainKey()`, or undefined for all domains. */
  domain?: string;
  /** Workspace id, or undefined for all workspaces. */
  workspace?: string;
}

export interface AtlasInsights {
  /** Item-weighted average of the OneLake pillars over the scoped workspaces. */
  posture: number | null;
  pillars: Record<MicrosoftGovernancePillar, number | null>;
  findings: Record<GovernanceSeverity, number>;
  items: number;
  /** Scoped workspaces whose governance summary is not available yet. */
  workspacesWithoutSummary: number;
  /** True when the loaded workspace belongs to the scope. */
  activeInScope: boolean;
  /** Scoped workspaces whose full snapshot feeds the detail charts, out of the scoped total. */
  detailCoverage: { loaded: number; total: number };
  /** Items across the loaded detail snapshots. */
  detailItems: number;
  /** Every synchronized workspace with its domain, for the filters. */
  allWorkspaces: WorkspaceInsight[];
  /** Domains of the synchronized workspaces, for the filters. */
  domainOptions: Array<{ key: string; label: string }>;
  jobs: { runs: number; succeeded: number; failed: number; rate: number | null };
  labeled: { labeled: number; total: number; unknown: number; rate: number | null };
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

const ACCESS_LABELS: Record<string, string> = { owner: "Owner", edit: "Edit", view: "View", none: "No access" };

const PILLARS: readonly MicrosoftGovernancePillar[] = ["health", "protect", "trust"];

/** Full snapshot of another workspace, loaded for the cross-workspace detail charts. */
export interface InsightWorkspaceSnapshot {
  data: AtlasData;
  trend: readonly SnapshotSummary[];
}

/**
 * Sums per-workspace trends: at each sync time, every workspace contributes its
 * latest point at or before that time (carried forward), so totals never dip
 * just because another workspace synchronized on a different day.
 */
export function sumTrends(series: ReadonlyArray<readonly SnapshotSummary[]>): SnapshotSummary[] {
  const sorted = series
    .map((points) => [...points].sort((left, right) => left.syncedAt.localeCompare(right.syncedAt)))
    .filter((points) => points.length);
  if (sorted.length === 1) return sorted[0];
  const times = [...new Set(sorted.flatMap((points) => points.map((point) => point.syncedAt)))].sort();
  return times.flatMap((syncedAt) => {
    const current = sorted
      .map((points) => points.filter((point) => point.syncedAt <= syncedAt).at(-1))
      .filter((point): point is SnapshotSummary => !!point);
    if (!current.length) return [];
    const total: Record<string, unknown> = { snapshotId: `all:${syncedAt}`, syncedAt, label: current.at(-1)!.label };
    for (const point of current) {
      for (const [key, value] of Object.entries(point)) {
        if (typeof value === "number") total[key] = (Number(total[key]) || 0) + value;
      }
    }
    return [total as unknown as SnapshotSummary];
  });
}

export function buildAtlasInsights(input: {
  data: AtlasData;
  trend: readonly SnapshotSummary[];
  /** Full snapshots of the other scoped workspaces, keyed by lower-case workspace id. */
  snapshots?: Readonly<Record<string, InsightWorkspaceSnapshot | null | undefined>>;
  statuses: Readonly<Record<string, PersistedWorkspaceSyncStatus>>;
  targets?: Partial<Record<PosturePillar, number>>;
  connections?: ConnectionInventoryView;
  period?: InsightPeriod;
  scope?: InsightScope;
  now?: number;
}): AtlasInsights {
  const { data, statuses } = input;
  const scope = input.scope ?? {};
  const now = input.now ?? Date.now();
  const activeId = data.workspace.fabricId.toLowerCase();
  const findings = buildGovernanceFindings(data);

  // Every synchronized workspace, the loaded one with its live summary.
  const inputs = domainGovernanceInputs(statuses, data, input.targets);
  const allWorkspaces: WorkspaceInsight[] = inputs
    .map((workspace): WorkspaceInsight => {
      const coverage = workspace.summary?.coverage.labeled;
      return {
        id: workspace.workspaceId,
        name: workspace.displayName || workspace.workspaceId,
        active: workspace.workspaceId.toLowerCase() === activeId,
        domainKey: domainKey(workspace.domainId),
        ...(workspace.summary ? { findings: workspace.summary.findings } : {}),
        ...(coverage ? { labeled: { labeled: coverage.numerator, total: coverage.denominator, unknown: coverage.unknown } } : {}),
      };
    })
    .sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name));
  const inScope = (workspace: { id: string; domainKey: string }) =>
    (!scope.domain || workspace.domainKey === scope.domain) &&
    (!scope.workspace || workspace.id.toLowerCase() === scope.workspace.toLowerCase());
  const workspaces = allWorkspaces.filter(inScope);
  const scopedInputs = inputs.filter((workspace) =>
    inScope({ id: workspace.workspaceId, domainKey: domainKey(workspace.domainId) }));
  const summaries = scopedInputs.flatMap((workspace) => (workspace.summary ? [workspace.summary] : []));
  const activeInScope = workspaces.some((workspace) => workspace.active);

  const scopedFindings: Record<GovernanceSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  let items = 0;
  const labeledTotals = { labeled: 0, total: 0, unknown: 0 };
  const weights = Object.fromEntries(PILLARS.map((pillar) => [pillar, { sum: 0, weight: 0 }])) as Record<MicrosoftGovernancePillar, { sum: number; weight: number }>;
  for (const summary of summaries) {
    items += summary.items;
    for (const severity of Object.keys(scopedFindings) as GovernanceSeverity[]) scopedFindings[severity] += summary.findings[severity];
    labeledTotals.labeled += summary.coverage.labeled.numerator;
    labeledTotals.total += summary.coverage.labeled.denominator;
    labeledTotals.unknown += summary.coverage.labeled.unknown;
    for (const pillar of PILLARS) {
      const score = summary.pillars[pillar];
      if (score == null) continue;
      weights[pillar].sum += score * Math.max(1, summary.items);
      weights[pillar].weight += Math.max(1, summary.items);
    }
  }
  const pillars = Object.fromEntries(PILLARS.map((pillar) => [
    pillar,
    weights[pillar].weight ? Math.round(weights[pillar].sum / weights[pillar].weight) : null,
  ])) as Record<MicrosoftGovernancePillar, number | null>;
  const known = PILLARS.map((pillar) => pillars[pillar]).filter((value): value is number => value != null);

  // Detail charts aggregate the full snapshot of every scoped workspace that is loaded.
  const details: InsightWorkspaceSnapshot[] = workspaces.flatMap((workspace) => {
    if (workspace.active) return [{ data, trend: input.trend }];
    const snapshot = input.snapshots?.[workspace.id.toLowerCase()];
    return snapshot ? [snapshot] : [];
  });
  const detailItems = details.flatMap((entry) => entry.data.items);
  const detailGrants = details.flatMap((entry) => entry.data.grants);
  const runs = details
    .flatMap((entry) => entry.data.jobs)
    .filter((job) => job.status === "completed" || job.status === "failed");
  const succeeded = runs.filter((job) => job.status === "completed").length;

  const since = now - (input.period ?? 12) * 30 * DAY_MS;
  const trend = sumTrends(details.map((entry) => entry.trend))
    .filter((point) => Date.parse(point.syncedAt) >= since);

  let edges = 0;
  let resolved = 0;
  let itemsWithLineage = 0;
  let externalPrincipals = 0;
  let candidates = 0;
  const profile = Object.fromEntries(RETIREMENT_SIGNAL_ORDER.map((id) => [id, 0])) as Record<RetirementSignalId, number>;
  for (const { data: snapshot } of details) {
    const lineageEdges = snapshot.edges.filter((edge) => edge.source !== edge.target);
    const connected = new Set(lineageEdges.flatMap((edge) => [edge.source, edge.target]));
    edges += lineageEdges.length;
    resolved += lineageEdges.filter((edge) => !edge.broken).length;
    itemsWithLineage += snapshot.items.filter((item) => connected.has(item.fabricId)).length;
    externalPrincipals += snapshot.principals.filter((principal) => principal.external).length;
    const radar = buildRetirementRadar(snapshot, snapshot === data ? findings : buildGovernanceFindings(snapshot));
    candidates += radar.candidates.length;
    for (const id of RETIREMENT_SIGNAL_ORDER) profile[id] += radar.profile[id];
  }

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

  return {
    posture: known.length ? Math.round(known.reduce((total, value) => total + value, 0) / known.length) : null,
    pillars,
    findings: scopedFindings,
    items,
    workspacesWithoutSummary: scopedInputs.length - summaries.length,
    activeInScope,
    detailCoverage: { loaded: details.length, total: workspaces.length },
    detailItems: detailItems.length,
    allWorkspaces,
    domainOptions: aggregateByDomain(inputs, data.governanceEvidence)
      .filter((row) => !row.empty)
      .map((row) => ({ key: row.key, label: row.domain.label })),
    jobs: { runs: runs.length, succeeded, failed: runs.length - succeeded, rate: runs.length ? Math.round((succeeded / runs.length) * 100) : null },
    labeled: {
      ...labeledTotals,
      rate: labeledTotals.total ? Math.round((labeledTotals.labeled / labeledTotals.total) * 100) : null,
    },
    trend,
    workspaces,
    domains: aggregateByDomain(scopedInputs, data.governanceEvidence).filter((row) => !row.empty),
    itemTypes: topSlices(count(detailItems, (item) => item.itemType), TOP_TYPES),
    access: [...count(detailGrants, (grant) => grant.accessLevel)]
      .map(([key, value]) => ({ key, label: ACCESS_LABELS[key] ?? key, value }))
      .sort((left, right) => right.value - left.value),
    externalPrincipals,
    lineage: {
      edges,
      resolved,
      itemsWithLineage,
      lineageKnown: (details.length ? details.map((entry) => entry.data) : [data])
        .every((snapshot) => snapshot.workspace.syncSections?.lineage?.status !== "failed"),
    },
    retirement: { candidates, profile },
    jobCalendar: [...days.values()],
    owners: topSlices(count(detailItems, (item) => item.ownerName?.trim() || item.ownerEmail?.trim() || "No owner"), TOP_OWNERS, "Other owners"),
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
