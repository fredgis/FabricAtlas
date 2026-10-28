import type { GovernanceFinding } from "./governance";
import type { AtlasData, ItemType } from "./model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fabric portal routes for item types whose deep link is stable and
 * documented by the portal itself. Any other type falls back to the
 * workspace list, which always exists and never produces a broken page.
 */
const ITEM_ROUTE: Partial<Record<ItemType, string>> = {
  Lakehouse: "lakehouses",
  Warehouse: "datawarehouses",
  Eventhouse: "eventhouses",
  KQLDatabase: "databases",
  KQLQueryset: "queryworkbenches",
  SQLDatabase: "sqldatabases",
  Notebook: "synapsenotebooks",
  DataPipeline: "pipelines",
  SemanticModel: "datasets",
  Report: "reports",
  Dashboard: "dashboards",
  Eventstream: "eventstreams",
  MirroredDatabase: "mirroreddatabases",
};

export function fabricPortalBase(
  portalBase: string = (import.meta.env.VITE_FABRIC_PORTAL_URL as
    string | undefined) ?? "https://app.fabric.microsoft.com",
): string {
  return portalBase.replace(/\/+$/, "");
}

export function fabricWorkspaceUrl(
  workspaceId: string | undefined,
  portalBase?: string,
): string {
  const portal = fabricPortalBase(portalBase);
  return workspaceId && UUID.test(workspaceId)
    ? `${portal}/groups/${encodeURIComponent(workspaceId)}/list?experience=power-bi`
    : portal;
}

/** Deep link to an item, or to its workspace when the route is unknown. */
export function fabricItemUrl(
  workspaceId: string | undefined,
  itemId: string | undefined,
  itemType: ItemType | undefined,
  portalBase?: string,
): string {
  const route = itemType ? ITEM_ROUTE[itemType] : undefined;
  if (
    !route ||
    !workspaceId ||
    !itemId ||
    !UUID.test(workspaceId) ||
    !UUID.test(itemId)
  ) {
    return fabricWorkspaceUrl(workspaceId, portalBase);
  }
  return `${fabricPortalBase(portalBase)}/groups/${encodeURIComponent(workspaceId)}/${route}/${encodeURIComponent(itemId)}?experience=power-bi`;
}

/**
 * Where a reviewer fixes a finding in Fabric. Item-scoped findings open the
 * item; workspace, principal and lineage findings open the workspace.
 */
export function findingFixUrl(
  finding: Pick<GovernanceFinding, "itemId" | "target">,
  data: Pick<AtlasData, "workspace" | "items">,
  portalBase?: string,
): string {
  const workspaceId = data.workspace.fabricId;
  const itemId =
    finding.target?.kind === "item" ? finding.target.itemId : undefined;
  if (!itemId) return fabricWorkspaceUrl(workspaceId, portalBase);
  const item = data.items.find((entry) => entry.fabricId === itemId);
  return fabricItemUrl(workspaceId, itemId, item?.itemType, portalBase);
}
