import { motion } from "framer-motion";
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
  Sparkles,
  Sun,
  Waypoints,
} from "lucide-react";
import { useThemeContext } from "@/hooks/theme.context";
import { ATLAS_CONFIG } from "../config";
import { REPOSITORY_URL } from "../release";
import { useAtlas } from "../store";

const CAPABILITIES = [
  {
    icon: FolderTree,
    title: "Catalog",
    detail: "Items, ownership and metadata",
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
    detail: "Schemas, settings and jobs",
  },
];

const SYNC_STEPS = [
  "Connect",
  "Discover",
  "Map",
  "Secure",
  "Persist",
];

function safeText(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return !normalized || normalized === "undefined" || normalized === "null"
    ? fallback
    : normalized;
}

export function AtlasBootView() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-m">
        <span className="flex icon-size-700 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
          <Compass className="icon-size-400" />
        </span>
        <div className="text-300 font-semibold">Loading Fabric Atlas</div>
        <span className="h-xs w-32 overflow-hidden rounded-full bg-muted">
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
  const workspaceName = safeText(
    data.workspace.displayName,
    ATLAS_CONFIG.workspaceName,
  );

  return (
    <div className="relative min-h-screen overflow-auto bg-background text-foreground">
      <div className="atlas-first-sync-bg pointer-events-none fixed inset-0" />
      <div className="atlas-sync-grid pointer-events-none fixed inset-0 opacity-40" />
      <motion.div
        aria-hidden="true"
        className="atlas-sync-orb pointer-events-none fixed rounded-full bg-primary/20 blur-3xl"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0.2, 0.55, 0.28], scale: [0.9, 1.08, 0.95] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
      />

      <button
        type="button"
        onClick={toggleTheme}
        aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        className="fixed right-l top-l z-20 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card/85 text-muted-foreground shadow-lg backdrop-blur hover:text-foreground"
      >
        {isDark ? (
          <Sun className="icon-size-200" />
        ) : (
          <Moon className="icon-size-200" />
        )}
      </button>

      <main className="atlas-sync-frame relative z-10 mx-auto flex min-h-screen flex-col justify-center py-xxl">
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className="overflow-hidden rounded-4xl border border-border bg-card/92 shadow-2xl backdrop-blur-xl"
        >
          <header className="flex flex-wrap items-center justify-between gap-m border-b border-border/70 px-xl py-l sm:px-xxl">
            <div className="flex items-center gap-m">
              <span className="flex icon-size-600 items-center justify-center rounded-xl bg-gradient-to-br from-lineage-downstream to-primary text-primary-foreground shadow-lg">
                <Compass className="icon-size-300" />
              </span>
              <span>
                <span className="block font-heading text-400 font-bold">
                  Fabric Atlas
                </span>
                <span className="block text-200 text-muted-foreground">
                  Workspace intelligence · deployment sync
                </span>
              </span>
            </div>
            <div className="flex items-center gap-s rounded-full border border-status-healthy/25 bg-status-healthy/10 px-m py-s text-200 font-semibold text-status-healthy">
              <span className="h-xs w-xs rounded-full bg-current shadow-[0_0_12px_currentColor]" />
              Sync services ready
            </div>
          </header>

          <div className="grid lg:grid-cols-[1.08fr_0.92fr]">
            <motion.section
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.12, duration: 0.55, ease: "easeOut" }}
              className="flex flex-col border-b border-border p-xl sm:p-xxxl lg:border-b-0 lg:border-r"
            >
              <div className="atlas-sync-copy">
                <span className="inline-flex items-center gap-s rounded-full border border-primary/30 bg-primary/10 px-m py-s text-200 font-semibold text-primary">
                  <Sparkles className="icon-size-100" />
                  {deploymentRefresh
                    ? "New deployment detected"
                    : "Your first workspace map"}
                </span>

                <h1 className="atlas-sync-title mt-xl text-balance font-heading text-hero-800 font-bold leading-hero-800 sm:text-hero-900 sm:leading-hero-900">
                  {deploymentRefresh
                    ? "Refresh the map. Start from truth."
                    : "Turn your Fabric workspace into a living atlas."}
                </h1>
                <p className="atlas-sync-copy mt-l text-300 leading-500 text-muted-foreground">
                  One synchronization discovers the estate, orients its lineage,
                  resolves effective access and prepares the governance dashboard.
                  Business data never leaves Fabric.
                </p>

                <div className="mt-xl flex flex-wrap gap-s">
                  <span className="rounded-full border border-border bg-background/60 px-m py-s text-200 font-semibold">
                    {data.items.length || "No"} indexed items
                  </span>
                  <span className="rounded-full border border-border bg-background/60 px-m py-s text-200 font-semibold">
                    {data.edges.length || "No"} lineage links
                  </span>
                  <span className="rounded-full border border-border bg-background/60 px-m py-s text-200 font-semibold">
                    {data.principals.length || "No"} principals
                  </span>
                </div>
              </div>

              <div className="mt-auto grid gap-s pt-xxxl sm:grid-cols-2">
                {CAPABILITIES.map(({ icon: Icon, title, detail }, index) => (
                  <motion.div
                    key={title}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.22 + index * 0.07, duration: 0.4 }}
                    className="group flex items-start gap-m rounded-xl border border-border bg-background/45 p-m transition-colors hover:border-primary/35 hover:bg-accent/70"
                  >
                    <span className="flex icon-size-600 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:-translate-y-xxs">
                      <Icon className="icon-size-200" />
                    </span>
                    <span>
                      <span className="block text-300 font-semibold">{title}</span>
                      <span className="mt-xxs block text-200 leading-200 text-muted-foreground">
                        {detail}
                      </span>
                    </span>
                  </motion.div>
                ))}
              </div>
            </motion.section>

            <motion.section
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.18, duration: 0.55, ease: "easeOut" }}
              className="flex flex-col gap-l bg-secondary/65 p-xl sm:p-xxl"
            >
              <div className="relative overflow-hidden rounded-2xl border border-border bg-background/55 p-l">
                <div className="flex items-center justify-between gap-m">
                  <div>
                    <div className="text-100 font-bold uppercase tracking-[0.16em] text-lineage-downstream">
                      Live topology preview
                    </div>
                    <div className="mt-xs text-300 font-semibold">
                      Source to insight
                    </div>
                  </div>
                  <span className="flex items-center gap-xs text-200 text-muted-foreground">
                    <span className="h-xs w-xs animate-pulse rounded-full bg-lineage-downstream" />
                    mapping
                  </span>
                </div>

                <svg
                  viewBox="0 0 520 300"
                  className="mt-m h-auto w-full"
                  role="img"
                  aria-label="Animated preview of Fabric lineage from pipelines to reports"
                >
                  <defs>
                    <linearGradient id="sync-line" x1="0" x2="1">
                      <stop offset="0" stopColor="var(--color-primary)" />
                      <stop
                        offset="1"
                        stopColor="var(--color-lineage-downstream)"
                      />
                    </linearGradient>
                    <filter id="sync-glow">
                      <feGaussianBlur stdDeviation="5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  <path
                    d="M82 80 C150 80 146 150 220 150"
                    className="atlas-flow"
                    fill="none"
                    stroke="url(#sync-line)"
                    strokeWidth="3"
                    strokeOpacity="0.8"
                  />
                  <path
                    d="M82 220 C150 220 146 150 220 150"
                    className="atlas-flow"
                    fill="none"
                    stroke="url(#sync-line)"
                    strokeWidth="3"
                    strokeOpacity="0.8"
                  />
                  <path
                    d="M300 150 C370 150 366 80 438 80"
                    className="atlas-flow"
                    fill="none"
                    stroke="url(#sync-line)"
                    strokeWidth="3"
                    strokeOpacity="0.8"
                  />
                  <path
                    d="M300 150 C370 150 366 220 438 220"
                    className="atlas-flow"
                    fill="none"
                    stroke="url(#sync-line)"
                    strokeWidth="3"
                    strokeOpacity="0.8"
                  />

                  {[
                    [42, 56, "PL", "Pipeline", "var(--color-lineage-upstream)"],
                    [42, 196, "NB", "Notebook", "var(--color-object-column)"],
                    [220, 126, "LH", "Lakehouse", "var(--color-object-source)"],
                    [438, 56, "SM", "Model", "var(--color-object-measure)"],
                    [438, 196, "RP", "Report", "var(--color-status-warning)"],
                  ].map(([x, y, code, label, color], index) => (
                    <g
                      key={String(code)}
                      className="atlas-sync-node"
                      style={{ animationDelay: `${index * 0.28}s` }}
                      filter={index === 2 ? "url(#sync-glow)" : undefined}
                    >
                      <rect
                        x={Number(x)}
                        y={Number(y)}
                        width="64"
                        height="48"
                        rx="12"
                        fill="var(--color-card)"
                        stroke="var(--color-border)"
                      />
                      <rect
                        x={Number(x) + 8}
                        y={Number(y) + 8}
                        width="32"
                        height="32"
                        rx="9"
                        fill={String(color)}
                      />
                      <text
                        x={Number(x) + 24}
                        y={Number(y) + 28}
                        fill="white"
                        fontSize="11"
                        fontWeight="700"
                        textAnchor="middle"
                      >
                        {code}
                      </text>
                      <text
                        x={Number(x) + 32}
                        y={Number(y) + 65}
                        fill="var(--color-muted-foreground)"
                        fontSize="10"
                        textAnchor="middle"
                      >
                        {label}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>

              <div className="mt-auto rounded-2xl border border-primary/25 bg-card p-l shadow-xl">
                <div className="flex items-start justify-between gap-m">
                  <div className="min-w-0">
                    <div className="text-100 font-bold uppercase tracking-[0.14em] text-primary">
                      Target workspace
                    </div>
                    <div className="mt-xs truncate font-heading text-500 font-bold">
                      {workspaceName}
                    </div>
                  </div>
                  <div className="font-numeric text-500 font-bold text-primary">
                    {syncing ? `${syncProgress}%` : "01"}
                  </div>
                </div>

                <div className="mt-l flex items-center justify-between gap-m text-200">
                  <span className="font-semibold">
                    {syncing
                      ? syncStage
                      : deploymentRefresh
                        ? "Ready to refresh this deployment"
                        : "Ready to create the catalog"}
                  </span>
                  <span className="text-muted-foreground">
                    {syncing ? "in progress" : "one full pass"}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Workspace synchronization progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={syncing ? syncProgress : 0}
                  className="mt-s h-s overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary via-lineage-downstream to-status-healthy transition-[width] duration-500"
                    style={{
                      width: `${syncing ? Math.max(syncProgress, 3) : 0}%`,
                    }}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => void sync()}
                  disabled={syncing || !configured}
                  className="mt-l flex h-11 w-full items-center justify-center gap-s rounded-xl bg-gradient-to-r from-primary to-lineage-downstream px-l text-300 font-semibold text-primary-foreground shadow-lg transition hover:brightness-110 disabled:opacity-55"
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
                <div className="rounded-xl border border-status-warning/35 bg-status-warning/10 p-m text-200 leading-300 text-status-warning">
                  <div className="flex items-center gap-s font-semibold">
                    <AlertTriangle className="icon-size-200" />
                    Atlas Sync is not configured
                  </div>
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
                <div className="rounded-xl border border-destructive/35 bg-destructive/10 p-m text-200 leading-300 text-destructive">
                  <div className="flex items-center gap-s font-semibold">
                    <AlertTriangle className="icon-size-200" />
                    Sync failed
                  </div>
                  <p className="mt-xs break-words">{syncError}</p>
                </div>
              )}

              {configured && !syncError && !syncing && (
                <div className="flex items-center gap-s text-200 text-muted-foreground">
                  <CheckCircle2 className="icon-size-200 text-status-healthy" />
                  Sync endpoint and Entra client are configured.
                </div>
              )}
            </motion.section>
          </div>

          <footer className="border-t border-border/70 bg-background/35 px-xl py-m sm:px-xxl">
            <div className="grid grid-cols-5 gap-s">
              {SYNC_STEPS.map((step, index) => (
                <div key={step} className="flex items-center gap-s">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 font-numeric text-100 font-bold text-primary">
                    {index + 1}
                  </span>
                  <span className="hidden text-200 font-semibold text-muted-foreground sm:inline">
                    {step}
                  </span>
                  {index < SYNC_STEPS.length - 1 && (
                    <span className="h-px flex-1 bg-border" />
                  )}
                </div>
              ))}
            </div>
          </footer>
        </motion.div>
      </main>
    </div>
  );
}
