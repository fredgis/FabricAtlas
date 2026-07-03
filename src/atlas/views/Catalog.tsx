import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Layers,
  X,
  Waypoints,
  ShieldCheck,
  Settings2,
  Activity,
  Tag,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAtlas } from "../store";
import {
  Avatar,
  Card,
  EndorsementChip,
  HealthChip,
  HealthDot,
  PrincipalAvatar,
  SectionLabel,
  TypeGlyph,
  cn,
} from "../ui";
import { typeMeta, relativeTime, type Item, type ItemType } from "../model";

function DrawerRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex gap-[14px] px-[18px] py-[8px] text-[12.5px]">
      <div className="w-[120px] shrink-0 font-semibold text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1 break-words">{value}</div>
    </div>
  );
}

function DrawerSection({ icon: Icon, title, children }: { icon: typeof Tag; title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border py-[10px]">
      <div className="flex items-center gap-[8px] px-[18px] py-[6px]">
        <Icon size={14} className="text-muted-foreground" />
        <SectionLabel>{title}</SectionLabel>
      </div>
      {children}
    </div>
  );
}

export function CatalogView() {
  const { data } = useAtlas();
  const { items, config, grants, edges, jobs } = data;

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

  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = items.find((i) => i.fabricId === detailId);
  const dCfgSections = useMemo(() => {
    const rows = config.filter((c) => c.itemFabricId === detailId);
    const m = new Map<string, typeof rows>();
    rows.forEach((r) => {
      const a = m.get(r.section) ?? [];
      a.push(r);
      m.set(r.section, a);
    });
    return [...m.entries()];
  }, [config, detailId]);
  const dUp = edges.filter((e) => e.target === detailId).map((e) => items.find((i) => i.fabricId === e.source)).filter(Boolean) as Item[];
  const dDown = edges.filter((e) => e.source === detailId).map((e) => items.find((i) => i.fabricId === e.target)).filter(Boolean) as Item[];
  const dGrants = grants.filter((g) => g.itemFabricId === detailId);
  const dJobs = jobs.filter((j) => j.itemFabricId === detailId);

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
            <button
              key={i.fabricId}
              onClick={() => setDetailId(i.fabricId)}
              style={{ padding: 14 }}
              className="flex flex-col gap-[11px] rounded-2xl border border-border bg-card text-left text-card-foreground transition-all hover:-translate-y-[2px] hover:border-primary/40 hover:shadow-lg"
            >
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
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {detail && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDetailId(null)}
            />
            <motion.aside
              className="fixed right-0 top-0 z-50 flex h-screen w-[440px] flex-col overflow-auto border-l border-border bg-card shadow-2xl"
              initial={{ x: 460 }}
              animate={{ x: 0 }}
              exit={{ x: 460 }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
            >
              <div className="flex items-start gap-[12px] px-[18px] py-[16px]">
                <TypeGlyph type={detail.itemType} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="text-[17px] font-bold leading-tight">{detail.displayName}</div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {typeMeta(detail.itemType).label}
                  </div>
                </div>
                <button
                  onClick={() => setDetailId(null)}
                  className="rounded-lg p-[6px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X size={17} />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-[7px] px-[18px] pb-[12px]">
                <HealthChip health={detail.health} />
                <EndorsementChip endorsement={detail.endorsement} />
                {detail.sensitivity && (
                  <span className="rounded-md bg-[#e5484d1a] px-[8px] py-[2px] text-[11px] font-bold text-[#e5484d]">
                    {detail.sensitivity}
                  </span>
                )}
              </div>

              <DrawerSection icon={Tag} title="Properties">
                <DrawerRow label="Description" value={detail.description} />
                <DrawerRow
                  label="Owner"
                  value={detail.ownerName ? `${detail.ownerName}${detail.ownerEmail ? ` · ${detail.ownerEmail}` : ""}` : "Unassigned"}
                />
                <DrawerRow label="Fabric ID" value={<span className="font-mono text-[11.5px]">{detail.fabricId}</span>} />
                <DrawerRow label="Health" value={<span className="capitalize">{detail.health}</span>} />
                <DrawerRow label="Endorsement" value={<span className="capitalize">{detail.endorsement}</span>} />
                <DrawerRow label="Sensitivity" value={detail.sensitivity ?? "—"} />
                <DrawerRow label="Size" value={detail.size} />
                <DrawerRow label="Tags" value={detail.tags.length ? detail.tags.join(", ") : "—"} />
                <DrawerRow label="Last refresh" value={detail.lastRefresh ? relativeTime(detail.lastRefresh) : "—"} />
                <DrawerRow label="Created" value={detail.createdAt ? relativeTime(detail.createdAt) : undefined} />
                <DrawerRow label="Updated" value={detail.updatedAt ? relativeTime(detail.updatedAt) : undefined} />
              </DrawerSection>

              {(dUp.length > 0 || dDown.length > 0) && (
                <DrawerSection icon={Waypoints} title={`Lineage · ${dUp.length} up · ${dDown.length} down`}>
                  {dUp.map((u) => (
                    <div key={u.fabricId} className="flex items-center gap-[8px] px-[18px] py-[4px] text-[12.5px]">
                      <span className="w-[20px] text-[10px] font-bold text-[#8b5cf6]">UP</span>
                      <TypeGlyph type={u.itemType} size={20} />
                      <span className="truncate">{u.displayName}</span>
                    </div>
                  ))}
                  {dDown.map((u) => (
                    <div key={u.fabricId} className="flex items-center gap-[8px] px-[18px] py-[4px] text-[12.5px]">
                      <span className="w-[20px] text-[10px] font-bold text-[#0ea5b7]">DN</span>
                      <TypeGlyph type={u.itemType} size={20} />
                      <span className="truncate">{u.displayName}</span>
                    </div>
                  ))}
                </DrawerSection>
              )}

              {dGrants.length > 0 && (
                <DrawerSection icon={ShieldCheck} title={`Access · ${dGrants.length}`}>
                  {dGrants.map((g, idx) => {
                    const pr = data.principals.find((p) => p.displayName === g.principalRef);
                    return (
                      <div key={idx} className="flex items-center gap-[9px] px-[18px] py-[5px] text-[12.5px]">
                        <PrincipalAvatar name={g.principalRef} kind={pr?.kind ?? "user"} size={24} />
                        <span className="min-w-0 flex-1 truncate">{g.principalRef}</span>
                        <span className="text-[11px] text-muted-foreground">{g.roleName ?? g.accessLevel}</span>
                      </div>
                    );
                  })}
                </DrawerSection>
              )}

              {dCfgSections.map(([section, rows]) => (
                <DrawerSection key={section} icon={Settings2} title={section}>
                  {rows.map((r, idx) => (
                    <DrawerRow key={idx} label={r.label} value={r.value} />
                  ))}
                </DrawerSection>
              ))}

              {dJobs.length > 0 && (
                <DrawerSection icon={Activity} title={`Recent jobs · ${dJobs.length}`}>
                  {dJobs.map((j, idx) => (
                    <DrawerRow key={idx} label={j.jobType} value={`${j.status} · ${relativeTime(j.startedAt)}`} />
                  ))}
                </DrawerSection>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
