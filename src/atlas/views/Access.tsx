import { Fragment, useMemo, useState } from "react";
import {
  Bot,
  Boxes,
  ChevronDown,
  ChevronRight,
  Crown,
  FolderTree,
  Globe,
  ShieldAlert,
  UserX,
  Users,
} from "lucide-react";
import { useAtlas } from "../store";
import { Card, PrincipalAvatar, TypeGlyph, cn } from "../ui";
import {
  typeMeta,
  schemaFor,
  type AccessLevel,
  type AccessSource,
  type Grant,
  type Item,
  type ItemType,
  type Principal,
  type WorkspaceRole,
} from "../model";

const ACCESS_STYLE: Record<AccessLevel, { className: string; label: string }> = {
  owner: {
    className:
      "border-status-warning/30 bg-status-warning/10 text-status-warning",
    label: "Owner",
  },
  edit: {
    className:
      "border-status-healthy/30 bg-status-healthy/10 text-status-healthy",
    label: "Edit",
  },
  view: {
    className: "border-primary/25 bg-primary/10 text-brand-foreground",
    label: "View",
  },
  none: { className: "", label: "—" },
};

function AccessChip({ level }: { level: AccessLevel }) {
  if (level === "none") {
    return (
      <span className="text-200 font-medium text-muted-foreground/70">—</span>
    );
  }

  const access = ACCESS_STYLE[level];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-s py-xxs text-[length:var(--text-200)] font-semibold",
        access.className,
      )}
    >
      {access.label}
    </span>
  );
}

const ROLE_STYLE: Record<WorkspaceRole, string> = {
  Admin: "border-status-failing/30 bg-status-failing/10 text-status-failing",
  Member:
    "border-lineage-upstream/30 bg-lineage-upstream/10 text-lineage-upstream",
  Contributor: "border-primary/25 bg-primary/10 text-brand-foreground",
  Viewer:
    "border-lineage-neutral/30 bg-lineage-neutral/10 text-muted-foreground",
};

function RoleBadge({ role }: { role: WorkspaceRole }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-s py-xxs text-[length:var(--text-200)] font-semibold",
        ROLE_STYLE[role],
      )}
    >
      {role}
    </span>
  );
}

const CATEGORIES: { key: string; label: string; types: ItemType[] }[] = [
  {
    key: "sources",
    label: "Sources",
    types: ["Lakehouse", "Warehouse", "Eventhouse", "KQLDatabase"],
  },
  {
    key: "transforms",
    label: "Transforms",
    types: ["Notebook", "DataPipeline", "Dataflow"],
  },
  { key: "models", label: "Models", types: ["SemanticModel"] },
  { key: "reports", label: "Reports", types: ["Report", "Dashboard"] },
];

const ACCESS_RANK: Record<AccessLevel, number> = {
  none: 0,
  view: 1,
  edit: 2,
  owner: 3,
};

const SOURCE_LABEL: Record<AccessSource, string> = {
  workspaceRole: "Inherited · Workspace",
  group: "Inherited · Group",
  directShare: "Direct share",
  orgLink: "Org link",
  itemOwner: "Item owner",
};

const SOURCE_TAG: Record<AccessSource, { label: string; className: string }> = {
  workspaceRole: {
    label: "Inherited",
    className:
      "border-lineage-neutral/30 bg-lineage-neutral/10 text-muted-foreground",
  },
  group: {
    label: "Group",
    className:
      "border-lineage-neutral/30 bg-lineage-neutral/10 text-muted-foreground",
  },
  directShare: {
    label: "Direct",
    className:
      "border-lineage-upstream/30 bg-lineage-upstream/10 text-lineage-upstream",
  },
  orgLink: {
    label: "Org link",
    className:
      "border-status-warning/30 bg-status-warning/10 text-status-warning",
  },
  itemOwner: {
    label: "Owner",
    className:
      "border-status-warning/30 bg-status-warning/10 text-status-warning",
  },
};

const ASSET_STYLE: Record<string, string> = {
  measure:
    "border-object-measure/30 bg-object-measure/10 text-object-measure",
  table: "border-object-source/30 bg-object-source/10 text-object-source",
  column: "border-object-column/30 bg-object-column/10 text-object-column",
};

type RiskTone = "critical" | "warning" | "info";

const RISK_STYLE: Record<
  RiskTone,
  { badge: string; icon: string; card: string; label: string }
> = {
  critical: {
    badge:
      "border-status-failing/30 bg-status-failing/10 text-status-failing",
    icon: "bg-status-failing/10 text-status-failing",
    card: "border-status-failing/30",
    label: "Priority",
  },
  warning: {
    badge:
      "border-status-warning/30 bg-status-warning/10 text-status-warning",
    icon: "bg-status-warning/10 text-status-warning",
    card: "border-status-warning/30",
    label: "Review",
  },
  info: {
    badge: "border-primary/25 bg-primary/10 text-brand-foreground",
    icon: "bg-primary/10 text-brand-foreground",
    card: "border-border",
    label: "Monitor",
  },
};

export function AccessView() {
  const { data } = useAtlas();
  const { principals, grants, items } = data;
  const [mode, setMode] = useState<"principal" | "object">("principal");

  const objectItems = useMemo(
    () =>
      items.filter((item) =>
        grants.some((grant) => grant.itemFabricId === item.fabricId),
      ),
    [items, grants],
  );
  const [selectedItemId, setSelectedItemId] = useState<string>(
    objectItems.find((item) => item.itemType === "Report")?.fabricId ??
      objectItems[0]?.fabricId ??
      "",
  );

  const principalByName = useMemo(
    () =>
      new Map<string, Principal>(
        principals.map((principal) => [principal.displayName, principal]),
      ),
    [principals],
  );

  const grantsByPrincipal = useMemo(() => {
    const grouped = new Map<string, Grant[]>();
    for (const grant of grants) {
      const principalGrants = grouped.get(grant.principalRef) ?? [];
      principalGrants.push(grant);
      grouped.set(grant.principalRef, principalGrants);
    }
    return grouped;
  }, [grants]);

  const itemTypeById = useMemo(
    () =>
      new Map<string, ItemType>(
        items.map((item) => [item.fabricId, item.itemType]),
      ),
    [items],
  );

  const categoryAccess = (
    principal: Principal,
    category: { types: ItemType[] },
  ): AccessLevel => {
    const principalGrants =
      grantsByPrincipal.get(principal.displayName) ?? [];
    const types = new Set(category.types);
    let best: AccessLevel = "none";

    for (const grant of principalGrants) {
      const applies =
        !grant.itemFabricId ||
        types.has(itemTypeById.get(grant.itemFabricId)!);
      if (applies && ACCESS_RANK[grant.accessLevel] > ACCESS_RANK[best]) {
        best = grant.accessLevel;
      }
    }
    return best;
  };

  const hasWorkspaceRole = (principal: Principal) =>
    (grantsByPrincipal.get(principal.displayName) ?? []).some(
      (grant) => !grant.itemFabricId,
    );

  const [expandedPrincipalId, setExpandedPrincipalId] = useState<string | null>(
    null,
  );
  const [openPanels, setOpenPanels] = useState<Set<string>>(
    new Set(["items"]),
  );

  const togglePanel = (panel: string) =>
    setOpenPanels((previous) => {
      const next = new Set(previous);
      if (next.has(panel)) next.delete(panel);
      else next.add(panel);
      return next;
    });

  const accessibleItemsFor = (principal: Principal) => {
    const principalGrants =
      grantsByPrincipal.get(principal.displayName) ?? [];
    const baseline = principalGrants.find((grant) => !grant.itemFabricId);
    const byItem = new Map<
      string,
      { level: AccessLevel; inherited: boolean }
    >();

    if (baseline) {
      for (const item of items) {
        byItem.set(item.fabricId, {
          level: baseline.accessLevel,
          inherited: true,
        });
      }
    }
    for (const grant of principalGrants) {
      if (grant.itemFabricId) {
        byItem.set(grant.itemFabricId, {
          level: grant.accessLevel,
          inherited: false,
        });
      }
    }

    return items
      .filter((item) => byItem.has(item.fabricId))
      .map((item) => ({ item, ...byItem.get(item.fabricId)! }));
  };

  const assetsFor = (accessibleItems: { item: Item }[]) => {
    const assets: {
      itemName: string;
      itemType: ItemType;
      kind: string;
      name: string;
      table?: string;
    }[] = [];

    for (const { item } of accessibleItems) {
      const schema = schemaFor(data, item.fabricId);
      if (!schema) continue;
      for (const table of schema) {
        assets.push({
          itemName: item.displayName,
          itemType: item.itemType,
          kind: "table",
          name: table.name,
        });
        for (const measure of table.measures) {
          assets.push({
            itemName: item.displayName,
            itemType: item.itemType,
            kind: "measure",
            name: measure.name,
            table: table.name,
          });
        }
        for (const column of table.columns) {
          assets.push({
            itemName: item.displayName,
            itemType: item.itemType,
            kind: "column",
            name: column.name,
            table: table.name,
          });
        }
      }
    }
    return assets;
  };

  const risks = useMemo(() => {
    const guests = principals.filter((principal) => principal.external);
    const admins = principals.filter(
      (principal) => principal.workspaceRole === "Admin",
    );
    const servicePrincipals = principals.filter(
      (principal) => principal.kind === "servicePrincipal",
    );
    const workspacePrincipals = new Set(
      grants
        .filter((grant) => !grant.itemFabricId)
        .map((grant) => grant.principalRef),
    );
    const itemOnly = principals.filter(
      (principal) => !workspacePrincipals.has(principal.displayName),
    );
    const broad = grants.filter((grant) => grant.flag === "broad");
    const findings: {
      icon: typeof ShieldAlert;
      tone: RiskTone;
      title: string;
      detail: string;
    }[] = [];

    if (guests.length) {
      findings.push({
        icon: Globe,
        tone: "critical",
        title: `${guests.length} external guest${guests.length > 1 ? "s" : ""} can access this workspace`,
        detail: guests.map((guest) => guest.displayName).join(", "),
      });
    }
    if (broad.length) {
      findings.push({
        icon: ShieldAlert,
        tone: "warning",
        title: "Items shared broadly",
        detail: `${broad.length} grant(s) reach the whole org (tenant link / large group).`,
      });
    }
    if (admins.length > 2) {
      findings.push({
        icon: Crown,
        tone: "warning",
        title: `${admins.length} workspace admins`,
        detail: `${admins.map((admin) => admin.displayName).join(", ")} — more than recommended.`,
      });
    }
    if (itemOnly.length) {
      findings.push({
        icon: UserX,
        tone: "info",
        title: `${itemOnly.length} principal(s) with item-only access`,
        detail: `${itemOnly.map((principal) => principal.displayName).join(", ")} — shared specific items without workspace membership.`,
      });
    }
    if (servicePrincipals.length) {
      findings.push({
        icon: Bot,
        tone: "info",
        title: `${servicePrincipals.length} service principal(s)`,
        detail: `${servicePrincipals.map((principal) => principal.displayName).join(", ")} — automation access, review periodically.`,
      });
    }
    return findings;
  }, [principals, grants]);

  const selectedItem: Item | undefined = items.find(
    (item) => item.fabricId === selectedItemId,
  );
  const itemGrants: Grant[] = grants.filter(
    (grant) => grant.itemFabricId === selectedItemId,
  );
  const directShareCount = grants.filter(
    (grant) => grant.source === "directShare",
  ).length;
  const externalCount = principals.filter(
    (principal) => principal.external,
  ).length;

  const metrics = [
    {
      label: "Principals",
      value: principals.length,
      detail: "People, groups and apps",
      icon: Users,
      className: "text-brand-foreground bg-primary/10",
    },
    {
      label: "Direct shares",
      value: directShareCount,
      detail: "Explicit item grants",
      icon: FolderTree,
      className: "text-lineage-upstream bg-lineage-upstream/10",
    },
    {
      label: "External access",
      value: externalCount,
      detail: "Guest principals",
      icon: Globe,
      className:
        externalCount > 0
          ? "text-status-failing bg-status-failing/10"
          : "text-status-healthy bg-status-healthy/10",
    },
    {
      label: "Risks",
      value: risks.length,
      detail: risks.length ? "Findings to review" : "No findings",
      icon: ShieldAlert,
      className:
        risks.length > 0
          ? "text-status-warning bg-status-warning/10"
          : "text-status-healthy bg-status-healthy/10",
    },
  ];

  return (
    <div className="atlas-content-frame flex flex-col gap-l p-l sm:p-xxl">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-l border-b border-border bg-secondary/60 p-l lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-xs text-200 font-semibold uppercase tracking-wider text-brand-foreground">
              Governance command center
            </div>
            <h1 className="text-600 font-bold leading-600">Access control</h1>
            <p className="mt-xs text-300 leading-300 text-muted-foreground">
              Effective reach across workspace roles, direct grants and object
              permissions.
            </p>
          </div>

          <div
            className="inline-flex self-start rounded-lg border border-border bg-card p-xs"
            role="group"
            aria-label="Access view"
          >
            {(["principal", "object"] as const).map((viewMode) => (
              <button
                key={viewMode}
                type="button"
                aria-pressed={mode === viewMode}
                onClick={() => setMode(viewMode)}
                className={cn(
                  "rounded-md px-l py-s text-300 font-semibold transition-colors",
                  mode === viewMode
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {viewMode === "principal" ? "By principal" : "By object"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 divide-x divide-y divide-border lg:grid-cols-4 lg:divide-y-0">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className="flex gap-m p-l">
                <span
                  className={cn(
                    "flex icon-size-600 shrink-0 items-center justify-center rounded-xl",
                    metric.className,
                  )}
                >
                  <Icon className="icon-size-300" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="font-numeric text-500 font-bold leading-500 tabular-nums">
                    {metric.value}
                  </div>
                  <div className="text-300 font-semibold">{metric.label}</div>
                  <div className="truncate text-200 text-muted-foreground">
                    {metric.detail}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {mode === "principal" ? (
        <div className="grid items-start gap-l xl:grid-cols-3">
          <Card className="overflow-hidden xl:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-s border-b border-border px-l py-m">
              <div>
                <h2 className="text-300 font-semibold">Access matrix</h2>
                <p className="text-200 text-muted-foreground">
                  Highest effective access by item family
                </p>
              </div>
              <span className="rounded-full border border-border bg-muted/50 px-s py-xs text-200 font-medium text-muted-foreground">
                {principals.length} rows
              </span>
            </div>

            <div className="overflow-auto">
              <table className="w-full min-w-[calc(var(--spacing-xxxl)*24)] border-collapse">
                <thead className="sticky top-0 z-10 bg-card shadow-sm">
                  <tr className="text-200 text-muted-foreground">
                    <th className="w-2/5 px-l py-m text-left font-semibold">
                      Principal
                    </th>
                    <th className="px-m py-m text-center font-semibold">
                      Workspace role
                    </th>
                    {CATEGORIES.map((category) => (
                      <th
                        key={category.key}
                        className="px-m py-m text-center font-semibold"
                      >
                        {category.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {principals.length === 0 && (
                    <tr>
                      <td
                        colSpan={2 + CATEGORIES.length}
                        className="px-l py-xxxl text-center text-300 text-muted-foreground"
                      >
                        No principals are available for this workspace.
                      </td>
                    </tr>
                  )}
                  {principals.map((principal) => {
                    const expanded =
                      expandedPrincipalId === principal.principalId;
                    const accessibleItems = expanded
                      ? accessibleItemsFor(principal)
                      : [];
                    const assets = expanded
                      ? assetsFor(accessibleItems)
                      : [];
                    const itemsOpen = openPanels.has("items");
                    const assetsOpen = openPanels.has("assets");
                    const detailId = `principal-access-${principal.principalId}`;

                    return (
                      <Fragment key={principal.principalId}>
                        <tr
                          className={cn(
                            "border-t border-border/60 text-center transition-colors",
                            expanded
                              ? "bg-primary/10"
                              : "hover:bg-accent/40",
                          )}
                        >
                          <td
                            className={cn(
                              "px-l py-m text-left",
                              expanded && "border-l-2 border-l-primary",
                            )}
                          >
                            <button
                              type="button"
                              aria-expanded={expanded}
                              aria-controls={detailId}
                              onClick={() =>
                                setExpandedPrincipalId(
                                  expanded ? null : principal.principalId,
                                )
                              }
                              className="flex w-full items-center gap-s rounded-md text-left"
                            >
                              {expanded ? (
                                <ChevronDown
                                  className="icon-size-200 shrink-0 text-brand-foreground"
                                  aria-hidden="true"
                                />
                              ) : (
                                <ChevronRight
                                  className="icon-size-200 shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                              )}
                              <PrincipalAvatar
                                name={principal.displayName}
                                kind={principal.kind}
                                size={32}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-xs text-300 font-semibold">
                                  <span className="truncate">
                                    {principal.displayName}
                                  </span>
                                  {principal.external && (
                                    <span className="rounded-md border border-status-warning/30 bg-status-warning/10 px-xs py-xxs text-100 font-semibold uppercase text-status-warning">
                                      External
                                    </span>
                                  )}
                                  {principal.kind === "servicePrincipal" && (
                                    <span className="rounded-md border border-lineage-downstream/30 bg-lineage-downstream/10 px-xs py-xxs text-100 font-semibold uppercase text-lineage-downstream">
                                      SPN
                                    </span>
                                  )}
                                </span>
                                <span className="block text-200 capitalize text-muted-foreground">
                                  {principal.kind === "servicePrincipal"
                                    ? "Service principal"
                                    : principal.kind}
                                </span>
                              </span>
                            </button>
                          </td>
                          <td className="px-m py-m">
                            {hasWorkspaceRole(principal) ? (
                              <RoleBadge role={principal.workspaceRole} />
                            ) : (
                              <span className="inline-flex rounded-full border border-border bg-muted/50 px-s py-xxs text-200 font-medium text-muted-foreground">
                                Item-only
                              </span>
                            )}
                          </td>
                          {CATEGORIES.map((category) => (
                            <td key={category.key} className="px-m py-m">
                              <AccessChip
                                level={categoryAccess(principal, category)}
                              />
                            </td>
                          ))}
                        </tr>

                        {expanded && (
                          <tr id={detailId} className="bg-muted/30">
                            <td
                              colSpan={2 + CATEGORIES.length}
                              className="border-l-2 border-l-primary px-l py-l"
                            >
                              <div className="grid gap-l text-left md:grid-cols-2">
                                <section className="overflow-hidden rounded-xl border border-border bg-card">
                                  <button
                                    type="button"
                                    aria-expanded={itemsOpen}
                                    onClick={() => togglePanel("items")}
                                    className="flex w-full items-center gap-s px-m py-m text-left hover:bg-accent/50"
                                  >
                                    {itemsOpen ? (
                                      <ChevronDown
                                        className="icon-size-200"
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <ChevronRight
                                        className="icon-size-200"
                                        aria-hidden="true"
                                      />
                                    )}
                                    <span className="flex icon-size-500 items-center justify-center rounded-lg bg-primary/10 text-brand-foreground">
                                      <FolderTree
                                        className="icon-size-200"
                                        aria-hidden="true"
                                      />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block text-300 font-semibold">
                                        Reachable items
                                      </span>
                                      <span className="block text-200 text-muted-foreground">
                                        Workspace and direct grants
                                      </span>
                                    </span>
                                    <span className="rounded-full bg-muted px-s py-xxs text-200 font-semibold">
                                      {accessibleItems.length}
                                    </span>
                                  </button>

                                  {itemsOpen && (
                                    <div className="max-h-[calc(var(--spacing-xxxl)*10)] overflow-auto border-t border-border/60">
                                      {accessibleItems.length === 0 && (
                                        <div className="px-m py-l text-200 text-muted-foreground">
                                          This principal has no reachable items.
                                        </div>
                                      )}
                                      {accessibleItems.map(
                                        ({ item, level, inherited }) => (
                                          <div
                                            key={item.fabricId}
                                            className="flex items-center gap-s border-b border-border/40 px-m py-s last:border-b-0"
                                          >
                                            <TypeGlyph
                                              type={item.itemType}
                                              size={24}
                                            />
                                            <span className="min-w-0 flex-1">
                                              <span className="block truncate text-200 font-medium">
                                                {item.displayName}
                                              </span>
                                              <span className="block text-100 text-muted-foreground">
                                                {typeMeta(item.itemType).label}
                                              </span>
                                            </span>
                                            <span
                                              className={cn(
                                                "rounded-md border px-xs py-xxs text-[length:var(--text-100)] font-semibold uppercase",
                                                inherited
                                                  ? "border-lineage-neutral/30 bg-lineage-neutral/10 text-muted-foreground"
                                                  : "border-lineage-upstream/30 bg-lineage-upstream/10 text-lineage-upstream",
                                              )}
                                            >
                                              {inherited
                                                ? "Workspace"
                                                : "Direct"}
                                            </span>
                                            <AccessChip level={level} />
                                          </div>
                                        ),
                                      )}
                                    </div>
                                  )}
                                </section>

                                <section className="overflow-hidden rounded-xl border border-border bg-card">
                                  <button
                                    type="button"
                                    aria-expanded={assetsOpen}
                                    onClick={() => togglePanel("assets")}
                                    className="flex w-full items-center gap-s px-m py-m text-left hover:bg-accent/50"
                                  >
                                    {assetsOpen ? (
                                      <ChevronDown
                                        className="icon-size-200"
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <ChevronRight
                                        className="icon-size-200"
                                        aria-hidden="true"
                                      />
                                    )}
                                    <span className="flex icon-size-500 items-center justify-center rounded-lg bg-object-column/10 text-object-column">
                                      <Boxes
                                        className="icon-size-200"
                                        aria-hidden="true"
                                      />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block text-300 font-semibold">
                                        Reachable assets
                                      </span>
                                      <span className="block text-200 text-muted-foreground">
                                        Tables, measures and columns
                                      </span>
                                    </span>
                                    <span className="rounded-full bg-muted px-s py-xxs text-200 font-semibold">
                                      {assets.length}
                                    </span>
                                  </button>

                                  {assetsOpen && (
                                    <div className="max-h-[calc(var(--spacing-xxxl)*10)] overflow-auto border-t border-border/60">
                                      {assets.length === 0 && (
                                        <div className="px-m py-l text-200 text-muted-foreground">
                                          No sub-objects exist in the items this
                                          principal can reach.
                                        </div>
                                      )}
                                      {assets.map((asset, index) => (
                                        <div
                                          key={`${asset.itemName}-${asset.kind}-${asset.name}-${index}`}
                                          className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-s border-b border-border/40 px-m py-s last:border-b-0"
                                        >
                                          <span
                                            className={cn(
                                              "row-span-2 self-center rounded-md border px-xs py-xxs text-[length:var(--text-100)] font-semibold uppercase",
                                              ASSET_STYLE[asset.kind],
                                            )}
                                          >
                                            {asset.kind}
                                          </span>
                                          <span className="truncate text-200 font-medium">
                                            {asset.name}
                                          </span>
                                          <span className="truncate text-100 text-muted-foreground">
                                            {asset.table
                                              ? `${asset.itemName} · ${asset.table}`
                                              : asset.itemName}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </section>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden xl:sticky xl:top-l">
            <div className="flex items-center justify-between gap-s border-b border-border bg-secondary/50 px-l py-m">
              <div>
                <h2 className="text-300 font-semibold">Prioritized risks</h2>
                <p className="text-200 text-muted-foreground">
                  Highest-impact findings first
                </p>
              </div>
              <span className="rounded-full border border-border bg-card px-s py-xs text-200 font-semibold">
                {risks.length}
              </span>
            </div>

            <div className="flex flex-col gap-s p-m">
              {risks.length === 0 && (
                <div className="rounded-xl border border-status-healthy/30 bg-status-healthy/10 p-l text-center">
                  <div className="text-300 font-semibold text-status-healthy">
                    No access risks detected
                  </div>
                  <div className="mt-xs text-200 text-muted-foreground">
                    Current grants do not trigger a governance finding.
                  </div>
                </div>
              )}
              {risks.map((risk, index) => {
                const Icon = risk.icon;
                const style = RISK_STYLE[risk.tone];
                return (
                  <article
                    key={`${risk.title}-${index}`}
                    className={cn(
                      "rounded-xl border bg-card p-m",
                      style.card,
                    )}
                  >
                    <div className="flex items-start gap-m">
                      <span
                        className={cn(
                          "flex icon-size-600 shrink-0 items-center justify-center rounded-xl",
                          style.icon,
                        )}
                      >
                        <Icon
                          className="icon-size-300"
                          aria-hidden="true"
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="mb-xs flex items-center justify-between gap-s">
                          <span
                            className={cn(
                              "rounded-md border px-xs py-xxs text-[length:var(--text-100)] font-semibold uppercase tracking-wide",
                              style.badge,
                            )}
                          >
                            {style.label}
                          </span>
                          <span className="font-numeric text-100 text-muted-foreground">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                        </div>
                        <h3 className="text-300 font-semibold leading-300">
                          {risk.title}
                        </h3>
                        <p className="mt-xs text-200 leading-200 text-muted-foreground">
                          {risk.detail}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </Card>
        </div>
      ) : (
        <div className="grid items-start gap-l lg:grid-cols-3">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-secondary/50 px-l py-m">
              <div>
                <h2 className="text-300 font-semibold">Shared objects</h2>
                <p className="text-200 text-muted-foreground">
                  Select an item to inspect
                </p>
              </div>
              <span className="rounded-full border border-border bg-card px-s py-xs text-200 font-semibold">
                {objectItems.length}
              </span>
            </div>

            <div className="max-h-[calc(var(--spacing-xxxl)*18)] overflow-auto">
              {objectItems.length === 0 && (
                <div className="p-xxl text-center">
                  <FolderTree className="mx-auto icon-size-600 text-muted-foreground" />
                  <div className="mt-m text-300 font-semibold">
                    No item-level grants
                  </div>
                  <div className="mt-xs text-200 leading-200 text-muted-foreground">
                    Objects appear here when an item has explicit access
                    assignments.
                  </div>
                </div>
              )}
              {objectItems.map((item) => {
                const selected = selectedItemId === item.fabricId;
                const grantCount = grants.filter(
                  (grant) => grant.itemFabricId === item.fabricId,
                ).length;
                return (
                  <button
                    key={item.fabricId}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedItemId(item.fabricId)}
                    className={cn(
                      "flex w-full items-center gap-m border-b border-border/60 px-l py-m text-left transition-colors last:border-b-0",
                      selected
                        ? "border-l-2 border-l-primary bg-primary/10"
                        : "border-l-2 border-l-transparent hover:bg-accent/50",
                    )}
                  >
                    <TypeGlyph type={item.itemType} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-300 font-semibold">
                        {item.displayName}
                      </span>
                      <span className="block text-200 text-muted-foreground">
                        {typeMeta(item.itemType).label}
                      </span>
                    </span>
                    <span className="rounded-full border border-border bg-card px-s py-xxs text-200 font-semibold tabular-nums">
                      {grantCount}
                    </span>
                    <ChevronRight
                      className={cn(
                        "icon-size-200",
                        selected
                          ? "text-brand-foreground"
                          : "text-muted-foreground",
                      )}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="overflow-hidden lg:col-span-2">
            {!selectedItem ? (
              <div className="flex min-h-[calc(var(--spacing-xxxl)*10)] flex-col items-center justify-center p-xxl text-center">
                <Boxes className="icon-size-700 text-muted-foreground" />
                <h2 className="mt-l text-400 font-semibold">
                  Select a shared object
                </h2>
                <p className="mt-xs text-300 text-muted-foreground">
                  Choose an item to review its principals, access levels and
                  grant origins.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-m border-b border-border bg-secondary/50 p-l">
                  <TypeGlyph type={selectedItem.itemType} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-400 font-semibold">
                      {selectedItem.displayName}
                    </div>
                    <div className="text-200 text-muted-foreground">
                      {typeMeta(selectedItem.itemType).label}
                      {selectedItem.ownerName
                        ? ` · owned by ${selectedItem.ownerName}`
                        : ""}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-card px-l py-s text-right">
                    <div className="font-numeric text-500 font-bold leading-500 tabular-nums">
                      {itemGrants.length}
                    </div>
                    <div className="text-200 text-muted-foreground">
                      principals
                    </div>
                  </div>
                </div>

                {itemGrants.length === 0 ? (
                  <div className="p-xxxl text-center text-300 text-muted-foreground">
                    This item has no explicit grants to review.
                  </div>
                ) : (
                  <div className="overflow-auto">
                    <table className="w-full min-w-[calc(var(--spacing-xxxl)*22)] border-collapse">
                      <thead className="sticky top-0 z-10 bg-card shadow-sm">
                        <tr className="text-200 text-muted-foreground">
                          <th className="px-l py-m text-left font-semibold">
                            Principal
                          </th>
                          <th className="px-m py-m text-left font-semibold">
                            Effective access
                          </th>
                          <th className="px-m py-m text-left font-semibold">
                            Grant origin
                          </th>
                          <th className="px-m py-m text-left font-semibold">
                            Flag
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemGrants.map((grant, index) => {
                          const principal = principalByName.get(
                            grant.principalRef,
                          );
                          const tag = SOURCE_TAG[grant.source];
                          return (
                            <tr
                              key={`${grant.principalRef}-${grant.source}-${index}`}
                              className="border-t border-border/60 hover:bg-accent/30"
                            >
                              <td className="px-l py-m">
                                <div className="flex items-center gap-s">
                                  <PrincipalAvatar
                                    name={grant.principalRef}
                                    kind={principal?.kind ?? "group"}
                                    size={28}
                                  />
                                  <span className="text-300 font-semibold">
                                    {grant.principalRef}
                                  </span>
                                </div>
                              </td>
                              <td className="px-m py-m">
                                <AccessChip level={grant.accessLevel} />
                              </td>
                              <td className="px-m py-m">
                                <div className="flex flex-wrap items-center gap-s">
                                  <span
                                    className={cn(
                                      "rounded-md border px-xs py-xxs text-[length:var(--text-100)] font-semibold uppercase",
                                      tag.className,
                                    )}
                                  >
                                    {tag.label}
                                  </span>
                                  <span className="text-200 text-muted-foreground">
                                    {SOURCE_LABEL[grant.source]}
                                    {grant.roleName
                                      ? ` · ${grant.roleName}`
                                      : ""}
                                  </span>
                                </div>
                              </td>
                              <td className="px-m py-m">
                                {grant.flag === "external" && (
                                  <span className="rounded-md border border-status-warning/30 bg-status-warning/10 px-s py-xxs text-200 font-semibold text-status-warning">
                                    External
                                  </span>
                                )}
                                {grant.flag === "broad" && (
                                  <span className="rounded-md border border-status-failing/30 bg-status-failing/10 px-s py-xxs text-200 font-semibold text-status-failing">
                                    Broad
                                  </span>
                                )}
                                {!grant.flag && (
                                  <span className="text-200 text-muted-foreground/60">
                                    —
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
