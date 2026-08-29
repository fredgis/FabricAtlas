import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Columns3,
  FilterX,
  Search,
  ShieldCheck,
  Sigma,
  Table2,
  Users,
  X,
} from "lucide-react";
import { useAtlas } from "../store";
import { PrincipalAvatar, SectionLabel, TypeGlyph, cn } from "../ui";
import {
  schemaFor,
  typeMeta,
  type AccessLevel,
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
  source?: string;
  description?: string;
  isHidden?: boolean;
  expression?: string;
}

const KIND_META: Record<
  AssetKind,
  {
    label: string;
    icon: typeof Table2;
    tone: string;
    selectedTone: string;
  }
> = {
  table: {
    label: "Table",
    icon: Table2,
    tone: "border-object-source/30 bg-object-source/10 text-object-source",
    selectedTone: "border-object-source/50 bg-object-source/10",
  },
  view: {
    label: "View",
    icon: Table2,
    tone:
      "border-lineage-downstream/30 bg-lineage-downstream/10 text-lineage-downstream",
    selectedTone: "border-lineage-downstream/50 bg-lineage-downstream/10",
  },
  column: {
    label: "Column",
    icon: Columns3,
    tone: "border-object-column/30 bg-object-column/10 text-object-column",
    selectedTone: "border-object-column/50 bg-object-column/10",
  },
  measure: {
    label: "Measure / KPI",
    icon: Sigma,
    tone: "border-object-measure/30 bg-object-measure/10 text-object-measure",
    selectedTone: "border-object-measure/50 bg-object-measure/10",
  },
};

const ACCESS_META: Record<
  AccessLevel,
  { label: string; className: string }
> = {
  owner: {
    label: "Owner",
    className:
      "border-object-measure/30 bg-object-measure/10 text-object-measure",
  },
  edit: {
    label: "Edit",
    className:
      "border-status-healthy/30 bg-status-healthy/10 text-status-healthy",
  },
  view: {
    label: "View",
    className:
      "border-object-column/30 bg-object-column/10 text-object-column",
  },
  none: {
    label: "None",
    className:
      "border-lineage-neutral/30 bg-lineage-neutral/10 text-muted-foreground",
  },
};

function AccessChip({ level }: { level: AccessLevel }) {
  const access = ACCESS_META[level];
  return (
    <span
      className={cn(
        "rounded-md border px-s py-xxs text-[length:var(--text-200)] font-semibold",
        access.className,
      )}
    >
      {access.label}
    </span>
  );
}

function KindGlyph({ kind }: { kind: AssetKind }) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "flex size-xxxl shrink-0 items-center justify-center rounded-lg border",
        meta.tone,
      )}
      aria-hidden="true"
    >
      <Icon className="icon-size-200" />
    </span>
  );
}

function MetadataCell({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-secondary px-m py-s">
      <div className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-xxs truncate text-300 font-semibold">{value || "—"}</div>
    </div>
  );
}

function safeGroupId(value: string) {
  return `asset-group-${value.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

export function AssetCatalogView() {
  const { data } = useAtlas();
  const { items, config, grants, principals } = data;

  const itemById = useMemo(
    () => new Map(items.map((item) => [item.fabricId, item])),
    [items],
  );
  const principalByName = useMemo(
    () =>
      new Map(
        principals.map((principal) => [principal.displayName, principal]),
      ),
    [principals],
  );

  const assets = useMemo<Asset[]>(() => {
    const output: Asset[] = [];
    const seen = new Set<string>();
    const push = (asset: Asset) => {
      if (!seen.has(asset.id)) {
        seen.add(asset.id);
        output.push(asset);
      }
    };
    for (const item of items) {
      const schema = schemaFor(data, item.fabricId);
      if (schema) {
        for (const table of schema) {
          const tableKind: AssetKind = table.objectType
            ?.toLowerCase()
            .includes("view")
            ? "view"
            : "table";
          push({
            id: `${item.fabricId}::t::${table.name}`,
            itemFabricId: item.fabricId,
            itemName: item.displayName,
            itemType: item.itemType,
            kind: tableKind,
            name: table.name,
            dataType: table.objectType,
            source: table.source,
            description: table.description,
            isHidden: table.isHidden,
          });
          for (const column of table.columns) {
            push({
              id: `${item.fabricId}::c::${table.name}::${column.name}`,
              itemFabricId: item.fabricId,
              itemName: item.displayName,
              itemType: item.itemType,
              kind: "column",
              name: column.name,
              table: table.name,
              dataType: column.dataType,
              description: column.description,
              isHidden: column.isHidden,
            });
          }
          for (const measure of table.measures) {
            push({
              id: `${item.fabricId}::m::${table.name}::${measure.name}`,
              itemFabricId: item.fabricId,
              itemName: item.displayName,
              itemType: item.itemType,
              kind: "measure",
              name: measure.name,
              table: table.name,
              description: measure.description,
              isHidden: measure.isHidden,
              expression: measure.expr,
            });
          }
        }
      }
      for (const entry of config.filter(
        (candidate) =>
          candidate.itemFabricId === item.fabricId &&
          candidate.section === "Tables",
      )) {
        push({
          id: `${item.fabricId}::t::${entry.label}`,
          itemFabricId: item.fabricId,
          itemName: item.displayName,
          itemType: item.itemType,
          kind: "table",
          name: entry.label,
        });
      }
    }
    return output;
  }, [data, items, config]);

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AssetKind | "all">("all");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return assets.filter(
      (asset) =>
        (kind === "all" || asset.kind === kind) &&
        (!normalizedQuery ||
          asset.name.toLowerCase().includes(normalizedQuery) ||
          asset.itemName.toLowerCase().includes(normalizedQuery) ||
          (asset.table ?? "").toLowerCase().includes(normalizedQuery) ||
          (asset.source ?? "").toLowerCase().includes(normalizedQuery) ||
          (asset.description ?? "").toLowerCase().includes(normalizedQuery)),
    );
  }, [assets, query, kind]);

  const groups = useMemo(() => {
    const grouped = new Map<string, Asset[]>();
    for (const asset of filtered) {
      const group = grouped.get(asset.itemFabricId) ?? [];
      group.push(asset);
      grouped.set(asset.itemFabricId, group);
    }
    return [...grouped.entries()];
  }, [filtered]);

  const [selId, setSelId] = useState("");
  const selectedAsset = assets.find((asset) => asset.id === selId);

  const access = useMemo(() => {
    if (!selectedAsset) {
      return [] as {
        name: string;
        level: AccessLevel;
        inherited: boolean;
        roleName?: string;
      }[];
    }
    const byName = new Map<
      string,
      {
        name: string;
        level: AccessLevel;
        inherited: boolean;
        roleName?: string;
      }
    >();
    for (const grant of grants.filter((entry) => !entry.itemFabricId)) {
      byName.set(grant.principalRef, {
        name: grant.principalRef,
        level: grant.accessLevel,
        inherited: true,
        roleName: grant.roleName,
      });
    }
    for (const grant of grants.filter(
      (entry) => entry.itemFabricId === selectedAsset.itemFabricId,
    )) {
      byName.set(grant.principalRef, {
        name: grant.principalRef,
        level: grant.accessLevel,
        inherited: false,
        roleName: grant.roleName,
      });
    }
    return [...byName.values()].sort(
      (a, b) => Number(a.inherited) - Number(b.inherited),
    );
  }, [selectedAsset, grants]);

  const counts = {
    all: assets.length,
    table: assets.filter((asset) => asset.kind === "table").length,
    view: assets.filter((asset) => asset.kind === "view").length,
    column: assets.filter((asset) => asset.kind === "column").length,
    measure: assets.filter((asset) => asset.kind === "measure").length,
  };
  const kinds: { key: AssetKind | "all"; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "table", label: "Tables", count: counts.table },
    { key: "view", label: "Views", count: counts.view },
    { key: "column", label: "Columns", count: counts.column },
    { key: "measure", label: "Measures / KPIs", count: counts.measure },
  ];

  const selectedItem = selectedAsset
    ? itemById.get(selectedAsset.itemFabricId)
    : undefined;
  const hasActiveFilters = Boolean(query.trim() || kind !== "all");

  const resetFilters = () => {
    setQuery("");
    setKind("all");
  };

  return (
    <div className="atlas-content-frame flex h-full flex-col gap-l p-xxl">
      <header className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-l px-xl py-l lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <SectionLabel>Schema inventory</SectionLabel>
            <div className="mt-xs flex flex-wrap items-baseline gap-s">
              <h1 className="text-600 font-bold leading-600">Asset Catalog</h1>
              <span className="text-300 text-muted-foreground">
                Tables, columns, measures and effective access
              </span>
            </div>
          </div>
          <dl className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-secondary">
            <div className="px-l py-s text-center">
              <dt className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                Assets
              </dt>
              <dd className="font-numeric text-400 font-bold">{assets.length}</dd>
            </div>
            <div className="px-l py-s text-center">
              <dt className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                Items
              </dt>
              <dd className="font-numeric text-400 font-bold">
                {new Set(assets.map((asset) => asset.itemFabricId)).size}
              </dd>
            </div>
            <div className="px-l py-s text-center">
              <dt className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                Showing
              </dt>
              <dd className="font-numeric text-400 font-bold">
                {filtered.length}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-col gap-s border-t border-border bg-secondary px-xl py-m xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <label htmlFor="asset-search" className="sr-only">
              Search assets
            </label>
            <Search className="icon-size-200 pointer-events-none absolute left-m top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              id="asset-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search asset, table or parent item"
              className="h-9 w-full rounded-lg border border-input bg-card pl-xxxl pr-xxxl text-300 text-foreground placeholder:text-muted-foreground"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear asset search"
                className="absolute right-s top-1/2 -translate-y-1/2 rounded-md p-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="icon-size-100" />
              </button>
            )}
          </div>

          <div
            className="flex flex-wrap gap-xs"
            role="group"
            aria-label="Filter assets by kind"
          >
            {kinds.map(({ key, label, count }) => (
              <button
                type="button"
                key={key}
                aria-pressed={kind === key}
                onClick={() => setKind(key)}
                className={cn(
                  "inline-flex h-9 items-center gap-s rounded-lg border px-m text-[length:var(--text-200)] font-semibold transition-colors",
                  kind === key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                {label}
                <span
                  className={cn(
                    "rounded-md px-xs py-xxs font-numeric text-100",
                    kind === key ? "bg-primary-foreground/15" : "bg-muted",
                  )}
                >
                  {count}
                </span>
              </button>
            ))}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-9 items-center justify-center gap-xs rounded-lg px-m text-200 font-semibold text-primary hover:bg-primary/10"
            >
              <FilterX className="icon-size-100" />
              Reset
            </button>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-l xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center gap-s border-b border-border bg-card px-l py-m">
            <div>
              <h2 className="text-300 font-semibold">Items and assets</h2>
              <p className="text-200 text-muted-foreground">
                {groups.length} {groups.length === 1 ? "item" : "items"} ·{" "}
                {filtered.length} {filtered.length === 1 ? "asset" : "assets"}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-xs">
              <button
                type="button"
                onClick={() =>
                  setExpandedGroups(
                    new Set(groups.map(([itemId]) => itemId)),
                  )
                }
                disabled={groups.length === 0}
                className="inline-flex items-center gap-xs rounded-md px-s py-xs text-200 font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                <ChevronDown className="icon-size-100" />
                Expand all
              </button>
              <button
                type="button"
                onClick={() => setExpandedGroups(new Set())}
                disabled={expandedGroups.size === 0}
                className="inline-flex items-center gap-xs rounded-md px-s py-xs text-200 font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                <ChevronRight className="icon-size-100" />
                Collapse all
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto bg-secondary/30 p-s">
            {groups.length === 0 && (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-xl py-xxxl text-center">
                <Search className="icon-size-500 text-muted-foreground" />
                <h3 className="mt-m text-400 font-semibold">
                  No matching assets
                </h3>
                <p className="mt-xs text-300 text-muted-foreground">
                  Try another search or asset kind. Schema assets appear after a
                  workspace sync.
                </p>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="mt-l rounded-lg bg-primary px-l py-s text-300 font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}

            <div className="space-y-s">
              {groups.map(([itemId, groupAssets]) => {
                const item = itemById.get(itemId);
                const open = expandedGroups.has(itemId);
                const controlsId = safeGroupId(itemId);
                return (
                  <article
                    key={itemId}
                    className="overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={controlsId}
                      onClick={() =>
                        setExpandedGroups((previous) => {
                          const next = new Set(previous);
                          if (next.has(itemId)) next.delete(itemId);
                          else next.add(itemId);
                          return next;
                        })
                      }
                      className="flex w-full items-center gap-m px-l py-m text-left transition-colors hover:bg-accent"
                    >
                      <span className="flex size-xxl shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground">
                        {open ? (
                          <ChevronDown className="icon-size-200" />
                        ) : (
                          <ChevronRight className="icon-size-200" />
                        )}
                      </span>
                      {item && <TypeGlyph type={item.itemType} size={32} />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-300 font-semibold">
                          {item?.displayName ?? "Unknown item"}
                        </span>
                        <span className="block text-200 text-muted-foreground">
                          {item ? typeMeta(item.itemType).label : "Item"}
                        </span>
                      </span>
                      <span className="rounded-md border border-border bg-secondary px-s py-xs font-numeric text-200 font-semibold text-muted-foreground">
                        {groupAssets.length}
                      </span>
                    </button>

                    {open && (
                      <div
                        id={controlsId}
                        className="border-t border-border bg-secondary/30 p-s"
                      >
                        <div className="space-y-xs">
                          {groupAssets.map((asset) => {
                            const meta = KIND_META[asset.kind];
                            const active = selectedAsset?.id === asset.id;
                            return (
                              <button
                                type="button"
                                key={asset.id}
                                aria-pressed={active}
                                onClick={() => setSelId(asset.id)}
                                className={cn(
                                  "flex w-full items-center gap-m rounded-lg border px-m py-s text-left transition-colors",
                                  active
                                    ? meta.selectedTone
                                    : "border-transparent bg-card hover:border-border hover:bg-accent",
                                )}
                              >
                                <KindGlyph kind={asset.kind} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-300 font-semibold">
                                    {asset.name}
                                  </span>
                                  <span className="block truncate text-200 text-muted-foreground">
                                    {meta.label}
                                    {asset.table ? ` · ${asset.table}` : ""}
                                  </span>
                                </span>
                                {asset.dataType && (
                                  <span className="shrink-0 rounded-md border border-border bg-secondary px-s py-xxs text-200 text-muted-foreground">
                                    {asset.dataType}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <AnimatePresence mode="wait">
          {selectedAsset ? (
            <motion.aside
              key={selectedAsset.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="min-h-0"
              aria-label={`${selectedAsset.name} inspector`}
            >
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="border-b border-border bg-secondary px-l py-l">
                  <div className="flex items-start gap-m">
                    <KindGlyph kind={selectedAsset.kind} />
                    <div className="min-w-0 flex-1">
                      <SectionLabel>
                        {KIND_META[selectedAsset.kind].label}
                      </SectionLabel>
                      <h2 className="mt-xxs break-words text-500 font-bold leading-500">
                        {selectedAsset.name}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelId("")}
                      aria-label="Clear selected asset"
                      className="rounded-lg border border-transparent p-s text-muted-foreground hover:border-border hover:bg-card hover:text-foreground"
                    >
                      <X className="icon-size-200" />
                    </button>
                  </div>
                </div>

                <div className="border-b border-border p-l">
                  <div className="mb-m flex items-center gap-s">
                    <Boxes className="icon-size-200 text-muted-foreground" />
                    <SectionLabel>Asset context</SectionLabel>
                  </div>
                  <div className="grid grid-cols-1 gap-s sm:grid-cols-2">
                    <MetadataCell
                      label="Asset kind"
                      value={KIND_META[selectedAsset.kind].label}
                    />
                    <MetadataCell
                      label="Object / data type"
                      value={selectedAsset.dataType ?? "Not applicable"}
                    />
                    <MetadataCell
                      label="Parent table"
                      value={selectedAsset.table ?? "Root object"}
                    />
                    <MetadataCell
                      label="Parent item"
                      value={selectedAsset.itemName}
                    />
                    <MetadataCell
                      label="Source"
                      value={selectedAsset.source ?? "Fabric metadata"}
                    />
                    <MetadataCell
                      label="Visibility"
                      value={selectedAsset.isHidden ? "Hidden" : "Visible"}
                    />
                  </div>

                  {selectedAsset.description && (
                    <p className="mt-s rounded-lg border border-border bg-secondary px-m py-s text-200 leading-300 text-muted-foreground">
                      {selectedAsset.description}
                    </p>
                  )}

                  {selectedAsset.expression && (
                    <div className="mt-s overflow-x-auto rounded-lg border border-border bg-muted p-m">
                      <div className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                        Expression
                      </div>
                      <code className="mt-xs block whitespace-pre-wrap font-mono text-200 text-foreground">
                        {selectedAsset.expression}
                      </code>
                    </div>
                  )}

                  <div className="mt-s flex items-center gap-m rounded-lg border border-border bg-secondary px-m py-m">
                    {selectedItem && (
                      <TypeGlyph type={selectedItem.itemType} size={34} />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-300 font-semibold">
                        {selectedAsset.itemName}
                      </div>
                      <div className="text-200 text-muted-foreground">
                        {typeMeta(selectedAsset.itemType).label}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-l">
                  <div className="flex items-start gap-s">
                    <ShieldCheck className="icon-size-200 mt-xxs text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <SectionLabel>Effective access</SectionLabel>
                      <p className="mt-xs text-200 text-muted-foreground">
                        Workspace roles are inherited; item shares override them
                        when present.
                      </p>
                    </div>
                    <span className="rounded-md border border-border bg-secondary px-s py-xs font-numeric text-200 font-semibold text-muted-foreground">
                      {access.length}
                    </span>
                  </div>

                  <div className="mt-m space-y-s">
                    {access.length === 0 && (
                      <div className="rounded-lg border border-dashed border-border bg-secondary/40 px-l py-xl text-center">
                        <Users className="icon-size-400 mx-auto text-muted-foreground" />
                        <div className="mt-s text-300 font-semibold">
                          No access records
                        </div>
                        <div className="mt-xs text-200 text-muted-foreground">
                          Sync the parent item to populate effective access.
                        </div>
                      </div>
                    )}
                    {access.map((grant) => {
                      const principal = principalByName.get(grant.name);
                      return (
                        <div
                          key={grant.name}
                          className="rounded-lg border border-border px-m py-m"
                        >
                          <div className="flex items-center gap-s">
                            <PrincipalAvatar
                              name={grant.name}
                              kind={principal?.kind ?? "user"}
                              size={30}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-xs">
                                <span className="truncate text-300 font-semibold">
                                  {grant.name}
                                </span>
                                {principal?.external && (
                                  <span className="rounded-md border border-status-warning/30 bg-status-warning/10 px-xs py-xxs text-100 font-semibold text-status-warning">
                                    External
                                  </span>
                                )}
                              </div>
                              <div className="mt-xxs text-200 text-muted-foreground">
                                {grant.roleName ??
                                  (grant.inherited
                                    ? "Workspace permission"
                                    : "Item permission")}
                              </div>
                            </div>
                            <AccessChip level={grant.level} />
                          </div>
                          <div className="mt-s flex items-center justify-between border-t border-border pt-s">
                            <span className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                              Access source
                            </span>
                            <span
                              className={cn(
                                "rounded-md border px-s py-xxs text-[length:var(--text-200)] font-semibold",
                                grant.inherited
                                  ? "border-lineage-upstream/30 bg-lineage-upstream/10 text-lineage-upstream"
                                  : "border-primary/30 bg-primary/10 text-primary",
                              )}
                            >
                              {grant.inherited
                                ? "Inherited · workspace"
                                : "Direct · item share"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.aside>
          ) : (
            <motion.aside
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed border-border bg-card px-xl py-xxxl"
            >
              <div className="text-center">
                <Boxes className="icon-size-600 mx-auto text-muted-foreground" />
                <h2 className="mt-m text-400 font-semibold">
                  Inspect an asset
                </h2>
                <p className="mt-xs text-300 text-muted-foreground">
                  Expand an item group, then select a table, column or measure
                  to review its context and effective access.
                </p>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
