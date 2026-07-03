import { useMemo } from "react";
import { motion } from "framer-motion";
import { ShieldAlert, Lock, ShieldCheck, Globe, EyeOff } from "lucide-react";
import { useAtlas } from "../store";
import { Card, TypeGlyph, cn } from "../ui";
import { typeMeta, type Item } from "../model";

interface Label {
  name: string;
  color: string;
  rank: number;
  icon: typeof Lock;
  blurb: string;
}

const LABELS: Label[] = [
  { name: "Highly Confidential", color: "#e5484d", rank: 4, icon: Lock, blurb: "Most sensitive — restrict sharing" },
  { name: "Confidential", color: "#e0a417", rank: 3, icon: ShieldAlert, blurb: "Business-sensitive — review who can see it" },
  { name: "General", color: "#3b82f6", rank: 2, icon: ShieldCheck, blurb: "Internal use" },
  { name: "Public", color: "#22a565", rank: 1, icon: Globe, blurb: "Safe to share" },
];
const UNLABELED: Label = { name: "Unlabeled", color: "#8b95a5", rank: 0, icon: EyeOff, blurb: "No sensitivity label applied" };

function labelFor(s?: string): Label {
  return LABELS.find((l) => l.name.toLowerCase() === (s ?? "").toLowerCase()) ?? UNLABELED;
}

export function SensitivityView() {
  const { data } = useAtlas();
  const { items } = data;

  const byLabel = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of items) {
      const l = labelFor(it.sensitivity).name;
      const a = m.get(l) ?? [];
      a.push(it);
      m.set(l, a);
    }
    return m;
  }, [items]);

  const order = [...LABELS, UNLABELED];
  const labeled = items.filter((i) => i.sensitivity).length;
  const confidential = items.filter((i) => labelFor(i.sensitivity).rank >= 3);

  return (
    <div className="flex flex-col gap-[16px] p-[24px]">
      <div>
        <h1 className="text-[22px] font-bold">Sensitivity labels</h1>
        <div className="mt-[4px] text-[13px] text-muted-foreground">
          Every Microsoft Information Protection label in the workspace, with the confidential items front and center
        </div>
      </div>

      {/* label summary */}
      <div className="grid gap-[12px]" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        {order.map((l) => {
          const n = byLabel.get(l.name)?.length ?? 0;
          const Icon = l.icon;
          return (
            <Card key={l.name} style={{ padding: 14 }} className="flex flex-col gap-[8px]">
              <div className="flex items-center gap-[8px]">
                <span
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-lg"
                  style={{ background: `${l.color}22`, color: l.color }}
                >
                  <Icon size={16} />
                </span>
                <span className="text-[24px] font-extrabold tabular-nums" style={{ color: l.color }}>{n}</span>
              </div>
              <div className="text-[13px] font-bold leading-tight">{l.name}</div>
              <div className="text-[11px] leading-snug text-muted-foreground">{l.blurb}</div>
            </Card>
          );
        })}
      </div>

      {/* confidential spotlight */}
      {confidential.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          <Card className="overflow-hidden border-[#e5484d]/40">
            <div className="flex items-center gap-[10px] border-b border-[#e5484d]/30 bg-[#e5484d]/10 px-[16px] py-[12px]">
              <ShieldAlert size={17} className="text-[#e5484d]" />
              <span className="text-[13px] font-bold text-[#e5484d]">
                {confidential.length} confidential item{confidential.length > 1 ? "s" : ""} — review access
              </span>
            </div>
            <div className="grid gap-[10px] p-[14px]" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
              {confidential.map((i) => {
                const l = labelFor(i.sensitivity);
                return (
                  <div key={i.fabricId} className="flex items-center gap-[11px] rounded-xl border border-border px-[12px] py-[10px]">
                    <TypeGlyph type={i.itemType} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{i.displayName}</div>
                      <div className="text-[11px] text-muted-foreground">{typeMeta(i.itemType).label}</div>
                    </div>
                    <span
                      className="shrink-0 rounded-md px-[8px] py-[3px] text-[11px] font-bold"
                      style={{ background: `${l.color}22`, color: l.color }}
                    >
                      {l.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </motion.div>
      )}

      {/* full breakdown */}
      <div className="flex flex-col gap-[12px]">
        {order.map((l) => {
          const list = byLabel.get(l.name) ?? [];
          if (list.length === 0) return null;
          const Icon = l.icon;
          return (
            <Card key={l.name} className="overflow-hidden">
              <div className="flex items-center gap-[9px] border-b border-border px-[16px] py-[11px]">
                <span className="flex h-[24px] w-[24px] items-center justify-center rounded-md" style={{ background: `${l.color}22`, color: l.color }}>
                  <Icon size={14} />
                </span>
                <span className="text-[13px] font-bold">{l.name}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">{list.length}</span>
              </div>
              <div className="divide-y divide-border/50">
                {list.map((i) => (
                  <div key={i.fabricId} className={cn("flex items-center gap-[11px] px-[16px] py-[9px]")}>
                    <TypeGlyph type={i.itemType} size={26} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{i.displayName}</div>
                      <div className="text-[11px] text-muted-foreground">{typeMeta(i.itemType).label}</div>
                    </div>
                    {i.ownerName && <span className="text-[11.5px] text-muted-foreground">{i.ownerName}</span>}
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
