import { useMemo } from "react";
import type { Tab } from "@/App";
import { Boxes, Activity, AlertTriangle, Users, Lock, BadgeCheck } from "lucide-react";
import { useAtlas } from "../store";
import { Avatar, Card, HealthDot, SectionLabel, TypeGlyph } from "../ui";
import {
  HEALTH_COLOR,
  typeMeta,
  relativeTime,
  MODEL_SCHEMA,
  type Health,
  type ItemType,
} from "../model";

const JOB_COLOR: Record<string, string> = {
  completed: "#22a565",
  failed: "#e5484d",
  running: "#3b82f6",
  cancelled: "#8b95a5",
};

function Donut({ counts }: { counts: [Health, number][] }) {
  const total = counts.reduce((a, [, c]) => a + c, 0) || 1;
  const r = 52;
  const C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width="132" height="132" viewBox="0 0 132 132">
      <g transform="rotate(-90 66 66)" fill="none" strokeWidth="20">
        {counts.map(([h, c]) => {
          const seg = (c / total) * C;
          const el = (
            <circle
              key={h}
              cx="66"
              cy="66"
              r={r}
              stroke={HEALTH_COLOR[h]}
              strokeDasharray={`${seg} ${C - seg}`}
              strokeDashoffset={-offset}
            />
          );
          offset += seg;
          return el;
        })}
      </g>
      <text x="66" y="62" textAnchor="middle" className="fill-foreground" fontSize="26" fontWeight="700">
        {total}
      </text>
      <text x="66" y="82" textAnchor="middle" className="fill-muted-foreground" fontSize="11">
        items
      </text>
    </svg>
  );
}

export function OverviewView({ onOpen }: { onOpen: (t: Tab) => void }) {
  const { data, lastSyncedAt } = useAtlas();
  const { items, principals, jobs, syncRuns, grants, edges } = data;

  const health = useMemo(() => {
    const c: Record<Health, number> = { healthy: 0, stale: 0, failing: 0, unknown: 0 };
    items.forEach((i) => (c[i.health] += 1));
    return c;
  }, [items]);

  const byType = useMemo(() => {
    const m = new Map<ItemType, number>();
    items.forEach((i) => m.set(i.itemType, (m.get(i.itemType) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const recentJobs = useMemo(
    () => [...jobs].sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt)).slice(0, 6),
    [jobs],
  );

  const maxType = Math.max(...byType.map(([, c]) => c), 1);

  const CONF = new Set(["confidential", "highly confidential"]);
  const confidential = items.filter((i) => CONF.has((i.sensitivity ?? "").toLowerCase()));
  const endorsed = items.filter((i) => i.endorsement !== "none");
  const labeled = items.filter((i) => i.sensitivity);
  const external = principals.filter((p) => p.external);
  const wsPrincipals = new Set(grants.filter((g) => !g.itemFabricId).map((g) => g.principalRef));
  const itemOnly = principals.filter((p) => !wsPrincipals.has(p.displayName));
  const assetCount = items.reduce((n, i) => {
    const s = MODEL_SCHEMA[i.fabricId];
    return n + (s ? s.reduce((m, t) => m + 1 + t.columns.length + t.measures.length, 0) : 0);
  }, 0);
  const pct = (n: number) => Math.round((n / (items.length || 1)) * 100);

  const kpis: { icon: typeof Boxes; label: string; value: number; color: string; go?: Tab; sub: string }[] = [
    { icon: Boxes, label: "Items", value: items.length, color: "#3b82f6", go: "catalog", sub: `${byType.length} types` },
    { icon: Activity, label: "Healthy", value: health.healthy, color: HEALTH_COLOR.healthy, go: "jobs", sub: `of ${items.length}` },
    { icon: AlertTriangle, label: "Needs attention", value: health.stale + health.failing, color: "#e0a417", go: "jobs", sub: `${health.failing} failing` },
    { icon: Users, label: "People & groups", value: principals.length, color: "#7c5cff", go: "access", sub: `${external.length} external` },
    { icon: Lock, label: "Confidential", value: confidential.length, color: "#e5484d", go: "sensitivity", sub: `${labeled.length} labeled` },
    { icon: BadgeCheck, label: "Endorsed", value: endorsed.length, color: "#0ea5b7", go: "catalog", sub: `${pct(endorsed.length)}% coverage` },
  ];

  const tiles = [
    { label: "External access", value: external.length, tab: "access" as Tab, tone: external.length ? "#e5484d" : "#22a565" },
    { label: "Item-only shares", value: itemOnly.length, tab: "access" as Tab, tone: "#e0a417" },
    { label: "Lineage links", value: edges.length, tab: "map" as Tab, tone: "#0ea5b7" },
    { label: "Data assets", value: assetCount, tab: "assets" as Tab, tone: "#3b82f6" },
  ];

  return (
    <div className="flex flex-col gap-[18px] p-[24px]">
      <div>
        <h1 className="text-[22px] font-bold">Governance overview</h1>
        <div className="mt-[4px] text-[13px] text-muted-foreground">
          Everything in {data.workspace.displayName}, indexed by Fabric Atlas · last sync{" "}
          {relativeTime(lastSyncedAt)}
          {syncRuns[0]?.triggeredBy ? ` by ${syncRuns[0].triggeredBy}` : ""}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(158px, 1fr))", gap: 12 }}>
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <button
              key={k.label}
              onClick={() => k.go && onOpen(k.go)}
              className="flex flex-col gap-[8px] rounded-2xl border border-border bg-card p-[15px] text-left transition-all hover:-translate-y-[2px] hover:border-primary/40 hover:shadow-lg"
            >
              <div className="flex items-center gap-[10px]">
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl" style={{ background: `${k.color}1c`, color: k.color }}>
                  <Icon size={18} />
                </span>
                <span className="text-[26px] font-extrabold leading-none tabular-nums" style={{ color: k.color }}>{k.value}</span>
              </div>
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold">{k.label}</div>
                <div className="truncate text-[11px] text-muted-foreground">{k.sub}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Governance snapshot */}
      <Card style={{ padding: 16 }}>
        <div className="flex items-center justify-between">
          <SectionLabel>Governance snapshot</SectionLabel>
          <button className="text-[12px] font-semibold text-primary" onClick={() => onOpen("sensitivity")}>Sensitivity</button>
        </div>
        <div className="mt-[14px] grid gap-[18px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          <div className="flex flex-col gap-[13px]">
            {[
              { label: "Endorsement coverage", n: endorsed.length, color: "#0ea5b7" },
              { label: "Sensitivity labeled", n: labeled.length, color: "#e5484d" },
            ].map((b) => (
              <div key={b.label}>
                <div className="mb-[5px] flex items-center justify-between text-[12.5px]">
                  <span className="font-semibold">{b.label}</span>
                  <span className="tabular-nums text-muted-foreground">{b.n}/{items.length} · {pct(b.n)}%</span>
                </div>
                <div className="h-[9px] overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct(b.n)}%`, background: b.color }} />
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-[10px]">
            {tiles.map((t) => (
              <button key={t.label} onClick={() => onOpen(t.tab)} className="rounded-xl border border-border p-[11px] text-left transition-colors hover:border-primary/40">
                <div className="text-[21px] font-extrabold tabular-nums" style={{ color: t.tone }}>{t.value}</div>
                <div className="text-[11.5px] text-muted-foreground">{t.label}</div>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
        <Card style={{ padding: 16 }}>
          <SectionLabel>Items by type</SectionLabel>
          <div className="mt-[12px] flex flex-col gap-[10px]">
            {byType.map(([t, c]) => (
              <button
                key={t}
                onClick={() => onOpen("catalog")}
                className="flex items-center gap-[11px] text-left"
              >
                <TypeGlyph type={t} size={28} />
                <div className="w-[130px] text-[13px] font-semibold">{typeMeta(t).label}</div>
                <div className="h-[8px] flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(c / maxType) * 100}%`, background: typeMeta(t).color }}
                  />
                </div>
                <div className="w-[24px] text-right text-[13px] font-bold tabular-nums">{c}</div>
              </button>
            ))}
          </div>
        </Card>

        <Card style={{ padding: 16 }}>
          <SectionLabel>Health</SectionLabel>
          <div className="mt-[8px] flex items-center gap-[16px]">
            <Donut
              counts={(Object.entries(health) as [Health, number][]).filter(([, c]) => c > 0)}
            />
            <div className="flex flex-col gap-[8px]">
              {(Object.entries(health) as [Health, number][])
                .filter(([, c]) => c > 0)
                .map(([h, c]) => (
                  <div key={h} className="flex items-center gap-[8px] text-[13px]">
                    <HealthDot health={h} />
                    <span className="capitalize">{h}</span>
                    <span className="ml-auto font-bold tabular-nums">{c}</span>
                  </div>
                ))}
            </div>
          </div>
        </Card>

        <Card style={{ padding: 16 }}>
          <div className="flex items-center justify-between">
            <SectionLabel>Recent activity</SectionLabel>
            <button className="text-[12px] font-semibold text-primary" onClick={() => onOpen("jobs")}>
              View all
            </button>
          </div>
          <div className="mt-[12px] flex flex-col gap-[10px]">
            {recentJobs.map((j, i) => (
              <div key={i} className="flex items-center gap-[10px] text-[13px]">
                <span
                  className="inline-block rounded-full"
                  style={{ width: 8, height: 8, background: JOB_COLOR[j.status] }}
                />
                <span className="truncate font-semibold">{j.itemName}</span>
                <span className="truncate text-muted-foreground">{j.jobType}</span>
                <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">
                  {relativeTime(j.startedAt)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card style={{ padding: 16 }}>
        <div className="flex items-center justify-between">
          <SectionLabel>Owners</SectionLabel>
          <button className="text-[12px] font-semibold text-primary" onClick={() => onOpen("access")}>
            Open access
          </button>
        </div>
        <div className="mt-[12px] flex flex-wrap gap-[16px]">
          {[...new Set(items.map((i) => i.ownerName).filter(Boolean))].map((name) => (
            <div key={name} className="flex items-center gap-[9px]">
              <Avatar name={name as string} size={30} />
              <div className="text-[13px]">
                <div className="font-semibold">{name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {items.filter((i) => i.ownerName === name).length} items
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
