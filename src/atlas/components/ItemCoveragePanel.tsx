import { Layers } from "lucide-react";
import {
  COVERAGE_DIMENSIONS,
  COVERAGE_DIMENSION_LABEL,
  COVERAGE_STATE_LABEL,
  ITEM_FAMILY_ADAPTERS,
  isMaterializedLakeViewRefreshJob,
  itemFamilyCapability,
  type CoverageState,
} from "../item-families";
import type { Job } from "../model";
import { cn } from "../ui";

const STATE_CLASS: Record<CoverageState, string> = {
  collected: "border-status-healthy/30 bg-status-healthy/10 text-status-healthy",
  partial: "border-status-warning/30 bg-status-warning/10 text-status-warning",
  "adapter-only": "border-lineage-upstream/30 bg-lineage-upstream/10 text-lineage-upstream",
  deferred: "border-border bg-muted text-muted-foreground",
  unsupported: "border-border bg-muted text-muted-foreground",
  excluded: "border-border bg-muted text-muted-foreground",
  "not-applicable": "border-border bg-transparent text-muted-foreground",
};

/** States each coverage dimension of an item's family independently. */
export function ItemCoveragePanel({
  itemType,
  jobs = [],
}: {
  itemType: string;
  jobs?: readonly Pick<Job, "jobType">[];
}) {
  const capability = itemFamilyCapability(itemType);
  const mlvRefreshJobs = jobs.filter((job) => isMaterializedLakeViewRefreshJob(job.jobType)).length;
  const headingId = `coverage-${capability.key.replace(/[^A-Za-z0-9]+/g, "-")}`;
  return (
    <section
      data-section-key="coverage"
      aria-labelledby={headingId}
      className="scroll-mt-l overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex flex-wrap items-center gap-s border-b border-border bg-secondary px-l py-m">
        <Layers className="icon-size-200 text-muted-foreground" aria-hidden="true" />
        <h3
          id={headingId}
          className="text-200 font-semibold uppercase tracking-[0.12em] text-muted-foreground"
        >
          Atlas coverage
        </h3>
        <span className="text-200 text-muted-foreground">
          {capability.label}
          {capability.maturity === "preview" ? " · Preview" : ""}
          {capability.kind === "workload-item"
            ? " · Workload item"
            : capability.kind === "unknown-item"
              ? " · Unregistered type"
              : ""}
        </span>
      </div>
      <dl className="divide-y divide-border/60">
        {COVERAGE_DIMENSIONS.map((dimension) => {
          const coverage = capability.coverage[dimension];
          return (
            <div
              key={dimension}
              className="atlas-row grid grid-cols-1 gap-xs px-l sm:grid-cols-3 sm:gap-l"
            >
              <dt className="text-200 font-semibold text-muted-foreground">
                {COVERAGE_DIMENSION_LABEL[dimension]}
              </dt>
              <dd className="min-w-0 sm:col-span-2">
                <span
                  className={cn(
                    "inline-flex rounded-md border px-s py-xxs text-200 font-semibold",
                    STATE_CLASS[coverage.state],
                  )}
                >
                  {COVERAGE_STATE_LABEL[coverage.state]}
                </span>
                <p className="mt-xxs break-words text-200 leading-200 text-muted-foreground">
                  {coverage.detail}
                </p>
              </dd>
            </div>
          );
        })}
      </dl>
      {(capability.adapters.length > 0 || mlvRefreshJobs > 0) && (
        <div className="space-y-xs border-t border-border px-l py-m text-200 leading-200 text-muted-foreground">
          {capability.adapters.map((adapter) => (
            <p key={adapter}>
              <span className="font-semibold text-foreground">
                {ITEM_FAMILY_ADAPTERS[adapter].label}:
              </span>{" "}
              {ITEM_FAMILY_ADAPTERS[adapter].detail}
            </p>
          ))}
          {mlvRefreshJobs > 0 && (
            <p>
              <span className="font-semibold text-foreground">Materialized lake views:</span>{" "}
              {mlvRefreshJobs} refresh job{mlvRefreshJobs === 1 ? "" : "s"} recorded on this Lakehouse.
              Views are not separate Fabric items.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
