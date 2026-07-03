import { useMemo, useRef, useState, type PointerEvent as RPE } from "react";
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
  typeMeta,
  schemaFor,
  relativeTime,
  type Item,
  type ItemType,
} from "../model";

const LAYER: Partial<Record<ItemType, number>> = {
  DataPipeline: 0,
  Dataflow: 0,
  Notebook: 0,
  Eventstream: 0,
  UserDataFunction: 0,
  AppBackend: 0,
  Lakehouse: 1,
  Warehouse: 1,
  Eventhouse: 1,
  MirroredDatabase: 1,
  SQLEndpoint: 2,
  SQLDatabase: 2,
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
      .forEach((it) => layers[LAYER[it.itemType] ?? 0].push(it));
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
  const schema = schemaFor(data, selId);
  const [openTables, setOpenTables] = useState<Set<string>>(new Set());
  const toggleTable = (t: string) =>
    setOpenTables((prev) => {
      const n = new Set(prev);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });

  const upstream = edges.filter((e) => e.target === selId).map((e) => itemById.get(e.source)!).filter(Boolean);
  const downstream = edges.filter((e) => e.source === selId).map((e) => itemById.get(e.target)!).filter(Boolean);

  // Interactive graph: manual node positions (drag) + bidirectional highlight.
  const [drag, setDrag] = useState<Record<string, { x: number; y: number }>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const dragging = useRef<{ id: string; ox: number; oy: number; px: number; py: number; moved: boolean } | null>(null);
  const posOf = (id: string) => drag[id] ?? layout.pos.get(id) ?? { x: 0, y: 0 };

  const nodeDown = (e: RPE, id: string) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = posOf(id);
    dragging.current = { id, ox: p.x, oy: p.y, px: e.clientX, py: e.clientY, moved: false };
    setDragId(id);
  };
  const nodeMove = (e: RPE) => {
    const d = dragging.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) d.moved = true;
    setDrag((prev) => ({ ...prev, [d.id]: { x: d.ox + dx, y: d.oy + dy } }));
  };
  const nodeUp = (e: RPE, id: string) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    const d = dragging.current;
    dragging.current = null;
    setDragId(null);
    if (d && !d.moved) setSelId(id);
  };

  const upIds = new Set(upstream.map((u) => u.fabricId));
  const downIds = new Set(downstream.map((d) => d.fabricId));
  const connected = new Set<string>([...upIds, ...downIds, selId]);
  const UP = "#8b5cf6";
  const DOWN = "#0ea5b7";

  const bounds = useMemo(() => {
    let w = layout.width;
    let h = layout.height;
    for (const id of Object.keys(drag)) {
      const p = drag[id];
      w = Math.max(w, p.x + NODE_W + 48);
      h = Math.max(h, p.y + NODE_H + 48);
    }
    return { w, h };
  }, [drag, layout]);

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1 overflow-auto bg-muted/40">
        <div
          className="relative m-[16px]"
          style={{ width: bounds.w, height: bounds.h }}
        >
          <svg
            className="absolute inset-0"
            width={bounds.w}
            height={bounds.h}
            style={{ zIndex: 0 }}
          >
            {edges.map((e, i) => {
              const s = posOf(e.source);
              const t = posOf(e.target);
              const x1 = s.x + NODE_W;
              const y1 = s.y + NODE_H / 2;
              const x2 = t.x;
              const y2 = t.y + NODE_H / 2;
              const isUp = e.target === selId;
              const isDown = e.source === selId;
              const active = isUp || isDown;
              const color = e.broken ? "#e5484d" : isUp ? UP : isDown ? DOWN : "#94a3b8";
              return (
                <path
                  key={i}
                  className={active && !e.broken ? "atlas-flow" : undefined}
                  d={`M${x1},${y1} C${x1 + 46},${y1} ${x2 - 46},${y2} ${x2},${y2}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={active ? 2.6 : 1.6}
                  strokeOpacity={e.broken ? 0.85 : active ? 0.95 : selId ? 0.16 : 0.4}
                  strokeDasharray={e.broken ? "6 5" : undefined}
                  style={{ transition: "stroke-opacity .2s, stroke-width .2s" }}
                />
              );
            })}
          </svg>

          {items.map((it) => {
            const p = posOf(it.fabricId);
            const selected = it.fabricId === selId;
            const isUp = upIds.has(it.fabricId);
            const isDown = downIds.has(it.fabricId);
            const dim = !!selId && !connected.has(it.fabricId);
            const isDragging = dragId === it.fabricId;
            const accent = selected ? "var(--color-primary)" : isUp ? UP : isDown ? DOWN : undefined;
            return (
              <div
                key={it.fabricId}
                onPointerDown={(e) => nodeDown(e, it.fabricId)}
                onPointerMove={nodeMove}
                onPointerUp={(e) => nodeUp(e, it.fabricId)}
                className={cn(
                  "absolute flex cursor-grab select-none items-center gap-[10px] rounded-xl border bg-card px-[12px] text-left shadow-sm active:cursor-grabbing",
                  selected ? "border-primary" : "border-border",
                )}
                style={{
                  left: p.x,
                  top: p.y,
                  width: NODE_W,
                  height: NODE_H,
                  zIndex: isDragging ? 6 : selected ? 4 : dim ? 1 : 2,
                  opacity: dim ? 0.35 : 1,
                  transform: isDragging ? "scale(1.05)" : undefined,
                  transition: isDragging
                    ? "none"
                    : "box-shadow .18s ease, opacity .18s ease, border-color .18s ease, transform .12s ease",
                  boxShadow: isDragging
                    ? "0 16px 34px -12px rgba(2,8,23,.55), 0 0 0 2px " + (accent ?? "var(--color-primary)")
                    : selected
                      ? "0 0 0 2px var(--color-primary), 0 10px 26px -12px rgba(2,8,23,.45)"
                      : undefined,
                  borderColor: accent,
                }}
              >
                {accent && !selected && (
                  <span
                    className="absolute -left-[6px] top-1/2 h-[11px] w-[11px] -translate-y-1/2 rounded-full ring-2 ring-card"
                    style={{ background: accent }}
                  />
                )}
                <TypeGlyph type={it.itemType} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold leading-[1.15]">
                    {it.displayName}
                  </div>
                  <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    {typeMeta(it.itemType).label}
                  </div>
                </div>
                <HealthDot health={it.health} />
              </div>
            );
          })}
        </div>

        <div className="pointer-events-none absolute bottom-[16px] left-[16px] rounded-xl border border-border bg-card/90 px-[13px] py-[11px] backdrop-blur">
          <SectionLabel>Legend</SectionLabel>
          <div className="mt-[8px] flex flex-col gap-[6px] text-[12px]">
            <div className="flex items-center gap-[8px]">
              <span className="h-[3px] w-[18px] rounded-full" style={{ background: "#8b5cf6" }} /> upstream
            </div>
            <div className="flex items-center gap-[8px]">
              <span className="h-[3px] w-[18px] rounded-full" style={{ background: "#0ea5b7" }} /> downstream
            </div>
            <div className="mt-[2px] flex items-center gap-[8px]">
              <HealthDot health="healthy" /> healthy
            </div>
            <div className="flex items-center gap-[8px]">
              <HealthDot health="failing" /> failing
            </div>
            <div className="mt-[3px] text-[11px] text-muted-foreground">Drag nodes · click to inspect</div>
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
                  {typeMeta(sel.itemType).label}
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
