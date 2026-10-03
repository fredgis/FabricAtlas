import { useMemo } from "react";
import type {
  AtlasNavigation,
  Tab,
} from "@/atlas/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Clock3,
  LockKeyhole,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useAtlas } from "../store";
import {
  buildAccessReviewRows,
  getCoverageDiagnostics,
} from "../governance";
import { Card, TypeGlyph, cn } from "../ui";
import {
  typeMeta,
  relativeTime,
  schemaFor,
  type ItemType,
  type JobStatus,
} from "../model";
import { snapshotCatalogFromData } from "../history";
import { scorePosture } from "../posture";
import { workspaceDetailLabel } from "../workspace-display";
import { summarizeHealth } from "../health-summary";
import { ScoreMeter } from "../components/ScoreMeter";
import { scoreBand, scoreStyle } from "../components/score-style";
import { PageHeader } from "../components/PageHeader";

const JOB_TONE: Record<JobStatus, string> = {
  completed: "bg-status-healthy",
  failed: "bg-status-failing",
  running: "bg-primary",
  cancelled: "bg-lineage-neutral",
};

function ScoreRing({
  value,
  label,
  large = false,
}: {
  value: number | null;
  label: string;
  large?: boolean;
}) {
  const score = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <span className="relative inline-flex items-center justify-center" style={scoreStyle(value)}>
      <svg
        viewBox="0 0 42 42"
        className={large ? "icon-size-800" : "icon-size-700"}
        role="img"
        aria-label={`${label}: ${value == null ? "not available" : `${value}%`}`}
      >
        <circle
          cx="21"
          cy="21"
          r="16"
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth="4"
        />
        <circle
          cx="21"
          cy="21"
          r="16"
          pathLength="100"
          fill="none"
          stroke="var(--atlas-score-fill)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${score} 100`}
          transform="rotate(-90 21 21)"
        />
      </svg>
      <span
        className={`atlas-score absolute font-numeric font-semibold ${
          large ? "text-500" : "text-200"
        }`}
        data-score-band={scoreBand(value)}
        aria-hidden="true"
      >
        {value == null ? "N/A" : value}
      </span>
    </span>
  );
}

export function OverviewView({
  onOpen,
}: {
  onOpen: (target: Tab | AtlasNavigation) => void;
}) {
  const {
    data,
    history,
    lastSyncedAt,
    governanceTargets,
    governancePolicyLoading,
    governancePolicyError,
  } = useAtlas();
  const targetsAvailable = !governancePolicyLoading && !governancePolicyError;
  const { items, principals, jobs, syncRuns, grants, edges } = data;

  const health = useMemo(() => summarizeHealth(items), [items]);

  const byType = useMemo(() => {
    const counts = new Map<ItemType, number>();
    items.forEach((item) => {
      counts.set(item.itemType, (counts.get(item.itemType) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const recentJobs = useMemo(
    () =>
      [...jobs]
        .sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt))
        .slice(0, 4),
    [jobs],
  );

  const latestSync = useMemo(
    () =>
      [...syncRuns].sort(
        (a, b) =>
          +new Date(b.finishedAt ?? b.startedAt) -
          +new Date(a.finishedAt ?? a.startedAt),
      )[0],
    [syncRuns],
  );
  const historyCurrent = history.current;
  const historyAligned =
    !data.workspace.snapshotId ||
    historyCurrent?.snapshotId === data.workspace.snapshotId;
  const currentCatalog =
    historyCurrent && historyAligned
      ? historyCurrent.catalog
      : undefined;
  const posture = useMemo(
    () =>
      scorePosture(
        currentCatalog ?? snapshotCatalogFromData(data),
        governanceTargets,
      ),
    [currentCatalog, data, governanceTargets],
  );
  const previousSnapshotId = historyAligned
    ? history.summaries[1]?.snapshotId
    : history.summaries[0]?.snapshotId;
  const previousCatalog = history.snapshots.find(
    (snapshot) => snapshot.snapshotId === previousSnapshotId,
  )?.catalog;
  const previousPosture = useMemo(() => {
    return previousCatalog ? scorePosture(previousCatalog, governanceTargets) : undefined;
  }, [previousCatalog, governanceTargets]);
  const postureAtTarget = posture.pillars.filter(
    (pillar) => pillar.score != null && pillar.score >= pillar.target,
  ).length;

  const assetCount = useMemo(
    () =>
      items.reduce((total, item) => {
        const schema = schemaFor(data, item.fabricId);
        return (
          total +
          (schema?.reduce(
            (schemaTotal, table) =>
              schemaTotal + 1 + table.columns.length + table.measures.length,
            0,
          ) ?? 0)
        );
      }, 0),
    [data, items],
  );

  const maxType = Math.max(...byType.map(([, count]) => count), 1);
  const confidentialLabels = new Set(["confidential", "highly confidential"]);
  const confidential = items.filter((item) =>
    confidentialLabels.has((item.sensitivity ?? "").toLowerCase()),
  );
  const coverageDiagnostics = useMemo(
    () => getCoverageDiagnostics(data),
    [data],
  );
  const endorsementCoverage = coverageDiagnostics.byId.endorsement;
  const sensitivityCoverage = coverageDiagnostics.byId.sensitivity;
  const ownerCoverage = coverageDiagnostics.byId.owners;
  const external = principals.filter((principal) => principal.external);
  const accessRows = useMemo(() => buildAccessReviewRows(data), [data]);
  const itemOnly = new Set(
    accessRows
      .filter(
        (row) =>
          row.origin === "item" && row.effectiveAccess !== "none",
      )
      .map((row) => row.principalKey),
  );
  const attentionCount = health.stale + health.failing;
  const healthPercentage = health.healthPercentage;
  const syncFreshness = lastSyncedAt
    ? relativeTime(lastSyncedAt)
    : "Not synced yet";
  const workspaceDetails = [workspaceDetailLabel(data.workspace)].filter(
    Boolean,
  );

  const pulse = health.failing
    ? {
        label: "Action required",
        className:
          "border-status-failing/30 bg-status-failing/10 text-status-failing",
      }
    : health.stale
      ? {
          label: "Freshness review",
          className:
            "border-status-warning/30 bg-status-warning/10 text-status-warning",
        }
      : health.unknown
        ? {
            label: `${health.unknown} health status unknown`,
            className:
              "border-border bg-muted text-muted-foreground",
          }
        : items.length
          ? {
              label: "Operational",
              className:
                "border-status-healthy/30 bg-status-healthy/10 text-status-healthy",
            }
          : {
              label: "Awaiting inventory",
              className:
                "border-lineage-neutral/30 bg-lineage-neutral/10 text-muted-foreground",
            };

  const coverage = [
    {
      label: "Endorsement",
      detail: endorsementCoverage.denominator
        ? `${endorsementCoverage.numerator} of ${endorsementCoverage.denominator} eligible items`
        : "Metadata not collected",
      value:
        endorsementCoverage.percentage == null
          ? null
          : Math.round(endorsementCoverage.percentage),
    },
    {
      label: "Sensitivity labels",
      detail: sensitivityCoverage.denominator
        ? `${sensitivityCoverage.numerator} of ${sensitivityCoverage.denominator} eligible items`
        : "Metadata not collected",
      value:
        sensitivityCoverage.percentage == null
          ? null
          : Math.round(sensitivityCoverage.percentage),
    },
    {
      label: "Documented ownership",
      detail: ownerCoverage.denominator
        ? `${ownerCoverage.numerator} of ${ownerCoverage.denominator} eligible items`
        : "Metadata not collected",
      value:
        ownerCoverage.percentage == null
          ? null
          : Math.round(ownerCoverage.percentage),
    },
  ];

  const riskSignals = [
    {
      label: "Needs attention",
      value: attentionCount,
      detail: `${health.failing} failing · ${health.stale} stale`,
      target: {
        tab: "governance",
        focus: {
          requestId: crypto.randomUUID(),
          governanceSection: "findings",
          filters: { section: "findings", category: "operations" },
        },
      } as AtlasNavigation,
      icon: AlertTriangle,
      tone:
        attentionCount > 0
          ? "text-status-warning"
          : "text-status-healthy",
    },
    {
      label: "External access",
      value: external.length,
      detail: `${principals.length} people and groups`,
      target: {
        tab: "access",
        focus: {
          requestId: crypto.randomUUID(),
          filters: { risk: "external" },
        },
      } as AtlasNavigation,
      icon: Users,
      tone:
        external.length > 0
          ? "text-status-failing"
          : "text-status-healthy",
    },
    {
      label: "Confidential items",
      value: confidential.length,
      detail: sensitivityCoverage.denominator
        ? `${sensitivityCoverage.numerator} items labeled`
        : "Label metadata unavailable",
      target: {
        tab: "governance",
        focus: {
          requestId: crypto.randomUUID(),
          governanceSection: "coverage",
        },
      } as AtlasNavigation,
      icon: LockKeyhole,
      tone: "text-lineage-upstream",
    },
    {
      label: "Item-only access",
      value: itemOnly.size,
      detail: `${grants.length} grants indexed`,
      target: {
        tab: "access",
        focus: {
          requestId: crypto.randomUUID(),
          filters: { origin: "item" },
        },
      } as AtlasNavigation,
      icon: ShieldCheck,
      tone:
        itemOnly.size > 0
          ? "text-status-warning"
          : "text-status-healthy",
    },
  ];

  return (
    <section
      aria-labelledby="overview-title"
      className="atlas-content-frame flex min-w-0 flex-col gap-l"
    >
      <PageHeader
        title={data.workspace.displayName || "Fabric workspace"}
        titleId="overview-title"
        purpose="Inventory, governance gaps and recent activity."
      />
      <div className="flex flex-wrap items-center justify-between gap-l border-y border-border px-l py-m">
        <dl className="flex flex-wrap gap-x-xxl gap-y-s" aria-label="Workspace inventory">
          {[["Fabric items", items.length], ["Tables, columns & measures", assetCount], ["Lineage links", edges.length]].map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-s">
              <dt className="text-200 text-muted-foreground">{label}</dt>
              <dd className="font-numeric text-300 font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <span className="text-200 text-muted-foreground" title={[...workspaceDetails, latestSync?.triggeredBy].filter(Boolean).join(" · ")}>
          Last synchronized: {syncFreshness}
        </span>
      </div>

      <section aria-labelledby="workspace-pulse-title">
        <div className="mb-m flex items-end justify-between gap-l">
          <div>
            <h2
              id="workspace-pulse-title"
              className="text-400 font-semibold"
            >
              Workspace pulse
            </h2>
            <p className="mt-xs text-200 text-muted-foreground">
              {targetsAvailable
                ? `${postureAtTarget} of ${posture.pillars.length} governance signals meet the current target.`
                : governancePolicyLoading
                  ? "Loading governance targets."
                  : "Governance targets are unavailable; current scores remain visible."}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onOpen({
                tab: "governance",
                focus: {
                  requestId: crypto.randomUUID(),
                  governanceSection: "posture",
                },
              })
            }
            className="atlas-control shrink-0 rounded-md px-s text-200 font-semibold text-brand-foreground hover:underline"
          >
            Open Governance Center
          </button>
        </div>
        {governancePolicyError && (
          <p role="alert" className="mb-m rounded-lg border border-destructive/30 bg-destructive/10 p-m text-200">
            {governancePolicyError} Open Governance Center to retry. Raw scores remain visible below.
          </p>
        )}
        <Card className="grid min-w-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.34fr)]">
          <div className="p-l">
            <div className="grid grid-cols-2 gap-l sm:grid-cols-3 xl:grid-cols-6">
              {posture.pillars.map((pillar) => {
                const previous = previousPosture?.pillars.find(
                  (candidate) => candidate.pillar === pillar.pillar,
                )?.score;
                const delta =
                  pillar.score != null && previous != null
                    ? pillar.score - previous
                    : null;
                return (
                  <button
                    key={pillar.pillar}
                    type="button"
                    onClick={() =>
                      onOpen({
                        tab: "governance",
                        focus: {
                          requestId: crypto.randomUUID(),
                          governanceSection: "posture",
                          filters: { pillar: pillar.pillar },
                        },
                      })
                    }
                    className="group flex min-h-[var(--atlas-touch-target)] min-w-0 flex-col items-center gap-s rounded-lg px-s py-m text-center transition-colors hover:bg-accent focus-visible:ring-inset focus-visible:ring-offset-0"
                    aria-label={`${pillar.pillar}: ${pillar.score == null ? "not available" : `${pillar.score}%`}. ${targetsAvailable ? `Target ${pillar.target}%` : "Target unavailable"}`}
                  >
                    <ScoreRing
                      value={pillar.score}
                      label={`${pillar.pillar} posture score`}
                    />
                    <span className="text-200 font-semibold capitalize">
                      {pillar.pillar}
                    </span>
                    <span className="text-100 text-muted-foreground">
                      {delta == null
                        ? targetsAvailable
                          ? `Target ${pillar.target}%`
                          : "No target"
                        : `${delta >= 0 ? "+" : ""}${delta} pts since previous`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              onOpen({
                tab: "governance",
                focus: {
                  requestId: crypto.randomUUID(),
                  governanceSection: "findings",
                  filters: { section: "findings", category: "operations" },
                },
              })
            }
            className="flex min-w-0 flex-col items-start justify-center gap-m border-t border-border bg-secondary/55 p-l text-left hover:bg-accent lg:border-l lg:border-t-0"
          >
            <span className="text-200 font-semibold text-muted-foreground">
              Operational coverage
            </span>
            <div className="flex items-center gap-l">
              <ScoreRing
                value={healthPercentage}
                label="Assessed item health"
                large
              />
              <span className="min-w-0">
                <span className={cn("inline-flex rounded-md border px-s py-xxs text-200 font-semibold", pulse.className)}>
                  {pulse.label}
                </span>
                <span className="mt-s block text-300 font-semibold">
                  {health.assessed} of {health.total} items assessed
                </span>
                <span className="mt-xxs block text-200 text-muted-foreground">
                  {attentionCount} need attention · synchronized {syncFreshness}
                </span>
              </span>
            </div>
            <span className="inline-flex items-center gap-s text-200 font-semibold text-brand-foreground">
              Review operational findings
              <ArrowRight className="icon-size-100" aria-hidden="true" />
            </span>
          </button>
        </Card>
      </section>

      <section aria-labelledby="priority-signals-title">
        <div className="mb-m flex items-end justify-between gap-l">
          <div>
            <h2 id="priority-signals-title" className="text-400 font-semibold">
              Priority signals
            </h2>
          </div>
          <span className="hidden text-200 text-muted-foreground sm:block">
            Collected workspace metadata
          </span>
        </div>
        <Card className="overflow-hidden">
          <div className="grid sm:grid-cols-2">
            {riskSignals.map((signal) => {
              const Icon = signal.icon;
              return (
                <button
                  type="button"
                  key={signal.label}
                  onClick={() => onOpen(signal.target)}
                  aria-label={`${signal.label}: ${signal.value}. ${signal.detail}`}
                  className="group flex items-center gap-m border-b border-border p-m text-left transition-colors hover:bg-accent sm:odd:border-r"
                >
                  <span
                    className={`flex icon-size-400 shrink-0 items-center justify-center ${signal.tone}`}
                  >
                    <Icon className="icon-size-200" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-s">
                      <span className="truncate text-300 font-semibold">
                        {signal.label}
                      </span>
                      <span
                        className={`font-numeric text-400 font-semibold tabular-nums ${signal.tone}`}
                      >
                        {signal.value}
                      </span>
                    </span>
                    <span className="mt-xs block truncate text-200 text-muted-foreground">
                      {signal.detail}
                    </span>
                  </span>
                  <ArrowRight
                    className="icon-size-200 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-xs motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        </Card>
      </section>

      <details className="rounded-lg border border-border">
        <summary className="min-h-[var(--atlas-touch-target)] cursor-pointer px-l py-m text-300 font-semibold hover:bg-accent">Metadata coverage</summary>
        <section aria-labelledby="governance-coverage-title" className="p-m">
        <div className="mb-m flex items-end justify-between gap-l">
          <div>
            <h2
              id="governance-coverage-title"
              className="text-400 font-semibold"
            >
              Metadata coverage
            </h2>
          </div>
          <button
            type="button"
            onClick={() =>
              onOpen({
                tab: "governance",
                focus: {
                  requestId: crypto.randomUUID(),
                  governanceSection: "coverage",
                },
              })
            }
            className="atlas-control shrink-0 rounded-md px-s text-200 font-semibold text-brand-foreground hover:underline"
          >
            Review labels
          </button>
        </div>
        <Card className="p-l sm:p-xl">
          {items.length ? (
            <div className="grid gap-xxl lg:grid-cols-5">
              <div className="flex flex-col gap-xl lg:col-span-3">
                {coverage.map((metric) => (
                  <div key={metric.label}>
                    <div className="mb-s flex items-end justify-between gap-l">
                      <div>
                        <div className="text-300 font-semibold">
                          {metric.label}
                        </div>
                        <div className="mt-xs text-200 text-muted-foreground">
                          {metric.detail}
                        </div>
                      </div>
                      <div className="atlas-score font-numeric text-400 font-semibold tabular-nums" data-score-band={scoreBand(metric.value)}>
                        {metric.value == null ? "N/A" : `${metric.value}%`}
                      </div>
                    </div>
                    <ScoreMeter label={`${metric.label} coverage`} value={metric.value} />
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => onOpen("assets")}
                className="group flex flex-col justify-between gap-l rounded-lg bg-secondary p-l text-left transition-colors hover:bg-accent lg:col-span-2"
              >
                <span>
                  <span className="flex items-center justify-between gap-l">
                    <span className="text-300 font-semibold">Object inventory</span>
                    <ArrowRight
                      className="icon-size-200 text-muted-foreground transition-transform group-hover:translate-x-xs motion-reduce:transition-none"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="mt-m block font-numeric text-hero-800 font-bold leading-hero-800 text-primary">
                    {assetCount}
                  </span>
                  <span className="mt-xs block text-200 text-muted-foreground">
                    tables, columns, and measures indexed
                  </span>
                </span>
                <span className="grid grid-cols-2 gap-l border-t border-border pt-l">
                  <span>
                    <span className="block font-numeric text-500 font-bold tabular-nums text-lineage-downstream">
                      {edges.length}
                    </span>
                    <span className="block text-200 text-muted-foreground">
                      lineage links
                    </span>
                  </span>
                  <span>
                    <span className="block font-numeric text-500 font-bold tabular-nums">
                      {items.length}
                    </span>
                    <span className="block text-200 text-muted-foreground">
                      Fabric items
                    </span>
                  </span>
                </span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-xxl text-center">
              <ShieldCheck
                className="icon-size-600 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="mt-m text-300 font-semibold">
                No governance coverage yet
              </p>
              <p className="mt-xs text-200 text-muted-foreground">
                Coverage appears after the workspace is indexed.
              </p>
            </div>
          )}
        </Card>
        </section>
      </details>

      <section aria-labelledby="activity-mix-title">
        <div className="mb-m flex items-end justify-between gap-l">
          <div>
            <h2 id="activity-mix-title" className="text-400 font-semibold">
              Recent activity &amp; item mix
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onOpen("jobs")}
            className="atlas-control shrink-0 rounded-md px-s text-200 font-semibold text-brand-foreground hover:underline"
          >
            View all jobs
          </button>
        </div>
        <Card className="overflow-hidden">
          <div className="grid lg:grid-cols-2">
            <div className="p-l sm:p-xl lg:border-r lg:border-border">
              <h3 className="text-300 font-semibold">Latest jobs</h3>
              {recentJobs.length ? (
                <div className="mt-m flex flex-col">
                  {recentJobs.map((job) => (
                    <div
                      key={`${job.itemFabricId}-${job.startedAt}-${job.jobType}`}
                      className="flex items-center gap-m border-b border-border py-m last:border-b-0"
                    >
                      <span
                        className={`icon-size-100 shrink-0 rounded-full ${JOB_TONE[job.status]}`}
                        title={job.status}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-300 font-semibold">
                          {job.itemName}
                        </div>
                        <div className="mt-xs truncate text-200 text-muted-foreground">
                          {job.jobType} · {job.status}
                        </div>
                      </div>
                      <span className="shrink-0 text-200 text-muted-foreground">
                        {relativeTime(job.startedAt)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-m rounded-xl border border-dashed border-border bg-muted/20 p-xl text-center">
                  <Clock3
                    className="mx-auto icon-size-500 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <p className="mt-s text-300 font-semibold">
                    No jobs recorded
                  </p>
                  <p className="mt-xs text-200 text-muted-foreground">
                    Recent Fabric activity will appear here.
                  </p>
                </div>
              )}
            </div>

            <div className="border-t border-border p-l sm:p-xl lg:border-t-0">
              <div className="flex items-center justify-between gap-l">
                <h3 className="text-300 font-semibold">Item mix</h3>
                <button
                  type="button"
                  onClick={() => onOpen("catalog")}
                  className="text-200 font-semibold text-primary hover:underline"
                >
                  Open catalog
                </button>
              </div>
              {byType.length ? (
                <div className="mt-m flex flex-col gap-s">
                  {byType.slice(0, 5).map(([type, count]) => (
                    <button
                      type="button"
                      key={type}
                      onClick={() =>
                        onOpen({
                          tab: "catalog",
                          focus: {
                            requestId: crypto.randomUUID(),
                            filters: { type },
                          },
                        })
                      }
                      aria-label={`View ${count} ${typeMeta(type).label} items in catalog`}
                      className="group flex items-center gap-m rounded-xl p-s text-left transition-colors hover:bg-accent"
                    >
                      <TypeGlyph type={type} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-s">
                          <span className="truncate text-300 font-semibold">
                            {typeMeta(type).label}
                          </span>
                          <span className="font-numeric text-300 font-bold tabular-nums">
                            {count}
                          </span>
                        </span>
                        <span className="mt-s block h-xs overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-primary transition-colors group-hover:bg-lineage-downstream"
                            style={{ width: `${(count / maxType) * 100}%` }}
                          />
                        </span>
                      </span>
                    </button>
                  ))}
                  {byType.length > 5 && (
                    <p className="px-s pt-s text-200 text-muted-foreground">
                      {byType.length - 5} more item{" "}
                      {byType.length - 5 === 1 ? "type" : "types"} in the
                      catalog
                    </p>
                  )}
                </div>
              ) : (
                <div className="mt-m rounded-xl border border-dashed border-border bg-muted/20 p-xl text-center">
                  <Boxes
                    className="mx-auto icon-size-500 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <p className="mt-s text-300 font-semibold">
                    No items indexed
                  </p>
                  <p className="mt-xs text-200 text-muted-foreground">
                    The item mix will populate after a successful sync.
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>
      </section>
    </section>
  );
}
