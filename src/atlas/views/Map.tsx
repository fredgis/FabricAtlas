import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useAtlas } from "../store";
import {
  Avatar,
  Card,
  EndorsementChip,
  HealthChip,
  HealthDot,
  SectionLabel,
  TypeGlyph,
  cn,
} from "../ui";
import {
  HEALTH_COLOR,
  ITEM_TYPES,
  MODEL_SCHEMA,
  relativeTime,
  type Item,
  type ItemType,
} from "../model";

const LAYER: Record<ItemType, number> = {
  DataPipeline: 0,
  Dataflow: 0,
  Notebook: 0,
  Lakehouse: 1,
  Warehouse: 1,
  Eventhouse: 1,
  SQLEndpoint: 2,
  SemanticModel: 2,
  KQLDatabase: 2,
  Report: 3,
  Dashboard: 3,
};

const NODE_W = 186;
const NODE_H = 54;
const COL_GAP = 250;
const ROW_GAP = 72;

export function MapView() {
  const { data } = useAtlas();
  const { items, edges, comments, config } = data;

  const layout = useMemo(() => {
    const layers: Item[][] = [[], [], [], []];
    [...items]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .forEach((it) => layers[LAYER[it.itemType]].push(it));
    const pos = new Map<string, { x: number; y: number }>();
    layers.forEach((col, li) => {
      col.forEach((it, idx) => {
        pos.set(it.fabricId, { x: 24 + li * COL_GAP, y: 24 + idx * ROW_GAP });
      });
    });
    const rows = Math.max(...layers.map((c) => c.length), 1);
    return {
      pos,
      width: 24 + 3 * COL_GAP + NODE_W + 24,
      height: 24 + rows * ROW_GAP + 8,
    };
  }, [items]);

  const itemById = useMemo(
    () => new Map<string, Item>(items.map((i) => [i.fabricId, i])),
    [items],
  );

  const [selId, setSelId] = useState<string>(
    items.find((i) => i.itemType === "SemanticModel")?.fabricId ?? items[0]?.fabricId ?? "",
  );
  const sel = itemById.get(selId);
  const schema = MODEL_SCHEMA[selId];
  const [openTables, setOpenTables] = useState<Set<string>>(new Set());
  const toggleTable = (t: string) =>
    setOpenTables((prev) => {
      const n = new Set(prev);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });

  const upstream = edges.filter((e) => e.target === selId).map((e) => itemById.get(e.source)!).filter(Boolean);
  const downstream = edges.filter((e) => e.source === selId).map((e) => itemById.get(e.target)!).filter(Boolean);

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1 overflow-auto bg-muted/40">
        <div
          className="relative m-[16px]"
          style={{ width: layout.width, height: layout.height }}
        >
          <svg
            className="absolute inset-0"
            width={layout.width}
            height={layout.height}
            style={{ zIndex: 0 }}
          >
            {edges.map((e, i) => {
              const s = layout.pos.get(e.source);
              const t = layout.pos.get(e.target);
              if (!s || !t) return null;
              const x1 = s.x + NODE_W;
              const y1 = s.y + NODE_H / 2;
              const x2 = t.x;
              const y2 = t.y + NODE_H / 2;
              const active = e.source === selId || e.target === selId;
              return (
                <path
                  key={i}
                  d={`M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`}
                  fill="none"
                  stroke={e.broken ? "#e5484d" : active ? "#3b82f6" : "#94a3b8"}
                  strokeWidth={active ? 2.5 : 1.6}
                  strokeOpacity={e.broken ? 0.85 : active ? 0.9 : 0.4}
                  strokeDasharray={e.broken ? "6 5" : undefined}
                />
              );
            })}
          </svg>

          {items.map((it) => {
            const p = layout.pos.get(it.fabricId)!;
            const selected = it.fabricId === selId;
            return (
              <button
                key={it.fabricId}
                onClick={() => setSelId(it.fabricId)}
                className={cn(
                  "absolute flex items-center gap-[10px] rounded-xl border bg-card px-[12px] text-left shadow-sm transition-shadow",
                  selected ? "border-primary" : "border-border hover:shadow-md",
                )}
                style={{
                  left: p.x,
                  top: p.y,
                  width: NODE_W,
                  height: NODE_H,
                  zIndex: 1,
                  boxShadow: selected ? "0 0 0 2px var(--color-primary)" : undefined,
                }}
              >
                <TypeGlyph type={it.itemType} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold leading-[1.15]">
                    {it.displayName}
                  </div>
                  <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    {ITEM_TYPES[it.itemType].label}
                  </div>
                </div>
                <HealthDot health={it.health} />
              </button>
            );
          })}
        </div>

        <div className="pointer-events-none absolute bottom-[16px] left-[16px] rounded-xl border border-border bg-card/90 px-[13px] py-[11px] backdrop-blur">
          <SectionLabel>Health</SectionLabel>
          <div className="mt-[8px] flex flex-col gap-[5px] text-[12px]">
            {(["healthy", "stale", "failing"] as const).map((h) => (
              <div key={h} className="flex items-center gap-[8px]">
                <HealthDot health={h} /> <span className="capitalize">{h}</span>
              </div>
            ))}
            <div className="mt-[3px] flex items-center gap-[8px]">
              <span style={{ color: "#e5484d", fontWeight: 800 }}>— —</span> broken lineage
            </div>
          </div>
        </div>
      </div>

      {/* Inspector */}
      <aside className="w-[324px] shrink-0 overflow-auto border-l border-border bg-card p-[16px]">
        {sel && (
          <div className="flex flex-col gap-[14px]">
            <div className="flex items-center gap-[12px]">
              <TypeGlyph type={sel.itemType} size={44} />
              <div className="min-w-0">
                <div className="truncate text-[17px] font-bold">{sel.displayName}</div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {ITEM_TYPES[sel.itemType].label}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-[8px]">
              <HealthChip health={sel.health} />
              <EndorsementChip endorsement={sel.endorsement} />
              {sel.sensitivity && (
                <span className="rounded-md bg-muted px-[8px] py-[2px] text-[11px] font-semibold text-muted-foreground">
                  {sel.sensitivity}
                </span>
              )}
            </div>

            {sel.description && (
              <p className="text-[13px] leading-[1.5] text-muted-foreground">{sel.description}</p>
            )}

            <div className="rounded-xl border border-border p-[12px]">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted-foreground">Owner</span>
                {sel.ownerName ? (
                  <span className="flex items-center gap-[8px] font-semibold">
                    <Avatar name={sel.ownerName} size={24} /> {sel.ownerName}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Unassigned</span>
                )}
              </div>
              <div className="mt-[8px] flex items-center justify-between text-[13px]">
                <span className="text-muted-foreground">Last refresh</span>
                <span className="font-semibold">{relativeTime(sel.lastRefresh)}</span>
              </div>
            </div>

            <div>
              <SectionLabel>Downstream · {downstream.length}</SectionLabel>
              <div className="mt-[8px] flex flex-col gap-[6px]">
                {downstream.length === 0 && (
                  <span className="text-[12px] text-muted-foreground">Nothing depends on this.</span>
                )}
                {downstream.map((d) => (
                  <button
                    key={d.fabricId}
                    onClick={() => setSelId(d.fabricId)}
                    className="flex items-center gap-[8px] text-left text-[13px]"
                  >
                    <TypeGlyph type={d.itemType} size={22} />
                    <span className="font-medium">{d.displayName}</span>
                    <HealthDot health={d.health} size={8} />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <SectionLabel>Upstream · {upstream.length}</SectionLabel>
              <div className="mt-[8px] flex flex-col gap-[6px]">
                {upstream.length === 0 && (
                  <span className="text-[12px] text-muted-foreground">No sources — this is a root.</span>
                )}
                {upstream.map((u) => (
                  <button
                    key={u.fabricId}
                    onClick={() => setSelId(u.fabricId)}
                    className="flex items-center gap-[8px] text-left text-[13px]"
                  >
                    <TypeGlyph type={u.itemType} size={22} />
                    <span className="font-medium">{u.displayName}</span>
                    <HealthDot health={u.health} size={8} />
                  </button>
                ))}
              </div>
            </div>

            {schema && (
              <div>
                <SectionLabel>Deep lineage · {schema.length} tables</SectionLabel>
                <div className="mt-[8px] flex flex-col gap-[5px]">
                  {schema.map((t) => {
                    const open = openTables.has(t.name);
                    return (
                      <div key={t.name} className="overflow-hidden rounded-lg border border-border">
                        <button
                          onClick={() => toggleTable(t.name)}
                          className="flex w-full items-center gap-[6px] px-[10px] py-[7px] text-left"
                        >
                          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          <span className="text-[12.5px] font-semibold">{t.name}</span>
                          {t.rows != null && (
                            <span className="ml-auto text-[11px] text-muted-foreground">
                              {t.rows} rows
                            </span>
                          )}
                        </button>
                        {open && (
                          <div className="flex flex-col gap-[8px] border-t border-border/60 px-[10px] py-[8px]">
                            {t.measures.length > 0 && (
                              <div>
                                <div className="mb-[3px] text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                  Measures · {t.measures.length}
                                </div>
                                {t.measures.map((m) => (
                                  <div key={m.name} className="flex items-center gap-[7px] py-[1px] text-[12px]">
                                    <span className="inline-block" style={{ width: 6, height: 6, borderRadius: 2, background: "#d9a520" }} />
                                    <span className="font-medium">{m.name}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div>
                              <div className="mb-[3px] text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                Columns · {t.columns.length}
                              </div>
                              {t.columns.map((c) => (
                                <div key={c.name} className="flex items-center gap-[7px] py-[1px] text-[12px]">
                                  <span className="inline-block" style={{ width: 6, height: 6, borderRadius: 2, background: "#4c8dff" }} />
                                  <span className="font-mono">{c.name}</span>
                                  <span className="ml-auto text-[11px] text-muted-foreground">{c.dataType}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-[10px]">
              <Card style={{ padding: 12 }}>
                <div className="text-[22px] font-bold" style={{ color: HEALTH_COLOR.healthy }}>
                  {config.filter((c) => c.itemFabricId === selId).length}
                </div>
                <div className="text-[11px] text-muted-foreground">config facts</div>
              </Card>
              <Card style={{ padding: 12 }}>
                <div className="text-[22px] font-bold">
                  {comments.filter((c) => c.itemFabricId === selId).length}
                </div>
                <div className="text-[11px] text-muted-foreground">comments</div>
              </Card>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
