import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useAtlas } from "../store";
import { Card, EndorsementChip, HealthChip, TypeGlyph, cn } from "../ui";
import { typeMeta, type ConfigKV, type Item } from "../model";

export function ConfigView() {
  const { data } = useAtlas();
  const { items, config } = data;

  const configByItem = useMemo(() => {
    const m = new Map<string, ConfigKV[]>();
    config.forEach((c) => {
      const arr = m.get(c.itemFabricId) ?? [];
      arr.push(c);
      m.set(c.itemFabricId, arr);
    });
    return m;
  }, [config]);

  const firstWithConfig = items.find((i) => configByItem.has(i.fabricId)) ?? items[0];
  const [selId, setSelId] = useState<string>(firstWithConfig?.fabricId ?? "");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const sel: Item | undefined = items.find((i) => i.fabricId === selId);
  const entries = useMemo(
    () => configByItem.get(selId) ?? [],
    [configByItem, selId],
  );

  const sections = useMemo(() => {
    const m = new Map<string, ConfigKV[]>();
    entries.forEach((e) => {
      const arr = m.get(e.section) ?? [];
      arr.push(e);
      m.set(e.section, arr);
    });
    return [...m.entries()];
  }, [entries]);

  const toggle = (s: string) =>
    setExpandedSections((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });

  return (
    <div className="flex flex-col gap-[16px] p-[24px]">
      <div>
        <h1 className="text-[22px] font-bold">Config</h1>
        <div className="mt-[4px] text-[13px] text-muted-foreground">
          Everything retrievable about each item — settings, schedules, tables, measures,
          bindings — as an expandable tree
        </div>
      </div>

      <div className="grid items-start gap-[16px] lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="border-b border-border px-[14px] py-[11px] text-[13px] font-bold">
            Items
          </div>
          <div className="max-h-[560px] overflow-auto">
            {items.map((i) => {
              const count = configByItem.get(i.fabricId)?.length ?? 0;
              return (
                <button
                  key={i.fabricId}
                  onClick={() => {
                    setSelId(i.fabricId);
                    setExpandedSections(new Set());
                  }}
                  className={cn(
                    "flex w-full items-center gap-[10px] border-t border-border/60 px-[14px] py-[10px] text-left first:border-t-0",
                    selId === i.fabricId ? "bg-accent" : "hover:bg-accent/60",
                  )}
                >
                  <TypeGlyph type={i.itemType} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{i.displayName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {typeMeta(i.itemType).label}
                    </div>
                  </div>
                  <span className="text-[11px] font-bold text-muted-foreground">{count}</span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card style={{ padding: 16 }}>
          {sel && (
            <div className="mb-[14px] flex items-center gap-[12px]">
              <TypeGlyph type={sel.itemType} size={40} />
              <div className="flex-1">
                <div className="text-[17px] font-bold">{sel.displayName}</div>
                <div className="text-[12px] text-muted-foreground">
                  {typeMeta(sel.itemType).label}
                  {sel.ownerName ? ` · owned by ${sel.ownerName}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-[8px]">
                <HealthChip health={sel.health} />
                <EndorsementChip endorsement={sel.endorsement} />
              </div>
            </div>
          )}

          {sections.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-[24px] text-center text-[13px] text-muted-foreground">
              No configuration retrievable for this item. If you haven't synced yet, run a
              Sync; otherwise its details are restricted or aren't exposed by the Fabric APIs
              for this item type.
            </div>
          )}

          <div className="flex flex-col gap-[10px]">
            {sections.map(([section, kvs]) => {
              const open = expandedSections.has(section);
              return (
                <div key={section} className="overflow-hidden rounded-xl border border-border">
                  <button
                    onClick={() => toggle(section)}
                    className="flex w-full items-center gap-[8px] bg-muted px-[14px] py-[10px] text-left"
                  >
                    {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    <span className="text-[13px] font-bold">{section}</span>
                    <span className="ml-auto text-[11px] font-semibold text-muted-foreground">
                      {kvs.length}
                    </span>
                  </button>
                  {open && (
                    <div className="divide-y divide-border/60">
                      {kvs.map((kv, i) => (
                        <div key={i} className="grid gap-[5px] px-[14px] py-[9px] sm:grid-cols-[180px_1fr] xl:grid-cols-[220px_1fr]">
                          <div className="text-[13px] font-semibold text-muted-foreground">
                            {kv.label}
                          </div>
                          <div className="text-[13px] font-mono break-all">{kv.value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
