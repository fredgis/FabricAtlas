import { useState } from "react";
import { FULL_RESCAN_INTERVAL_DAYS, parseSyncPlanSummary } from "../incremental-sync";
import type { SyncRun } from "../model";
import { preferredSyncMode, setPreferredSyncMode, type SyncModePreference } from "../sync-mode";
import { cn } from "../ui";
import { formatRunDuration } from "../workspace-sync";

const MODES: { value: SyncModePreference; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "incremental", label: "Incremental" },
];

function duration(run: SyncRun): number | undefined {
  if (typeof run.durationMs === "number" && run.durationMs >= 0) return run.durationMs;
  const start = Date.parse(run.startedAt);
  const end = run.finishedAt ? Date.parse(run.finishedAt) : Number.NaN;
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : undefined;
}

/** Latest completed run statistics: rescanned vs reused items, and the last full run duration for comparison. */
export function lastRunStats(runs: readonly SyncRun[]) {
  const completed = runs
    .filter((run) => run.status === "completed")
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const latest = completed[0];
  if (!latest) return undefined;
  const plan = parseSyncPlanSummary(latest.summary);
  const lastFull = completed.find((run) => parseSyncPlanSummary(run.summary)?.mode === "full");
  return {
    plan,
    items: plan ? plan.refreshed + plan.reused : latest.itemsSynced,
    durationMs: duration(latest),
    fullDurationMs: lastFull && lastFull !== latest ? duration(lastFull) : undefined,
  };
}

/** Full | Incremental scan mode choice shown next to "Synchronize now" (kept per browser). */
export function ScanModeControl({ runs, disabled }: { runs: readonly SyncRun[]; disabled?: boolean }) {
  const [mode, setMode] = useState<SyncModePreference>(preferredSyncMode);
  const stats = lastRunStats(runs);
  return (
    <div className="mt-m flex flex-col gap-xs rounded-lg border border-border bg-card p-m">
      <div className="flex flex-wrap items-center gap-m">
        <span className="text-200 font-semibold text-foreground" id="atlas-scan-mode">
          Scan mode
        </span>
        <div role="radiogroup" aria-labelledby="atlas-scan-mode" className="inline-flex rounded-md border border-input p-xxs">
          {MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={mode === option.value}
              disabled={disabled}
              onClick={() => {
                setMode(option.value);
                setPreferredSyncMode(option.value);
              }}
              className={cn(
                "min-h-[var(--atlas-control-height)] rounded px-m text-300 font-semibold disabled:opacity-60",
                mode === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-200 leading-200 text-muted-foreground">
        {mode === "incremental"
          ? "Incremental mode asks the Scanner API only for items modified since the last validated snapshot and reuses the rest."
          : "Full mode re-reads every item from Fabric. Use it after a permission or configuration change Fabric does not date."}
      </p>
      {stats && (
        <p className="text-200 leading-200 text-foreground" data-testid="scan-last-run">
          <span className="font-semibold">Last run: </span>
          {stats.plan
            ? stats.plan.mode === "incremental"
              ? `${stats.plan.refreshed} of ${stats.items} items rescanned · ${stats.plan.reused} reused`
              : `full scan of ${stats.items} items`
            : stats.items != null
              ? `${stats.items} items synchronized`
              : "completed"}
          {stats.durationMs != null && (
            <span className="text-muted-foreground">
              {` · Duration ${formatRunDuration(stats.durationMs)}`}
              {stats.fullDurationMs != null && stats.plan?.mode === "incremental"
                ? ` (full: ${formatRunDuration(stats.fullDurationMs)})`
                : ""}
            </span>
          )}
        </p>
      )}
      <p className="text-200 leading-200 text-muted-foreground">
        Full rescan forced every {FULL_RESCAN_INTERVAL_DAYS} days.
      </p>
    </div>
  );
}
