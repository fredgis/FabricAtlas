import { useMemo, type CSSProperties } from "react";
import type { Tab } from "@/App";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Boxes,
  Clock3,
  FolderTree,
  LockKeyhole,
  ShieldCheck,
  Users,
  Waypoints,
} from "lucide-react";
import { useAtlas } from "../store";
import { Avatar, Card, HealthDot, SectionLabel, TypeGlyph } from "../ui";
import {
  typeMeta,
  relativeTime,
  schemaFor,
  type Health,
  type ItemType,
  type JobStatus,
} from "../model";

const HEALTH_TONE: Record<Health, string> = {
  healthy: "bg-status-healthy",
  stale: "bg-status-warning",
  failing: "bg-status-failing",
  unknown: "bg-lineage-neutral",
};

const JOB_TONE: Record<JobStatus, string> = {
  completed: "bg-status-healthy",
  failed: "bg-status-failing",
  running: "bg-primary",
  cancelled: "bg-lineage-neutral",
};

export function OverviewView({ onOpen }: { onOpen: (t: Tab) => void }) {
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
        .slice(0, 6),
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

  const owners = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((item) => {
      if (item.ownerName) {
        counts.set(item.ownerName, (counts.get(item.ownerName) ?? 0) + 1);
      }
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

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
      tab: "sensitivity" as Tab,
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
    <div className="flex flex-col gap-xl p-l sm:p-xxl">
      <Card className="atlas-overview-hero relative isolate overflow-hidden border-primary/30 shadow-2xl">
        <div className="atlas-overview-beam" aria-hidden="true" />
        <div className="grid lg:grid-cols-5">
          <div className="flex flex-col justify-between gap-xxxl p-xl sm:p-xxl lg:col-span-3 lg:p-xxxl">
            <div>
              <div className="mb-l flex flex-wrap items-center gap-s">
                <span className="inline-flex items-center gap-s rounded-full border border-primary/30 bg-primary/10 px-m py-s text-200 font-semibold uppercase tracking-wide text-primary">
                  <Activity className="icon-size-100" aria-hidden="true" />
                  Governance command center
                </span>
                <span
                  className={`inline-flex items-center gap-s rounded-full border px-m py-s text-200 font-semibold ${pulse.className}`}
                >
                  <span className="relative flex">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-30" />
                    <span className="relative inline-flex icon-size-100 rounded-full bg-current" />
                  </span>
                  {pulse.label}
                </span>
              </div>

              <SectionLabel>Workspace</SectionLabel>
              <h1 className="atlas-overview-title mt-s text-balance font-heading text-hero-800 font-bold leading-hero-800 sm:text-hero-900 sm:leading-hero-900">
                {data.workspace.displayName || "Fabric workspace"}
              </h1>
              <p className="atlas-overview-copy mt-m text-300 leading-300 text-muted-foreground">
                {items.length} {items.length === 1 ? "item" : "items"} across{" "}
                {byType.length} {byType.length === 1 ? "type" : "types"}, with{" "}
                {assetCount} indexed data {assetCount === 1 ? "asset" : "assets"}.
                {workspaceDetails.length > 0
                  ? ` ${workspaceDetails.join(" · ")}.`
                  : ""}
              </p>
            </div>

            <div className="flex flex-col gap-m sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={() => onOpen("map")}
                aria-label="Open workspace map and lineage"
                className="inline-flex items-center justify-center gap-s rounded-lg bg-primary px-l py-m text-300 font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                <Waypoints className="icon-size-200" aria-hidden="true" />
                Explore map
                <ArrowRight className="icon-size-200" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onOpen("catalog")}
                aria-label="Open workspace catalog"
                className="inline-flex items-center justify-center gap-s rounded-lg border border-border bg-background px-l py-m text-300 font-semibold transition-colors hover:border-primary/40 hover:bg-accent"
              >
                <FolderTree className="icon-size-200" aria-hidden="true" />
                Browse catalog
              </button>
              <button
                type="button"
                onClick={() => onOpen("access")}
                aria-label="Open workspace access controls"
                className="inline-flex items-center justify-center gap-s rounded-lg border border-border bg-background px-l py-m text-300 font-semibold transition-colors hover:border-primary/40 hover:bg-accent"
              >
                <ShieldCheck className="icon-size-200" aria-hidden="true" />
                Review access
              </button>
            </div>
          </div>

          <div className="relative flex flex-col justify-between gap-xxl border-t border-border/70 bg-background/35 p-xl backdrop-blur-sm sm:p-xxl lg:col-span-2 lg:border-l lg:border-t-0 lg:p-xxxl">
            <div>
              <SectionLabel>Governance pulse</SectionLabel>
              <div className="mt-l flex flex-col items-center gap-xl xl:flex-row">
                <div
                  className="atlas-pulse-dial shrink-0"
                  style={
                    {
                      "--pulse": `${healthPercentage ?? 0}%`,
                    } as CSSProperties
                  }
                >
                  <div className="atlas-pulse-core">
                    <div>
                      <div className="font-numeric text-hero-800 font-bold leading-hero-800 text-primary">
                        {healthPercentage == null ? "—" : healthPercentage}
                        {healthPercentage != null && (
                          <span className="text-400">%</span>
                        )}
                      </div>
                      <div className="mt-xs text-200 font-semibold text-muted-foreground">
                        healthy inventory
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid w-full grid-cols-2 gap-s">
                  {(Object.entries(health) as [Health, number][]).map(
                    ([status, count]) => (
                      <div
                        key={status}
                        className="rounded-xl border border-border bg-card/65 p-m"
                      >
                        <div className="flex items-center gap-s">
                          <span
                            className={`icon-size-100 rounded-full ${HEALTH_TONE[status]}`}
                          />
                          <span className="text-200 font-semibold capitalize text-muted-foreground">
                            {status}
                          </span>
                        </div>
                        <div className="mt-s font-numeric text-500 font-bold">
                          {count}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-border/70 pt-l">
              <div className="flex items-start gap-m">
                <span className="flex icon-size-600 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Clock3 className="icon-size-200" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="text-200 font-semibold uppercase tracking-wide text-muted-foreground">
                    Sync freshness
                  </div>
                  <div className="mt-xs text-400 font-semibold">
                    {syncFreshness}
                  </div>
                  <div className="mt-xs truncate text-200 text-muted-foreground">
                    {latestSync?.triggeredBy
                      ? `Triggered by ${latestSync.triggeredBy}`
                      : latestSync
                        ? `Latest run ${latestSync.status}`
                        : "No sync runs recorded"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <section aria-labelledby="attention-title">
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-s border-b border-border bg-muted/40 px-l py-m sm:flex-row sm:items-center sm:justify-between">
            <div>
              <SectionLabel>Attention strip</SectionLabel>
              <h2 id="attention-title" className="mt-xs text-400 font-semibold">
                {attentionCount || external.length || itemOnly.length
                  ? "Signals worth reviewing"
                  : "No immediate governance signals"}
              </h2>
            </div>
            <span className="inline-flex items-center gap-s text-200 text-muted-foreground">
              <BadgeCheck
                className="icon-size-200 text-status-healthy"
                aria-hidden="true"
              />
              Live workspace index
            </span>
          </div>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4">
            {riskSignals.map((signal) => {
              const Icon = signal.icon;
              return (
                <button
                  type="button"
                  key={signal.label}
                  onClick={() => onOpen(signal.tab)}
                  aria-label={`Open ${signal.label.toLowerCase()}`}
                  className="group flex items-center gap-m border-b border-border p-l text-left transition-colors hover:bg-accent sm:odd:border-r xl:border-b-0 xl:border-r xl:last:border-r-0"
                >
                  <span
                    className={`flex icon-size-600 shrink-0 items-center justify-center rounded-lg bg-muted ${signal.tone}`}
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
                    className="icon-size-200 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-xs"
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        </Card>
      </section>

      <div className="grid gap-xl xl:grid-cols-12">
        <Card className="p-xl xl:col-span-7">
          <div className="flex items-start justify-between gap-l">
            <div>
              <SectionLabel>Governance coverage</SectionLabel>
              <h2 className="mt-xs text-500 font-semibold">
                Controls across the inventory
              </h2>
            </div>
            <button
              type="button"
              className="shrink-0 text-200 font-semibold text-primary hover:underline"
              onClick={() => onOpen("sensitivity")}
            >
              Review labels
            </button>
          </div>

          <div className="mt-xl grid gap-xxl md:grid-cols-5">
            <div className="flex flex-col gap-xl md:col-span-3">
              {coverage.map((metric) => (
                <div key={metric.label}>
                  <div className="mb-s flex items-end justify-between gap-l">
                    <div>
                      <div className="text-300 font-semibold">{metric.label}</div>
                      <div className="mt-xs text-200 text-muted-foreground">
                        {metric.detail}
                      </div>
                    </div>
                    <div className="font-numeric text-500 font-bold tabular-nums">
                      {metric.value}%
                    </div>
                  </div>
                  <div className="h-s overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${metric.tone}`}
                      style={{ width: `${metric.value}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col justify-between gap-l rounded-xl border border-border bg-muted/30 p-l md:col-span-2">
              <div>
                <SectionLabel>Inventory reach</SectionLabel>
                <div className="mt-s font-numeric text-hero-800 font-bold leading-hero-800 text-primary">
                  {assetCount}
                </div>
                <div className="text-200 text-muted-foreground">
                  tables, columns, and measures indexed
                </div>
              </div>
              <div className="grid grid-cols-2 gap-m border-t border-border pt-l">
                <div>
                  <div className="font-numeric text-500 font-bold tabular-nums text-lineage-downstream">
                    {edges.length}
                  </div>
                  <div className="text-200 text-muted-foreground">
                    lineage links
                  </div>
                </div>
                <div>
                  <div className="font-numeric text-500 font-bold tabular-nums text-primary">
                    {grants.length}
                  </div>
                  <div className="text-200 text-muted-foreground">
                    access grants
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpen("assets")}
                className="inline-flex items-center justify-between gap-s rounded-lg border border-border bg-background px-m py-s text-200 font-semibold transition-colors hover:border-primary/40 hover:bg-accent"
              >
                Open asset catalog
                <ArrowRight className="icon-size-200" aria-hidden="true" />
              </button>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col p-xl xl:col-span-5">
          <div className="flex items-start justify-between gap-l">
            <div>
              <SectionLabel>Health posture</SectionLabel>
              <h2 className="mt-xs text-500 font-semibold">
                Workspace reliability
              </h2>
            </div>
            <button
              type="button"
              className="shrink-0 text-200 font-semibold text-primary hover:underline"
              onClick={() => onOpen("jobs")}
            >
              Open jobs
            </button>
          </div>

          {items.length ? (
            <div className="mt-xl flex flex-1 flex-col justify-between gap-xl">
              <div className="flex items-end justify-between gap-l rounded-xl bg-muted/30 p-l">
                <div>
                  <div className="text-200 font-semibold uppercase tracking-wide text-muted-foreground">
                    Healthy inventory
                  </div>
                  <div className="mt-xs font-numeric text-hero-900 font-bold leading-hero-900 text-status-healthy">
                    {healthPercentage}%
                  </div>
                </div>
                <Activity
                  className="icon-size-700 text-status-healthy"
                  aria-hidden="true"
                />
              </div>
              <div className="flex flex-col gap-m">
                {(Object.entries(health) as [Health, number][]).map(
                  ([status, count]) => (
                    <div key={status} className="flex items-center gap-m">
                      <HealthDot health={status} />
                      <span className="w-1/4 text-300 font-semibold capitalize">
                        {status}
                      </span>
                      <div className="h-s flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${HEALTH_TONE[status]}`}
                          style={{ width: `${percentage(count)}%` }}
                        />
                      </div>
                      <span className="w-xl text-right font-numeric text-300 font-bold tabular-nums">
                        {count}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>
          ) : (
            <div className="mt-xl flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-xxl text-center">
              <Activity
                className="icon-size-600 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="mt-m text-300 font-semibold">No health data yet</p>
              <p className="mt-xs text-200 text-muted-foreground">
                Item health will appear after the workspace is indexed.
              </p>
            </div>
          )}
        </Card>

        <Card className="p-xl xl:col-span-7">
          <div className="flex items-start justify-between gap-l">
            <div>
              <SectionLabel>Item mix</SectionLabel>
              <h2 className="mt-xs text-500 font-semibold">
                Fabric estate composition
              </h2>
            </div>
            <button
              type="button"
              className="shrink-0 text-200 font-semibold text-primary hover:underline"
              onClick={() => onOpen("catalog")}
            >
              View catalog
            </button>
          </div>

          {byType.length ? (
            <div className="mt-xl grid gap-m md:grid-cols-2">
              {byType.map(([type, count]) => (
                <button
                  type="button"
                  key={type}
                  onClick={() => onOpen("catalog")}
                  aria-label={`View ${typeMeta(type).label} items in catalog`}
                  className="group flex items-center gap-m rounded-xl border border-transparent p-s text-left transition-colors hover:border-border hover:bg-accent"
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
                        className="block h-full rounded-full bg-primary transition-all group-hover:bg-lineage-downstream"
                        style={{ width: `${(count / maxType) * 100}%` }}
                      />
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-xl rounded-xl border border-dashed border-border bg-muted/20 p-xxl text-center">
              <Boxes
                className="mx-auto icon-size-600 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="mt-m text-300 font-semibold">No items indexed</p>
              <p className="mt-xs text-200 text-muted-foreground">
                The item mix will populate after a successful sync.
              </p>
            </div>
          )}
        </Card>

        <Card className="flex flex-col p-xl xl:col-span-5">
          <div className="flex items-start justify-between gap-l">
            <div>
              <SectionLabel>Recent activity</SectionLabel>
              <h2 className="mt-xs text-500 font-semibold">Jobs and owners</h2>
            </div>
            <button
              type="button"
              className="shrink-0 text-200 font-semibold text-primary hover:underline"
              onClick={() => onOpen("jobs")}
            >
              View all
            </button>
          </div>

          <div className="mt-xl flex flex-1 flex-col">
            {recentJobs.length ? (
              <div className="flex flex-col">
                {recentJobs.map((job) => (
                  <div
                    key={`${job.itemFabricId}-${job.startedAt}-${job.jobType}`}
                    className="flex items-center gap-m border-b border-border py-m first:pt-0"
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
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-l text-center">
                <Clock3
                  className="mx-auto icon-size-500 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="mt-s text-300 font-semibold">No jobs recorded</p>
                <p className="mt-xs text-200 text-muted-foreground">
                  Recent Fabric activity will appear here.
                </p>
              </div>
            )}

            <div className="mt-auto border-t border-border pt-l">
              <div className="mb-m flex items-center justify-between gap-l">
                <SectionLabel>Ownership</SectionLabel>
                <button
                  type="button"
                  className="text-200 font-semibold text-primary hover:underline"
                  onClick={() => onOpen("access")}
                >
                  Open access
                </button>
              </div>
              {owners.length ? (
                <div className="flex flex-wrap items-center gap-m">
                  {owners.slice(0, 5).map(([name, count]) => (
                    <div key={name} className="flex items-center gap-s">
                      <Avatar name={name} />
                      <div>
                        <div className="atlas-owner-name truncate text-200 font-semibold">
                          {name}
                        </div>
                        <div className="text-100 text-muted-foreground">
                          {count} {count === 1 ? "item" : "items"}
                        </div>
                      </div>
                    </div>
                  ))}
                  {owners.length > 5 && (
                    <button
                      type="button"
                      onClick={() => onOpen("access")}
                      className="rounded-full border border-border bg-muted px-m py-s text-200 font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label={`View ${owners.length - 5} more owners`}
                    >
                      +{owners.length - 5} more
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-200 text-muted-foreground">
                  Owner metadata is not available yet.
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
