//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  Compass,
  FolderTree,
  MessagesSquare,
  Moon,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sun,
  Waypoints,
} from "lucide-react";

import { useThemeContext } from "@/hooks/theme.context";
import { useAtlas } from "./atlas/store";
import { Avatar, cn } from "./atlas/ui";
import { relativeTime } from "./atlas/model";

import { OverviewView } from "./atlas/views/Overview";
import { MapView } from "./atlas/views/Map";
import { CatalogView } from "./atlas/views/Catalog";
import { AccessView } from "./atlas/views/Access";
import { JobsView } from "./atlas/views/Jobs";
import { ConfigView } from "./atlas/views/Config";
import { CommentsView } from "./atlas/views/Comments";
import { WelcomeView } from "./atlas/views/Welcome";

export type Tab =
  | "overview"
  | "map"
  | "catalog"
  | "access"
  | "jobs"
  | "config"
  | "comments";

const NAV: { id: Tab; label: string; icon: typeof Compass }[] = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "map", label: "Map & lineage", icon: Waypoints },
  { id: "catalog", label: "Catalog", icon: FolderTree },
  { id: "access", label: "Access", icon: ShieldCheck },
  { id: "jobs", label: "Jobs & health", icon: Activity },
  { id: "config", label: "Config", icon: Settings2 },
  { id: "comments", label: "Comments", icon: MessagesSquare },
];

function initialTab(): Tab {
  const h = window.location.hash.replace("#", "") as Tab;
  return NAV.some((n) => n.id === h) ? h : "overview";
}

function App() {
  const [tab, setTab] = useState<Tab>(initialTab);
  const { isDark, toggleTheme } = useThemeContext();
  const { data, sync, syncing, lastSyncedAt, currentUser, isPreview, hasData } =
    useAtlas();

  useEffect(() => {
    window.location.hash = tab;
  }, [tab]);

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace("#", "") as Tab;
      if (NAV.some((n) => n.id === h)) setTab(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const nav = (t: Tab) => setTab(t);

  // Deployed and nothing synced yet → the classy first-run screen.
  if (!isPreview && !hasData) {
    return <WelcomeView />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside className="flex w-[236px] shrink-0 flex-col border-r border-border bg-secondary">
        <div className="flex items-center gap-[11px] px-[16px] py-[16px]">
          <span
            className="flex items-center justify-center rounded-xl text-white"
            style={{
              width: 34,
              height: 34,
              background: "linear-gradient(135deg,#0ea5b7,#3b82f6)",
            }}
          >
            <Compass size={19} />
          </span>
          <div>
            <div className="text-[16px] font-bold leading-none">Fabric Atlas</div>
            <div className="mt-[3px] text-[11px] text-muted-foreground">
              Workspace explorer
            </div>
          </div>
        </div>

        <nav className="flex flex-col gap-[2px] px-[10px]">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => nav(id)}
              className={cn(
                "flex items-center gap-[11px] rounded-lg px-[11px] py-[9px] text-left text-[13.5px] font-semibold transition-colors",
                tab === id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>

        <div className="mt-auto p-[12px]">
          <div className="rounded-xl border border-border bg-card p-[12px] text-[12px] text-muted-foreground">
            <div>Fabric workspace</div>
            <div className="mt-[2px] text-[13px] font-bold text-foreground">
              {data.workspace.displayName}
            </div>
            <div className="mt-[4px] text-[11px]">{data.workspace.capacity}</div>
            <div className="mt-[6px] flex items-center gap-[6px] text-[11px]">
              <span
                className="inline-block rounded-full"
                style={{ width: 7, height: 7, background: "#22a565" }}
              />
              {data.items.length} items indexed
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[56px] shrink-0 items-center justify-between border-b border-border px-[22px]">
          <div className="text-[13px] text-muted-foreground">
            Fabric · <b className="text-foreground">{data.workspace.displayName}</b> ·{" "}
            {NAV.find((n) => n.id === tab)?.label}
          </div>
          <div className="flex items-center gap-[14px]">
            <span className="hidden text-[12px] text-muted-foreground sm:inline">
              synced {relativeTime(lastSyncedAt)}
            </span>
            <button
              onClick={() => void sync()}
              disabled={syncing}
              className="flex items-center gap-[8px] rounded-lg px-[13px] py-[8px] text-[13px] font-bold text-white disabled:opacity-70"
              style={{ background: "linear-gradient(135deg,#0ea5b7,#3b82f6)" }}
            >
              <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Syncing…" : "Sync"}
            </button>
            <button
              onClick={toggleTheme}
              title="Toggle theme"
              className="flex items-center justify-center rounded-lg border border-border bg-card p-[8px] text-muted-foreground hover:text-foreground"
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <Avatar name={currentUser.name} size={30} />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto">
          {tab === "overview" && <OverviewView onOpen={nav} />}
          {tab === "map" && <MapView />}
          {tab === "catalog" && <CatalogView />}
          {tab === "access" && <AccessView />}
          {tab === "jobs" && <JobsView />}
          {tab === "config" && <ConfigView />}
          {tab === "comments" && <CommentsView />}
        </main>
      </div>
    </div>
  );
}

export default App;
