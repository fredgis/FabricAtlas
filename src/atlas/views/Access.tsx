import { useMemo, useState } from "react";
import { ShieldAlert, Globe, Crown, UserX, Bot } from "lucide-react";
import { useAtlas } from "../store";
import { Card, PrincipalAvatar, SectionLabel, TypeGlyph, cn } from "../ui";
import {
  typeMeta,
  type AccessLevel,
  type AccessSource,
  type Grant,
  type Item,
  type ItemType,
  type Principal,
  type WorkspaceRole,
} from "../model";

const ACC: Record<AccessLevel, { color: string; label: string }> = {
  owner: { color: "#d9a520", label: "Owner" },
  edit: { color: "#22a565", label: "Edit" },
  view: { color: "#3b82f6", label: "View" },
  none: { color: "", label: "—" },
};

function AccessChip({ level }: { level: AccessLevel }) {
  if (level === "none") return <span className="text-[12px] text-muted-foreground">—</span>;
  const a = ACC[level];
  return (
    <span
      className="rounded-md px-[9px] py-[3px] text-[11.5px] font-bold"
      style={{ background: `${a.color}22`, color: a.color }}
    >
      {a.label}
    </span>
  );
}

const ROLE_COLOR: Record<WorkspaceRole, string> = {
  Admin: "#e5484d",
  Member: "#7c5cff",
  Contributor: "#3b82f6",
  Viewer: "#64748b",
};
function RoleBadge({ role }: { role: WorkspaceRole }) {
  return (
    <span
      className="rounded-full px-[10px] py-[3px] text-[11px] font-bold"
      style={{ background: `${ROLE_COLOR[role]}22`, color: ROLE_COLOR[role] }}
    >
      {role}
    </span>
  );
}

const CATS: { key: string; label: string; types: ItemType[] }[] = [
  { key: "sources", label: "Sources", types: ["Lakehouse", "Warehouse", "Eventhouse", "KQLDatabase"] },
  { key: "transforms", label: "Transforms", types: ["Notebook", "DataPipeline", "Dataflow"] },
  { key: "models", label: "Models", types: ["SemanticModel"] },
  { key: "reports", label: "Reports", types: ["Report", "Dashboard"] },
];

function accessFor(p: Principal, catKey: string): AccessLevel {
  if (p.kind === "guest") return catKey === "reports" ? "view" : "none";
  if (p.kind === "servicePrincipal")
    return catKey === "sources" || catKey === "transforms" ? "edit" : "none";
  switch (p.workspaceRole) {
    case "Admin":
    case "Member":
      return "edit";
    case "Contributor":
      return catKey === "reports" ? "view" : "edit";
    case "Viewer":
      return catKey === "models" || catKey === "reports" ? "view" : "none";
  }
}

const SOURCE_LABEL: Record<AccessSource, string> = {
  workspaceRole: "Inherited · Workspace",
  group: "Inherited · Group",
  directShare: "Direct share",
  orgLink: "Org link",
  itemOwner: "Item owner",
};
const SOURCE_TAG: Record<AccessSource, { t: string; c: string }> = {
  workspaceRole: { t: "Inherited", c: "#64748b" },
  group: { t: "Group", c: "#64748b" },
  directShare: { t: "Direct", c: "#7c5cff" },
  orgLink: { t: "Org link", c: "#e0a417" },
  itemOwner: { t: "Owner", c: "#d9a520" },
};

export function AccessView() {
  const { data } = useAtlas();
  const { principals, grants, items } = data;
  const [mode, setMode] = useState<"principal" | "object">("principal");

  const objectItems = useMemo(
    () => items.filter((i) => grants.some((g) => g.itemFabricId === i.fabricId)),
    [items, grants],
  );
  const [selItem, setSelItem] = useState<string>(
    objectItems.find((i) => i.itemType === "Report")?.fabricId ?? objectItems[0]?.fabricId ?? "",
  );

  const principalByName = useMemo(
    () => new Map<string, Principal>(principals.map((p) => [p.displayName, p])),
    [principals],
  );

  const risks = useMemo(() => {
    const guests = principals.filter((p) => p.external);
    const admins = principals.filter((p) => p.workspaceRole === "Admin");
    const sps = principals.filter((p) => p.kind === "servicePrincipal");
    const noOwner = items.filter((i) => !i.ownerName);
    const broad = grants.filter((g) => g.flag === "broad");
    const out: { icon: typeof ShieldAlert; sev: string; title: string; detail: string }[] = [];
    if (guests.length)
      out.push({ icon: Globe, sev: "#e5484d", title: `${guests.length} external guest${guests.length > 1 ? "s" : ""} can access this workspace`, detail: guests.map((g) => g.displayName).join(", ") });
    if (broad.length)
      out.push({ icon: ShieldAlert, sev: "#e0a417", title: "Items shared broadly", detail: `${broad.length} grant(s) reach the whole org (tenant link / large group).` });
    if (admins.length > 2)
      out.push({ icon: Crown, sev: "#e0a417", title: `${admins.length} workspace admins`, detail: `${admins.map((a) => a.displayName).join(", ")} — more than recommended.` });
    if (noOwner.length)
      out.push({ icon: UserX, sev: "#3b82f6", title: `${noOwner.length} item(s) with no owner`, detail: noOwner.map((i) => i.displayName).join(", ") });
    if (sps.length)
      out.push({ icon: Bot, sev: "#3b82f6", title: `${sps.length} service principal(s)`, detail: `${sps.map((s) => s.displayName).join(", ")} — automation access, review periodically.` });
    return out;
  }, [principals, grants, items]);

  const sel: Item | undefined = items.find((i) => i.fabricId === selItem);
  const itemGrants: Grant[] = grants.filter((g) => g.itemFabricId === selItem);

  return (
    <div className="flex flex-col gap-[16px] p-[24px]">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[22px] font-bold">Access</h1>
          <div className="mt-[4px] text-[13px] text-muted-foreground">
            Who can reach what — down to each object and where the access comes from
          </div>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-border">
          {(["principal", "object"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "px-[14px] py-[7px] text-[12.5px] font-bold",
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {m === "principal" ? "By principal" : "By object"}
            </button>
          ))}
        </div>
      </div>

      {mode === "principal" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, alignItems: "start" }}>
          <Card className="overflow-hidden">
            <div className="border-b border-border px-[16px] py-[12px] text-[13px] font-bold">
              Access matrix · highest access per item type
            </div>
            <div className="overflow-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-[16px] py-[11px] text-left font-bold">Principal</th>
                    <th className="px-[10px] py-[11px] font-bold">Role</th>
                    {CATS.map((c) => (
                      <th key={c.key} className="px-[10px] py-[11px] font-bold">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {principals.map((p) => (
                    <tr key={p.principalId} className="border-t border-border/60 text-center">
                      <td className="px-[16px] py-[11px] text-left">
                        <div className="flex items-center gap-[10px]">
                          <PrincipalAvatar name={p.displayName} kind={p.kind} size={30} />
                          <div>
                            <div className="flex items-center gap-[6px] text-[13px] font-semibold">
                              <span className="truncate">{p.displayName}</span>
                              {p.external && (
                                <span className="rounded bg-[#f5a52422] px-[6px] py-[1px] text-[10px] font-bold text-[#b7791f]">external</span>
                              )}
                              {p.kind === "servicePrincipal" && (
                                <span className="rounded bg-[#0ea5b722] px-[6px] py-[1px] text-[10px] font-bold text-[#0e8a99]">SPN</span>
                              )}
                            </div>
                            <div className="text-[11px] capitalize text-muted-foreground">
                              {p.kind === "servicePrincipal" ? "Service principal" : p.kind}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-[10px] py-[11px]"><RoleBadge role={p.workspaceRole} /></td>
                      {CATS.map((c) => (
                        <td key={c.key} className="px-[10px] py-[11px]">
                          <AccessChip level={accessFor(p, c.key)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card style={{ padding: 0 }}>
            <div className="flex items-center justify-between border-b border-border px-[16px] py-[12px]">
              <span className="text-[13px] font-bold">Access risks</span>
              <span className="text-[12px] text-muted-foreground">{risks.length} to review</span>
            </div>
            <div>
              {risks.map((r, i) => {
                const Icon = r.icon;
                return (
                  <div key={i} className="flex gap-[12px] border-b border-border/60 px-[15px] py-[13px] last:border-0">
                    <span
                      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg"
                      style={{ background: `${r.sev}22`, color: r.sev }}
                    >
                      <Icon size={16} />
                    </span>
                    <div>
                      <div className="text-[13px] font-bold">{r.title}</div>
                      <div className="mt-[3px] text-[12px] leading-[1.45] text-muted-foreground">{r.detail}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, alignItems: "start" }}>
          <Card className="overflow-hidden">
            <div className="border-b border-border px-[14px] py-[11px] text-[13px] font-bold">Items</div>
            <div className="max-h-[560px] overflow-auto">
              {objectItems.map((i) => (
                <button
                  key={i.fabricId}
                  onClick={() => setSelItem(i.fabricId)}
                  className={cn(
                    "flex w-full items-center gap-[10px] border-t border-border/60 px-[14px] py-[10px] text-left first:border-t-0",
                    selItem === i.fabricId ? "bg-accent" : "hover:bg-accent/60",
                  )}
                >
                  <TypeGlyph type={i.itemType} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{i.displayName}</div>
                    <div className="text-[11px] text-muted-foreground">{typeMeta(i.itemType).label}</div>
                  </div>
                  <span className="text-[11px] font-bold text-muted-foreground">
                    {grants.filter((g) => g.itemFabricId === i.fabricId).length}
                  </span>
                </button>
              ))}
            </div>
          </Card>

          <Card style={{ padding: 0 }} className="overflow-hidden">
            {sel && (
              <div className="flex items-center gap-[12px] border-b border-border px-[16px] py-[14px]">
                <TypeGlyph type={sel.itemType} size={40} />
                <div>
                  <div className="text-[16px] font-bold">{sel.displayName}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {typeMeta(sel.itemType).label}
                    {sel.ownerName ? ` · owned by ${sel.ownerName}` : ""}
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-[20px] font-bold">{itemGrants.length}</div>
                  <div className="text-[11px] text-muted-foreground">principals</div>
                </div>
              </div>
            )}
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-[16px] py-[11px] text-left font-bold">Principal</th>
                  <th className="px-[12px] py-[11px] text-left font-bold">Effective access</th>
                  <th className="px-[12px] py-[11px] text-left font-bold">How they got it</th>
                  <th className="px-[12px] py-[11px] text-left font-bold">Flag</th>
                </tr>
              </thead>
              <tbody>
                {itemGrants.map((g, i) => {
                  const p = principalByName.get(g.principalRef);
                  const tag = SOURCE_TAG[g.source];
                  return (
                    <tr key={i} className="border-t border-border/60">
                      <td className="px-[16px] py-[11px]">
                        <div className="flex items-center gap-[10px]">
                          <PrincipalAvatar name={g.principalRef} kind={p?.kind ?? "group"} size={28} />
                          <span className="text-[13px] font-semibold">{g.principalRef}</span>
                        </div>
                      </td>
                      <td className="px-[12px] py-[11px]"><AccessChip level={g.accessLevel} /></td>
                      <td className="px-[12px] py-[11px]">
                        <span className="inline-flex items-center gap-[8px] text-[12.5px]">
                          <span
                            className="rounded px-[7px] py-[2px] text-[10px] font-bold uppercase"
                            style={{ background: `${tag.c}22`, color: tag.c }}
                          >
                            {tag.t}
                          </span>
                          <span className="text-muted-foreground">
                            {SOURCE_LABEL[g.source]}
                            {g.roleName ? ` · ${g.roleName}` : ""}
                          </span>
                        </span>
                      </td>
                      <td className="px-[12px] py-[11px]">
                        {g.flag === "external" && (
                          <span className="rounded bg-[#f5a52422] px-[7px] py-[2px] text-[11px] font-bold text-[#b7791f]">external</span>
                        )}
                        {g.flag === "broad" && (
                          <span className="rounded bg-[#e5484d22] px-[7px] py-[2px] text-[11px] font-bold text-[#e5484d]">broad</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
