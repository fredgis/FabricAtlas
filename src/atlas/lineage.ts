import type { Edge, Item, ItemType } from "./model";

export type LineageDirection = "upstream" | "downstream";

export interface LineagePath {
  ids: Set<string>;
  edgeKeys: Set<string>;
  distance: Map<string, number>;
}

export interface LineageImpact {
  upstream: LineagePath;
  downstream: LineagePath;
}

export interface StagedLayout {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
  stageCount: number;
}

export const LINEAGE_STAGE_LABELS = [
  "Ingest & transform",
  "Store",
  "Model",
  "Consume",
] as const;

const ITEM_STAGE: Partial<Record<ItemType, number>> = {
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

export function lineageEdgeKey(edge: Edge): string {
  return `${edge.source}\u0000${edge.target}\u0000${edge.relation}`;
}

function walkLineage(
  edges: Edge[],
  startId: string,
  direction: LineageDirection,
  maxDepth: number,
): LineagePath {
  const ids = new Set<string>();
  const edgeKeys = new Set<string>();
  const distance = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
  const visited = new Set<string>([startId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= maxDepth) continue;

    for (const edge of edges) {
      const matches =
        direction === "upstream" ? edge.target === current.id : edge.source === current.id;
      if (!matches) continue;

      const nextId = direction === "upstream" ? edge.source : edge.target;
      if (nextId === startId) continue;

      edgeKeys.add(lineageEdgeKey(edge));
      ids.add(nextId);

      const nextDepth = current.depth + 1;
      const knownDepth = distance.get(nextId);
      if (knownDepth == null || nextDepth < knownDepth) distance.set(nextId, nextDepth);

      if (!visited.has(nextId)) {
        visited.add(nextId);
        queue.push({ id: nextId, depth: nextDepth });
      }
    }
  }

  return { ids, edgeKeys, distance };
}

export function getLineageImpact(
  edges: Edge[],
  startId: string,
  maxDepth = Number.POSITIVE_INFINITY,
): LineageImpact {
  if (!startId) {
    const empty = (): LineagePath => ({
      ids: new Set<string>(),
      edgeKeys: new Set<string>(),
      distance: new Map<string, number>(),
    });
    return { upstream: empty(), downstream: empty() };
  }

  return {
    upstream: walkLineage(edges, startId, "upstream", maxDepth),
    downstream: walkLineage(edges, startId, "downstream", maxDepth),
  };
}

export function itemStage(type: ItemType): number {
  return ITEM_STAGE[type] ?? 0;
}

export function buildStagedLayout(
  items: Item[],
  edges: Edge[],
  options?: {
    nodeWidth?: number;
    nodeHeight?: number;
    columnGap?: number;
    rowGap?: number;
    padding?: number;
  },
): StagedLayout {
  const nodeWidth = options?.nodeWidth ?? 196;
  const nodeHeight = options?.nodeHeight ?? 60;
  const columnGap = options?.columnGap ?? 266;
  const rowGap = options?.rowGap ?? 78;
  const padding = options?.padding ?? 28;
  const stages: Item[][] = Array.from({ length: LINEAGE_STAGE_LABELS.length }, () => []);

  for (const item of items) stages[itemStage(item.itemType)].push(item);

  stages[0].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const order = new Map<string, number>();
  stages[0].forEach((item, index) => order.set(item.fabricId, index));

  for (let stageIndex = 1; stageIndex < stages.length; stageIndex += 1) {
    stages[stageIndex].sort((a, b) => {
      const score = (item: Item) => {
        const neighborOrders = edges
          .filter(
            (edge) =>
              (edge.target === item.fabricId && order.has(edge.source)) ||
              (edge.source === item.fabricId && order.has(edge.target)),
          )
          .map((edge) => order.get(edge.source) ?? order.get(edge.target) ?? 0);
        if (neighborOrders.length === 0) return Number.POSITIVE_INFINITY;
        return neighborOrders.reduce((sum, value) => sum + value, 0) / neighborOrders.length;
      };

      const delta = score(a) - score(b);
      return Number.isFinite(delta) && delta !== 0
        ? delta
        : a.displayName.localeCompare(b.displayName);
    });
    stages[stageIndex].forEach((item, index) => order.set(item.fabricId, index));
  }

  const positions = new Map<string, { x: number; y: number }>();
  stages.forEach((stage, stageIndex) => {
    stage.forEach((item, rowIndex) => {
      positions.set(item.fabricId, {
        x: padding + stageIndex * columnGap,
        y: padding + 34 + rowIndex * rowGap,
      });
    });
  });

  const rows = Math.max(...stages.map((stage) => stage.length), 1);
  return {
    positions,
    width: padding * 2 + (stages.length - 1) * columnGap + nodeWidth,
    height: padding * 2 + 34 + (rows - 1) * rowGap + nodeHeight,
    stageCount: stages.length,
  };
}
