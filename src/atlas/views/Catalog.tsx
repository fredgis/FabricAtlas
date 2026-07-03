import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, Layers } from "lucide-react";
import { useAtlas } from "../store";
import {
  Avatar,
  Card,
  EndorsementChip,
  HealthChip,
  HealthDot,
  TypeGlyph,
  cn,
} from "../ui";
import { typeMeta, relativeTime, type Item, type ItemType } from "../model";

export function CatalogView() {
  const { data } = useAtlas();
  const { items } = data;

  const groups = useMemo(() => {
    const m = new Map<ItemType, Item[]>();
    items.forEach((i) => {
      const arr = m.get(i.itemType) ?? [];
      arr.push(i);
      m.set(i.itemType, arr);
    });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selType, setSelType] = useState<ItemType | null>(null);
  const [query, setQuery] = useState("");

  const toggle = (t: string) =>
    setCollapsed((p) => {
      const n = new Set(p);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (!selType || i.itemType === selType) &&
        (!q ||
          i.displayName.toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q))),
    );
  }, [items, selType, query]);

  return (
    <div className="p-[24px]">
      <div className="mb-[16px]">
        <h1 className="text-[22px] font-bold">Catalog</h1>
        <div className="mt-[4px] text-[13px] text-muted-foreground">
          Every item in the workspace, as a tree and as cards
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, alignItems: "start" }}>
        {/* Tree */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-[8px] border-b border-border px-[12px] py-[10px]">
            <Search size={15} className="text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter…"
              className="w-full bg-transparent text-[13px] outline-none"
            />
          </div>
          <div className="max-h-[600px] overflow-auto py-[6px]">
            <button
              onClick={() => setSelType(null)}
              className={cn(
                "flex w-full items-center gap-[8px] px-[12px] py-[8px] text-left text-[13px] font-bold",
                selType === null ? "text-primary" : "",
              )}
            >
              <Layers size={16} /> {data.workspace.displayName}
              <span className="ml-auto text-[11px] text-muted-foreground">{items.length}</span>
            </button>
            {groups.map(([type, list]) => {
              const open = !collapsed.has(type);
              return (
                <div key={type}>
                  <button
                    onClick={() => {
                      toggle(type);
                      setSelType(type);
                    }}
                    className={cn(
                      "flex w-full items-center gap-[6px] px-[12px] py-[7px] pl-[16px] text-left text-[13px] font-semibold",
                      selType === type ? "bg-accent" : "hover:bg-accent/60",
                    )}
                  >
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <TypeGlyph type={type} size={20} />
                    <span>{typeMeta(type).label}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">{list.length}</span>
                  </button>
                  {open &&
                    list.map((i) => (
                      <div
                        key={i.fabricId}
                        className="flex items-center gap-[8px] px-[12px] py-[6px] pl-[40px] text-[12.5px]"
                      >
                        <HealthDot health={i.health} size={7} />
                        <span className="truncate">{i.displayName}</span>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
          {visible.map((i) => (
            <Card key={i.fabricId} style={{ padding: 14 }} className="flex flex-col gap-[11px]">
              <div className="flex items-center gap-[10px]">
                <TypeGlyph type={i.itemType} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    {typeMeta(i.itemType).label}
                  </div>
                </div>
                <HealthDot health={i.health} />
              </div>
              <div className="text-[15px] font-bold leading-[1.2]">{i.displayName}</div>
              <div className="flex items-center gap-[8px] text-[12.5px] font-medium">
                {i.ownerName ? (
                  <>
                    <Avatar name={i.ownerName} size={22} /> {i.ownerName}
                  </>
                ) : (
                  <span className="text-muted-foreground">Unassigned</span>
                )}
              </div>
              <div className="flex flex-wrap gap-[5px]">
                {i.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-md bg-muted px-[7px] py-[2px] text-[11px] font-semibold text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <div className="mt-auto flex items-center justify-between border-t border-border pt-[10px] text-[11.5px] text-muted-foreground">
                <span>refreshed {relativeTime(i.lastRefresh)}</span>
                <EndorsementChip endorsement={i.endorsement} />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
