import type { SyncRun } from "./model";
import type { WorkspaceScope } from "./workspace-scope";
import { SYNC_PHASES, syncPhaseIndex } from "./synchronization-progress";

export interface SyncCapability {
  available: boolean;
  label: string;
  reason: string;
}

/**
 * Backend-dependent synchronization capabilities. Both stay closed until the
 * durable Functions cutover passes its recovery and identity gates; controls
 * that need them (resume, background continuation, schedule editing) are not
 * rendered while `available` is false.
 */
export const SYNC_BACKEND_CAPABILITIES = {
  backgroundRuns: {
    available: false,
    label: "Background synchronization",
    reason:
      "Runs execute in the synchronizer's browser tab through the published Python User Data Function. Closing the tab stops the run before publication.",
  },
  scheduledRuns: {
    available: false,
    label: "Scheduled synchronization",
    reason:
      "Fabric Apps backend Functions have no documented timer or unattended trigger, and the collectors need a delegated user identity that Atlas never stores.",
  },
} as const satisfies Record<string, SyncCapability>;

export const RECENT_RUNS_PREVIEW_COUNT = 5;

export type ScopeWorkspaceStatus =
  | { kind: "running"; phase: string; progress: number }
  | { kind: "failed"; message: string; snapshotAt?: string }
  | { kind: "snapshot"; snapshotAt: string }
  | { kind: "unsynchronized" }
  | { kind: "inactive" };

export interface ScopeWorkspaceRow {
  id: string;
  displayName: string;
  workspaceType?: string;
  active: boolean;
  persisted: boolean;
  status: ScopeWorkspaceStatus;
}

export function scopeWorkspaceRows({
  scopes,
  activeWorkspaceId,
  syncing,
  syncProgress,
  syncError,
  lastSyncedAt,
}: {
  scopes: readonly WorkspaceScope[];
  activeWorkspaceId: string;
  syncing: boolean;
  syncProgress: number;
  syncError?: string;
  lastSyncedAt?: string;
}): ScopeWorkspaceRow[] {
  return scopes.map((scope) => {
    const active = scope.id === activeWorkspaceId;
    let status: ScopeWorkspaceStatus;
    if (!active) {
      status = { kind: "inactive" };
    } else if (syncing) {
      status = {
        kind: "running",
        phase: SYNC_PHASES[syncPhaseIndex(syncProgress)].activeLabel,
        progress: Math.min(100, Math.max(0, Math.round(syncProgress))),
      };
    } else if (syncError) {
      status = {
        kind: "failed",
        message: syncError,
        snapshotAt: lastSyncedAt,
      };
    } else if (lastSyncedAt) {
      status = { kind: "snapshot", snapshotAt: lastSyncedAt };
    } else {
      status = { kind: "unsynchronized" };
    }
    return {
      id: scope.id,
      displayName: scope.displayName,
      workspaceType: scope.workspaceType,
      active,
      persisted: scope.persisted,
      status,
    };
  });
}

export type RecentRunResult = "running" | "completed" | "failed" | "unfinished";

export interface RecentRunRow {
  id: string;
  startedAt: string;
  triggeredBy?: string;
  workspaceName: string;
  result: RecentRunResult;
  durationMs?: number;
  summary?: string;
  failureMessage?: string;
  live: boolean;
}

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

function runDuration(run: SyncRun): number | undefined {
  if (
    typeof run.durationMs === "number" &&
    Number.isFinite(run.durationMs) &&
    run.durationMs >= 0
  ) {
    return run.durationMs;
  }
  const started = timestamp(run.startedAt);
  const finished = timestamp(run.finishedAt);
  if (started == null || finished == null || finished < started) {
    return undefined;
  }
  return finished - started;
}

/**
 * Projects persisted SyncRun audit rows plus the in-flight browser run. A
 * persisted `running` row that this session does not own has no recorded
 * result, so it is reported as unfinished instead of running.
 */
export function recentRunRows({
  runs,
  workspaceName,
  live,
}: {
  runs: readonly SyncRun[];
  workspaceName: string;
  live?: { startedAt: number; triggeredBy: string };
}): RecentRunRow[] {
  const rows: RecentRunRow[] = runs
    .filter((run) => timestamp(run.startedAt) != null)
    .map((run) => ({
      id: run.id,
      startedAt: new Date(run.startedAt).toISOString(),
      triggeredBy: run.triggeredBy?.trim() || undefined,
      workspaceName,
      result: run.status === "running" ? "unfinished" : run.status,
      durationMs: run.status === "running" ? undefined : runDuration(run),
      summary: run.summary?.trim() || undefined,
      failureMessage:
        run.status === "failed"
          ? run.failureMessage?.trim() || undefined
          : undefined,
      live: false,
    }));
  if (live && Number.isFinite(live.startedAt)) {
    rows.push({
      id: `live-${live.startedAt}`,
      startedAt: new Date(live.startedAt).toISOString(),
      triggeredBy: live.triggeredBy,
      workspaceName,
      result: "running",
      live: true,
    });
  }
  return rows.sort(
    (left, right) =>
      new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime(),
  );
}

export function formatRunDuration(durationMs: number | undefined): string {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0) {
    return "Not recorded";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 1) return "<1s";
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${String(totalMinutes % 60).padStart(2, "0")}m`;
}

function startOfLocalDay(value: Date): number {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  ).getTime();
}

export function runDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const dayDifference = Math.round(
    (startOfLocalDay(now) - startOfLocalDay(date)) / 86_400_000,
  );
  if (dayDifference === 0) return "Today";
  if (dayDifference === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function formatRunStart(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${runDayLabel(iso, now)} ${time}`;
}
