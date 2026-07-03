import { useMemo } from "react";
import type { Tab } from "@/App";
import { useAtlas } from "../store";
import { Avatar, Card, HealthDot, SectionLabel, TypeGlyph } from "../ui";
import {
  HEALTH_COLOR,
  ITEM_TYPES,
  relativeTime,
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
  const { items, principals, jobs, syncRuns } = data;

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

  const kpis: { label: string; value: number; color?: string; go?: Tab }[] = [
    { label: "Items", value: items.length },
    { label: "Healthy", value: health.healthy, color: HEALTH_COLOR.healthy },
    { label: "Stale", value: health.stale, color: HEALTH_COLOR.stale, go: "jobs" },
    { label: "Failing", value: health.failing, color: HEALTH_COLOR.failing, go: "jobs" },
    { label: "People & groups", value: principals.length, go: "access" },
  ];

  return (
    <div className="flex flex-col gap-[18px] p-[24px]">
      <div>
        <h1 className="text-[22px] font-bold">Overview</h1>
        <div className="mt-[4px] text-[13px] text-muted-foreground">
          Everything in {data.workspace.displayName}, indexed by FabricAtlas · last sync{" "}
          {relativeTime(lastSyncedAt)}
          {syncRuns[0]?.triggeredBy ? ` by ${syncRuns[0].triggeredBy}` : ""}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14 }}>
        {kpis.map((k) => (
          <Card
            key={k.label}
            className={k.go ? "cursor-pointer transition-colors hover:border-primary" : ""}
            style={{ padding: 16 }}
          >
            <button
              className="w-full text-left"
              onClick={() => k.go && onOpen(k.go)}
              disabled={!k.go}
            >
              <SectionLabel>{k.label}</SectionLabel>
              <div className="mt-[8px] text-[28px] font-bold" style={{ color: k.color }}>
                {k.value}
              </div>
            </button>
          </Card>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1.2fr", gap: 18 }}>
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
                <div className="w-[130px] text-[13px] font-semibold">{ITEM_TYPES[t].label}</div>
                <div className="h-[8px] flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(c / maxType) * 100}%`, background: ITEM_TYPES[t].color }}
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
                <span className="font-semibold">{j.itemName}</span>
                <span className="text-muted-foreground">{j.jobType}</span>
                <span className="ml-auto text-[12px] text-muted-foreground">
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
