import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  FilterX,
  Layers,
  Search,
  Settings2,
  ShieldCheck,
  Tag,
  Waypoints,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { AtlasFocusRequest } from "../navigation";
import { useAtlas } from "../store";
import {
  Avatar,
  EndorsementChip,
  PrincipalAvatar,
  SectionLabel,
  TypeGlyph,
  cn,
} from "../ui";
import {
  typeMeta,
  relativeTime,
  type Health,
  type Item,
  type ItemType,
} from "../model";

const HEALTH_META: Record<
  Health,
  { label: string; className: string; dotClassName: string }
> = {
  healthy: {
    label: "Healthy",
    className:
      "border-status-healthy/30 bg-status-healthy/10 text-status-healthy",
    dotClassName: "bg-status-healthy",
  },
  stale: {
    label: "Stale",
    className:
      "border-status-warning/30 bg-status-warning/10 text-status-warning",
    dotClassName: "bg-status-warning",
  },
  failing: {
    label: "Failing",
    className:
      "border-status-failing/30 bg-status-failing/10 text-status-failing",
    dotClassName: "bg-status-failing",
  },
  unknown: {
    label: "Unknown",
    className:
      "border-lineage-neutral/30 bg-lineage-neutral/10 text-muted-foreground",
    dotClassName: "bg-lineage-neutral",
  },
};

function HealthBadge({ health }: { health: Health }) {
  const meta = HEALTH_META[health];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-xs rounded-md border px-s py-xxs text-[length:var(--text-200)] font-semibold",
        meta.className,
      )}
    >
      <span className="size-s-nudge rounded-full bg-current" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function DrawerRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  if (value == null || value === "") return null;
  return (
    <div className="grid grid-cols-1 gap-xs border-t border-border/60 px-l py-m first:border-t-0 sm:grid-cols-3 sm:gap-l">
      <div className="text-200 font-semibold text-muted-foreground">
        {label}
      </div>
      <div className="min-w-0 break-words text-300 sm:col-span-2">{value}</div>
    </div>
  );
}

function DrawerSection({
  icon: Icon,
  title,
  sectionKey,
  children,
}: {
  icon: typeof Tag;
  title: string;
  sectionKey: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-section-key={sectionKey}
      className="scroll-mt-l overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex items-center gap-s border-b border-border bg-secondary px-l py-m">
        <Icon className="icon-size-200 text-muted-foreground" />
        <SectionLabel>{title}</SectionLabel>
      </div>
      {children}
    </section>
  );
}

function toSectionKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function CatalogView({ focus }: { focus?: AtlasFocusRequest } = {}) {
  const { data } = useAtlas();
  const { items, config, grants, edges, jobs } = data;

  const groups = useMemo(() => {
    const grouped = new Map<ItemType, Item[]>();
    items.forEach((item) => {
      const list = grouped.get(item.itemType) ?? [];
      list.push(item);
      grouped.set(item.itemType, list);
    });
    return [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selType, setSelType] = useState<ItemType | null>(null);
  const [query, setQuery] = useState(focus?.query ?? "");

  const toggle = (type: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (!selType || item.itemType === selType) &&
        (!normalizedQuery ||
          item.displayName.toLowerCase().includes(normalizedQuery) ||
          item.tags.some((tag) =>
            tag.toLowerCase().includes(normalizedQuery),
          )),
    );
  }, [items, selType, query]);

  const [detailId, setDetailId] = useState<string | null>(
    focus?.itemId ?? null,
  );
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const detail = items.find((item) => item.fabricId === detailId);
  const dCfgSections = useMemo(() => {
    const rows = config.filter((entry) => entry.itemFabricId === detailId);
    const grouped = new Map<string, typeof rows>();
    rows.forEach((row) => {
      const sectionRows = grouped.get(row.section) ?? [];
      sectionRows.push(row);
      grouped.set(row.section, sectionRows);
    });
    return [...grouped.entries()];
  }, [config, detailId]);
  const dUp = edges
    .filter((edge) => edge.target === detailId)
    .map((edge) => items.find((item) => item.fabricId === edge.source))
    .filter(Boolean) as Item[];
  const dDown = edges
    .filter((edge) => edge.source === detailId)
    .map((edge) => items.find((item) => item.fabricId === edge.target))
    .filter(Boolean) as Item[];
  const dGrants = grants.filter((grant) => grant.itemFabricId === detailId);
  const dJobs = jobs.filter((job) => job.itemFabricId === detailId);
  const hasActiveFilters = Boolean(selType || query.trim());

  const drawerSections = detail
    ? [
        { key: "properties", label: "Properties" },
        ...(dUp.length || dDown.length
          ? [{ key: "lineage", label: "Lineage" }]
          : []),
        ...(dGrants.length ? [{ key: "access", label: "Access" }] : []),
        ...dCfgSections.map(([section]) => ({
          key: `config-${toSectionKey(section)}`,
          label: section,
        })),
        ...(dJobs.length ? [{ key: "jobs", label: "Jobs" }] : []),
      ]
    : [];

  const resetFilters = () => {
    setQuery("");
    setSelType(null);
  };

  const scrollToSection = (sectionKey: string) => {
    drawerRef.current
      ?.querySelector<HTMLElement>(`[data-section-key="${sectionKey}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (!detailId) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    if (!drawer) return;
    drawer.focus();

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDetailId(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      previousFocus.current?.focus();
    };
  }, [detailId]);

  return (
    <div className="atlas-content-frame p-xxl">
      <header className="mb-l overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-l px-xl py-l lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <SectionLabel>Workspace inventory</SectionLabel>
            <div className="mt-xs flex flex-wrap items-baseline gap-s">
              <h1 className="text-600 font-bold leading-600">Catalog</h1>
              <span className="text-300 text-muted-foreground">
                {data.workspace.displayName}
              </span>
            </div>
          </div>
          <dl className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-secondary">
            <div className="px-l py-s text-center">
              <dt className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                Items
              </dt>
              <dd className="font-numeric text-400 font-bold">{items.length}</dd>
            </div>
            <div className="px-l py-s text-center">
              <dt className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                Types
              </dt>
              <dd className="font-numeric text-400 font-bold">{groups.length}</dd>
            </div>
            <div className="px-l py-s text-center">
              <dt className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                Showing
              </dt>
              <dd className="font-numeric text-400 font-bold">
                {visible.length}
              </dd>
            </div>
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-s border-t border-border bg-secondary px-xl py-s">
          <Search className="icon-size-200 text-muted-foreground" />
          <span className="text-200 text-muted-foreground">
            Search by item name or tag, then narrow the inventory by type.
          </span>
          {selType && (
            <span className="rounded-md border border-primary/30 bg-primary/10 px-s py-xxs text-200 font-semibold text-primary">
              {typeMeta(selType).label}
            </span>
          )}
          {query.trim() && (
            <span className="rounded-md border border-border bg-card px-s py-xxs text-200 font-semibold">
              “{query.trim()}”
            </span>
          )}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="ml-auto inline-flex items-center gap-xs rounded-md px-s py-xs text-200 font-semibold text-primary hover:bg-primary/10"
            >
              <FilterX className="icon-size-100" />
              Clear filters
            </button>
          )}
        </div>
      </header>

      <div className="grid items-start gap-l lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
        <aside className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:sticky lg:top-l lg:max-h-screen">
          <div className="sticky top-0 z-10 border-b border-border bg-card p-m">
            <label
              htmlFor="catalog-search"
              className="mb-s block text-200 font-semibold text-foreground"
            >
              Search catalog
            </label>
            <div className="relative">
              <Search className="icon-size-200 pointer-events-none absolute left-m top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                id="catalog-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Item name or tag"
                className="h-9 w-full rounded-lg border border-input bg-background pl-xxxl pr-xxxl text-300 text-foreground placeholder:text-muted-foreground"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear catalog search"
                  className="absolute right-s top-1/2 -translate-y-1/2 rounded-md p-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="icon-size-100" />
                </button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto py-s">
            <div className="px-s">
              <button
                type="button"
                aria-pressed={selType === null}
                onClick={() => setSelType(null)}
                className={cn(
                  "flex w-full items-center gap-s rounded-lg border px-m py-m text-left transition-colors",
                  selType === null
                    ? "border-primary/30 bg-primary/10 text-foreground"
                    : "border-transparent hover:bg-accent",
                )}
              >
                <span className="flex size-xxxl items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Layers className="icon-size-200" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-300 font-semibold">
                    All workspace items
                  </span>
                  <span className="block text-200 text-muted-foreground">
                    Every governed type
                  </span>
                </span>
                <span className="font-numeric text-200 font-semibold text-muted-foreground">
                  {items.length}
                </span>
              </button>
            </div>

            <div className="my-s border-t border-border" />

            {groups.map(([type, list]) => {
              const open = expanded.has(type);
              const selected = selType === type;
              return (
                <div key={type} className="px-s">
                  <div
                    className={cn(
                      "flex items-center rounded-lg border transition-colors",
                      selected
                        ? "border-primary/30 bg-primary/10"
                        : "border-transparent hover:bg-accent",
                    )}
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={`${open ? "Collapse" : "Expand"} ${typeMeta(type).label}`}
                      onClick={() => toggle(type)}
                      className="m-xs rounded-md p-s text-muted-foreground hover:bg-card hover:text-foreground"
                    >
                      {open ? (
                        <ChevronDown className="icon-size-200" />
                      ) : (
                        <ChevronRight className="icon-size-200" />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSelType(type)}
                      className="flex min-w-0 flex-1 items-center gap-s py-s pr-m text-left"
                    >
                      <TypeGlyph type={type} size={24} />
                      <span className="min-w-0 flex-1 truncate text-300 font-semibold">
                        {typeMeta(type).label}
                      </span>
                      <span className="font-numeric text-200 font-semibold text-muted-foreground">
                        {list.length}
                      </span>
                    </button>
                  </div>
                  {open && (
                    <div className="ml-l border-l border-border py-xs">
                      {list.map((item) => (
                        <button
                          type="button"
                          key={item.fabricId}
                          onClick={() => setDetailId(item.fabricId)}
                          className={cn(
                            "flex w-full items-center gap-s rounded-r-lg px-m py-s text-left text-200 transition-colors",
                            detailId === item.fabricId
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "size-s-nudge shrink-0 rounded-full",
                              HEALTH_META[item.health].dotClassName,
                            )}
                            aria-hidden="true"
                          />
                          <span className="truncate">{item.displayName}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <main>
          <div className="mb-m flex items-center justify-between gap-m">
            <div>
              <h2 className="text-400 font-semibold">Governed items</h2>
              <p className="text-200 text-muted-foreground">
                {visible.length} {visible.length === 1 ? "result" : "results"}
              </p>
            </div>
            {selType && (
              <button
                type="button"
                onClick={() => setSelType(null)}
                className="rounded-lg border border-border bg-card px-m py-s text-200 font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                Show all types
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-xl py-xxxl text-center">
              <Search className="icon-size-500 text-muted-foreground" />
              <h2 className="mt-m text-400 font-semibold">No matching items</h2>
              <p className="mt-xs text-300 text-muted-foreground">
                Try a different name or tag, or clear the selected type.
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-l rounded-lg bg-primary px-l py-s text-300 font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-m sm:grid-cols-2 2xl:grid-cols-3">
              {visible.map((item) => {
                const selected = detailId === item.fabricId;
                return (
                  <button
                    key={item.fabricId}
                    type="button"
                    aria-haspopup="dialog"
                    aria-label={`Open details for ${item.displayName}`}
                    onClick={() => setDetailId(item.fabricId)}
                    className={cn(
                      "group flex min-h-52 flex-col overflow-hidden rounded-2xl border bg-card text-left text-card-foreground shadow-sm transition-[border-color,box-shadow,transform,background-color] hover:-translate-y-xxs hover:border-primary/50 hover:shadow-lg",
                      selected
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                        : "border-border",
                    )}
                  >
                    <div className="flex w-full items-start gap-m border-b border-border bg-secondary/70 px-l py-m">
                      <TypeGlyph type={item.itemType} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                          {typeMeta(item.itemType).label}
                        </div>
                        <div className="mt-xxs truncate text-400 font-bold leading-400">
                          {item.displayName}
                        </div>
                      </div>
                      <HealthBadge health={item.health} />
                    </div>

                    <div className="flex flex-1 flex-col gap-m px-l py-m">
                      <div className="flex items-center gap-s">
                        {item.ownerName ? (
                          <>
                            <Avatar name={item.ownerName} size={24} />
                            <div className="min-w-0">
                              <div className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                                Owner
                              </div>
                              <div className="truncate text-200 font-semibold">
                                {item.ownerName}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div>
                            <div className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                              Owner
                            </div>
                            <div className="text-200 text-muted-foreground">
                              Unassigned
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-xs">
                        {item.tags.length ? (
                          item.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-md border border-border bg-muted px-s py-xxs text-200 font-medium text-muted-foreground"
                            >
                              {tag}
                            </span>
                          ))
                        ) : (
                          <span className="text-200 text-muted-foreground">
                            No tags
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex w-full items-center justify-between gap-s border-t border-border px-l py-s">
                      <span className="text-200 text-muted-foreground">
                        Refreshed {relativeTime(item.lastRefresh)}
                      </span>
                      <EndorsementChip endorsement={item.endorsement} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </main>
      </div>

      <AnimatePresence>
        {detail && (
          <>
            <motion.div
              aria-hidden="true"
              className="fixed inset-0 z-40 bg-muted-foreground/40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDetailId(null)}
            />
            <motion.aside
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label={`${detail.displayName} details`}
              tabIndex={-1}
              className="fixed right-0 top-0 z-50 flex h-screen w-full flex-col overflow-hidden border-l border-border bg-card shadow-2xl sm:w-3/4 lg:w-1/2 xl:w-2/5"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
            >
              <header className="sticky top-0 z-10 shrink-0 border-b border-border bg-card">
                <div className="flex items-start gap-m px-l py-l">
                  <TypeGlyph type={detail.itemType} size={44} />
                  <div className="min-w-0 flex-1">
                    <SectionLabel>{typeMeta(detail.itemType).label}</SectionLabel>
                    <h2 className="mt-xxs text-500 font-bold leading-500">
                      {detail.displayName}
                    </h2>
                    <div className="mt-s flex flex-wrap items-center gap-s">
                      <HealthBadge health={detail.health} />
                      <EndorsementChip endorsement={detail.endorsement} />
                      {detail.sensitivity && (
                        <span className="rounded-md border border-destructive/30 bg-destructive/10 px-s py-xxs text-200 font-semibold text-destructive">
                          {detail.sensitivity}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetailId(null)}
                    aria-label="Close item details"
                    className="rounded-lg border border-transparent p-s text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground"
                  >
                    <X className="icon-size-200" />
                  </button>
                </div>

                <nav
                  aria-label="Item detail sections"
                  className="flex gap-xs overflow-x-auto border-t border-border bg-secondary px-l py-s"
                >
                  {drawerSections.map((section) => (
                    <button
                      type="button"
                      key={section.key}
                      onClick={() => scrollToSection(section.key)}
                      className="shrink-0 rounded-md px-s py-xs text-200 font-semibold text-muted-foreground hover:bg-card hover:text-foreground"
                    >
                      {section.label}
                    </button>
                  ))}
                </nav>
              </header>

              <div className="min-h-0 flex-1 space-y-l overflow-y-auto bg-secondary/40 p-l">
                <DrawerSection
                  icon={Tag}
                  title="Properties"
                  sectionKey="properties"
                >
                  <DrawerRow label="Description" value={detail.description} />
                  <DrawerRow
                    label="Owner"
                    value={
                      detail.ownerName
                        ? `${detail.ownerName}${detail.ownerEmail ? ` · ${detail.ownerEmail}` : ""}`
                        : "Unassigned"
                    }
                  />
                  <DrawerRow
                    label="Fabric ID"
                    value={
                      <span className="font-monospace text-200">
                        {detail.fabricId}
                      </span>
                    }
                  />
                  <DrawerRow
                    label="Health"
                    value={<span className="capitalize">{detail.health}</span>}
                  />
                  <DrawerRow
                    label="Endorsement"
                    value={
                      <span className="capitalize">{detail.endorsement}</span>
                    }
                  />
                  <DrawerRow
                    label="Sensitivity"
                    value={detail.sensitivity ?? "—"}
                  />
                  <DrawerRow label="Size" value={detail.size} />
                  <DrawerRow
                    label="Tags"
                    value={detail.tags.length ? detail.tags.join(", ") : "—"}
                  />
                  <DrawerRow
                    label="Last refresh"
                    value={
                      detail.lastRefresh
                        ? relativeTime(detail.lastRefresh)
                        : "—"
                    }
                  />
                  <DrawerRow
                    label="Created"
                    value={
                      detail.createdAt
                        ? relativeTime(detail.createdAt)
                        : undefined
                    }
                  />
                  <DrawerRow
                    label="Updated"
                    value={
                      detail.updatedAt
                        ? relativeTime(detail.updatedAt)
                        : undefined
                    }
                  />
                </DrawerSection>

                {(dUp.length > 0 || dDown.length > 0) && (
                  <DrawerSection
                    icon={Waypoints}
                    title={`Lineage · ${dUp.length} up · ${dDown.length} down`}
                    sectionKey="lineage"
                  >
                    <div className="divide-y divide-border/60">
                      {dUp.map((item) => (
                        <div
                          key={item.fabricId}
                          className="flex items-center gap-s px-l py-s text-300"
                        >
                          <span className="w-xxxl shrink-0 text-100 font-bold text-lineage-upstream">
                            UP
                          </span>
                          <TypeGlyph type={item.itemType} size={22} />
                          <span className="truncate">{item.displayName}</span>
                        </div>
                      ))}
                      {dDown.map((item) => (
                        <div
                          key={item.fabricId}
                          className="flex items-center gap-s px-l py-s text-300"
                        >
                          <span className="w-xxxl shrink-0 text-100 font-bold text-lineage-downstream">
                            DN
                          </span>
                          <TypeGlyph type={item.itemType} size={22} />
                          <span className="truncate">{item.displayName}</span>
                        </div>
                      ))}
                    </div>
                  </DrawerSection>
                )}

                {dGrants.length > 0 && (
                  <DrawerSection
                    icon={ShieldCheck}
                    title={`Access · ${dGrants.length}`}
                    sectionKey="access"
                  >
                    <div className="divide-y divide-border/60">
                      {dGrants.map((grant, index) => {
                        const principal = data.principals.find(
                          (entry) => entry.displayName === grant.principalRef,
                        );
                        return (
                          <div
                            key={index}
                            className="flex items-center gap-s px-l py-m text-300"
                          >
                            <PrincipalAvatar
                              name={grant.principalRef}
                              kind={principal?.kind ?? "user"}
                              size={28}
                            />
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {grant.principalRef}
                            </span>
                            <span className="text-200 text-muted-foreground">
                              {grant.roleName ?? grant.accessLevel}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </DrawerSection>
                )}

                {dCfgSections.map(([section, rows]) => (
                  <DrawerSection
                    key={section}
                    icon={Settings2}
                    title={section}
                    sectionKey={`config-${toSectionKey(section)}`}
                  >
                    {rows.map((row, index) => (
                      <DrawerRow
                        key={index}
                        label={row.label}
                        value={row.value}
                      />
                    ))}
                  </DrawerSection>
                ))}

                {dJobs.length > 0 && (
                  <DrawerSection
                    icon={Activity}
                    title={`Recent jobs · ${dJobs.length}`}
                    sectionKey="jobs"
                  >
                    {dJobs.map((job, index) => (
                      <DrawerRow
                        key={index}
                        label={job.jobType}
                        value={`${job.status} · ${relativeTime(job.startedAt)}`}
                      />
                    ))}
                  </DrawerSection>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
