//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  BarChart3,
  Boxes,
  Compass,
  FolderTree,
  Info,
  KeyRound,
  Menu,
  Moon,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  Waypoints,
  X,
} from "lucide-react";

import { useThemeContext } from "@/hooks/theme.context";
import { useAtlas } from "./atlas/store";
import { CommandPalette } from "./atlas/components/CommandPalette";
import {
  navigationForSearch,
  type AtlasFocusRequest,
  type AtlasNavigation,
  type Tab,
} from "./atlas/navigation";
import { Avatar, cn } from "./atlas/ui";
import { relativeTime } from "./atlas/model";

import { OverviewView } from "./atlas/views/Overview";
import { MapView } from "./atlas/views/Map";
import { CatalogView } from "./atlas/views/Catalog";
import { AssetCatalogView } from "./atlas/views/AssetCatalog";
import { AccessView } from "./atlas/views/Access";
import { GovernanceCenterView } from "./atlas/views/GovernanceCenter";
import { JobsView } from "./atlas/views/Jobs";
import { WorkspaceHubView } from "./atlas/views/WorkspaceHub";
import { AboutView } from "./atlas/views/About";
import { AtlasBootView, FirstSyncView } from "./atlas/views/FirstSync";

export type { Tab } from "./atlas/navigation";

const NAV_GROUPS: {
  label: string;
  items: { id: Tab; label: string; icon: typeof Compass }[];
}[] = [
  {
    label: "Explore",
    items: [
      { id: "overview", label: "Overview", icon: BarChart3 },
      { id: "map", label: "Map & lineage", icon: Waypoints },
      { id: "catalog", label: "Catalog", icon: FolderTree },
      { id: "assets", label: "Asset Catalog", icon: Boxes },
    ],
  },
  {
    label: "Govern",
    items: [
      { id: "governance", label: "Governance Center", icon: ShieldCheck },
      { id: "access", label: "Access Review", icon: KeyRound },
    ],
  },
  {
    label: "Operate",
    items: [
      { id: "jobs", label: "Jobs & health", icon: Activity },
      { id: "workspace", label: "Workspace Hub", icon: Settings2 },
    ],
  },
  {
    label: "System",
    items: [{ id: "about", label: "About", icon: Info }],
  },
];
const NAV = NAV_GROUPS.flatMap((group) => group.items);

function tabFromHash(): Tab {
  const raw = window.location.hash.replace("#", "").split("?")[0];
  if (raw === "config" || raw === "comments") return "workspace";
  if (raw === "sensitivity") return "governance";
  const tab = raw as Tab;
  return NAV.some((item) => item.id === tab) ? tab : "overview";
}

function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [focus, setFocus] = useState<AtlasFocusRequest | undefined>(() =>
    window.location.hash.replace("#", "").startsWith("sensitivity")
      ? {
          requestId: crypto.randomUUID(),
          governanceSection: "coverage",
        }
      : undefined,
  );
  const [commandOpen, setCommandOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const { isDark, toggleTheme } = useThemeContext();
  const {
    data,
    hydrating,
    sync,
    syncing,
    syncProgress,
    syncStage,
    syncError,
    canSync,
    lastSyncedAt,
    currentUser,
    isPreview,
    hasData,
    requiresDeploymentSync,
  } = useAtlas();

  useEffect(() => {
    const nextHash = `#${tab}`;
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, "", nextHash);
    }
  }, [tab]);

  useEffect(() => {
    if (!navOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [navOpen]);

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLSelectElement)
      ) {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);

  useEffect(() => {
    const onHash = () => {
      setTab(tabFromHash());
      setFocus(undefined);
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, []);

  const navigate = (navigation: AtlasNavigation | Tab) => {
    const next =
      typeof navigation === "string" ? { tab: navigation } : navigation;
    setTab(next.tab);
    setFocus(next.focus);
    setNavOpen(false);
  };

  const nav = (t: Tab) => navigate(t);

  if (!isPreview && hydrating) return <AtlasBootView />;
  if (!isPreview && (!hasData || requiresDeploymentSync)) {
    return <FirstSyncView />;
  }

  return (
    <div className="atlas-shell-canvas relative flex h-screen overflow-hidden text-foreground">
      <div
        className="atlas-brand-spectrum pointer-events-none absolute inset-x-0 top-0 z-[60] h-[3px]"
        aria-hidden="true"
      />
      {navOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-black/45 lg:hidden"
        />
      )}
      {/* Sidebar */}
      <aside
        aria-label="Primary navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[224px] shrink-0 flex-col border-r border-border bg-card shadow-fabric-16 transition-transform lg:static lg:translate-x-0 lg:shadow-none",
          navOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-[11px] px-[14px] pb-[13px] pt-[16px]">
          <span
            className="atlas-brand-mark flex h-[34px] w-[34px] items-center justify-center rounded-lg text-primary-foreground"
          >
            <Compass size={19} />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-none">Fabric Atlas</div>
            <div className="mt-[3px] text-[11px] text-muted-foreground">
              Workspace governance
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
            className="ml-auto flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
          >
            <X size={17} />
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-[10px] pb-[10px]">
          {NAV_GROUPS.map((group, groupIndex) => (
            <div key={group.label} className={cn(groupIndex > 0 && "mt-[12px]")}>
              <div className="px-[10px] pb-[5px] text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {group.label}
              </div>
              <div className="flex flex-col gap-[2px]">
                {group.items.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => nav(id)}
                    aria-current={tab === id ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-[10px] rounded-md px-[10px] py-[7px] text-left text-[13px] font-medium transition-colors",
                      tab === id
                        ? "bg-primary/10 text-brand-foreground before:absolute before:bottom-[6px] before:left-0 before:top-[6px] before:w-[3px] before:rounded-full before:bg-primary"
                        : "text-foreground/75 hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Icon size={17} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-auto p-[12px]">
          <div className="rounded-lg border border-border bg-secondary p-[11px] text-[12px] text-muted-foreground">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em]">
              Fabric workspace
            </div>
            <div className="mt-[2px] text-[13px] font-bold text-foreground">
              {data.workspace.displayName}
            </div>
            <div className="mt-[4px] text-[11px]">{data.workspace.capacity}</div>
            <div className="mt-[6px] flex items-center gap-[6px] text-[11px]">
              <span
                className="inline-block h-[7px] w-[7px] rounded-full bg-status-healthy"
              />
              {data.items.length} Fabric items
            </div>
            <div className="mt-[2px] text-[10px] text-muted-foreground">
              Latest validated snapshot
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative flex h-[52px] shrink-0 items-center justify-between gap-[10px] border-b border-border bg-card px-[12px] shadow-fabric-2 sm:px-[18px] lg:px-[20px]">
          <div className="flex min-w-0 items-center gap-[8px]">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground lg:hidden"
            >
              <Menu size={17} />
            </button>
            <div className="truncate text-[12px] text-muted-foreground sm:text-[13px]">
              <span className="hidden sm:inline">Fabric · </span>
              <b className="text-foreground">{data.workspace.displayName}</b>
              <span className="hidden sm:inline">
                {" "}
                · {NAV.find((n) => n.id === tab)?.label}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-[8px] sm:gap-[12px] lg:gap-[14px]">
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="hidden h-[32px] items-center gap-s rounded-md border border-transparent bg-secondary px-m text-200 text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground md:flex"
            >
              <Search className="icon-size-100" aria-hidden="true" />
              Search workspace
              <kbd className="rounded border border-border bg-muted px-xs py-xxs font-mono text-100">
                Ctrl K
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              aria-label="Search workspace"
              className="flex h-[32px] w-[32px] items-center justify-center rounded-md border border-transparent bg-secondary text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground md:hidden"
            >
              <Search className="icon-size-200" />
            </button>
            <span
              className={cn(
                "hidden max-w-[240px] truncate text-[12px] text-muted-foreground sm:inline",
                syncError && !syncing && "text-destructive",
              )}
              title={syncError}
            >
              {syncing
                ? `${syncStage} · ${syncProgress}%`
                : syncError
                  ? "Sync failed"
                  : `synced ${relativeTime(lastSyncedAt)}`}
            </span>
            <button
              type="button"
              onClick={() => void sync()}
              disabled={syncing || !canSync}
              title={
                canSync
                  ? undefined
                  : "Only the configured Atlas sync administrator can synchronize"
              }
              className="flex h-[32px] items-center gap-[7px] rounded-md bg-primary px-[12px] text-[13px] font-semibold text-primary-foreground shadow-fabric-2 hover:bg-primary-hover disabled:opacity-70"
            >
              <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
              <span className="hidden sm:inline">
                {syncing ? `${syncProgress}%` : "Sync"}
              </span>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              title={isDark ? "Switch to light theme" : "Switch to dark theme"}
              aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
              className="flex h-[32px] w-[32px] items-center justify-center rounded-md border border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground"
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <Avatar name={currentUser.name} size={30} />
          </div>
          {(syncing || syncProgress > 0) && (
            <div
              role="progressbar"
              aria-label="Workspace synchronization progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={syncProgress}
              className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-muted"
            >
              <div
                className="h-full bg-gradient-to-r from-primary to-lineage-downstream transition-[width] duration-500"
                style={{ width: `${syncProgress}%` }}
              />
            </div>
          )}
        </header>

        <main className="min-h-0 flex-1 overflow-auto bg-transparent">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${tab}:${focus?.requestId ?? "default"}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              className="h-full"
            >
              {tab === "overview" && <OverviewView onOpen={navigate} />}
              {tab === "map" && <MapView />}
              {tab === "catalog" && <CatalogView focus={focus} />}
              {tab === "assets" && <AssetCatalogView focus={focus} />}
              {tab === "governance" && (
                <GovernanceCenterView
                  focus={focus}
                  onNavigate={navigate}
                />
              )}
              {tab === "access" && (
                <AccessView
                  initialItemId={focus?.itemId}
                  initialPrincipalId={focus?.principalId}
                  initialFilters={focus?.filters}
                />
              )}
              {tab === "sensitivity" && (
                <GovernanceCenterView
                  focus={{
                    requestId: focus?.requestId ?? "legacy-sensitivity",
                    governanceSection: "coverage",
                  }}
                  onNavigate={navigate}
                />
              )}
              {tab === "jobs" && <JobsView focus={focus} />}
              {tab === "workspace" && <WorkspaceHubView focus={focus} />}
              {tab === "about" && <AboutView />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      {commandOpen && (
        <CommandPalette
          data={data}
          open
          onClose={() => setCommandOpen(false)}
          onSelect={(result) => navigate(navigationForSearch(result))}
        />
      )}
    </div>
  );
}

export default App;
