import { useEffect, useId, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDown,
  Calendar,
  CalendarOff,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock3,
  ExternalLink,
  Globe,
  History,
  Info,
  Layers,
  RefreshCw,
  Settings,
  UserRound,
  X,
} from "lucide-react";
import { ATLAS_CONFIG } from "../config";
import { isFeatureEnabled } from "../feature-flags";
import { relativeTime } from "../model";
import { REPOSITORY_URL } from "../release";
import { useAtlas } from "../store";
import { syncContactMessage } from "../sync-contact";
import { SYNC_PHASES, syncPhaseIndex } from "../synchronization-progress";
import { Card, cn } from "../ui";
import {
  formatRunDuration,
  formatRunStart,
  RECENT_RUNS_PREVIEW_COUNT,
  recentRunRows,
  scopeWorkspaceRows,
  SYNC_BACKEND_CAPABILITIES,
  type RecentRunRow,
  type ScopeWorkspaceRow,
} from "../workspace-sync";
import { WorkspaceScopeDialog } from "./WorkspaceScopeDialog";

export const LIVE_RUN_ROW_ID = "atlas-live-sync-run";

const BUTTON_BASE =
  "inline-flex min-h-[var(--atlas-touch-target)] items-center justify-center gap-s rounded-md px-l text-300 font-semibold transition-colors disabled:opacity-60 sm:min-h-[var(--atlas-control-height)]";
const PRIMARY_BUTTON = `${BUTTON_BASE} bg-primary text-primary-foreground shadow-fabric-2 hover:bg-primary-hover`;
const SECONDARY_BUTTON = `${BUTTON_BASE} border border-input bg-card text-foreground hover:bg-accent`;

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function contactLine(): string {
  return syncContactMessage(ATLAS_CONFIG.syncAdminEmail);
}

function synchronizerEmail(): string | undefined {
  const value = ATLAS_CONFIG.syncAdminEmail?.trim();
  return !value || value === "undefined" || value === "null"
    ? undefined
    : value;
}

function PhaseStepper({
  progress,
  active,
}: {
  progress: number;
  active: boolean;
}) {
  const normalized = Math.min(100, Math.max(0, progress));
  const current = syncPhaseIndex(normalized);
  return (
    <ol
      aria-label="Synchronization phases"
      className="grid grid-cols-4 gap-s sm:flex sm:items-center sm:gap-m"
    >
      {SYNC_PHASES.map((phase, index) => {
        const complete = normalized >= 100 || index < current;
        const isCurrent = active && !complete && index === current;
        return (
          <li
            key={phase.label}
            aria-current={isCurrent ? "step" : undefined}
            className="flex min-w-0 items-center gap-m sm:flex-1 sm:last:flex-none"
          >
            <span
              className="flex min-w-0 flex-col items-center gap-xs text-center sm:flex-row sm:gap-s sm:text-left"
              title={phase.detail}
            >
              {complete ? (
                <CircleCheck
                  className="icon-size-300 shrink-0 text-primary"
                  aria-hidden="true"
                />
              ) : isCurrent ? (
                <span
                  aria-hidden="true"
                  className="flex icon-size-300 shrink-0 items-center justify-center rounded-full border-2 border-primary dark:border-brand-foreground"
                >
                  <span className="size-s rounded-full bg-primary dark:bg-brand-foreground" />
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className="icon-size-300 shrink-0 rounded-full border-2 border-muted-foreground"
                />
              )}
              <span
                className={cn(
                  "max-w-full truncate text-[length:var(--text-200)] sm:text-[length:var(--text-300)]",
                  isCurrent
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {phase.label}
              </span>
              <span className="sr-only">
                {complete ? ", complete" : isCurrent ? ", in progress" : ", not started"}
              </span>
            </span>
            {index < SYNC_PHASES.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  "hidden h-px min-w-l flex-1 sm:block",
                  complete ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function BannerShell({
  tone,
  icon,
  title,
  description,
  actions,
  children,
}: {
  tone: "primary" | "destructive" | "warning";
  icon: ReactNode;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      aria-labelledby="workspace-sync-banner-title"
      className={cn(
        "rounded-xl border p-l sm:p-xl",
        tone === "primary" && "border-primary/30 bg-primary/5",
        tone === "destructive" && "border-destructive/35 bg-destructive/10",
        tone === "warning" && "border-status-warning/35 bg-status-warning/10",
      )}
    >
      <div className="flex flex-col gap-l lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-l">
          <span
            aria-hidden="true"
            className={cn(
              "flex icon-size-700 shrink-0 items-center justify-center rounded-xl",
              tone === "primary" && "bg-primary text-primary-foreground",
              tone === "destructive" && "bg-destructive text-destructive-foreground",
              tone === "warning" && "bg-status-warning/20 text-foreground",
            )}
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="workspace-sync-banner-title"
              className="font-heading text-500 font-semibold leading-500"
            >
              {title}
            </h2>
            <div className="mt-xxs text-300 leading-300 text-muted-foreground">
              {description}
            </div>
            {children}
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap gap-s lg:shrink-0 lg:justify-end">
            {actions}
          </div>
        )}
      </div>
    </section>
  );
}

function SyncBanner({ onViewRun }: { onViewRun: () => void }) {
  const {
    syncing,
    syncProgress,
    syncStage,
    syncError,
    configured,
    canSync,
    isPreview,
    sync,
    cancelSync,
    lastSyncedAt,
    data,
  } = useAtlas();
  const canStart = canSync && (isPreview || configured);
  const progress = Math.min(100, Math.max(0, Math.round(syncProgress)));

  if (syncing) {
    return (
      <BannerShell
        tone="primary"
        icon={
          <RefreshCw
            className="icon-size-400 motion-safe:animate-spin"
            aria-hidden="true"
          />
        }
        title="Synchronization is running in this browser tab"
        description="Keep this tab open until publication completes. Closing it stops the run; the last validated snapshot stays available."
        actions={
          <>
            <button type="button" onClick={onViewRun} className={PRIMARY_BUTTON}>
              <History className="icon-size-200" aria-hidden="true" />
              View run
            </button>
            {canSync && (
              <button type="button" onClick={cancelSync} className={SECONDARY_BUTTON}>
                <X className="icon-size-200" aria-hidden="true" />
                Cancel run
              </button>
            )}
          </>
        }
      >
        <div className="mt-l flex items-center gap-l">
          <div
            role="progressbar"
            aria-label="Workspace synchronization progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-valuetext={`${progress}% complete. ${syncStage}.`}
            className="h-s min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 dark:bg-brand-foreground"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="shrink-0 text-right font-numeric text-500 font-semibold tabular-nums">
            {progress}%
          </span>
        </div>
        <div className="mt-m">
          <PhaseStepper progress={progress} active />
        </div>
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mt-m text-200 leading-200 text-muted-foreground"
        >
          Current step: {syncStage}
        </p>
      </BannerShell>
    );
  }

  if (syncError) {
    return (
      <BannerShell
        tone="destructive"
        icon={<AlertTriangle className="icon-size-400" aria-hidden="true" />}
        title="The last synchronization failed"
        description={
          <>
            <span role="alert" className="block break-words text-foreground">
              {syncError}
            </span>
            <span className="mt-xxs block">
              {lastSyncedAt
                ? `The last validated snapshot, published ${relativeTime(lastSyncedAt)}, is still shown.`
                : "No snapshot was published for this workspace."}
            </span>
          </>
        }
        actions={
          canStart ? (
            <button type="button" onClick={() => void sync()} className={PRIMARY_BUTTON}>
              <RefreshCw className="icon-size-200" aria-hidden="true" />
              Retry synchronization
            </button>
          ) : undefined
        }
      >
        {!canSync && (
          <p className="mt-s text-200 leading-200 text-foreground">{contactLine()}</p>
        )}
      </BannerShell>
    );
  }

  if (!isPreview && !configured) {
    return (
      <BannerShell
        tone="warning"
        icon={<AlertTriangle className="icon-size-400" aria-hidden="true" />}
        title="Atlas Sync is not configured"
        description="This deployment has no valid synchronization endpoint, Entra client or synchronizer identity."
        actions={
          <a
            href={`${REPOSITORY_URL}/blob/main/docs/installation.md`}
            target="_blank"
            rel="noreferrer"
            className={SECONDARY_BUTTON}
          >
            <ExternalLink className="icon-size-200" aria-hidden="true" />
            Open installation guide
          </a>
        }
      />
    );
  }

  return (
    <BannerShell
      tone="primary"
      icon={<CircleCheck className="icon-size-400" aria-hidden="true" />}
      title={
        lastSyncedAt
          ? `Last validated snapshot published ${relativeTime(lastSyncedAt)}`
          : "No snapshot has been published yet"
      }
      description={
        lastSyncedAt
          ? `${data.workspace.displayName} was synchronized ${formatRunStart(lastSyncedAt)}. Runs are manual and execute in the synchronizer's browser tab.`
          : "Runs are manual and execute in the synchronizer's browser tab."
      }
      actions={
        canStart ? (
          <button type="button" onClick={() => void sync()} className={PRIMARY_BUTTON}>
            <RefreshCw className="icon-size-200" aria-hidden="true" />
            Synchronize now
          </button>
        ) : undefined
      }
    >
      {!canSync && (
        <p className="mt-s text-200 leading-200 text-foreground">{contactLine()}</p>
      )}
    </BannerShell>
  );
}

function ScopeStatus({ row }: { row: ScopeWorkspaceRow }) {
  const { status } = row;
  const chip =
    "inline-flex items-center gap-xs rounded-md border px-s py-xxs text-200 font-semibold";
  switch (status.kind) {
    case "running":
      return (
        <span className={cn(chip, "border-primary/30 bg-primary/10 text-primary")}>
          <RefreshCw className="icon-size-100 motion-safe:animate-spin" aria-hidden="true" />
          {status.phase}
        </span>
      );
    case "snapshot":
      return (
        <span className={cn(chip, "border-status-healthy/30 bg-status-healthy/10 text-foreground")}>
          <CircleCheck className="icon-size-100 text-status-healthy" aria-hidden="true" />
          Last valid snapshot
        </span>
      );
    case "failed":
      return (
        <span className={cn(chip, "border-destructive/35 bg-destructive/10 text-foreground")}>
          <CircleX className="icon-size-100 text-destructive" aria-hidden="true" />
          Last run failed
        </span>
      );
    case "unsynchronized":
      return (
        <span className={cn(chip, "border-status-warning/35 bg-status-warning/10 text-foreground")}>
          <CircleDashed className="icon-size-100" aria-hidden="true" />
          Not synchronized
        </span>
      );
    default:
      return (
        <span className={cn(chip, "border-border bg-muted text-muted-foreground")}>
          <Clock3 className="icon-size-100" aria-hidden="true" />
          Not loaded
        </span>
      );
  }
}

function scopeDetail(row: ScopeWorkspaceRow): string {
  const { status } = row;
  switch (status.kind) {
    case "running":
      return `${status.progress}% complete`;
    case "snapshot":
      return formatRunStart(status.snapshotAt);
    case "failed":
      return status.snapshotAt
        ? `Snapshot from ${formatRunStart(status.snapshotAt)} kept`
        : "No snapshot published";
    case "unsynchronized":
      return "Run the first synchronization";
    default:
      return "Open to load its latest snapshot";
  }
}

function SelectedWorkspacesCard() {
  const {
    workspaceScopes,
    workspaceScopesLoading,
    workspaceScopesError,
    reloadWorkspaceScopes,
    activeWorkspaceId,
    selectWorkspace,
    syncing,
    syncProgress,
    syncError,
    lastSyncedAt,
    canSync,
  } = useAtlas();
  const [scopeOpen, setScopeOpen] = useState(false);
  const switchHintId = useId();
  const rows = scopeWorkspaceRows({
    scopes: workspaceScopes,
    activeWorkspaceId,
    syncing,
    syncProgress,
    syncError,
    lastSyncedAt,
  });
  const canManageScope = canSync && isFeatureEnabled("fabric-app-functions");
  const usesFallback =
    workspaceScopes.length === 1 && !workspaceScopes[0].persisted;

  return (
    <Card className="flex min-w-0 flex-col">
      <header className="flex flex-wrap items-start justify-between gap-m border-b border-border p-l">
        <div className="min-w-0">
          <h2 className="text-400 font-semibold leading-400">Selected workspaces</h2>
          <p className="mt-xxs text-200 leading-200 text-muted-foreground">
            Workspaces in the shared Atlas synchronization scope.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-m">
          <span className="text-300 font-semibold text-primary">
            {workspaceScopes.length} selected
          </span>
          {canManageScope && (
            <button
              type="button"
              onClick={() => setScopeOpen(true)}
              className={SECONDARY_BUTTON}
            >
              <Settings className="icon-size-200" aria-hidden="true" />
              Manage scope
            </button>
          )}
        </div>
      </header>

      {workspaceScopesError && (
        <div
          role="alert"
          className="mx-l mt-l flex flex-wrap items-center gap-m rounded-lg border border-destructive/35 bg-destructive/10 p-m text-200 leading-200 text-foreground"
        >
          <AlertTriangle className="icon-size-200 shrink-0 text-destructive" aria-hidden="true" />
          <span className="min-w-0 flex-1 break-words">{workspaceScopesError}</span>
          <button
            type="button"
            onClick={() => void reloadWorkspaceScopes().catch(() => undefined)}
            className={SECONDARY_BUTTON}
          >
            Reload scope
          </button>
        </div>
      )}

      {workspaceScopesLoading ? (
        <div role="status" className="flex flex-col gap-s p-l">
          <span className="text-200 text-muted-foreground">
            Loading the shared workspace scope…
          </span>
          {[0, 1].map((index) => (
            <span key={index} aria-hidden="true" className="block h-xxxl rounded-md bg-muted" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="p-l text-center text-200 leading-200 text-muted-foreground">
          No workspace is in the shared scope.{" "}
          {canManageScope
            ? "Use Manage scope to select one."
            : "The configured synchronizer selects workspaces."}
        </p>
      ) : (
        <table className="w-full border-collapse text-300">
          <caption className="sr-only">
            Workspaces in the shared synchronization scope
          </caption>
          <thead className="hidden md:table-header-group">
            <tr className="border-b border-border text-left text-200 text-muted-foreground">
              <th scope="col" className="px-l py-s font-semibold">Workspace</th>
              <th scope="col" className="px-m py-s font-semibold">Status</th>
              <th scope="col" className="px-m py-s font-semibold">Details</th>
              <th scope="col" className="px-l py-s text-right font-semibold">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr
                key={row.id}
                className="flex flex-wrap items-center gap-x-m gap-y-xs px-l py-m md:table-row md:p-0"
              >
                <td className="w-full md:w-auto md:px-l md:py-s">
                  <span className="flex min-w-0 items-center gap-m">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex icon-size-600 shrink-0 items-center justify-center rounded-lg",
                        row.active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Layers className="icon-size-200" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{row.displayName}</span>
                      {row.active && (
                        <span className="block text-200 text-muted-foreground">
                          Active workspace
                        </span>
                      )}
                    </span>
                  </span>
                </td>
                <td className="md:px-m md:py-s">
                  <ScopeStatus row={row} />
                </td>
                <td className="text-200 text-muted-foreground md:px-m md:py-s md:text-300">
                  {scopeDetail(row)}
                </td>
                <td className="ml-auto md:px-l md:py-s md:text-right">
                  {!row.active && (
                    <button
                      type="button"
                      onClick={() => selectWorkspace(row.id)}
                      disabled={syncing}
                      aria-describedby={syncing ? switchHintId : undefined}
                      aria-label={`Open ${row.displayName}`}
                      className={SECONDARY_BUTTON}
                    >
                      Open
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(syncing || usesFallback || !canSync) && (
        <div className="mt-auto flex flex-col gap-xs border-t border-border px-l py-m text-200 leading-200 text-muted-foreground">
          {syncing && (
            <p id={switchHintId}>
              Workspace switching is paused until the active run finishes or is cancelled.
            </p>
          )}
          {usesFallback && (
            <p>
              Showing the configured deployment workspace until the synchronizer
              saves an explicit scope.
            </p>
          )}
          {!canSync && (
            <p>
              Scope is managed by{" "}
              {synchronizerEmail() ??
                "the configured synchronization administrator"}
              .
            </p>
          )}
        </div>
      )}

      {canManageScope && (
        <WorkspaceScopeDialog open={scopeOpen} onOpenChange={setScopeOpen} />
      )}
    </Card>
  );
}

function ScheduleCard() {
  const reason = SYNC_BACKEND_CAPABILITIES.scheduledRuns.reason;
  const synchronizer = synchronizerEmail() ?? "Configured synchronizer";
  const rows = [
    { icon: Calendar, label: "Frequency", value: "Manual only" },
    { icon: Globe, label: "Time zone", value: "Not configured" },
    {
      icon: UserRound,
      label: "Run identity",
      value: synchronizer,
      detail: "Delegated sign-in in the browser",
    },
    { icon: Clock3, label: "Next run", value: "Not scheduled" },
  ];

  return (
    <Card className="flex min-w-0 flex-col">
      <header className="flex items-center justify-between gap-m border-b border-border p-l">
        <h2 className="text-400 font-semibold leading-400">Schedule</h2>
        <span className="inline-flex items-center gap-xs rounded-md border border-border bg-muted px-s py-xxs text-200 font-semibold text-muted-foreground">
          <CalendarOff className="icon-size-100" aria-hidden="true" />
          Disabled
        </span>
      </header>
      <dl className="grid grid-cols-[auto_auto_minmax(0,1fr)] gap-x-m px-l">
        {rows.map(({ icon: Icon, label, value, detail }) => (
          <div
            key={label}
            className="col-span-3 grid grid-cols-subgrid items-start border-b border-border py-m last:border-b-0"
          >
            <Icon className="mt-xxs icon-size-200 shrink-0 text-muted-foreground" aria-hidden="true" />
            <dt className="text-300 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 text-300">
              <span className="block break-words font-semibold">{value}</span>
              {detail && (
                <span className="block text-200 text-muted-foreground">{detail}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div
        role="note"
        className="m-l mt-auto flex items-start gap-s rounded-lg border border-border bg-secondary p-m text-200 leading-200"
      >
        <Info className="mt-xxs icon-size-200 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p>
          <span className="font-semibold">Scheduling is unavailable. </span>
          <span className="text-muted-foreground">{reason}</span>
        </p>
      </div>
    </Card>
  );
}

function RunResult({ row }: { row: RecentRunRow }) {
  switch (row.result) {
    case "running":
      return (
        <span className="inline-flex items-center gap-xs font-semibold text-primary">
          <RefreshCw className="icon-size-200 motion-safe:animate-spin" aria-hidden="true" />
          Running
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-xs font-semibold text-status-healthy">
          <CircleCheck className="icon-size-200" aria-hidden="true" />
          Completed
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex flex-col">
          <span className="inline-flex items-center gap-xs font-semibold text-foreground">
            <CircleX className="icon-size-200 text-destructive" aria-hidden="true" />
            Failed
          </span>
          {row.failureMessage && (
            <span className="mt-xxs max-w-xs break-words text-200 text-muted-foreground">
              {row.failureMessage}
            </span>
          )}
        </span>
      );
    default:
      return (
        <span className="inline-flex flex-col">
          <span className="inline-flex items-center gap-xs font-semibold text-foreground">
            <CircleDashed className="icon-size-200 text-muted-foreground" aria-hidden="true" />
            No result recorded
          </span>
          <span className="mt-xxs text-200 text-muted-foreground">
            Interrupted, or still open in another session
          </span>
        </span>
      );
  }
}

function MobileLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mr-xs text-200 font-semibold text-muted-foreground md:hidden">
      {children}
    </span>
  );
}

function RecentRunsCard() {
  const { data, syncing, syncStartedAt, currentUser, hydrating, canSync } =
    useAtlas();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const liveStartedAt = syncing ? syncStartedAt : undefined;
  const now = useNow(liveStartedAt != null);
  const rows = recentRunRows({
    runs: data.syncRuns,
    workspaceName: data.workspace.displayName,
    live:
      liveStartedAt != null
        ? { startedAt: liveStartedAt, triggeredBy: currentUser.name }
        : undefined,
  });
  const visible = expanded ? rows : rows.slice(0, RECENT_RUNS_PREVIEW_COUNT);

  return (
    <Card className="min-w-0">
      <header className="flex flex-wrap items-start justify-between gap-m p-l pb-m">
        <div className="min-w-0">
          <h2 className="text-400 font-semibold leading-400">
            Recent synchronization runs
          </h2>
          <p className="mt-xxs text-200 leading-200 text-muted-foreground">
            Latest synchronization activity for {data.workspace.displayName}.
          </p>
        </div>
        {rows.length > RECENT_RUNS_PREVIEW_COUNT && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex min-h-[var(--atlas-touch-target)] items-center rounded-md px-s text-300 font-semibold text-primary underline-offset-4 hover:underline sm:min-h-[var(--atlas-control-height)]"
          >
            {expanded
              ? `Show latest ${RECENT_RUNS_PREVIEW_COUNT}`
              : `View all ${rows.length} runs`}
          </button>
        )}
      </header>

      {hydrating ? (
        <div role="status" className="flex flex-col gap-s px-l pb-l">
          <span className="text-200 text-muted-foreground">
            Loading synchronization runs…
          </span>
          {[0, 1, 2].map((index) => (
            <span key={index} aria-hidden="true" className="block h-xxl rounded-md bg-muted" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="mx-l mb-l rounded-lg border border-dashed border-border p-l text-center text-200 leading-200 text-muted-foreground">
          No synchronization run is recorded for {data.workspace.displayName} yet.{" "}
          {canSync
            ? "Synchronize now to publish the first snapshot."
            : contactLine()}
        </p>
      ) : (
        <div className="px-s">
          <table id={listId} className="w-full border-collapse text-300">
            <caption className="sr-only">
              Synchronization runs, newest first
            </caption>
            <thead className="hidden md:table-header-group">
              <tr className="border-b border-border text-left text-200 text-muted-foreground">
                <th scope="col" aria-sort="descending" className="px-s py-s font-semibold">
                  <span className="inline-flex items-center gap-xs">
                    Started
                    <ArrowDown className="icon-size-100" aria-hidden="true" />
                  </span>
                </th>
                <th scope="col" className="px-s py-s font-semibold">Trigger</th>
                <th scope="col" className="px-s py-s font-semibold">Scope</th>
                <th scope="col" className="px-s py-s font-semibold">Result</th>
                <th scope="col" className="px-s py-s font-semibold">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((row) => (
                <tr
                  key={row.id}
                  id={row.live ? LIVE_RUN_ROW_ID : undefined}
                  tabIndex={row.live ? -1 : undefined}
                  className={cn(
                    "flex flex-wrap items-start gap-x-l gap-y-xs px-s py-m md:table-row md:p-0",
                    row.live &&
                      "bg-primary/5 focus:outline-2 focus:outline-offset-[-2px] focus:outline-ring",
                  )}
                >
                  <td className="w-full font-semibold md:w-auto md:px-s md:py-s md:font-normal">
                    {formatRunStart(row.startedAt)}
                  </td>
                  <td className="md:px-s md:py-s">
                    <MobileLabel>Trigger</MobileLabel>
                    Manual
                    {row.triggeredBy && (
                      <span className="block text-200 text-muted-foreground">
                        {row.triggeredBy}
                      </span>
                    )}
                  </td>
                  <td className="min-w-0 md:px-s md:py-s">
                    <MobileLabel>Scope</MobileLabel>
                    <span className="break-words">{row.workspaceName}</span>
                  </td>
                  <td className="w-full md:w-auto md:px-s md:py-s">
                    <RunResult row={row} />
                  </td>
                  <td className="font-numeric tabular-nums md:px-s md:py-s">
                    <MobileLabel>Duration</MobileLabel>
                    {row.live && liveStartedAt != null
                      ? `${formatRunDuration(now - liveStartedAt)} so far`
                      : formatRunDuration(row.durationMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="m-l mt-s flex items-start gap-s rounded-lg border border-primary/20 bg-primary/5 px-m py-s text-200 leading-200 text-foreground">
        <Info className="mt-xxs icon-size-200 shrink-0 text-primary" aria-hidden="true" />
        The last validated snapshot remains available during synchronization.
        A run replaces it only after its manifest is published.
      </p>
    </Card>
  );
}

export function WorkspaceSynchronizationPanel() {
  const viewRun = () => {
    const row = document.getElementById(LIVE_RUN_ROW_ID);
    if (!row) return;
    row.scrollIntoView?.({ block: "nearest" });
    row.focus();
  };

  return (
    <div className="flex flex-col gap-l">
      <SyncBanner onViewRun={viewRun} />
      <div className="grid gap-l xl:grid-cols-[minmax(0,1.85fr)_minmax(320px,1fr)]">
        <SelectedWorkspacesCard />
        <ScheduleCard />
      </div>
      <RecentRunsCard />
    </div>
  );
}
