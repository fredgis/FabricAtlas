import { useMemo } from "react";
import type {
  AtlasNavigation,
  Tab,
} from "@/atlas/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  Clock3,
  Compass,
  FolderTree,
  LockKeyhole,
  ShieldCheck,
  Users,
  Waypoints,
} from "lucide-react";
import { useAtlas } from "../store";
import { Card, SectionLabel, TypeGlyph } from "../ui";
import {
  typeMeta,
  relativeTime,
  schemaFor,
  type Health,
  type ItemType,
  type JobStatus,
} from "../model";

const JOB_TONE: Record<JobStatus, string> = {
  completed: "bg-status-healthy",
  failed: "bg-status-failing",
  running: "bg-primary",
  cancelled: "bg-lineage-neutral",
};

export function OverviewView({
  onOpen,
}: {
  onOpen: (target: Tab | AtlasNavigation) => void;
}) {
  const { data, lastSyncedAt } = useAtlas();
  const { items, principals, jobs, syncRuns, grants, edges } = data;

  const health = useMemo(() => {
    const counts: Record<Health, number> = {
      healthy: 0,
      stale: 0,
      failing: 0,
      unknown: 0,
    };
    items.forEach((item) => {
      counts[item.health] += 1;
    });
    return counts;
  }, [items]);

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
  const endorsed = items.filter((item) => item.endorsement !== "none");
  const labeled = items.filter((item) => item.sensitivity);
  const owned = items.filter((item) => item.ownerName);
  const external = principals.filter((principal) => principal.external);
  const workspacePrincipals = new Set(
    grants
      .filter((grant) => !grant.itemFabricId)
      .map((grant) => grant.principalRef),
  );
  const itemOnly = principals.filter(
    (principal) => !workspacePrincipals.has(principal.displayName),
  );
  const attentionCount = health.stale + health.failing;
  const percentage = (count: number) =>
    Math.round((count / (items.length || 1)) * 100);
  const healthPercentage = items.length
    ? percentage(health.healthy)
    : undefined;
  const syncFreshness = lastSyncedAt
    ? relativeTime(lastSyncedAt)
    : "Not synced yet";
  const workspaceDetails = [
    data.workspace.capacity,
    data.workspace.region,
  ].filter(Boolean);

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
              "border-status-warning/30 bg-status-warning/10 text-status-warning",
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
      detail: `${endorsed.length} of ${items.length} items`,
      value: percentage(endorsed.length),
      tone: "bg-lineage-downstream",
    },
    {
      label: "Sensitivity labels",
      detail: `${labeled.length} of ${items.length} items`,
      value: percentage(labeled.length),
      tone: "bg-lineage-upstream",
    },
    {
      label: "Owner assignment",
      detail: `${owned.length} of ${items.length} items`,
      value: percentage(owned.length),
      tone: "bg-primary",
    },
  ];

  const riskSignals = [
    {
      label: "Needs attention",
      value: attentionCount,
      detail: `${health.failing} failing · ${health.stale} stale`,
      tab: "jobs" as Tab,
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
      tab: "access" as Tab,
      icon: Users,
      tone:
        external.length > 0
          ? "text-status-failing"
          : "text-status-healthy",
    },
    {
      label: "Confidential items",
      value: confidential.length,
      detail: `${labeled.length} items labeled`,
      tab: "governance" as Tab,
      icon: LockKeyhole,
      tone: "text-lineage-upstream",
    },
    {
      label: "Item-only access",
      value: itemOnly.length,
      detail: `${grants.length} grants indexed`,
      tab: "access" as Tab,
      icon: ShieldCheck,
      tone:
        itemOnly.length > 0
          ? "text-status-warning"
          : "text-status-healthy",
    },
  ];

  return (
    <main className="flex flex-col gap-xxl p-l sm:p-xxl">
      <Card className="atlas-overview-hero relative isolate overflow-hidden border-border shadow-fabric-4">
        <div className="grid lg:grid-cols-5">
          <div className="flex flex-col justify-between gap-xxxl p-xl sm:p-xxl lg:col-span-3 lg:p-xxxl">
            <div>
              <div className="flex items-center gap-m">
                <span className="atlas-brand-mark flex icon-size-700 shrink-0 items-center justify-center rounded-xl text-primary-foreground">
                  <Compass className="icon-size-400" aria-hidden="true" />
                </span>
                <div>
                  <SectionLabel>Fabric Atlas</SectionLabel>
                  <div className="mt-xs text-200 font-semibold text-muted-foreground">
                    Governance overview
                  </div>
                </div>
              </div>

              <h1 className="atlas-overview-title mt-xl text-balance font-heading text-hero-800 font-bold leading-hero-800 sm:text-hero-900 sm:leading-hero-900">
                {data.workspace.displayName || "Fabric workspace"}
              </h1>
              <p className="atlas-overview-copy mt-m text-400 leading-500 text-muted-foreground">
                See what is governed, what needs attention, and where to act
                across this workspace.
              </p>
              {workspaceDetails.length > 0 && (
                <p className="mt-s text-200 text-muted-foreground">
                  {workspaceDetails.join(" · ")}
                </p>
              )}
            </div>

            <nav
              aria-label="Overview destinations"
              className="grid gap-s sm:grid-cols-3"
            >
              <button
                type="button"
                onClick={() => onOpen("map")}
                className="group inline-flex items-center justify-between gap-s rounded-md bg-primary px-l py-m text-300 font-semibold text-primary-foreground shadow-fabric-2 transition-colors hover:bg-primary-hover"
              >
                <span className="inline-flex items-center gap-s">
                  <Waypoints className="icon-size-200" aria-hidden="true" />
                  Map
                </span>
                <ArrowRight
                  className="icon-size-200 transition-transform group-hover:translate-x-xs motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                onClick={() => onOpen("catalog")}
                className="group inline-flex items-center justify-between gap-s rounded-md border border-border bg-card px-l py-m text-300 font-semibold transition-colors hover:border-primary/40 hover:bg-accent"
              >
                <span className="inline-flex items-center gap-s">
                  <FolderTree className="icon-size-200" aria-hidden="true" />
                  Catalog
                </span>
                <ArrowRight
                  className="icon-size-200 text-muted-foreground transition-transform group-hover:translate-x-xs motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                onClick={() => onOpen("access")}
                className="group inline-flex items-center justify-between gap-s rounded-md border border-border bg-card px-l py-m text-300 font-semibold transition-colors hover:border-primary/40 hover:bg-accent"
              >
                <span className="inline-flex items-center gap-s">
                  <ShieldCheck className="icon-size-200" aria-hidden="true" />
                  Access
                </span>
                <ArrowRight
                  className="icon-size-200 text-muted-foreground transition-transform group-hover:translate-x-xs motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </button>
            </nav>
          </div>

          <aside className="flex flex-col justify-center gap-xl border-t border-border bg-secondary/70 p-xl sm:p-xxl lg:col-span-2 lg:border-l lg:border-t-0 lg:p-xxxl">
            <div className="flex items-center gap-l">
              <span
                className={`relative flex icon-size-600 shrink-0 items-center justify-center rounded-full border ${pulse.className}`}
                aria-hidden="true"
              >
                <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-10 motion-reduce:hidden" />
                <Activity className="icon-size-300" />
              </span>
              <div>
                <SectionLabel>Health pulse</SectionLabel>
                <div className="mt-xs flex items-baseline gap-s">
                  <span className="font-numeric text-hero-800 font-bold leading-hero-800">
                    {healthPercentage == null ? "—" : `${healthPercentage}%`}
                  </span>
                  <span className="text-300 font-semibold">{pulse.label}</span>
                </div>
                <p className="mt-xs text-200 text-muted-foreground">
                  {items.length
                    ? `${health.healthy} of ${items.length} items healthy`
                    : "Health appears after the workspace is indexed"}
                </p>
              </div>
            </div>

            <div className="h-px bg-border" />

            <div className="flex items-center gap-l">
              <span className="flex icon-size-600 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Clock3 className="icon-size-300" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <SectionLabel>Sync freshness</SectionLabel>
                <div className="mt-xs text-400 font-semibold">
                  {syncFreshness}
                </div>
                <p className="mt-xs truncate text-200 text-muted-foreground">
                  {latestSync?.triggeredBy
                    ? `Triggered by ${latestSync.triggeredBy}`
                    : latestSync
                      ? `Latest run ${latestSync.status}`
                      : "No sync runs recorded"}
                </p>
              </div>
            </div>
          </aside>
        </div>
      </Card>

      <section aria-labelledby="priority-signals-title">
        <div className="mb-m flex items-end justify-between gap-l">
          <div>
            <SectionLabel>Priority signals</SectionLabel>
            <h2 id="priority-signals-title" className="mt-xs text-500 font-semibold">
              What deserves a closer look
            </h2>
          </div>
          <span className="hidden text-200 text-muted-foreground sm:block">
            Live workspace index
          </span>
        </div>
        <Card className="overflow-hidden">
          <div className="grid sm:grid-cols-2 xl:grid-cols-4">
            {riskSignals.map((signal) => {
              const Icon = signal.icon;
              return (
                <button
                  type="button"
                  key={signal.label}
                  onClick={() => onOpen(signal.tab)}
                  aria-label={`${signal.label}: ${signal.value}. ${signal.detail}`}
                  className="group flex items-center gap-m border-b border-border p-l text-left transition-colors hover:bg-accent sm:odd:border-r xl:border-b-0 xl:border-r xl:last:border-r-0"
                >
                  <span
                    className={`flex icon-size-600 shrink-0 items-center justify-center rounded-xl bg-muted ${signal.tone}`}
                  >
                    <Icon className="icon-size-200" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-s">
                      <span className="truncate text-300 font-semibold">
                        {signal.label}
                      </span>
                      <span
                        className={`font-numeric text-500 font-bold tabular-nums ${signal.tone}`}
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

      <section aria-labelledby="governance-coverage-title">
        <div className="mb-m flex items-end justify-between gap-l">
          <div>
            <SectionLabel>Governance coverage</SectionLabel>
            <h2
              id="governance-coverage-title"
              className="mt-xs text-500 font-semibold"
            >
              Essential controls across the inventory
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
            className="shrink-0 text-200 font-semibold text-primary hover:underline"
          >
            Review labels
          </button>
        </div>
        <Card className="p-xl sm:p-xxl">
          {items.length ? (
            <div className="grid gap-xxxl lg:grid-cols-5">
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
                      <div className="font-numeric text-500 font-bold tabular-nums">
                        {metric.value}%
                      </div>
                    </div>
                    <div
                      className="h-s overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-label={`${metric.label} coverage`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={metric.value}
                    >
                      <div
                        className={`h-full rounded-full ${metric.tone}`}
                        style={{ width: `${metric.value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => onOpen("assets")}
                className="group flex flex-col justify-between gap-xl rounded-xl border border-border bg-muted/30 p-l text-left transition-colors hover:border-primary/40 hover:bg-accent lg:col-span-2"
              >
                <span>
                  <span className="flex items-center justify-between gap-l">
                    <SectionLabel>Inventory reach</SectionLabel>
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

      <section aria-labelledby="activity-mix-title">
        <div className="mb-m flex items-end justify-between gap-l">
          <div>
            <SectionLabel>Recent activity &amp; item mix</SectionLabel>
            <h2 id="activity-mix-title" className="mt-xs text-500 font-semibold">
              What is changing in the workspace
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onOpen("jobs")}
            className="shrink-0 text-200 font-semibold text-primary hover:underline"
          >
            View all jobs
          </button>
        </div>
        <Card className="overflow-hidden">
          <div className="grid lg:grid-cols-2">
            <div className="p-xl sm:p-xxl lg:border-r lg:border-border">
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

            <div className="border-t border-border p-xl sm:p-xxl lg:border-t-0">
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
                      onClick={() => onOpen("catalog")}
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
    </main>
  );
}
