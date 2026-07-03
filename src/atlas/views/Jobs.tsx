import { useMemo } from "react";
import { CheckCircle2, XCircle, Loader2, Ban } from "lucide-react";
import { useAtlas } from "../store";
import { Card, SectionLabel, TypeGlyph } from "../ui";
import { relativeTime, type Item, type JobStatus } from "../model";

const STATUS: Record<JobStatus, { color: string; icon: typeof CheckCircle2; label: string }> = {
  completed: { color: "#22a565", icon: CheckCircle2, label: "Completed" },
  failed: { color: "#e5484d", icon: XCircle, label: "Failed" },
  running: { color: "#3b82f6", icon: Loader2, label: "Running" },
  cancelled: { color: "#8b95a5", icon: Ban, label: "Cancelled" },
};

function duration(sec: number, status: JobStatus): string {
  if (status === "running") return "in progress";
  if (sec <= 0) return "—";
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export function JobsView() {
  const { data } = useAtlas();
  const { jobs, items } = data;

  const itemById = useMemo(
    () => new Map<string, Item>(items.map((i) => [i.fabricId, i])),
    [items],
  );
  const sorted = useMemo(
    () => [...jobs].sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt)),
    [jobs],
  );

  const failed = jobs.filter((j) => j.status === "failed").length;
  const running = jobs.filter((j) => j.status === "running").length;
  const done = jobs.filter((j) => j.status === "completed");
  const avg = done.length
    ? Math.round(done.reduce((a, j) => a + j.durationSec, 0) / done.length)
    : 0;

  const kpis = [
    { label: "Runs (recent)", value: `${jobs.length}` },
    { label: "Failed", value: `${failed}`, color: "#e5484d" },
    { label: "Running", value: `${running}`, color: "#3b82f6" },
    { label: "Avg duration", value: `${avg}s` },
  ];

  return (
    <div className="flex flex-col gap-[16px] p-[24px]">
      <div>
        <h1 className="text-[22px] font-bold">Jobs & health</h1>
        <div className="mt-[4px] text-[13px] text-muted-foreground">
          Refreshes, pipeline and notebook runs from the Fabric job history
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {kpis.map((k) => (
          <Card key={k.label} style={{ padding: 16 }}>
            <SectionLabel>{k.label}</SectionLabel>
            <div className="mt-[8px] text-[26px] font-bold" style={{ color: k.color }}>
              {k.value}
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-[16px] py-[12px] font-bold">Status</th>
              <th className="px-[16px] py-[12px] font-bold">Item</th>
              <th className="px-[16px] py-[12px] font-bold">Job</th>
              <th className="px-[16px] py-[12px] font-bold">Started</th>
              <th className="px-[16px] py-[12px] font-bold">Duration</th>
              <th className="px-[16px] py-[12px] font-bold">Detail</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((j, idx) => {
              const s = STATUS[j.status];
              const Icon = s.icon;
              const item = itemById.get(j.itemFabricId);
              return (
                <tr key={idx} className="border-b border-border/60 text-[13px] last:border-0">
                  <td className="px-[16px] py-[12px]">
                    <span
                      className="inline-flex items-center gap-[7px] rounded-md px-[9px] py-[3px] text-[12px] font-bold"
                      style={{ background: `${s.color}22`, color: s.color }}
                    >
                      <Icon size={13} className={j.status === "running" ? "animate-spin" : ""} />
                      {s.label}
                    </span>
                  </td>
                  <td className="px-[16px] py-[12px]">
                    <div className="flex items-center gap-[9px]">
                      {item && <TypeGlyph type={item.itemType} size={26} />}
                      <span className="font-semibold">{j.itemName}</span>
                    </div>
                  </td>
                  <td className="px-[16px] py-[12px] text-muted-foreground">{j.jobType}</td>
                  <td className="px-[16px] py-[12px] text-muted-foreground">
                    {relativeTime(j.startedAt)}
                  </td>
                  <td className="px-[16px] py-[12px] tabular-nums">
                    {duration(j.durationSec, j.status)}
                  </td>
                  <td className="px-[16px] py-[12px] text-muted-foreground">
                    {j.message ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
