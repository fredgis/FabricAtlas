import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  AlertTriangle,
  GitCompareArrows,
  LoaderCircle,
  Network,
  RefreshCw,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  buildItemRelationsBetaGraph,
  collectItemRelationsBeta,
  compareItemRelationsWithCurrent,
  type ItemRelationClass,
  type ItemRelationsBetaCollection,
  type ItemRelationsBetaGraphEdge,
  type ItemRelationsBetaNode,
  type ItemRelationsBetaProgress,
} from "../item-relations-beta";
import {
  buildStagedLayout,
  LINEAGE_STAGE_LABELS,
} from "../lineage";
import type {
  AtlasFocusRequest,
  AtlasNavigation,
} from "../navigation";
import { useAtlas } from "../store";
import { cn, TypeGlyph } from "../ui";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 82;
const COLUMN_GAP = 282;
const ROW_GAP = 108;

type DifferenceFilter =
  | "all"
  | "matching"
  | "beta-only"
  | "direction-conflict"
  | "cross-workspace";

const RELATION_STYLES: Record<
  ItemRelationClass,
  { color: string; dash?: string; label: string }
> = {
  data: {
    color: "var(--color-lineage-downstream)",
    label: "Data",
  },
  association: {
    color: "var(--color-foreground)",
    dash: "4 5",
    label: "Association",
  },
  orchestration: {
    color: "var(--color-status-warning)",
    dash: "12 6",
    label: "Orchestration",
  },
  lifecycle: {
    color: "var(--color-status-failing)",
    dash: "2 5",
    label: "Lifecycle",
  },
  visibility: {
    color: "var(--color-lineage-upstream)",
    dash: "12 5 2 5",
    label: "Visibility",
  },
};

function filterText(
  focus: AtlasFocusRequest | undefined,
  key: string,
): string {
  const value = focus?.filters?.[key];
  return typeof value === "string" ? value : "";
}

function differenceFilter(
  focus: AtlasFocusRequest | undefined,
): DifferenceFilter {
  const value = filterText(focus, "difference");
  return value === "matching" ||
    value === "beta-only" ||
    value === "direction-conflict" ||
    value === "cross-workspace"
    ? value
    : "all";
}

function edgePath(
  edge: ItemRelationsBetaGraphEdge,
  positions: Map<string, { x: number; y: number }>,
) {
  const source = positions.get(edge.sourceKey);
  const target = positions.get(edge.targetKey);
  if (!source || !target) return null;
  const forward = source.x <= target.x;
  const sourceX = forward ? source.x + NODE_WIDTH : source.x;
  const targetX = forward ? target.x : target.x + NODE_WIDTH;
  const sourceY = source.y + NODE_HEIGHT / 2;
  const targetY = target.y + NODE_HEIGHT / 2;
  const bend = Math.max(72, Math.abs(targetX - sourceX) * 0.46);
  const firstControlX = sourceX + (forward ? bend : -bend);
  const secondControlX = targetX - (forward ? bend : -bend);
  return {
    d: `M ${sourceX} ${sourceY} C ${firstControlX} ${sourceY}, ${secondControlX} ${targetY}, ${targetX} ${targetY}`,
    labelX: (sourceX + targetX) / 2,
    labelY: (sourceY + targetY) / 2 - 7,
  };
}

function countFailures(
  collection: ItemRelationsBetaCollection,
): number {
  return Object.values(collection.itemFailures).reduce(
    (total, directions) => total + Object.keys(directions).length,
    0,
  );
}

function differenceLabel(value: DifferenceFilter): string {
  switch (value) {
    case "matching":
      return "Matching current map";
    case "beta-only":
      return "Beta-only";
    case "direction-conflict":
      return "Direction conflicts";
    case "cross-workspace":
      return "Cross-workspace";
    default:
      return "All API relations";
  }
}

function graphNodeStyle(): CSSProperties {
  return {
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  };
}

export function MapBetaView({
  focus,
  onStateChange,
}: {
  focus?: AtlasFocusRequest;
  onStateChange?: (navigation: AtlasNavigation) => void;
} = {}) {
  const { data, currentUser, canSync, isPreview } = useAtlas();
  const [collection, setCollection] =
    useState<ItemRelationsBetaCollection | null>(null);
  const [status, setStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [error, setError] = useState<string>();
  const [progress, setProgress] =
    useState<ItemRelationsBetaProgress | null>(null);
  const [query, setQuery] = useState(focus?.query ?? "");
  const [workspaceFilter, setWorkspaceFilter] = useState(
    filterText(focus, "workspace"),
  );
  const [relationFilter, setRelationFilter] = useState(
    filterText(focus, "relation"),
  );
  const [difference, setDifference] = useState<DifferenceFilter>(
    differenceFilter(focus),
  );
  const [selectedKey, setSelectedKey] = useState(
    focus?.itemId ?? "",
  );
  const [zoom, setZoom] = useState(1);
  const abortController = useRef<AbortController | undefined>(undefined);

  useEffect(
    () => () => abortController.current?.abort(),
    [],
  );

  useEffect(() => {
    onStateChange?.({
      tab: "map-beta",
      focus: {
        requestId: "map-beta-view-state",
        itemId: selectedKey || undefined,
        query: query.trim() || undefined,
        filters:
          workspaceFilter || relationFilter || difference !== "all"
            ? {
                ...(workspaceFilter
                  ? { workspace: workspaceFilter }
                  : {}),
                ...(relationFilter
                  ? { relation: relationFilter }
                  : {}),
                ...(difference !== "all" ? { difference } : {}),
              }
            : undefined,
      },
    });
  }, [
    difference,
    onStateChange,
    query,
    relationFilter,
    selectedKey,
    workspaceFilter,
  ]);

  const graph = useMemo(
    () =>
      collection
        ? buildItemRelationsBetaGraph(
            collection,
            data.items,
            data.workspace.displayName,
          )
        : null,
    [collection, data.items, data.workspace.displayName],
  );
  const comparison = useMemo(
    () =>
      graph
        ? compareItemRelationsWithCurrent(graph, data.edges)
        : null,
    [data.edges, graph],
  );
  const nodeByKey = useMemo(
    () => new Map(graph?.nodes.map((node) => [node.key, node]) ?? []),
    [graph],
  );
  const workspaceOptions = useMemo(
    () =>
      [...new Map(
        graph?.nodes.map((node) => [
          node.workspaceId.toLowerCase(),
          {
            id: node.workspaceId,
            label: node.workspaceName,
          },
        ]) ?? [],
      ).values()].sort((left, right) =>
        left.label.localeCompare(right.label),
      ),
    [graph],
  );
  const relationOptions = useMemo(
    () =>
      [...new Set(
        graph?.edges.map((edge) => edge.relationType) ?? [],
      )].sort((left, right) => left.localeCompare(right)),
    [graph],
  );

  const visibleGraph = useMemo(() => {
    if (!graph || !comparison) {
      return { nodes: [] as ItemRelationsBetaNode[], edges: [] as ItemRelationsBetaGraphEdge[] };
    }
    const normalizedQuery = query.trim().toLowerCase();
    const queryMatches = new Set(
      graph.nodes
        .filter(
          (node) =>
            !normalizedQuery ||
            node.displayName.toLowerCase().includes(normalizedQuery) ||
            node.itemType.toLowerCase().includes(normalizedQuery) ||
            node.workspaceName.toLowerCase().includes(normalizedQuery),
        )
        .map((node) => node.key),
    );
    const edges = graph.edges.filter((edge) => {
      const source = nodeByKey.get(edge.sourceKey);
      const target = nodeByKey.get(edge.targetKey);
      if (!source || !target) return false;
      if (
        normalizedQuery &&
        !queryMatches.has(source.key) &&
        !queryMatches.has(target.key)
      ) {
        return false;
      }
      if (
        workspaceFilter &&
        source.workspaceId.toLowerCase() !==
          workspaceFilter.toLowerCase() &&
        target.workspaceId.toLowerCase() !==
          workspaceFilter.toLowerCase()
      ) {
        return false;
      }
      if (
        relationFilter &&
        edge.relationType !== relationFilter
      ) {
        return false;
      }
      switch (difference) {
        case "matching":
          return comparison.matching.has(edge.id);
        case "beta-only":
          return comparison.betaOnly.has(edge.id);
        case "direction-conflict":
          return comparison.directionConflicts.has(edge.id);
        case "cross-workspace":
          return source.workspaceId !== target.workspaceId;
        default:
          return true;
      }
    });
    const visibleKeys = new Set<string>();
    edges.forEach((edge) => {
      visibleKeys.add(edge.sourceKey);
      visibleKeys.add(edge.targetKey);
    });
    if (
      !normalizedQuery &&
      !workspaceFilter &&
      !relationFilter &&
      difference === "all"
    ) {
      graph.nodes.forEach((node) => visibleKeys.add(node.key));
    } else if (normalizedQuery) {
      queryMatches.forEach((key) => visibleKeys.add(key));
    }
    return {
      nodes: graph.nodes.filter((node) => visibleKeys.has(node.key)),
      edges,
    };
  }, [
    comparison,
    difference,
    graph,
    nodeByKey,
    query,
    relationFilter,
    workspaceFilter,
  ]);

  const resolvedSelectedKey =
    selectedKey &&
    visibleGraph.nodes.some((node) => node.key === selectedKey)
      ? selectedKey
      : "";

  const layout = useMemo(
    () =>
      buildStagedLayout(
        visibleGraph.nodes.map((node) => ({
          fabricId: node.key,
          displayName: node.displayName,
          itemType: node.itemType,
        })),
        visibleGraph.edges.map((edge) => ({
          source: edge.sourceKey,
          target: edge.targetKey,
          relation: edge.relationType,
        })),
        {
          nodeWidth: NODE_WIDTH,
          nodeHeight: NODE_HEIGHT,
          columnGap: COLUMN_GAP,
          rowGap: ROW_GAP,
          componentGap: 60,
          focusId: resolvedSelectedKey || undefined,
        },
      ),
    [resolvedSelectedKey, visibleGraph.edges, visibleGraph.nodes],
  );
  const selectedNode = resolvedSelectedKey
    ? nodeByKey.get(resolvedSelectedKey)
    : undefined;
  const selectedRelations = useMemo(
    () =>
      selectedNode && graph
        ? graph.edges.filter(
            (edge) =>
              edge.sourceKey === selectedNode.key ||
              edge.targetKey === selectedNode.key,
          )
        : [],
    [graph, selectedNode],
  );
  const selectedQueries = useMemo(
    () =>
      selectedNode
        ? collection?.queries.filter(
            (queryEvidence) =>
              queryEvidence.itemId.toLowerCase() ===
              selectedNode.id.toLowerCase(),
          ) ?? []
        : [],
    [collection?.queries, selectedNode],
  );
  const selectedFailures = useMemo(() => {
    if (!selectedNode || !collection) return undefined;
    return Object.entries(collection.itemFailures).find(
      ([itemId]) =>
        itemId.toLowerCase() === selectedNode.id.toLowerCase(),
    )?.[1];
  }, [collection, selectedNode]);

  const collect = async () => {
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    setStatus("loading");
    setError(undefined);
    setProgress({
      completedItems: 0,
      totalItems: data.items.length,
      requestCount: 0,
      sliceCount: 0,
    });
    try {
      const result = await collectItemRelationsBeta(
        data.workspace.fabricId,
        data.items.map((item) => item.fabricId),
        currentUser,
        setProgress,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setCollection(result);
      setStatus("ready");
    } catch (caught) {
      if (
        controller.signal.aborted ||
        (caught instanceof DOMException && caught.name === "AbortError")
      ) {
        setStatus(collection ? "ready" : "idle");
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "Item Relations collection failed.",
      );
      setStatus("error");
    } finally {
      if (abortController.current === controller) {
        abortController.current = undefined;
      }
    }
  };

  const cancel = () => {
    abortController.current?.abort();
    abortController.current = undefined;
  };

  const actionDisabled =
    isPreview || !canSync || data.items.length === 0;
  const actionTitle = isPreview
    ? "Item Relations collection is available in the deployed Beta app."
    : !canSync
      ? "Only the configured Atlas synchronizer can run this API-wide collection."
      : data.items.length === 0
        ? "Synchronize the workspace before collecting Item Relations."
        : undefined;
  const progressPercent = progress
    ? Math.round(
        (progress.completedItems /
          Math.max(progress.totalItems, 1)) *
          100,
      )
    : 0;
  const failureCount = collection ? countFailures(collection) : 0;

  return (
    <div className="flex min-h-full flex-col gap-l p-m sm:p-l xl:p-xl">
      <header className="flex flex-col gap-m border-b border-border pb-l lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="mb-s flex flex-wrap items-center gap-s">
            <h1 className="text-600 font-bold tracking-tight">
              Map &amp; Lineage
            </h1>
            <span className="rounded-md border border-status-warning/50 bg-status-warning/10 px-s py-xs text-200 font-semibold text-foreground">
              Beta API
            </span>
          </div>
          <p className="text-300 leading-300 text-muted-foreground">
            Live relation evidence from Fabric&apos;s preview Item Relations
            API. This view is collected on demand and does not replace the
            validated Atlas snapshot.
          </p>
        </div>
        <button
          type="button"
          onClick={status === "loading" ? cancel : () => void collect()}
          disabled={status !== "loading" && actionDisabled}
          title={actionTitle}
          className={cn(
            "inline-flex min-h-11 items-center justify-center gap-s rounded-lg px-l text-300 font-semibold shadow-fabric-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60",
            status === "loading"
              ? "border border-border bg-card text-foreground hover:bg-accent"
              : "bg-primary text-primary-foreground hover:bg-primary-hover",
          )}
        >
          {status === "loading" ? (
            <X className="icon-size-200" aria-hidden="true" />
          ) : (
            <RefreshCw className="icon-size-200" aria-hidden="true" />
          )}
          {status === "loading"
            ? "Cancel collection"
            : collection
              ? "Refresh API relations"
              : "Collect API relations"}
        </button>
      </header>

      <div className="rounded-lg border border-status-warning/35 bg-status-warning/10 px-m py-s text-200 leading-200 text-foreground">
        <strong>Preview contract:</strong> relation types and endpoints are
        preserved as returned. Unknown values remain visible, and lifecycle or
        orchestration links are not presented as validated data flow. Arrows
        follow the API dependency orientation from{" "}
        <code>dependentOnItemId</code> to <code>itemId</code>.
      </div>

      {status === "loading" && (
        <section
          aria-live="polite"
          aria-busy="true"
          className="rounded-lg border border-border bg-card px-m py-m shadow-fabric-2"
        >
          <div className="flex items-center justify-between gap-m text-200">
            <span className="flex min-w-0 items-center gap-s font-semibold">
              <LoaderCircle
                className="icon-size-200 shrink-0 animate-spin"
                aria-hidden="true"
              />
              <span className="truncate">
                Collecting upstream and downstream API relations
              </span>
            </span>
            <span className="shrink-0 tabular-nums">
              {progress?.completedItems ?? 0}/{progress?.totalItems ?? 0}
            </span>
          </div>
          <div
            className="mt-s h-s overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
            aria-label="Item Relations collection progress"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </section>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-s rounded-lg border border-destructive/40 bg-destructive/10 px-m py-m text-300 text-foreground"
        >
          <AlertTriangle
            className="icon-size-200 mt-xs shrink-0 text-destructive"
            aria-hidden="true"
          />
          <div>
            <strong>Item Relations collection failed.</strong>{" "}
            {error} Use the collection action to retry.
          </div>
        </div>
      )}

      {!collection && status !== "loading" ? (
        <section className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-l py-xl text-center">
          <Network
            className="icon-size-500 text-brand"
            aria-hidden="true"
          />
          <h2 className="mt-m text-400 font-semibold">
            No Beta relation evidence collected
          </h2>
          <p className="mt-s max-w-xl text-300 leading-300 text-muted-foreground">
            Run the on-demand collection to query both Item Relations API
            directions for every item in the current Atlas snapshot.
          </p>
          {actionTitle && (
            <p className="mt-s text-200 text-muted-foreground">
              {actionTitle}
            </p>
          )}
        </section>
      ) : collection && graph && comparison ? (
        <>
          <section
            aria-label="Item Relations collection evidence"
            className="grid gap-s rounded-lg border border-border bg-card p-m shadow-fabric-2 sm:grid-cols-2 xl:grid-cols-[1.3fr_1fr_1fr_1fr]"
          >
            <div className="sm:col-span-2 xl:col-span-1">
              <div className="text-200 font-semibold text-muted-foreground">
                Collection
              </div>
              <div className="mt-xs text-300 font-semibold">
                {collection.completedItemIds.length} item roots,{" "}
                {collection.requestCount} Fabric requests
              </div>
              <div className="mt-xs text-200 text-muted-foreground">
                {collection.sliceCount} UDF slices ·{" "}
                {(collection.durationMs / 1000).toFixed(1)} seconds
              </div>
            </div>
            <div>
              <div className="text-200 text-muted-foreground">
                API graph
              </div>
              <div className="mt-xs text-500 font-bold tabular-nums">
                {graph.edges.length}
              </div>
              <div className="text-200 text-muted-foreground">
                raw relations
              </div>
            </div>
            <div>
              <div className="text-200 text-muted-foreground">
                Cross-workspace
              </div>
              <div className="mt-xs text-500 font-bold tabular-nums">
                {comparison.crossWorkspaceRelationCount}
              </div>
              <div className="text-200 text-muted-foreground">
                relations
              </div>
            </div>
            <div>
              <div className="text-200 text-muted-foreground">
                Partial failures
              </div>
              <div className="mt-xs text-500 font-bold tabular-nums">
                {failureCount}
              </div>
              <div className="text-200 text-muted-foreground">
                direction queries
              </div>
            </div>
          </section>

          {(failureCount > 0 ||
            graph.unresolvedRelationCount > 0 ||
            collection.errors.length > 0) && (
            <div
              role="status"
              className="flex items-start gap-s rounded-lg border border-status-warning/40 bg-status-warning/10 px-m py-s text-200 text-foreground"
            >
              <AlertTriangle
                className="icon-size-200 mt-xs shrink-0"
                aria-hidden="true"
              />
              <span>
                The API graph is partial: {failureCount} failed direction
                queries, {graph.unresolvedRelationCount} unresolved relation
                endpoints. Raw failure codes remain available in the
                selection details.
              </span>
            </div>
          )}

          <section className="grid gap-m xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-fabric-2">
              <div className="grid gap-s border-b border-border bg-secondary/60 p-m sm:grid-cols-2 xl:grid-cols-4">
                <label className="min-w-0">
                  <span className="mb-xs block text-200 font-semibold text-muted-foreground">
                    Search
                  </span>
                  <span className="relative block">
                    <Search
                      className="icon-size-200 pointer-events-none absolute left-s top-1/2 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Item, type, or workspace"
                      className="h-11 w-full rounded-md border border-input bg-card pl-xl pr-s text-300 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </span>
                </label>
                <label className="min-w-0">
                  <span className="mb-xs block text-200 font-semibold text-muted-foreground">
                    Workspace
                  </span>
                  <select
                    value={workspaceFilter}
                    onChange={(event) =>
                      setWorkspaceFilter(event.target.value)
                    }
                    className="h-11 w-full rounded-md border border-input bg-card px-s text-300 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">All workspaces</option>
                    {workspaceOptions.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0">
                  <span className="mb-xs block text-200 font-semibold text-muted-foreground">
                    Relation type
                  </span>
                  <select
                    value={relationFilter}
                    onChange={(event) =>
                      setRelationFilter(event.target.value)
                    }
                    className="h-11 w-full rounded-md border border-input bg-card px-s text-300 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">All relation types</option>
                    {relationOptions.map((relation) => (
                      <option key={relation} value={relation}>
                        {relation}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0">
                  <span className="mb-xs block text-200 font-semibold text-muted-foreground">
                    Difference
                  </span>
                  <select
                    value={difference}
                    onChange={(event) =>
                      setDifference(
                        event.target.value as DifferenceFilter,
                      )
                    }
                    className="h-11 w-full rounded-md border border-input bg-card px-s text-300 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {(
                      [
                        "all",
                        "matching",
                        "beta-only",
                        "direction-conflict",
                        "cross-workspace",
                      ] as DifferenceFilter[]
                    ).map((value) => (
                      <option key={value} value={value}>
                        {differenceLabel(value)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-s border-b border-border px-m py-s">
                <div className="flex flex-wrap gap-m text-200 text-muted-foreground">
                  {Object.entries(RELATION_STYLES).map(
                    ([relationClass, style]) => (
                      <span
                        key={relationClass}
                        className="inline-flex items-center gap-xs"
                      >
                        <svg
                          width="24"
                          height="8"
                          aria-hidden="true"
                        >
                          <line
                            x1="0"
                            y1="4"
                            x2="24"
                            y2="4"
                            stroke={style.color}
                            strokeWidth="2"
                            strokeDasharray={style.dash}
                          />
                        </svg>
                        {style.label}
                      </span>
                    ),
                  )}
                </div>
                <div className="flex items-center gap-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setZoom((value) => Math.max(0.65, value - 0.1))
                    }
                    aria-label="Zoom out"
                    className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ZoomOut
                      className="icon-size-200"
                      aria-hidden="true"
                    />
                  </button>
                  <span className="min-w-12 text-center text-200 tabular-nums text-muted-foreground">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setZoom((value) => Math.min(1.35, value + 0.1))
                    }
                    aria-label="Zoom in"
                    className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ZoomIn
                      className="icon-size-200"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>

              {visibleGraph.nodes.length === 0 ? (
                <div className="flex min-h-[420px] items-center justify-center px-l py-xl text-center">
                  <div>
                    <h2 className="text-400 font-semibold">
                      No relations match these filters
                    </h2>
                    <p className="mt-s text-300 text-muted-foreground">
                      Clear one or more filters to restore API evidence.
                    </p>
                  </div>
                </div>
              ) : graph.edges.length === 0 ? (
                <div className="flex min-h-[420px] items-center justify-center px-l py-xl text-center">
                  <div>
                    <h2 className="text-400 font-semibold">
                      The API returned no relations
                    </h2>
                    <p className="mt-s text-300 text-muted-foreground">
                      The item roots completed, but neither direction returned
                      relation evidence.
                    </p>
                  </div>
                </div>
              ) : (
                <div
                  className="atlas-map-grid max-h-[720px] min-h-[520px] overflow-auto bg-background"
                  aria-label={`Item Relations graph with ${visibleGraph.nodes.length} items and ${visibleGraph.edges.length} relations`}
                >
                  <div
                    className="relative"
                    style={{
                      width: layout.width * zoom,
                      height: layout.height * zoom,
                      minWidth: "100%",
                    }}
                  >
                    <div
                      className="absolute left-0 top-0 origin-top-left"
                      style={{
                        width: layout.width,
                        height: layout.height,
                        transform: `scale(${zoom})`,
                      }}
                    >
                      {LINEAGE_STAGE_LABELS.map((label, index) => (
                        <div
                          key={label}
                          className="absolute top-s text-200 font-semibold text-muted-foreground"
                          style={{ left: 28 + index * COLUMN_GAP }}
                        >
                          {label}
                        </div>
                      ))}
                      {layout.groups.map((group) => (
                        <div
                          key={group.id}
                          className="pointer-events-none absolute left-s rounded-xl border border-dashed border-border/70"
                          style={{
                            top: group.y,
                            width: layout.width - 16,
                            height: group.height,
                          }}
                          aria-hidden="true"
                        >
                          <span className="absolute left-s top-xs rounded bg-background/90 px-xs text-100 font-semibold text-muted-foreground">
                            {group.label}
                          </span>
                        </div>
                      ))}
                      <svg
                        className="absolute inset-0 overflow-visible"
                        width={layout.width}
                        height={layout.height}
                        aria-hidden="true"
                      >
                        <defs>
                          {Object.entries(RELATION_STYLES).map(
                            ([relationClass, style]) => (
                              <marker
                                key={relationClass}
                                id={`beta-arrow-${relationClass}`}
                                markerWidth="8"
                                markerHeight="8"
                                refX="7"
                                refY="4"
                                orient="auto"
                                markerUnits="strokeWidth"
                              >
                                <path
                                  d="M 0 0 L 8 4 L 0 8 z"
                                  fill={style.color}
                                />
                              </marker>
                            ),
                          )}
                        </defs>
                        {visibleGraph.edges.map((edge) => {
                          const path = edgePath(edge, layout.positions);
                          if (!path) return null;
                          const style = RELATION_STYLES[edge.relationClass];
                          const selected =
                            edge.sourceKey === resolvedSelectedKey ||
                            edge.targetKey === resolvedSelectedKey;
                          return (
                            <g key={edge.id}>
                              <path
                                d={path.d}
                                fill="none"
                                stroke={style.color}
                                strokeWidth={selected ? 3 : 2}
                                strokeDasharray={style.dash}
                                opacity={
                                  resolvedSelectedKey && !selected
                                    ? 0.28
                                    : 0.84
                                }
                                markerEnd={`url(#beta-arrow-${edge.relationClass})`}
                              />
                              {visibleGraph.edges.length <= 80 && (
                                <text
                                  x={path.labelX}
                                  y={path.labelY}
                                  textAnchor="middle"
                                  fill="var(--color-muted-foreground)"
                                  stroke="var(--color-background)"
                                  strokeWidth="4"
                                  paintOrder="stroke"
                                  fontSize="11"
                                >
                                  {edge.relationType}
                                </text>
                              )}
                            </g>
                          );
                        })}
                      </svg>
                      {visibleGraph.nodes.map((node) => {
                        const position = layout.positions.get(node.key);
                        if (!position) return null;
                        const selected =
                          node.key === resolvedSelectedKey;
                        return (
                          <button
                            key={node.key}
                            type="button"
                            onClick={() =>
                              setSelectedKey(selected ? "" : node.key)
                            }
                            aria-pressed={selected}
                            className={cn(
                              "absolute flex items-center gap-s rounded-lg border bg-card p-s text-left shadow-fabric-2 transition-[border-color,box-shadow,opacity] hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                              node.isLocal
                                ? "border-border"
                                : "border-dashed border-lineage-upstream",
                              selected &&
                                "border-primary ring-2 ring-primary/25",
                            )}
                            style={{
                              ...graphNodeStyle(),
                              left: position.x,
                              top: position.y,
                            }}
                          >
                            <TypeGlyph type={node.itemType} size={36} />
                            <span className="min-w-0">
                              <span className="block truncate text-300 font-semibold text-foreground">
                                {node.displayName}
                              </span>
                              <span className="mt-xs block truncate text-200 text-muted-foreground">
                                {node.itemType}
                              </span>
                              <span className="mt-xs block truncate text-100 text-muted-foreground">
                                {node.isLocal
                                  ? "Current workspace"
                                  : node.workspaceName}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <aside className="min-w-0 rounded-xl border border-border bg-card p-m shadow-fabric-2">
              {selectedNode ? (
                <>
                  <div className="flex items-start gap-s">
                    <TypeGlyph type={selectedNode.itemType} size={40} />
                    <div className="min-w-0">
                      <h2 className="break-words text-400 font-semibold">
                        {selectedNode.displayName}
                      </h2>
                      <p className="mt-xs text-200 text-muted-foreground">
                        {selectedNode.itemType}
                      </p>
                    </div>
                  </div>
                  <dl className="mt-m grid gap-s border-y border-border py-m text-200">
                    <div>
                      <dt className="text-muted-foreground">Workspace</dt>
                      <dd className="mt-xs break-words font-medium">
                        {selectedNode.workspaceName}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Item ID</dt>
                      <dd className="mt-xs break-all font-mono text-100">
                        {selectedNode.id}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        Workspace ID
                      </dt>
                      <dd className="mt-xs break-all font-mono text-100">
                        {selectedNode.workspaceId}
                      </dd>
                    </div>
                  </dl>
                  <h3 className="mt-m text-300 font-semibold">
                    API relationships ({selectedRelations.length})
                  </h3>
                  {selectedRelations.length > 0 ? (
                    <ul className="mt-s grid gap-s">
                      {selectedRelations.map((edge) => {
                        const outgoing = edge.sourceKey === selectedNode.key;
                        const neighbor = nodeByKey.get(
                          outgoing ? edge.targetKey : edge.sourceKey,
                        );
                        return (
                          <li
                            key={edge.id}
                            className="rounded-md border border-border bg-secondary/60 p-s text-200"
                          >
                            <div className="font-semibold">
                              {edge.relationType}
                            </div>
                            <div className="mt-xs text-muted-foreground">
                              {outgoing ? "Outgoing to" : "Incoming from"}{" "}
                              {neighbor?.displayName ?? "Unresolved item"}
                            </div>
                            <details className="mt-s">
                              <summary className="cursor-pointer font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                Raw API fields
                              </summary>
                              <dl className="mt-s grid gap-xs text-100 text-muted-foreground">
                                <div>
                                  <dt>relationType</dt>
                                  <dd className="break-all font-mono text-foreground">
                                    {edge.relationType}
                                  </dd>
                                </div>
                                <div>
                                  <dt>itemId</dt>
                                  <dd className="break-all font-mono text-foreground">
                                    {edge.rawItemId}
                                  </dd>
                                </div>
                                <div>
                                  <dt>dependentOnItemId</dt>
                                  <dd className="break-all font-mono text-foreground">
                                    {edge.rawDependentOnItemId}
                                  </dd>
                                </div>
                              </dl>
                            </details>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-s text-200 text-muted-foreground">
                      No API relationship is connected to this item.
                    </p>
                  )}
                  {selectedQueries.length > 0 && (
                    <>
                      <h3 className="mt-m text-300 font-semibold">
                        Direction queries
                      </h3>
                      <ul className="mt-s grid gap-xs text-200">
                        {selectedQueries.map((queryEvidence, index) => (
                          <li
                            key={`${queryEvidence.direction}-${index}`}
                            className="flex items-center justify-between gap-s rounded-md bg-secondary px-s py-xs"
                          >
                            <span>{queryEvidence.direction}</span>
                            <span className="font-medium">
                              {queryEvidence.status === "complete"
                                ? `${queryEvidence.relationCount ?? 0} relations`
                                : queryEvidence.code}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {selectedFailures &&
                    Object.keys(selectedFailures).length > 0 && (
                      <p
                        role="status"
                        className="mt-m rounded-md border border-status-warning/40 bg-status-warning/10 p-s text-200"
                      >
                        Partial query failure:{" "}
                        {Object.entries(selectedFailures)
                          .map(
                            ([direction, code]) =>
                              `${direction} (${code})`,
                          )
                          .join(", ")}
                      </p>
                    )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-s">
                    <GitCompareArrows
                      className="icon-size-300 text-brand"
                      aria-hidden="true"
                    />
                    <h2 className="text-400 font-semibold">
                      Graph comparison
                    </h2>
                  </div>
                  <p className="mt-s text-200 leading-200 text-muted-foreground">
                    Local API endpoints are compared with the current Atlas
                    item-level graph. Cross-workspace relations have no local
                    snapshot equivalent.
                  </p>
                  <dl className="mt-m divide-y divide-border border-y border-border text-300">
                    <div className="flex items-center justify-between gap-m py-s">
                      <dt>Matching relations</dt>
                      <dd className="font-semibold tabular-nums">
                        {comparison.matchingCount}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-m py-s">
                      <dt>Beta-only relations</dt>
                      <dd className="font-semibold tabular-nums">
                        {comparison.betaOnlyCount}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-m py-s">
                      <dt>Direction conflicts</dt>
                      <dd className="font-semibold tabular-nums">
                        {comparison.directionConflictCount}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-m py-s">
                      <dt>Current-only relations</dt>
                      <dd className="font-semibold tabular-nums">
                        {comparison.currentOnlyCount}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-m text-200 leading-200 text-muted-foreground">
                    Select an item in the graph to inspect its raw relation
                    types and workspace evidence.
                  </p>
                </>
              )}
            </aside>
          </section>
        </>
      ) : null}
    </div>
  );
}
