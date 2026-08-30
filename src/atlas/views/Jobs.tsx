import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Ban,
  CheckCircle2,
  Clock3,
  Gauge,
  FilterX,
  Loader2,
  PlayCircle,
  Search,
  XCircle,
} from "lucide-react";
import type { AtlasFocusRequest, AtlasNavigation } from "../navigation";
import { SavedViewsMenu } from "../components/SavedViewsMenu";
import { searchJobId } from "../search";
import { useAtlas } from "../store";
import { Card, SectionLabel, TypeGlyph } from "../ui";
import { relativeTime, type Item, type Job, type JobStatus } from "../model";

const STATUS: Record<
  JobStatus,
  { icon: typeof CheckCircle2; label: string; className: string }
> = {
  completed: {
    icon: CheckCircle2,
    label: "Completed",
    className: "border-status-healthy/30 bg-status-healthy/10 text-status-healthy",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    className: "border-status-failing/30 bg-status-failing/10 text-status-failing",
  },
  running: {
    icon: Loader2,
    label: "Running",
    className: "border-primary/30 bg-primary/10 text-primary",
  },
  cancelled: {
    icon: Ban,
    label: "Cancelled",
    className: "border-border bg-muted text-muted-foreground",
  },
};

function duration(sec: number, status: JobStatus): string {
  if (status === "running") return "In progress";
  if (sec <= 0) return "—";
  if (sec < 60) return `${sec}s`;
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function dateGroup(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown date";

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDifference = Math.round(
    (startOfToday.valueOf() - startOfDate.valueOf()) / (24 * 60 * 60 * 1000),
  );

  if (dayDifference === 0) return "Today";
  if (dayDifference === 1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}

export function JobsView({
  focus,
  onStateChange,
}: {
  focus?: AtlasFocusRequest;
  onStateChange?: (navigation: AtlasNavigation) => void;
} = {}) {
  const {
    data,
    savedViews,
    savedViewsLoading,
    savedViewsError,
    addSavedView,
    removeSavedView,
  } = useAtlas();
  const { jobs, items } = data;
  const [query, setQuery] = useState(
    focus?.itemId ? "" : focus?.query ?? "",
  );
  const [focusedItemId, setFocusedItemId] = useState(
    focus?.itemId ?? "",
  );
  const [focusedJobId, setFocusedJobId] = useState(
    focus?.jobId ?? "",
  );
  const [statusFilter, setStatusFilter] = useState<JobStatus | "all">(
    typeof focus?.filters?.status === "string"
      ? (focus.filters.status as JobStatus)
      : "all",
  );

  useEffect(() => {
    onStateChange?.({
      tab: "jobs",
      focus: {
        requestId: "jobs-view-state",
        itemId: focusedItemId || undefined,
        jobId: focusedJobId || undefined,
        query: query.trim() || undefined,
        filters: { search: query, status: statusFilter },
      },
    });
  }, [
    focusedItemId,
    focusedJobId,
    onStateChange,
    query,
    statusFilter,
  ]);

  const itemById = useMemo(
    () => new Map<string, Item>(items.map((item) => [item.fabricId, item])),
    [items],
  );

  const filteredJobs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return jobs.filter(
      (job) =>
        (statusFilter === "all" || job.status === statusFilter) &&
        (!focusedItemId || job.itemFabricId === focusedItemId) &&
        (!focusedJobId ||
          searchJobId(job.itemFabricId, job.jobType, job.startedAt) ===
            focusedJobId) &&
        (!normalized ||
          job.itemName.toLowerCase().includes(normalized) ||
          job.jobType.toLowerCase().includes(normalized) ||
          job.status.toLowerCase().includes(normalized) ||
          (job.message ?? "").toLowerCase().includes(normalized)),
    );
  }, [focusedItemId, focusedJobId, jobs, query, statusFilter]);

  const groupedJobs = useMemo(() => {
    const sorted = [...filteredJobs].sort(
      (a, b) => +new Date(b.startedAt) - +new Date(a.startedAt),
    );
    const groups = new Map<string, Job[]>();
    sorted.forEach((job) => {
      const label = dateGroup(job.startedAt);
      const group = groups.get(label) ?? [];
      group.push(job);
      groups.set(label, group);
    });
    return [...groups.entries()];
  }, [filteredJobs]);

  const summary = useMemo(() => {
    const completed = jobs.filter((job) => job.status === "completed");
    const failed = jobs.filter((job) => job.status === "failed").length;
    const active = jobs.filter((job) => job.status === "running").length;
    const averageSeconds = completed.length
      ? Math.round(
          completed.reduce((total, job) => total + job.durationSec, 0) /
            completed.length,
        )
      : 0;

    return {
      runs: jobs.length,
      completed: completed.length,
      failed,
      active,
      averageSeconds,
    };
  }, [jobs]);

  const metrics = [
    { label: "Recent runs", value: summary.runs, icon: PlayCircle },
    {
      label: "Successful",
      value: summary.completed,
      icon: CheckCircle2,
      valueClassName: "text-status-healthy",
    },
    {
      label: "Failures",
      value: summary.failed,
      icon: XCircle,
      valueClassName: summary.failed ? "text-status-failing" : "text-foreground",
    },
    {
      label: "Active now",
      value: summary.active,
      icon: Activity,
      valueClassName: summary.active ? "text-primary" : "text-foreground",
    },
    {
      label: "Average duration",
      value: duration(summary.averageSeconds, "completed"),
      icon: Gauge,
    },
  ];

  return (
    <div className="atlas-content-frame flex flex-col gap-xl p-xl lg:p-xxl">
      <header className="border-l border-primary pl-l">
        <SectionLabel>Operations / run history</SectionLabel>
        <div className="mt-s flex flex-col gap-s lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-heading text-600 leading-600 font-bold">
              Jobs &amp; health
            </h1>
            <p className="mt-xs text-300 leading-300 text-muted-foreground">
              Refreshes, pipeline runs and notebook activity across this workspace.
            </p>
          </div>
          <div className="flex items-center gap-s text-200 leading-200 text-muted-foreground">
            <Clock3 className="icon-size-200" aria-hidden="true" />
            Ordered by most recent start time
          </div>
        </div>
      </header>

      <section
        aria-label="Job health summary"
        className="grid grid-cols-1 gap-m sm:grid-cols-2 xl:grid-cols-5"
      >
        {metrics.map(({ label, value, icon: Icon, valueClassName }) => (
          <Card key={label} className="border-t border-t-primary/40 p-l">
            <div className="flex items-center justify-between gap-s">
              <SectionLabel>{label}</SectionLabel>
              <Icon className="icon-size-200 text-muted-foreground" aria-hidden="true" />
            </div>
            <div
              className={`mt-m font-numeric text-hero-700 leading-hero-700 font-bold tabular-nums ${
                valueClassName ?? "text-foreground"
              }`}
            >
              {value}
            </div>
          </Card>
        ))}
      </section>

      <section aria-labelledby="run-history-title">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-m border-b border-border px-l py-m">
            <div>
              <h2 id="run-history-title" className="text-400 leading-400 font-semibold">
                Run history
              </h2>
              <p className="mt-xs text-200 leading-200 text-muted-foreground">
                {filteredJobs.length
                  ? `${filteredJobs.length} of ${jobs.length} recorded runs`
                  : "No recorded runs"}
              </p>
            </div>
            {summary.failed > 0 && (
              <span className="inline-flex items-center gap-xs rounded-full border border-status-failing/30 bg-status-failing/10 px-s py-xs text-200 font-semibold text-status-failing">
                <XCircle className="icon-size-100" aria-hidden="true" />
                {summary.failed} require attention
              </span>
            )}
          </div>

          <div className="flex flex-col gap-s border-b border-border bg-secondary/60 px-l py-s sm:flex-row sm:items-center">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search job history</span>
              <Search className="icon-size-200 pointer-events-none absolute left-m top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search item, job type, status or error"
                className="h-9 w-full rounded-lg border border-input bg-card pl-xxxl pr-m text-300"
              />
            </label>
            <select
              aria-label="Filter jobs by status"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as JobStatus | "all")
              }
              className="h-9 rounded-lg border border-input bg-card px-m text-300"
            >
              <option value="all">All statuses</option>
              <option value="failed">Failed</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <SavedViewsMenu
              views={savedViews.filter((view) => view.section === "jobs")}
              loading={savedViewsLoading}
              error={savedViewsError}
              activeSection="jobs"
              currentFilters={{ search: query, status: statusFilter }}
              onCreate={addSavedView}
              onApply={(view) => {
                setQuery(
                  typeof view.filters.search === "string"
                    ? view.filters.search
                    : "",
                );
                setStatusFilter(
                  typeof view.filters.status === "string"
                    ? (view.filters.status as JobStatus)
                    : "all",
                );
              }}
              onDelete={removeSavedView}
            />
            {focusedItemId && (
              <button
                type="button"
                onClick={() => {
                  setFocusedItemId("");
                  setFocusedJobId("");
                }}
                className="inline-flex h-9 items-center gap-s rounded-full border border-primary/30 bg-primary/10 px-m text-200 font-semibold text-brand-foreground"
                aria-label="Clear focused item"
              >
                {itemById.get(focusedItemId)?.displayName ?? "Focused item"}
                <XCircle className="icon-size-100" aria-hidden="true" />
              </button>
            )}
            {focusedJobId && (
              <button
                type="button"
                onClick={() => setFocusedJobId("")}
                className="inline-flex h-9 items-center gap-s rounded-full border border-lineage-downstream/30 bg-lineage-downstream/10 px-m text-200 font-semibold text-lineage-downstream"
                aria-label="Clear focused job"
              >
                Focused run
                <XCircle className="icon-size-100" aria-hidden="true" />
              </button>
            )}
            {(query || statusFilter !== "all" || focusedItemId || focusedJobId) && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                  setFocusedItemId("");
                  setFocusedJobId("");
                }}
                className="inline-flex h-9 items-center justify-center gap-s rounded-lg px-m text-200 font-semibold text-primary hover:bg-primary/10"
              >
                <FilterX className="icon-size-100" />
                Reset
              </button>
            )}
          </div>

          {filteredJobs.length === 0 ? (
            <div className="flex flex-col items-center px-xl py-xxxl text-center">
              <span className="flex items-center justify-center rounded-full bg-muted p-l text-muted-foreground">
                <Activity className="icon-size-500" aria-hidden="true" />
              </span>
              <h3 className="mt-l text-400 leading-400 font-semibold">
                {jobs.length ? "No matching job activity" : "No job activity yet"}
              </h3>
              <p className="mt-s text-300 leading-300 text-muted-foreground">
                {jobs.length
                  ? "Clear the filters or search for another item or run."
                  : "Run a refresh, pipeline or notebook, then synchronize Fabric Atlas to populate this operational history."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-300 leading-300">
                <caption className="sr-only">
                  Fabric job runs grouped by start date
                </caption>
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-200 uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="whitespace-nowrap px-l py-m font-semibold">
                      Status
                    </th>
                    <th scope="col" className="whitespace-nowrap px-l py-m font-semibold">
                      Item
                    </th>
                    <th scope="col" className="whitespace-nowrap px-l py-m font-semibold">
                      Job
                    </th>
                    <th scope="col" className="whitespace-nowrap px-l py-m font-semibold">
                      Started
                    </th>
                    <th scope="col" className="whitespace-nowrap px-l py-m font-semibold">
                      Duration
                    </th>
                    <th scope="col" className="px-l py-m font-semibold">
                      Detail
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groupedJobs.map(([group, groupJobs]) => (
                    <JobGroup
                      key={group}
                      label={group}
                      jobs={groupJobs}
                      itemById={itemById}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

function JobGroup({
  label,
  jobs,
  itemById,
}: {
  label: string;
  jobs: Job[];
  itemById: Map<string, Item>;
}) {
  return (
    <>
      <tr className="border-b border-border bg-secondary">
        <th
          scope="rowgroup"
          colSpan={6}
          className="px-l py-s text-200 font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {label}
          <span className="ml-s font-normal normal-case">
            {jobs.length} run{jobs.length === 1 ? "" : "s"}
          </span>
        </th>
      </tr>
      {jobs.map((job) => {
        const status = STATUS[job.status];
        const Icon = status.icon;
        const item = itemById.get(job.itemFabricId);

        return (
          <tr
            key={`${job.itemFabricId}-${job.jobType}-${job.startedAt}`}
            className="border-b border-border/60 last:border-b-0 hover:bg-accent/50"
          >
            <td className="whitespace-nowrap px-l py-m">
              <span
                className={`inline-flex items-center gap-xs rounded-full border px-s py-xs text-200 font-semibold ${status.className}`}
              >
                <Icon
                  className={`icon-size-100 ${
                    job.status === "running" ? "animate-spin" : ""
                  }`}
                  aria-hidden="true"
                />
                {status.label}
              </span>
            </td>
            <td className="whitespace-nowrap px-l py-m">
              <div className="flex items-center gap-s">
                {item && <TypeGlyph type={item.itemType} />}
                <span className="font-semibold text-foreground">{job.itemName}</span>
              </div>
            </td>
            <td className="whitespace-nowrap px-l py-m text-muted-foreground">
              {job.jobType}
            </td>
            <td className="whitespace-nowrap px-l py-m text-muted-foreground">
              <time dateTime={job.startedAt}>{relativeTime(job.startedAt)}</time>
            </td>
            <td className="whitespace-nowrap px-l py-m font-numeric tabular-nums">
              {duration(job.durationSec, job.status)}
            </td>
            <td className="px-l py-m text-muted-foreground">
              {job.message ?? "No additional detail"}
            </td>
          </tr>
        );
      })}
    </>
  );
}
