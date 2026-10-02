import {
  buildItemRelationsGraph,
  compareItemRelationsWithLineage,
  itemRelationsNodeKey,
  type ItemRelationsComparisonStatus,
  type ItemRelationsEvidence,
  type ItemRelationsGraph,
  type ItemRelationsGraphEdge,
  type ItemRelationsLineageComparison,
} from "./item-relations-evidence";
import type { AtlasChange, HistoricalSnapshot } from "./history";
import { compareSnapshots } from "./history";
import { lineageEdgeKey, normalizeLineageEdges } from "./lineage";
import type { Edge, Item } from "./model";

// Unified, read-only view of lineage evidence by source. Atlas snapshot edges
// stay authoritative; Item Relations API (Beta) edges are only compared with
// them and are never converted into `Edge` values.

export type RelationshipAgreement =
  | "conflict"
  | "agree"
  | "unverified"
  | "preview-only"
  | "cross-workspace"
  | "not-lineage"
  | "snapshot-only"
  | "not-covered"
  | "snapshot";

export const RELATIONSHIP_AGREEMENT_ORDER: readonly RelationshipAgreement[] = [
  "conflict",
  "unverified",
  "preview-only",
  "cross-workspace",
  "agree",
  "snapshot-only",
  "not-covered",
  "not-lineage",
  "snapshot",
];

export const RELATIONSHIP_AGREEMENT_LABEL: Record<
  RelationshipAgreement,
  string
> = {
  conflict: "Direction differs",
  agree: "Sources agree",
  unverified: "Direction unverified",
  "preview-only": "Item Relations only",
  "cross-workspace": "Cross-workspace",
  "not-lineage": "Visibility only",
  "snapshot-only": "Atlas snapshot only",
  "not-covered": "No Preview coverage",
  snapshot: "Atlas snapshot",
};

export interface RelationshipEndpoint {
  key: string;
  id: string;
  workspaceId: string;
  workspaceName?: string;
  displayName: string;
  itemType?: string;
  inSnapshot: boolean;
  isLocal: boolean;
}

export interface PreviewRelationshipEvidence {
  edge: ItemRelationsGraphEdge;
  status: ItemRelationsComparisonStatus;
}

export interface RelationshipEvidence {
  /** Unordered endpoint pair, stable across selection and source changes. */
  id: string;
  source: RelationshipEndpoint;
  target: RelationshipEndpoint;
  agreement: RelationshipAgreement;
  crossWorkspace: boolean;
  authoritative: Edge[];
  preview: PreviewRelationshipEvidence[];
}

export interface LineageEvidenceModel {
  relationships: RelationshipEvidence[];
  byId: ReadonlyMap<string, RelationshipEvidence>;
  counts: Record<RelationshipAgreement, number>;
  /** Normalized source-to-consumer Atlas snapshot edges. */
  authoritativeEdges: Edge[];
  previewGraph?: ItemRelationsGraph;
  comparison?: ItemRelationsLineageComparison;
}

export interface LineageEvidenceInput {
  items: readonly Item[];
  edges: readonly Edge[];
  workspaceId: string;
  workspaceName?: string;
  evidence?: ItemRelationsEvidence | null;
}

export function relationshipPairId(leftKey: string, rightKey: string): string {
  return leftKey <= rightKey
    ? `${leftKey}~${rightKey}`
    : `${rightKey}~${leftKey}`;
}

function agreementFor(
  authoritative: readonly Edge[],
  preview: readonly PreviewRelationshipEvidence[],
  hasEvidence: boolean,
  authoritativeOnly: ReadonlySet<string>,
): RelationshipAgreement {
  const statuses = new Set(preview.map((entry) => entry.status));
  if (statuses.has("direction-conflict")) return "conflict";
  if (statuses.has("matching")) return "agree";
  if (statuses.has("unverified-direction")) return "unverified";
  if (statuses.has("preview-only")) return "preview-only";
  if (statuses.has("cross-workspace")) return "cross-workspace";
  if (authoritative.length === 0) return "not-lineage";
  if (!hasEvidence) return "snapshot";
  return authoritative.some((edge) =>
    authoritativeOnly.has(lineageEdgeKey(edge)),
  )
    ? "snapshot-only"
    : "not-covered";
}

function emptyCounts(): Record<RelationshipAgreement, number> {
  return Object.fromEntries(
    RELATIONSHIP_AGREEMENT_ORDER.map((agreement) => [agreement, 0]),
  ) as Record<RelationshipAgreement, number>;
}

/**
 * Groups Atlas snapshot lineage and optional Item Relations evidence by
 * endpoint pair. Snapshot edges are normalized from source to consumer first;
 * Preview edges keep their own orientation and comparison status.
 */
export function buildLineageEvidence(
  input: LineageEvidenceInput,
): LineageEvidenceModel {
  const workspaceId = input.workspaceId.toLowerCase();
  const items = [...input.items];
  const authoritativeEdges = normalizeLineageEdges(items, [...input.edges]);
  const evidence =
    input.evidence && input.evidence.workspaceId === workspaceId
      ? input.evidence
      : undefined;
  const previewGraph = evidence
    ? buildItemRelationsGraph(evidence, {
        localItems: items,
        workspaceName: input.workspaceName,
      })
    : undefined;
  const comparison = previewGraph
    ? compareItemRelationsWithLineage(previewGraph, authoritativeEdges)
    : undefined;
  const authoritativeOnly = new Set(comparison?.authoritativeOnly ?? []);
  const itemByLowerId = new Map(
    items.map((item) => [item.fabricId.toLowerCase(), item]),
  );
  const previewNodes = new Map(
    (previewGraph?.nodes ?? []).map((node) => [node.key, node]),
  );

  const endpoint = (key: string): RelationshipEndpoint => {
    const node = previewNodes.get(key);
    const separator = key.indexOf(":");
    const endpointWorkspaceId = node?.workspaceId ?? key.slice(0, separator);
    const id = node?.id ?? key.slice(separator + 1);
    const isLocal = endpointWorkspaceId === workspaceId;
    const item = isLocal ? itemByLowerId.get(id) : undefined;
    return {
      key,
      id: item?.fabricId ?? id,
      workspaceId: endpointWorkspaceId,
      workspaceName: isLocal
        ? input.workspaceName ?? node?.workspaceName
        : node?.workspaceName,
      displayName: item?.displayName ?? node?.displayName ?? id,
      itemType: item?.itemType ?? node?.itemType,
      inSnapshot: Boolean(item),
      isLocal,
    };
  };

  const groups = new Map<
    string,
    {
      sourceKey: string;
      targetKey: string;
      authoritative: Edge[];
      preview: PreviewRelationshipEvidence[];
    }
  >();
  const group = (sourceKey: string, targetKey: string) => {
    const id = relationshipPairId(sourceKey, targetKey);
    let current = groups.get(id);
    if (!current) {
      current = { sourceKey, targetKey, authoritative: [], preview: [] };
      groups.set(id, current);
    }
    return current;
  };

  for (const edge of authoritativeEdges) {
    group(
      itemRelationsNodeKey(workspaceId, edge.source),
      itemRelationsNodeKey(workspaceId, edge.target),
    ).authoritative.push(edge);
  }
  for (const edge of previewGraph?.edges ?? []) {
    const status = comparison?.edges.get(edge.id);
    if (!status) continue;
    group(edge.sourceKey, edge.targetKey).preview.push({ edge, status });
  }

  const counts = emptyCounts();
  const relationships = [...groups.entries()].map(([id, entry]) => {
    const source = endpoint(entry.sourceKey);
    const target = endpoint(entry.targetKey);
    const agreement = agreementFor(
      entry.authoritative,
      entry.preview,
      Boolean(evidence),
      authoritativeOnly,
    );
    counts[agreement] += 1;
    return {
      id,
      source,
      target,
      agreement,
      crossWorkspace: !source.isLocal || !target.isLocal,
      authoritative: entry.authoritative,
      preview: entry.preview,
    } satisfies RelationshipEvidence;
  });
  const rank = new Map(
    RELATIONSHIP_AGREEMENT_ORDER.map((agreement, index) => [agreement, index]),
  );
  relationships.sort(
    (left, right) =>
      rank.get(left.agreement)! - rank.get(right.agreement)! ||
      left.source.displayName.localeCompare(right.source.displayName) ||
      left.target.displayName.localeCompare(right.target.displayName) ||
      left.id.localeCompare(right.id),
  );

  return {
    relationships,
    byId: new Map(relationships.map((entry) => [entry.id, entry])),
    counts,
    authoritativeEdges,
    previewGraph,
    comparison,
  };
}

export function relationshipMatches(
  relationship: RelationshipEvidence,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    relationship.source.displayName,
    relationship.target.displayName,
    relationship.source.workspaceName ?? "",
    relationship.target.workspaceName ?? "",
    ...relationship.authoritative.map((edge) => edge.relation),
    ...relationship.preview.map((entry) => entry.edge.relation.relationType),
  ].some((value) => value.toLowerCase().includes(normalized));
}

/** Preview edges drawn on the graph; agreeing and visibility edges are not. */
export function isDrawnPreviewEdge(entry: PreviewRelationshipEvidence): boolean {
  return (
    entry.status !== "matching" &&
    entry.status !== "not-lineage" &&
    !entry.edge.selfRelation
  );
}

export interface PreviewLaneNode {
  key: string;
  endpoint: RelationshipEndpoint;
  x: number;
  y: number;
}

export interface PreviewOverlay {
  edges: Array<{
    relationshipId: string;
    entry: PreviewRelationshipEvidence;
    sourceKey: string;
    targetKey: string;
  }>;
  laneNodes: PreviewLaneNode[];
  laneWidth: number;
  laneHeight: number;
}

export interface PreviewOverlayOptions {
  /** Snapshot item IDs currently placed by the staged layout. */
  visibleItemIds: ReadonlySet<string>;
  laneX: number;
  nodeWidth: number;
  rowGap: number;
  top: number;
}

/**
 * Places endpoints that are not in the snapshot in a separate lane to the
 * right of the staged layout. Snapshot nodes keep their layout positions, and
 * lane order depends only on evidence, never on selection.
 */
export function buildPreviewOverlay(
  model: LineageEvidenceModel,
  workspaceId: string,
  options: PreviewOverlayOptions,
): PreviewOverlay {
  const visibleKeys = new Set(
    [...options.visibleItemIds].map((id) =>
      itemRelationsNodeKey(workspaceId, id),
    ),
  );
  const laneEndpoints = new Map<string, RelationshipEndpoint>();
  const edges: PreviewOverlay["edges"] = [];
  for (const relationship of model.relationships) {
    for (const entry of relationship.preview) {
      if (!isDrawnPreviewEdge(entry)) continue;
      const endpoints = [entry.edge.sourceKey, entry.edge.targetKey].map(
        (key) =>
          key === relationship.source.key
            ? relationship.source
            : relationship.target,
      );
      if (
        endpoints.some(
          (endpoint) => endpoint.inSnapshot && !visibleKeys.has(endpoint.key),
        )
      ) {
        continue;
      }
      for (const endpoint of endpoints) {
        if (!endpoint.inSnapshot) laneEndpoints.set(endpoint.key, endpoint);
      }
      edges.push({
        relationshipId: relationship.id,
        entry,
        sourceKey: entry.edge.sourceKey,
        targetKey: entry.edge.targetKey,
      });
    }
  }
  const laneNodes = [...laneEndpoints.values()]
    .sort(
      (left, right) =>
        (left.workspaceName ?? left.workspaceId).localeCompare(
          right.workspaceName ?? right.workspaceId,
        ) ||
        left.displayName.localeCompare(right.displayName) ||
        left.key.localeCompare(right.key),
    )
    .map((endpoint, index) => ({
      key: endpoint.key,
      endpoint,
      x: options.laneX,
      y: options.top + index * options.rowGap,
    }));
  return {
    edges,
    laneNodes,
    laneWidth: laneNodes.length > 0 ? options.nodeWidth + 96 : 0,
    laneHeight:
      laneNodes.length > 0
        ? options.top + laneNodes.length * options.rowGap
        : 0,
  };
}

export interface LineageChangeRow {
  change: AtlasChange;
  sourceName: string;
  targetName: string;
  relation: string;
}

function isEdge(value: unknown): value is Edge {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Edge).source === "string" &&
    typeof (value as Edge).target === "string"
  );
}

/** Lineage-only snapshot changes, labelled with the names each snapshot knew. */
export function lineageChangesBetween(
  previous: HistoricalSnapshot,
  current: HistoricalSnapshot,
): LineageChangeRow[] {
  const names = new Map<string, string>();
  for (const item of previous.catalog.items) {
    names.set(item.fabricId, item.displayName);
  }
  for (const item of current.catalog.items) {
    names.set(item.fabricId, item.displayName);
  }
  return compareSnapshots(previous, current)
    .filter((change) => change.domain === "lineage")
    .map((change) => {
      const edge = isEdge(change.after)
        ? change.after
        : isEdge(change.before)
          ? change.before
          : undefined;
      const [labelSource = change.label, labelTarget = ""] =
        change.label.split(" → ");
      const sourceId = edge?.source ?? labelSource;
      const targetId = edge?.target ?? labelTarget;
      const relation =
        edge?.relation ??
        current.catalog.edges.find(
          (candidate) =>
            candidate.source === sourceId && candidate.target === targetId,
        )?.relation ??
        "";
      return {
        change,
        sourceName: names.get(sourceId) ?? sourceId,
        targetName: names.get(targetId) ?? targetId,
        relation,
      };
    });
}
