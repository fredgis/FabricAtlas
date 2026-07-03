import { useState } from "react";
import {
  Activity,
  BarChart3,
  Compass,
  FolderTree,
  MessagesSquare,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Waypoints,
  Link2,
  AlertTriangle,
} from "lucide-react";

import { useThemeContext } from "@/hooks/theme.context";
import { useAtlas } from "../store";
import { Avatar, cn } from "../ui";

const FEATURES: { icon: typeof Compass; label: string; hint: string }[] = [
  { icon: FolderTree, label: "Catalog", hint: "every item, typed & grouped" },
  { icon: Waypoints, label: "Lineage", hint: "down to tables & measures" },
  { icon: ShieldCheck, label: "Access", hint: "users & their permissions" },
  { icon: Activity, label: "Jobs", hint: "runs, health & failures" },
  { icon: BarChart3, label: "Config", hint: "exhaustive item settings" },
  { icon: MessagesSquare, label: "Comments", hint: "your team layer" },
];

export function WelcomeView() {
  const { isDark, toggleTheme } = useThemeContext();
  const { data, sync, syncing, configured, setSyncUrl, syncError, currentUser } =
    useAtlas();
  const [url, setUrl] = useState("");

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* ambient gradient blobs */}
      <div
        className="pointer-events-none absolute -left-[12%] -top-[18%] h-[520px] w-[520px] rounded-full opacity-40 blur-[90px]"
        style={{ background: "radial-gradient(circle,#0ea5b7,transparent 60%)" }}
      />
      <div
        className="pointer-events-none absolute -right-[10%] top-[30%] h-[560px] w-[560px] rounded-full opacity-30 blur-[100px]"
        style={{ background: "radial-gradient(circle,#7c5cff,transparent 60%)" }}
      />

      {/* top bar */}
      <header className="relative z-10 flex items-center justify-between px-[26px] py-[18px]">
        <div className="flex items-center gap-[11px]">
          <span
            className="flex items-center justify-center rounded-xl text-white"
            style={{ width: 34, height: 34, background: "linear-gradient(135deg,#0ea5b7,#3b82f6)" }}
          >
            <Compass size={19} />
          </span>
          <div className="text-[16px] font-bold">Fabric Atlas</div>
        </div>
        <div className="flex items-center gap-[12px]">
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

      {/* hero */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-[24px] text-center">
        <div
          className="mb-[22px] flex items-center justify-center rounded-[26px] text-white shadow-2xl"
          style={{
            width: 92,
            height: 92,
            background: "linear-gradient(135deg,#0ea5b7,#3b82f6 55%,#7c5cff)",
            boxShadow: "0 20px 60px -18px rgba(59,130,246,0.65)",
          }}
        >
          <Compass size={46} strokeWidth={1.6} />
        </div>

        <div className="mb-[8px] inline-flex items-center gap-[8px] rounded-full border border-border bg-card/70 px-[12px] py-[5px] text-[12px] text-muted-foreground backdrop-blur">
          <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: "#22a565" }} />
          Connected to <b className="text-foreground">{data.workspace.displayName}</b>
          <span className="opacity-60">· {data.workspace.capacity}</span>
        </div>

        <h1 className="max-w-[720px] text-[34px] font-extrabold leading-[1.12] tracking-tight sm:text-[40px]">
          One map of everything in your{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(120deg,#0ea5b7,#3b82f6,#7c5cff)" }}
          >
            Fabric workspace
          </span>
        </h1>
        <p className="mt-[14px] max-w-[560px] text-[15px] leading-relaxed text-muted-foreground">
          Nothing is stored yet. Run a Sync to read the live workspace — items,
          lineage, users &amp; access, jobs and config — straight into the Atlas
          database.
        </p>

        {/* URL config (only until the UDF invoke URL is known) */}
        {!configured && (
          <div className="mt-[22px] w-full max-w-[560px] rounded-2xl border border-border bg-card/80 p-[14px] text-left backdrop-blur">
            <div className="mb-[7px] flex items-center gap-[7px] text-[12.5px] font-semibold">
              <Link2 size={14} /> Sync endpoint
            </div>
            <div className="mb-[9px] text-[12px] text-muted-foreground">
              Publish the <code>atlas_sync_functions</code> function in Fabric,
              then paste its <b>sync_all</b> invoke URL once.
            </div>
            <div className="flex gap-[8px]">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…userdatafunctions.fabric.microsoft.com/…/sync_all"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-[11px] py-[8px] text-[12.5px] outline-none focus:border-primary"
              />
              <button
                onClick={() => url.trim() && setSyncUrl(url)}
                className="rounded-lg border border-border bg-card px-[13px] py-[8px] text-[12.5px] font-semibold hover:text-foreground"
              >
                Save
              </button>
            </div>
          </div>
        )}

        <button
          onClick={() => void sync()}
          disabled={syncing || !configured}
          className="mt-[22px] flex items-center gap-[10px] rounded-xl px-[22px] py-[13px] text-[15px] font-bold text-white shadow-lg transition disabled:opacity-60"
          style={{ background: "linear-gradient(135deg,#0ea5b7,#3b82f6)" }}
        >
          <RefreshCw size={18} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing workspace…" : "Sync this workspace"}
        </button>

        {syncError && (
          <div className="mt-[16px] flex max-w-[560px] items-start gap-[8px] rounded-xl border border-[#e5484d]/40 bg-[#e5484d]/10 px-[13px] py-[10px] text-left text-[12.5px] text-[#e5484d]">
            <AlertTriangle size={15} className="mt-[1px] shrink-0" />
            <span className="break-words">{syncError}</span>
          </div>
        )}

        {/* feature chips */}
        <div className="mt-[34px] grid w-full max-w-[720px] grid-cols-2 gap-[10px] sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, label, hint }) => (
            <div
              key={label}
              className={cn(
                "flex items-center gap-[11px] rounded-xl border border-border bg-card/70 px-[13px] py-[11px] text-left backdrop-blur",
              )}
            >
              <span
                className="flex items-center justify-center rounded-lg text-white"
                style={{ width: 30, height: 30, background: "linear-gradient(135deg,#0ea5b7,#3b82f6)" }}
              >
                <Icon size={16} />
              </span>
              <div>
                <div className="text-[13px] font-semibold">{label}</div>
                <div className="text-[11px] text-muted-foreground">{hint}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
