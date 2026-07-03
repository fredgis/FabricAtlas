import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Table2, Columns3, Sigma, Search, Users, Boxes } from "lucide-react";
import { useAtlas } from "../store";
import { Card, PrincipalAvatar, SectionLabel, TypeGlyph, cn } from "../ui";
import {
  MODEL_SCHEMA,
  typeMeta,
  type AccessLevel,
  type Item,
  type ItemType,
} from "../model";

type AssetKind = "table" | "column" | "measure" | "view";

interface Asset {
  id: string;
  itemFabricId: string;
  itemName: string;
  itemType: ItemType;
  kind: AssetKind;
  name: string;
  table?: string;
  dataType?: string;
}

const KIND_META: Record<AssetKind, { label: string; icon: typeof Table2; color: string }> = {
  table: { label: "Table", icon: Table2, color: "#2f9e6f" },
  view: { label: "View", icon: Table2, color: "#0ea5b7" },
  column: { label: "Column", icon: Columns3, color: "#3b82f6" },
  measure: { label: "Measure / KPI", icon: Sigma, color: "#d9a520" },
};

const ACC: Record<AccessLevel, { label: string; color: string }> = {
  owner: { label: "Owner", color: "#d9a520" },
  edit: { label: "Edit", color: "#22a565" },
  view: { label: "View", color: "#3b82f6" },
  none: { label: "—", color: "#8b95a5" },
};

function AccChip({ level }: { level: AccessLevel }) {
  const a = ACC[level];
  return (
    <span
      className="rounded-md px-[8px] py-[2px] text-[11px] font-bold"
      style={{ background: `${a.color}22`, color: a.color }}
    >
      {a.label}
    </span>
  );
}

export function AssetCatalogView() {
  const { data } = useAtlas();
  const { items, config, grants, principals } = data;

  const itemById = useMemo(() => new Map(items.map((i) => [i.fabricId, i])), [items]);
  const principalByName = useMemo(
    () => new Map(principals.map((p) => [p.displayName, p])),
    [principals],
  );

  const assets = useMemo<Asset[]>(() => {
    const out: Asset[] = [];
    const seen = new Set<string>();
    const push = (a: Asset) => {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        out.push(a);
      }
    };
    for (const it of items) {
      const schema = MODEL_SCHEMA[it.fabricId];
      if (schema) {
        for (const t of schema) {
          push({ id: `${it.fabricId}::t::${t.name}`, itemFabricId: it.fabricId, itemName: it.displayName, itemType: it.itemType, kind: "table", name: t.name });
          for (const c of t.columns)
            push({ id: `${it.fabricId}::c::${t.name}::${c.name}`, itemFabricId: it.fabricId, itemName: it.displayName, itemType: it.itemType, kind: "column", name: c.name, table: t.name, dataType: c.dataType });
          for (const m of t.measures)
            push({ id: `${it.fabricId}::m::${t.name}::${m.name}`, itemFabricId: it.fabricId, itemName: it.displayName, itemType: it.itemType, kind: "measure", name: m.name, table: t.name });
        }
      }
      for (const c of config.filter((cf) => cf.itemFabricId === it.fabricId && cf.section === "Tables"))
        push({ id: `${it.fabricId}::t::${c.label}`, itemFabricId: it.fabricId, itemName: it.displayName, itemType: it.itemType, kind: "table", name: c.label });
    }
    return out;
  }, [items, config]);

  const [q, setQ] = useState("");
  const [kind, setKind] = useState<AssetKind | "all">("all");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return assets.filter(
      (a) =>
        (kind === "all" || a.kind === kind) &&
        (!s ||
          a.name.toLowerCase().includes(s) ||
          a.itemName.toLowerCase().includes(s) ||
          (a.table ?? "").toLowerCase().includes(s)),
    );
  }, [assets, q, kind]);

  const groups = useMemo(() => {
    const m = new Map<string, Asset[]>();
    for (const a of filtered) {
      const arr = m.get(a.itemFabricId) ?? [];
      arr.push(a);
      m.set(a.itemFabricId, arr);
    }
    return [...m.entries()];
  }, [filtered]);

  const [selId, setSelId] = useState<string>("");
  const sel = assets.find((a) => a.id === selId) ?? filtered[0];

  const access = useMemo(() => {
    if (!sel) return [] as { name: string; level: AccessLevel; inherited: boolean; roleName?: string }[];
    const byName = new Map<string, { name: string; level: AccessLevel; inherited: boolean; roleName?: string }>();
    for (const g of grants.filter((g) => !g.itemFabricId))
      byName.set(g.principalRef, { name: g.principalRef, level: g.accessLevel, inherited: true, roleName: g.roleName });
    for (const g of grants.filter((g) => g.itemFabricId === sel.itemFabricId))
      byName.set(g.principalRef, { name: g.principalRef, level: g.accessLevel, inherited: false, roleName: g.roleName });
    return [...byName.values()].sort((a, b) => Number(a.inherited) - Number(b.inherited));
  }, [sel, grants]);

  const counts = {
    all: assets.length,
    table: assets.filter((a) => a.kind === "table").length,
    column: assets.filter((a) => a.kind === "column").length,
    measure: assets.filter((a) => a.kind === "measure").length,
  };
  const KINDS: { k: AssetKind | "all"; label: string; n: number }[] = [
    { k: "all", label: "All", n: counts.all },
    { k: "table", label: "Tables", n: counts.table },
    { k: "column", label: "Columns", n: counts.column },
    { k: "measure", label: "Measures / KPIs", n: counts.measure },
  ];

  const selItem = sel ? itemById.get(sel.itemFabricId) : undefined;

  return (
    <div className="flex h-full flex-col gap-[16px] p-[24px]">
      <div className="flex flex-wrap items-end justify-between gap-[12px]">
        <div>
          <h1 className="text-[22px] font-bold">Asset Catalog</h1>
          <div className="mt-[4px] text-[13px] text-muted-foreground">
            Every object inside every item — tables, columns, measures &amp; KPIs — and who can reach them
          </div>
        </div>
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search assets…"
            className="w-[260px] rounded-lg border border-border bg-card py-[9px] pl-[32px] pr-[11px] text-[13px] outline-none focus:border-primary"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-[8px]">
        {KINDS.map(({ k, label, n }) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={cn(
              "flex items-center gap-[8px] rounded-full border px-[13px] py-[6px] text-[12.5px] font-semibold transition-colors",
              kind === k ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            <span className={cn("rounded-full px-[7px] text-[11px]", kind === k ? "bg-white/25" : "bg-muted")}>{n}</span>
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: "minmax(320px, 400px) 1fr", gap: 16 }}>
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-border px-[16px] py-[11px] text-[13px] font-bold">
            {filtered.length} assets · {groups.length} items
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {groups.length === 0 && (
              <div className="p-[24px] text-center text-[13px] text-muted-foreground">
                No assets match. Assets come from item schemas (semantic model tables, columns, measures)
                and lakehouse tables — run a Sync to populate them.
              </div>
            )}
            {groups.map(([itemId, arr]) => {
              const it = itemById.get(itemId);
              return (
                <div key={itemId}>
                  <div className="sticky top-0 z-10 flex items-center gap-[9px] border-b border-border/60 bg-secondary/80 px-[14px] py-[8px] backdrop-blur">
                    {it && <TypeGlyph type={it.itemType} size={22} />}
                    <span className="truncate text-[12.5px] font-bold">{it?.displayName ?? "Unknown"}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">{arr.length}</span>
                  </div>
                  {arr.map((a) => {
                    const KM = KIND_META[a.kind];
                    const Icon = KM.icon;
                    const active = sel?.id === a.id;
                    return (
                      <button
                        key={a.id}
                        onClick={() => setSelId(a.id)}
                        className={cn(
                          "flex w-full items-center gap-[10px] border-b border-border/40 px-[14px] py-[8px] text-left transition-colors",
                          active ? "bg-accent" : "hover:bg-accent/50",
                        )}
                      >
                        <span
                          className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-md"
                          style={{ background: `${KM.color}1e`, color: KM.color }}
                        >
                          <Icon size={13} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12.5px] font-semibold">{a.name}</div>
                          {a.table && (
                            <div className="truncate text-[10.5px] text-muted-foreground">{a.table}</div>
                          )}
                        </div>
                        {a.dataType && (
                          <span className="shrink-0 rounded bg-muted px-[6px] py-[1px] text-[10px] text-muted-foreground">{a.dataType}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </Card>

        <AnimatePresence mode="wait">
          {sel && (
            <motion.div
              key={sel.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <Card className="overflow-hidden">
                <div
                  className="flex items-center gap-[14px] px-[20px] py-[18px]"
                  style={{ background: `linear-gradient(120deg, ${KIND_META[sel.kind].color}14, transparent)` }}
                >
                  <span
                    className="flex h-[48px] w-[48px] items-center justify-center rounded-2xl text-white"
                    style={{ background: KIND_META[sel.kind].color }}
                  >
                    {(() => {
                      const I = KIND_META[sel.kind].icon;
                      return <I size={24} />;
                    })()}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[19px] font-bold">{sel.name}</div>
                    <div className="text-[12.5px] text-muted-foreground">
                      {KIND_META[sel.kind].label}
                      {sel.table ? ` · ${sel.table}` : ""}
                      {sel.dataType ? ` · ${sel.dataType}` : ""}
                    </div>
                  </div>
                </div>

                <div className="border-t border-border px-[20px] py-[16px]">
                  <SectionLabel>Belongs to</SectionLabel>
                  <div className="mt-[9px] flex items-center gap-[11px] rounded-xl border border-border bg-muted/40 px-[13px] py-[11px]">
                    {selItem && <TypeGlyph type={selItem.itemType} size={34} />}
                    <div>
                      <div className="text-[14px] font-semibold">{sel.itemName}</div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {typeMeta(sel.itemType).label}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border px-[20px] py-[16px]">
                  <div className="flex items-center gap-[8px]">
                    <Users size={15} className="text-muted-foreground" />
                    <SectionLabel>Who has access · {access.length}</SectionLabel>
                  </div>
                  <div className="mt-[4px] text-[11.5px] text-muted-foreground">
                    Object access is inherited from the parent item's permissions.
                  </div>
                  <div className="mt-[11px] flex flex-col gap-[7px]">
                    {access.length === 0 && (
                      <div className="rounded-lg border border-dashed border-border px-[13px] py-[14px] text-center text-[12.5px] text-muted-foreground">
                        No access records synced for the parent item yet.
                      </div>
                    )}
                    {access.map((g) => {
                      const p = principalByName.get(g.name);
                      return (
                        <div key={g.name} className="flex items-center gap-[11px] rounded-lg border border-border px-[12px] py-[9px]">
                          <PrincipalAvatar name={g.name} kind={p?.kind ?? "user"} size={30} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-[7px] text-[13px] font-semibold">
                              <span className="truncate">{g.name}</span>
                              {p?.external && (
                                <span className="rounded bg-[#f5a52422] px-[6px] py-[1px] text-[10px] font-bold text-[#b7791f]">external</span>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {g.inherited ? "Inherited · workspace" : "Direct share"}
                              {g.roleName ? ` · ${g.roleName}` : ""}
                            </div>
                          </div>
                          <AccChip level={g.level} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>
            </motion.div>
          )}
          {!sel && (
            <Card className="flex items-center justify-center">
              <div className="flex flex-col items-center gap-[10px] py-[60px] text-center text-muted-foreground">
                <Boxes size={40} strokeWidth={1.4} />
                <div className="text-[14px] font-semibold">Pick an asset</div>
                <div className="max-w-[320px] text-[12.5px]">
                  Select a table, column or measure to see what it belongs to and who can access it.
                </div>
              </div>
            </Card>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
