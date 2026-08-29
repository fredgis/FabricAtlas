import {
  AlertTriangle,
  CheckCircle2,
  Compass,
  ExternalLink,
  FolderTree,
  Moon,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sun,
  Waypoints,
} from "lucide-react";
import { useThemeContext } from "@/hooks/theme.context";
import { REPOSITORY_URL } from "../release";
import { useAtlas } from "../store";

const SYNC_CAPABILITIES = [
  {
    icon: FolderTree,
    title: "Catalog",
    detail: "Workspace items and ownership",
  },
  {
    icon: Waypoints,
    title: "Lineage",
    detail: "Dependencies and impact paths",
  },
  {
    icon: ShieldCheck,
    title: "Access",
    detail: "Principals, shares and risks",
  },
  {
    icon: Settings2,
    title: "Configuration",
    detail: "Settings, schemas and jobs",
  },
];

export function AtlasBootView() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-m">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
          <Compass className="icon-size-400" />
        </span>
        <div className="text-300 font-semibold">Loading Fabric Atlas</div>
        <span className="h-1 w-32 overflow-hidden rounded-full bg-muted">
          <span className="block h-full w-1/2 animate-pulse rounded-full bg-primary" />
        </span>
      </div>
    </div>
  );
}

export function FirstSyncView() {
  const { isDark, toggleTheme } = useThemeContext();
  const {
    data,
    configured,
    sync,
    syncing,
    syncError,
    syncProgress,
    syncStage,
    hasData,
    requiresDeploymentSync,
  } = useAtlas();
  const deploymentRefresh = hasData && requiresDeploymentSync;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="atlas-first-sync-bg pointer-events-none absolute inset-0" />
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        className="absolute right-l top-l z-10 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card/85 text-muted-foreground shadow-lg backdrop-blur hover:text-foreground"
      >
        {isDark ? (
          <Sun className="icon-size-200" />
        ) : (
          <Moon className="icon-size-200" />
        )}
      </button>
      <main className="relative mx-auto flex min-h-screen w-full max-w-5xl items-center px-l py-xxxl">
        <div className="grid w-full overflow-hidden rounded-3xl border border-border bg-card/95 shadow-2xl backdrop-blur lg:grid-cols-[1.05fr_0.95fr]">
          <section className="flex flex-col justify-between border-b border-border p-xxxl lg:border-b-0 lg:border-r">
            <div>
              <span className="inline-flex items-center gap-s rounded-full border border-primary/30 bg-primary/10 px-m py-s text-200 font-semibold text-primary">
                <Compass className="icon-size-100" />
                {deploymentRefresh ? "New deployment sync" : "First workspace sync"}
              </span>
              <h1 className="mt-xl max-w-xl font-heading text-hero-800 font-bold leading-hero-800">
                {deploymentRefresh
                  ? "Refresh the workspace for this deployment."
                  : "Build your live map of Microsoft Fabric."}
              </h1>
              <p className="mt-l max-w-xl text-300 leading-500 text-muted-foreground">
                Fabric Atlas reads metadata only. Every newly deployed build starts
                here once, ensuring its catalog and lineage are refreshed before the
                dashboard opens.
              </p>
            </div>

            <div className="mt-xxxl grid gap-s sm:grid-cols-2">
              {SYNC_CAPABILITIES.map(({ icon: Icon, title, detail }) => (
                <div
                  key={title}
                  className="flex items-start gap-m rounded-xl border border-border bg-background/45 p-m"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="icon-size-200" />
                  </span>
                  <span>
                    <span className="block text-300 font-semibold">{title}</span>
                    <span className="mt-xxs block text-200 leading-200 text-muted-foreground">
                      {detail}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-col justify-center bg-secondary/65 p-xxxl">
            <div className="text-100 font-bold uppercase tracking-[0.16em] text-lineage-downstream">
              Target workspace
            </div>
            <div className="mt-s truncate font-heading text-600 font-bold leading-600">
              {data.workspace.displayName}
            </div>
            <div className="mt-xs font-mono text-200 text-muted-foreground">
              {data.workspace.fabricId || "Workspace resolved by Fabric"}
            </div>

            <div className="mt-xxxl rounded-2xl border border-border bg-card p-l">
              <div className="flex items-center justify-between gap-m">
                <div>
                  <div className="text-300 font-semibold">
                    {syncing
                      ? syncStage
                      : deploymentRefresh
                        ? "Ready to refresh this deployment"
                        : "Ready to create the catalog"}
                  </div>
                  <div className="mt-xxs text-200 text-muted-foreground">
                    {syncing
                      ? "Keep this page open while Fabric metadata is indexed."
                      : "A full sync can take a minute on a large workspace."}
                  </div>
                </div>
                <div className="font-numeric text-500 font-bold text-primary">
                  {syncing ? `${syncProgress}%` : "01"}
                </div>
              </div>

              <div
                role="progressbar"
                aria-label="Workspace synchronization progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={syncing ? syncProgress : 0}
                className="mt-l h-2 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-lineage-downstream transition-[width] duration-500"
                  style={{ width: `${syncing ? Math.max(syncProgress, 3) : 0}%` }}
                />
              </div>

              <button
                type="button"
                onClick={() => void sync()}
                disabled={syncing || !configured}
                className="mt-l flex h-11 w-full items-center justify-center gap-s rounded-xl bg-primary px-l text-300 font-semibold text-primary-foreground shadow-lg transition hover:brightness-110 disabled:opacity-55"
              >
                {syncing ? (
                  <RefreshCw className="icon-size-200 animate-spin" />
                ) : (
                  <Waypoints className="icon-size-200" />
                )}
                {syncing
                  ? "Synchronizing workspace"
                  : deploymentRefresh
                    ? "Sync this deployment"
                    : "Start first sync"}
              </button>
            </div>

            {!configured && (
              <div className="mt-m rounded-xl border border-status-warning/35 bg-status-warning/10 p-m text-200 leading-300 text-status-warning">
                <div className="flex items-center gap-s font-semibold">
                  <AlertTriangle className="icon-size-200" />
                  Atlas Sync is not configured
                </div>
                <p className="mt-xs">
                  Add the public UDF URL and Entra client ID to the Rayfin
                  environment, then redeploy.
                </p>
                <a
                  href={`${REPOSITORY_URL}/blob/main/docs/installation.md`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-s inline-flex items-center gap-xs font-semibold underline underline-offset-4"
                >
                  Open installation guide
                  <ExternalLink className="icon-size-100" />
                </a>
              </div>
            )}

            {syncError && (
              <div className="mt-m rounded-xl border border-destructive/35 bg-destructive/10 p-m text-200 leading-300 text-destructive">
                <div className="flex items-center gap-s font-semibold">
                  <AlertTriangle className="icon-size-200" />
                  Sync failed
                </div>
                <p className="mt-xs break-words">{syncError}</p>
              </div>
            )}

            {configured && !syncError && !syncing && (
              <div className="mt-m flex items-center gap-s text-200 text-muted-foreground">
                <CheckCircle2 className="icon-size-200 text-status-healthy" />
                Sync endpoint and Entra client are configured.
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
