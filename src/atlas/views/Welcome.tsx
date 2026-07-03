import { useState } from "react";
import {
  Activity,
  Boxes,
  FolderTree,
  Lock,
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

function GovernanceLogo({ size = 92 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-label="Fabric Governance">
      <defs>
        <linearGradient id="fg-logo" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0ea5b7" />
          <stop offset="0.55" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#7c5cff" />
        </linearGradient>
      </defs>
      <path d="M32 3 L57 11.5 V30 C57 45.5 46 56 32 61 C18 56 7 45.5 7 30 V11.5 Z" fill="url(#fg-logo)" />
      <path d="M32 3 L57 11.5 V30 C57 45.5 46 56 32 61 C18 56 7 45.5 7 30 V11.5 Z" fill="#000" fillOpacity="0.06" />
      <g stroke="#fff" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" fill="none">
        <path d="M32 15 L45 32 L32 49 L19 32 Z" opacity="0.95" />
      </g>
      <path d="M32 23 L39 32 L32 41 L25 32 Z" fill="#fff" fillOpacity="0.95" />
    </svg>
  );
}

const FEATURES: { icon: typeof FolderTree; label: string; hint: string }[] = [
  { icon: FolderTree, label: "Catalog", hint: "every item, typed & grouped" },
  { icon: Waypoints, label: "Lineage", hint: "down to tables & measures" },
  { icon: Boxes, label: "Assets", hint: "tables, columns, KPIs" },
  { icon: ShieldCheck, label: "Access", hint: "who can reach each object" },
  { icon: Lock, label: "Sensitivity", hint: "labels & confidential items" },
  { icon: Activity, label: "Health", hint: "jobs, runs & failures" },
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
          <GovernanceLogo size={34} />
          <div>
            <div className="text-[16px] font-bold leading-none">Fabric Atlas</div>
            <div className="mt-[2px] text-[11px] text-muted-foreground">Workspace governance</div>
          </div>
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
        <div className="mb-[22px]" style={{ filter: "drop-shadow(0 20px 44px rgba(59,130,246,0.45))" }}>
          <GovernanceLogo size={98} />
        </div>

        <div className="mb-[8px] inline-flex items-center gap-[8px] rounded-full border border-border bg-card/70 px-[12px] py-[5px] text-[12px] text-muted-foreground backdrop-blur">
          <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: "#22a565" }} />
          Connected to <b className="text-foreground">{data.workspace.displayName}</b>
          <span className="opacity-60">· {data.workspace.capacity}</span>
        </div>

        <h1 className="max-w-[760px] text-[34px] font-extrabold leading-[1.12] tracking-tight sm:text-[42px]">
          Fabric workspace{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(120deg,#0ea5b7,#3b82f6,#7c5cff)" }}
          >
            governance
          </span>
          , in one place
        </h1>
        <p className="mt-[14px] max-w-[580px] text-[15px] leading-relaxed text-muted-foreground">
          Discover every item, trace lineage down to the column, see who can reach what, and spotlight
          confidential data. Nothing is stored until you Sync — then it all lands in the Atlas database.
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
