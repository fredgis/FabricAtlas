import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as RME,
  type PointerEvent as RPE,
} from "react";
import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileDown,
  GitBranch,
  Maximize2,
  RotateCcw,
  Search,
  Table2,
  Users,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { ImpactReportDialog } from "../components/ImpactReportDialog";
import {
  buildAccessReviewRows,
  selectAccessByItem,
} from "../governance";
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
import {
  typeMeta,
  schemaFor,
  relativeTime,
  type AtlasData,
  type Edge,
  type Health,
  type Item,
  type ModelTableSchema,
} from "../model";
import {
  LINEAGE_STAGE_LABELS,
  buildStagedLayout,
  getLineageImpact,
  lineageEdgeKey,
  type SchemaObjectRef,
} from "../lineage";

const NODE_W = 196;
const NODE_H = 60;
const OBJECT_W = 204;
const OBJECT_H = 52;
const UP = "var(--color-lineage-upstream)";
const DOWN = "var(--color-lineage-downstream)";

type Mode = "items" | "objects";
type InspectorTab = "summary" | "schema" | "access" | "runs";

interface Point {
  x: number;
  y: number;
}

interface ObjectNode extends Point {
  id: string;
  label: string;
  subtitle: string;
  code: string;
  color: string;
  table?: string;
  itemId?: string;
  kind: "source" | "table" | "field" | "owner" | "consumer";
}

interface ObjectEdge {
  source: string;
  target: string;
  relation: string;
  structural?: boolean;
}

function objectEdgeKey(edge: ObjectEdge): string {
  return `${edge.source}\u0000${edge.target}\u0000${edge.relation}`;
}

function getObjectImpact(edges: ObjectEdge[], startId: string) {
  const walk = (direction: "upstream" | "downstream") => {
    const ids = new Set<string>();
    const edgeKeys = new Set<string>();
    const visited = new Set<string>([startId]);
    const queue = [startId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      for (const edge of edges) {
        const matches =
          direction === "upstream"
            ? edge.target === current
            : edge.source === current;
        if (!matches) continue;
        const next = direction === "upstream" ? edge.source : edge.target;
        if (next === startId) continue;
        ids.add(next);
        edgeKeys.add(objectEdgeKey(edge));
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    return { ids, edgeKeys };
  };

  return {
    upstream: walk("upstream"),
    downstream: walk("downstream"),
  };
}

function searchParam(name: string): string {
  return new URL(window.location.href).searchParams.get(name) ?? "";
}

function initialMode(): Mode {
  return searchParam("lineage") === "objects" ? "objects" : "items";
}

function initialSelected(items: Item[], edges: Edge[]): string {
  const requested = searchParam("item");
  if (items.some((item) => item.fabricId === requested)) return requested;
  const candidates = items.filter((item) => item.itemType === "SemanticModel");
  const ranked = (candidates.length > 0 ? candidates : items)
    .map((item) => {
      const impact = getLineageImpact(edges, item.fabricId);
      return {
        item,
        score: impact.upstream.ids.size + impact.downstream.ids.size,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.item.displayName.localeCompare(b.item.displayName),
    );
  return ranked[0]?.item.fabricId ?? "";
}

function curve(source: Point, target: Point, width = NODE_W, height = NODE_H): string {
  const x1 = source.x + width;
  const y1 = source.y + height / 2;
  const x2 = target.x;
  const y2 = target.y + height / 2;
  const bend = Math.max(42, Math.abs(x2 - x1) * 0.32);
  return `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`;
}

function objectGraph(
  data: AtlasData,
  selected: Item | undefined,
  selectedSchema: ModelTableSchema[],
  upstream: Item[],
  items: Item[],
  edges: Edge[],
  tableName: string,
): { nodes: ObjectNode[]; edges: ObjectEdge[]; width: number; height: number; table?: string } {
  if (!selected || selectedSchema.length === 0) {
    return { nodes: [], edges: [], width: 1080, height: 520 };
  }

  const table = selectedSchema.find((entry) => entry.name === tableName) ?? selectedSchema[0];
  const nodes: ObjectNode[] = [];
  const graphEdges: ObjectEdge[] = [];

  selectedSchema.forEach((entry, index) => {
    const modelNode: ObjectNode = {
      id: `table:${entry.name}`,
      label: entry.name,
      subtitle: `${entry.columns.length} columns · ${entry.measures.length} measures`,
      code: "TB",
      color: "var(--color-object-table)",
      table: entry.name,
      kind: "table",
      x: 330,
      y: 62 + index * 72,
    };
    nodes.push(modelNode);

    const sourceItem = upstream.find((item) =>
      (schemaFor(data, item.fabricId) ?? []).some(
        (sourceTable) => sourceTable.name === entry.name,
      ),
    );
    if (sourceItem) {
      const sourceNode: ObjectNode = {
        id: `source:${sourceItem.fabricId}:${entry.name}`,
        label: entry.name,
        subtitle: sourceItem.displayName,
        code: "TB",
        color: "var(--color-object-source)",
        table: entry.name,
        itemId: sourceItem.fabricId,
        kind: "source",
        x: 24,
        y: modelNode.y,
      };
      nodes.push(sourceNode);
      graphEdges.push({
        source: sourceNode.id,
        target: modelNode.id,
        relation:
          edges.find(
            (edge) =>
              edge.source === sourceItem.fabricId && edge.target === selected.fabricId,
          )?.relation ?? "feeds",
      });
    }
  });

  const owner: ObjectNode = {
    id: `owner:${selected.fabricId}`,
    label: selected.displayName,
    subtitle: typeMeta(selected.itemType).label,
    code: typeMeta(selected.itemType).code,
    color: typeMeta(selected.itemType).color,
    itemId: selected.fabricId,
    kind: "owner",
    x: 660,
    y: 20,
  };
  nodes.push(owner);

  for (const entry of selectedSchema) {
    graphEdges.push({
      source: `table:${entry.name}`,
      target: owner.id,
      relation: "part of",
      structural: true,
    });
  }

  const fields = [
    ...table.measures.map((measure) => ({
      name: measure.name,
      code: "fx",
      color: "var(--color-object-measure)",
      subtitle: "Measure",
    })),
    ...table.columns.map((column) => ({
      name: column.name,
      code: "CL",
      color: "var(--color-object-column)",
      subtitle: column.dataType,
    })),
  ];
  fields.forEach((field, index) => {
    const node: ObjectNode = {
      id: `field:${field.code}:${field.name}`,
      label: field.name,
      subtitle: field.subtitle,
      code: field.code,
      color: field.color,
      table: table.name,
      itemId: selected.fabricId,
      kind: "field",
      x: 660,
      y: 98 + index * 58,
    };
    nodes.push(node);
    graphEdges.push({
      source: `table:${table.name}`,
      target: node.id,
      relation: field.code === "fx" ? "measure" : "column",
      structural: true,
    });
  });

  edges
    .filter((edge) => edge.source === selected.fabricId)
    .forEach((edge, index) => {
      const consumer = items.find((item) => item.fabricId === edge.target);
      if (!consumer) return;
      const node: ObjectNode = {
        id: `consumer:${consumer.fabricId}`,
        label: consumer.displayName,
        subtitle: typeMeta(consumer.itemType).label,
        code: typeMeta(consumer.itemType).code,
        color: typeMeta(consumer.itemType).color,
        itemId: consumer.fabricId,
        kind: "consumer",
        x: 1000,
        y: 72 + index * 80,
      };
      nodes.push(node);
      graphEdges.push({ source: owner.id, target: node.id, relation: edge.relation });
    });

  return {
    nodes,
    edges: graphEdges,
    width: 1240,
    height: Math.max(520, selectedSchema.length * 72 + 96, fields.length * 58 + 170),
    table: table.name,
  };
}

function InspectorTabButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof GitBranch;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "relative flex h-[42px] flex-1 items-center justify-center gap-[6px] text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground",
        active &&
          "text-foreground after:absolute after:inset-x-[8px] after:bottom-0 after:h-[2px] after:rounded-full after:bg-lineage-downstream",
      )}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

export function MapView() {
  const { data } = useAtlas();
  const { items, edges, comments, config, principals, jobs } = data;
  const itemById = useMemo(
    () => new Map<string, Item>(items.map((item) => [item.fabricId, item])),
    [items],
  );

  const startingId = initialSelected(items, edges);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [selId, setSelId] = useState(startingId);
  const [focusId, setFocusId] = useState(startingId);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(
    () => new Set(startingId ? [startingId] : []),
  );
  const [impactMode, setImpactMode] = useState(
    searchParam("impact") === "focused",
  );
  const [query, setQuery] = useState(searchParam("q"));
  const [typeFilter, setTypeFilter] = useState(searchParam("type") || "all");
  const [healthFilter, setHealthFilter] = useState<Health | "all">(
    (searchParam("health") as Health | "all") || "all",
  );
  const [tableName, setTableName] = useState(searchParam("table"));
  const [tab, setTab] = useState<InspectorTab>("summary");
  const [openTables, setOpenTables] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Record<string, Point>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [objectDrag, setObjectDrag] = useState<Record<string, Point>>({});
  const [objectDragId, setObjectDragId] = useState<string | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState("");
  const [selectedObjectIds, setSelectedObjectIds] = useState<Set<string>>(
    new Set(),
  );
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);
  const [impactReportOpen, setImpactReportOpen] = useState(false);
  const dragging = useRef<{
    id: string;
    ids: string[];
    origins: Record<string, Point>;
    pointer: Point;
    moved: boolean;
  } | null>(null);
  const objectDragging = useRef<{
    id: string;
    ids: string[];
    origins: Record<string, Point>;
    pointer: Point;
    moved: boolean;
  } | null>(null);
  const suppressItemClick = useRef(false);
  const suppressObjectClick = useRef(false);
  const mapRef = useRef<HTMLDivElement>(null);

  const selected =
    itemById.get(selId) ?? itemById.get(initialSelected(items, edges));
  const activeId = selected?.fabricId ?? "";
  const resolvedFocusId = itemById.has(focusId) ? focusId : activeId;
  const schema = useMemo(
    () => schemaFor(data, activeId) ?? [],
    [activeId, data],
  );
  const impact = useMemo(
    () => getLineageImpact(edges, activeId, impactMode ? Number.POSITIVE_INFINITY : 1),
    [activeId, edges, impactMode],
  );
  const focusImpact = useMemo(
    () =>
      getLineageImpact(
        edges,
        resolvedFocusId,
        impactMode ? Number.POSITIVE_INFINITY : 1,
      ),
    [edges, impactMode, resolvedFocusId],
  );
  const upstream = useMemo(
    () =>
      [...impact.upstream.ids]
        .map((id) => itemById.get(id))
        .filter((item): item is Item => !!item)
        .sort(
          (a, b) =>
            (impact.upstream.distance.get(a.fabricId) ?? 0) -
              (impact.upstream.distance.get(b.fabricId) ?? 0) ||
            a.displayName.localeCompare(b.displayName),
        ),
    [impact.upstream.distance, impact.upstream.ids, itemById],
  );
  const downstream = useMemo(
    () =>
      [...impact.downstream.ids]
        .map((id) => itemById.get(id))
        .filter((item): item is Item => !!item)
        .sort(
          (a, b) =>
            (impact.downstream.distance.get(a.fabricId) ?? 0) -
              (impact.downstream.distance.get(b.fabricId) ?? 0) ||
            a.displayName.localeCompare(b.displayName),
        ),
    [impact.downstream.distance, impact.downstream.ids, itemById],
  );
  const connected = useMemo(
    () => new Set([activeId, ...impact.upstream.ids, ...impact.downstream.ids]),
    [activeId, impact.downstream.ids, impact.upstream.ids],
  );
  const focusedItems = useMemo(
    () =>
      new Set([
        resolvedFocusId,
        ...focusImpact.upstream.ids,
        ...focusImpact.downstream.ids,
      ]),
    [focusImpact.downstream.ids, focusImpact.upstream.ids, resolvedFocusId],
  );
  const types = useMemo(
    () =>
      [...new Set(items.map((item) => item.itemType))].sort((a, b) =>
        typeMeta(a).label.localeCompare(typeMeta(b).label),
      ),
    [items],
  );
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      if (item.fabricId === activeId) return true;
      const matchesFilters =
        (typeFilter === "all" || item.itemType === typeFilter) &&
        (healthFilter === "all" || item.health === healthFilter) &&
        (!normalized ||
          item.displayName.toLowerCase().includes(normalized) ||
          typeMeta(item.itemType).label.toLowerCase().includes(normalized) ||
          item.tags.some((tag) => tag.toLowerCase().includes(normalized)));
      return (
        matchesFilters &&
        (!impactMode || !resolvedFocusId || focusedItems.has(item.fabricId))
      );
    });
  }, [activeId, focusedItems, healthFilter, impactMode, items, query, resolvedFocusId, typeFilter]);
  const visibleIds = useMemo(
    () => new Set(visibleItems.map((item) => item.fabricId)),
    [visibleItems],
  );
  const visibleEdges = useMemo(
    () =>
      edges.filter(
        (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
      ),
    [edges, visibleIds],
  );
  const layout = useMemo(
    () =>
      buildStagedLayout(visibleItems, visibleEdges, {
        nodeWidth: NODE_W,
        nodeHeight: NODE_H,
        columnGap: 285,
        focusId: resolvedFocusId,
      }),
    [resolvedFocusId, visibleEdges, visibleItems],
  );
  const posOf = (id: string) => drag[id] ?? layout.positions.get(id) ?? { x: 0, y: 0 };
  const bounds = useMemo(() => {
    let width = layout.width;
    let height = layout.height;
    Object.values(drag).forEach((point) => {
      width = Math.max(width, point.x + NODE_W + 48);
      height = Math.max(height, point.y + NODE_H + 48);
    });
    return { width, height };
  }, [drag, layout.height, layout.width]);
  const objects = useMemo(
    () => objectGraph(data, selected, schema, upstream, items, edges, tableName),
    [data, edges, items, schema, selected, tableName, upstream],
  );
  const activeObjectId = objects.nodes.some(
    (node) => node.id === selectedObjectId,
  )
    ? selectedObjectId
    : (objects.nodes.find((node) => node.kind === "owner")?.id ??
      objects.nodes[0]?.id ??
      "");
  const activeObject = objects.nodes.find((node) => node.id === activeObjectId);
  const reportItemId =
    mode === "objects" ? activeObject?.itemId ?? activeId : activeId;
  const reportObject: SchemaObjectRef | undefined =
    mode === "objects" && activeObject?.kind === "table"
      ? {
          itemId: activeId,
          kind: "table",
          name: activeObject.label,
        }
      : mode === "objects" && activeObject?.kind === "source" && activeObject.itemId
        ? {
            itemId: activeObject.itemId,
            kind: "table",
            name: activeObject.label,
          }
        : mode === "objects" && activeObject?.kind === "field"
          ? {
              itemId: activeId,
              kind: activeObject.code === "fx" ? "measure" : "column",
              name: activeObject.label,
              tableName: activeObject.table,
            }
          : undefined;
  const objectImpact = useMemo(
    () => getObjectImpact(objects.edges, activeObjectId),
    [activeObjectId, objects.edges],
  );
  const objectConnected = useMemo(
    () =>
      new Set([
        activeObjectId,
        ...objectImpact.upstream.ids,
        ...objectImpact.downstream.ids,
      ]),
    [activeObjectId, objectImpact.downstream.ids, objectImpact.upstream.ids],
  );
  const objectPosOf = (node: ObjectNode): Point =>
    objectDrag[node.id] ?? { x: node.x, y: node.y };
  const objectBounds = useMemo(() => {
    let width = objects.width;
    let height = objects.height;
    Object.values(objectDrag).forEach((point) => {
      width = Math.max(width, point.x + OBJECT_W + 48);
      height = Math.max(height, point.y + OBJECT_H + 48);
    });
    return { width, height };
  }, [objectDrag, objects.height, objects.width]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("lineage", mode);
    if (activeId) url.searchParams.set("item", activeId);
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    if (typeFilter !== "all") url.searchParams.set("type", typeFilter);
    else url.searchParams.delete("type");
    if (healthFilter !== "all") url.searchParams.set("health", healthFilter);
    else url.searchParams.delete("health");
    if (impactMode) url.searchParams.set("impact", "focused");
    else url.searchParams.delete("impact");
    if (mode === "objects" && objects.table) url.searchParams.set("table", objects.table);
    else url.searchParams.delete("table");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [activeId, healthFilter, impactMode, mode, objects.table, query, typeFilter]);

  const nodeDown = (event: RPE<HTMLButtonElement>, id: string) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const multi = event.ctrlKey || event.metaKey || event.shiftKey;
    let selection = selectedItemIds;
    if (!selection.has(id)) {
      selection = multi
        ? new Set([...selection, id])
        : new Set([id]);
      setSelectedItemIds(selection);
    }
    const ids = [...selection];
    dragging.current = {
      id,
      ids,
      origins: Object.fromEntries(ids.map((selectedId) => [selectedId, posOf(selectedId)])),
      pointer: { x: event.clientX, y: event.clientY },
      moved: false,
    };
    setDragId(id);
  };
  const nodeMove = (event: RPE<HTMLButtonElement>) => {
    const current = dragging.current;
    if (!current) return;
    const dx = (event.clientX - current.pointer.x) / zoom;
    const dy = (event.clientY - current.pointer.y) / zoom;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) current.moved = true;
    setDrag((previous) => {
      const next = { ...previous };
      current.ids.forEach((id) => {
        const origin = current.origins[id];
        next[id] = {
          x: Math.max(12, origin.x + dx),
          y: Math.max(46, origin.y + dy),
        };
      });
      return next;
    });
  };
  const nodeUp = (event: RPE<HTMLButtonElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const moved = dragging.current?.moved;
    dragging.current = null;
    setDragId(null);
    suppressItemClick.current = !!moved;
    window.setTimeout(() => {
      suppressItemClick.current = false;
    }, 0);
  };
  const nodeClick = (event: RME<HTMLButtonElement>, id: string) => {
    if (suppressItemClick.current) return;
    const multi = event.ctrlKey || event.metaKey || event.shiftKey;
    if (multi) {
      const next = new Set(selectedItemIds);
      if (next.has(id) && next.size > 1) next.delete(id);
      else next.add(id);
      setSelectedItemIds(next);
      setSelId(next.has(id) ? id : ([...next][0] ?? id));
    } else {
      setSelectedItemIds(new Set([id]));
      setSelId(id);
    }
    setTab("summary");
  };

  const selectObjectNode = (node: ObjectNode) => {
    setSelectedObjectId(node.id);
    if ((node.kind === "source" || node.kind === "table") && node.table) {
      setTableName(node.table);
    }
  };

  const objectNodeDown = (
    event: RPE<HTMLButtonElement>,
    node: ObjectNode,
  ) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const multi = event.ctrlKey || event.metaKey || event.shiftKey;
    let selection = selectedObjectIds;
    if (!selection.has(node.id)) {
      selection = multi
        ? new Set([...selection, node.id])
        : new Set([node.id]);
      setSelectedObjectIds(selection);
    }
    const ids = [...selection];
    objectDragging.current = {
      id: node.id,
      ids,
      origins: Object.fromEntries(
        ids.map((id) => {
          const selectedNode = objects.nodes.find((candidate) => candidate.id === id);
          return [
            id,
            selectedNode ? objectPosOf(selectedNode) : { x: 0, y: 0 },
          ];
        }),
      ),
      pointer: { x: event.clientX, y: event.clientY },
      moved: false,
    };
    setObjectDragId(node.id);
  };

  const objectNodeMove = (event: RPE<HTMLButtonElement>) => {
    const current = objectDragging.current;
    if (!current) return;
    const dx = (event.clientX - current.pointer.x) / zoom;
    const dy = (event.clientY - current.pointer.y) / zoom;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) current.moved = true;
    setObjectDrag((previous) => {
      const next = { ...previous };
      current.ids.forEach((id) => {
        const origin = current.origins[id];
        next[id] = {
          x: Math.max(12, origin.x + dx),
          y: Math.max(46, origin.y + dy),
        };
      });
      return next;
    });
  };

  const objectNodeUp = (event: RPE<HTMLButtonElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const moved = objectDragging.current?.moved;
    objectDragging.current = null;
    setObjectDragId(null);
    suppressObjectClick.current = !!moved;
    window.setTimeout(() => {
      suppressObjectClick.current = false;
    }, 0);
  };

  const objectNodeClick = (
    event: RME<HTMLButtonElement>,
    node: ObjectNode,
  ) => {
    if (suppressObjectClick.current) return;
    const multi = event.ctrlKey || event.metaKey || event.shiftKey;
    if (multi) {
      const next = new Set(selectedObjectIds);
      if (next.has(node.id) && next.size > 1) next.delete(node.id);
      else next.add(node.id);
      setSelectedObjectIds(next);
      const active = next.has(node.id)
        ? node
        : objects.nodes.find((candidate) => candidate.id === [...next][0]);
      if (active) selectObjectNode(active);
    } else {
      setSelectedObjectIds(new Set([node.id]));
      selectObjectNode(node);
    }
  };

  const toggleTable = (name: string) =>
    setOpenTables((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const fit = () => {
    const viewport = mapRef.current;
    const graph = mode === "items" ? bounds : objectBounds;
    if (!viewport) return;
    const next = Math.min(
      1.1,
      Math.max(
        0.55,
        Math.min(
          (viewport.clientWidth - 48) / graph.width,
          (viewport.clientHeight - 48) / graph.height,
        ),
      ),
    );
    setZoom(next);
    window.requestAnimationFrame(() => viewport.scrollTo({ top: 0, left: 0 }));
  };

  const resetGraph = () => {
    setDrag({});
    setObjectDrag({});
    setZoom(1);
    setFocusId(activeId);
    setSelectedItemIds(new Set(activeId ? [activeId] : []));
    setSelectedObjectIds(
      new Set(activeObjectId ? [activeObjectId] : []),
    );
    window.requestAnimationFrame(() =>
      mapRef.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" }),
    );
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("Copy this Fabric Atlas link", window.location.href);
    }
  };

  const accessRows = useMemo(() => buildAccessReviewRows(data), [data]);
  const effectiveAccess = useMemo(() => {
    return selectAccessByItem(accessRows, activeId).map((row) => ({
      principalRef: row.principalRef,
      accessLevel: row.effectiveAccess,
      inherited: row.origin === "workspace",
      mixed: row.origin === "mixed",
      roleName: row.effectiveGrants
        .map((grant) => grant.roleName)
        .filter(Boolean)
        .join(", "),
    }));
  }, [accessRows, activeId]);
  const selectedJobs = jobs
    .filter((job) => job.itemFabricId === activeId)
    .sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt));
  const graph = mode === "items" ? bounds : objectBounds;
  const portal = (
    (import.meta.env.VITE_FABRIC_PORTAL_URL as string | undefined) ??
    "https://app.fabric.microsoft.com"
  ).replace(/\/$/, "");
  const workspaceUrl = data.workspace.fabricId
    ? `${portal}/groups/${encodeURIComponent(data.workspace.fabricId)}/list?experience=power-bi`
    : portal;

  return (
    <div className="flex h-full min-h-[720px] flex-col xl:min-h-0">
      <div className="flex flex-wrap items-end justify-between gap-[12px] border-b border-border px-[20px] py-[14px]">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-lineage-downstream">
            Workspace topology
          </div>
          <h1 className="mt-[3px] text-[22px] font-bold">Map &amp; lineage</h1>
          <div className="mt-[3px] text-[12px] text-muted-foreground">
            Trace dependencies, inspect objects and estimate downstream change impact.
          </div>
        </div>
        <div className="flex flex-wrap gap-[7px]">
          {[
            ["Items", items.length],
            ["Links", edges.length],
            ["Upstream", upstream.length],
            ["Downstream", downstream.length],
          ].map(([label, value]) => (
            <div
              key={label}
              className="min-w-[78px] rounded-lg border border-border bg-card px-[10px] py-[7px] shadow-fabric-2"
            >
              <div className="font-numeric text-[15px] font-bold">{value}</div>
              <div className="text-[10px] text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-[8px] border-b border-border bg-card px-[20px] py-[8px] shadow-fabric-2">
        <div className="flex rounded-md border border-border bg-secondary p-[2px]">
          {(["items", "objects"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={cn(
                "h-[30px] rounded-md px-[12px] text-[12px] font-semibold capitalize text-muted-foreground",
                mode === value && "bg-card text-brand-foreground shadow-fabric-2",
              )}
            >
              {value}
            </button>
          ))}
        </div>
        <label className="relative min-w-[180px] flex-1 sm:max-w-[280px]">
          <Search
            size={14}
            className="pointer-events-none absolute left-[10px] top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <span className="sr-only">Search lineage</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mode === "items" ? "Search items…" : "Search objects…"}
            className="h-[34px] w-full rounded-lg border border-input bg-card pl-[31px] pr-[10px] text-[12px] outline-none"
          />
        </label>
        {mode === "items" ? (
          <>
            <select
              aria-label="Filter by item type"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="h-[34px] rounded-lg border border-input bg-card px-[10px] text-[12px] text-muted-foreground outline-none"
            >
              <option value="all">All types</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {typeMeta(type).label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by health"
              value={healthFilter}
              onChange={(event) =>
                setHealthFilter(event.target.value as Health | "all")
              }
              className="h-[34px] rounded-lg border border-input bg-card px-[10px] text-[12px] text-muted-foreground outline-none"
            >
              <option value="all">All health</option>
              <option value="healthy">Healthy</option>
              <option value="stale">Stale</option>
              <option value="failing">Failing</option>
              <option value="unknown">Unknown</option>
            </select>
          </>
        ) : (
          schema.length > 0 && (
            <select
              aria-label="Select object lineage table"
              value={objects.table ?? ""}
              onChange={(event) => setTableName(event.target.value)}
              className="h-[34px] max-w-[220px] rounded-lg border border-input bg-card px-[10px] text-[12px] text-muted-foreground outline-none"
            >
              {schema.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          )
        )}
        {mode === "items" && <button
          type="button"
          role="switch"
          aria-checked={impactMode}
          onClick={() => {
            const next = !impactMode;
            if (next) setFocusId(activeId);
            setImpactMode(next);
          }}
          className={cn(
            "ml-auto flex h-[34px] items-center gap-[7px] rounded-lg border px-[10px] text-[12px] font-semibold",
            impactMode
              ? "border-lineage-upstream/50 bg-lineage-upstream/10 text-lineage-upstream"
              : "border-border text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "relative h-[16px] w-[28px] rounded-full bg-muted after:absolute after:left-[3px] after:top-[3px] after:h-[10px] after:w-[10px] after:rounded-full after:bg-white after:transition-transform",
              impactMode && "bg-lineage-upstream after:translate-x-[12px]",
            )}
          />
          Impact mode
        </button>}
        {mode === "items" && (
          <button
            type="button"
            onClick={() => {
              setFocusId(activeId);
              setDrag({});
            }}
            className="flex h-[34px] items-center gap-[6px] rounded-lg border border-border px-[10px] text-[12px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <GitBranch size={13} />
            Focus selection
          </button>
        )}
        {(mode === "items"
          ? selectedItemIds.size
          : selectedObjectIds.size) > 1 && (
          <span className="rounded-lg border border-primary/30 bg-primary/10 px-[9px] py-[7px] text-[11px] font-semibold text-primary">
            {mode === "items"
              ? selectedItemIds.size
              : selectedObjectIds.size}{" "}
            selected
          </span>
        )}
        <button
          type="button"
          onClick={resetGraph}
          className="flex h-[34px] items-center gap-[6px] rounded-lg border border-border px-[10px] text-[12px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <RotateCcw size={13} />
          Reset
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div
          ref={mapRef}
          className="atlas-map-grid relative min-h-[500px] overflow-auto bg-muted/30"
        >
          {mode === "objects" && (
            <div className="sticky left-[16px] top-[12px] z-20 max-w-[500px] rounded-lg border border-border bg-card px-[10px] py-[7px] text-[11px] text-muted-foreground shadow-fabric-4">
              Object metadata is exact; field-to-report usage remains item-level because
              Fabric does not expose visual field bindings through the current APIs.
            </div>
          )}
          <div style={{ width: graph.width * zoom, height: graph.height * zoom }}>
            <div
              className="relative origin-top-left"
              style={{
                width: graph.width,
                height: graph.height,
                transform: `scale(${zoom})`,
              }}
            >
              {mode === "items" ? (
                <>
                  {layout.groups.map((group) => (
                    <div
                      key={group.id}
                      className="pointer-events-none absolute left-[14px] right-[14px] rounded-xl border border-border/60 bg-card/30"
                      style={{ top: group.y, height: group.height }}
                    >
                      <span className="absolute left-[12px] top-[8px] max-w-[280px] truncate rounded-md bg-background/80 px-[7px] py-[2px] text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                        {group.label}
                      </span>
                    </div>
                  ))}
                  <div
                    className="pointer-events-none absolute inset-x-0 top-[9px] z-[2] grid"
                    style={{
                      gridTemplateColumns: `repeat(${LINEAGE_STAGE_LABELS.length}, 285px)`,
                      paddingLeft: 28,
                    }}
                  >
                    {LINEAGE_STAGE_LABELS.map((label) => (
                      <div
                        key={label}
                        className="flex items-center gap-[7px] pr-[20px] text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
                      >
                        <span>{label}</span>
                        <span className="h-px flex-1 bg-border" />
                      </div>
                    ))}
                  </div>
                  <svg
                    className="pointer-events-none absolute inset-0 z-[1] overflow-visible"
                    width={bounds.width}
                    height={bounds.height}
                    aria-hidden="true"
                  >
                    <defs>
                      {[
                        ["default", "var(--color-lineage-neutral)"],
                        ["up", UP],
                        ["down", DOWN],
                        ["broken", "var(--color-destructive)"],
                      ].map(([id, fill]) => (
                        <marker
                          key={id}
                          id={`atlas-${id}`}
                          markerWidth="8"
                          markerHeight="8"
                          refX="7"
                          refY="4"
                          orient="auto"
                        >
                          <path d="M0 0 8 4 0 8Z" fill={fill} />
                        </marker>
                      ))}
                    </defs>
                    {visibleEdges.map((edge) => {
                      const source = posOf(edge.source);
                      const target = posOf(edge.target);
                      const key = lineageEdgeKey(edge);
                      const isUp = impact.upstream.edgeKeys.has(key);
                      const isDown = impact.downstream.edgeKeys.has(key);
                      const active = isUp || isDown;
                      const color = edge.broken
                        ? "var(--color-destructive)"
                        : isUp
                          ? UP
                          : isDown
                            ? DOWN
                            : "var(--color-lineage-neutral)";
                      return (
                        <g key={key}>
                          <title>{edge.relation}</title>
                          <path
                            className={active && !edge.broken ? "atlas-flow" : undefined}
                            d={curve(source, target)}
                            fill="none"
                            stroke={color}
                            strokeWidth={active ? 2.6 : 1.5}
                            strokeOpacity={
                              edge.broken ? 0.9 : active ? 0.96 : activeId ? 0.18 : 0.5
                            }
                            strokeDasharray={edge.broken ? "6 5" : undefined}
                            markerEnd={`url(#atlas-${
                              edge.broken
                                ? "broken"
                                : isUp
                                  ? "up"
                                  : isDown
                                    ? "down"
                                    : "default"
                            })`}
                          />
                        </g>
                      );
                    })}
                  </svg>
                  {visibleItems.map((item) => {
                    const point = posOf(item.fabricId);
                    const primaryNode = item.fabricId === activeId;
                    const selectedNode =
                      selectedItemIds.has(item.fabricId) || primaryNode;
                    const isUp = impact.upstream.ids.has(item.fabricId);
                    const isDown = impact.downstream.ids.has(item.fabricId);
                    const dim = !!activeId && !connected.has(item.fabricId);
                    const activeDrag = dragId === item.fabricId;
                    const accent = primaryNode
                      ? "var(--color-primary)"
                      : isUp
                        ? UP
                        : isDown
                          ? DOWN
                          : undefined;
                    return (
                      <button
                        key={item.fabricId}
                        type="button"
                        aria-pressed={selectedNode}
                        onClick={(event) => nodeClick(event, item.fabricId)}
                        aria-label={`${item.displayName}, ${typeMeta(item.itemType).label}, ${item.health}`}
                        onPointerDown={(event) => nodeDown(event, item.fabricId)}
                        onPointerMove={nodeMove}
                        onPointerUp={nodeUp}
                        className={cn(
                          "absolute flex touch-none select-none items-center gap-[10px] rounded-lg border bg-card px-[12px] text-left shadow-fabric-2 transition-[box-shadow,opacity,border-color,transform] hover:-translate-y-[1px] hover:shadow-fabric-8",
                          selectedNode ? "border-primary/70" : "border-border",
                          dim && "opacity-30",
                          "cursor-grab active:cursor-grabbing",
                        )}
                        style={{
                          left: point.x,
                          top: point.y,
                          width: NODE_W,
                          height: NODE_H,
                          zIndex: activeDrag ? 7 : primaryNode ? 5 : selectedNode ? 4 : dim ? 1 : 3,
                          transform: activeDrag ? "scale(1.04)" : undefined,
                          borderColor: accent,
                          boxShadow: primaryNode
                            ? "0 0 0 2px var(--color-primary), 0 12px 28px -18px rgba(0,0,0,.8)"
                            : selectedNode
                              ? "0 0 0 1px var(--color-primary)"
                            : undefined,
                        }}
                      >
                        {accent && !primaryNode && (
                          <span
                            className="absolute -left-[6px] top-1/2 h-[11px] w-[11px] -translate-y-1/2 rounded-full ring-2 ring-card"
                            style={{ background: accent }}
                          />
                        )}
                        <TypeGlyph type={item.itemType} size={34} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold leading-[1.15]">
                            {item.displayName}
                          </span>
                          <span className="mt-[3px] block truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                            {typeMeta(item.itemType).label}
                          </span>
                        </span>
                        <HealthDot health={item.health} />
                      </button>
                    );
                  })}
                </>
              ) : objects.nodes.length > 0 ? (
                <>
                  <div
                    className="pointer-events-none absolute inset-x-0 top-[9px] grid"
                    style={{
                      gridTemplateColumns: "306px 330px 340px 300px",
                      paddingLeft: 24,
                    }}
                  >
                    {["Source objects", "Model tables", "Fields", "Consumers"].map(
                      (label) => (
                        <div
                          key={label}
                          className="flex items-center gap-[7px] pr-[18px] text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
                        >
                          <span>{label}</span>
                          <span className="h-px flex-1 bg-border" />
                        </div>
                      ),
                    )}
                  </div>
                  <svg
                    className="pointer-events-none absolute inset-0 overflow-visible"
                    width={objectBounds.width}
                    height={objectBounds.height}
                    aria-hidden="true"
                  >
                    <defs>
                      <marker
                        id="atlas-object-downstream"
                        markerWidth="8"
                        markerHeight="8"
                        refX="7"
                        refY="4"
                        orient="auto"
                      >
                        <path d="M0 0 8 4 0 8Z" fill={DOWN} />
                      </marker>
                      <marker
                        id="atlas-object-upstream"
                        markerWidth="8"
                        markerHeight="8"
                        refX="7"
                        refY="4"
                        orient="auto"
                      >
                        <path d="M0 0 8 4 0 8Z" fill={UP} />
                      </marker>
                      <marker
                        id="atlas-object-neutral"
                        markerWidth="8"
                        markerHeight="8"
                        refX="7"
                        refY="4"
                        orient="auto"
                      >
                        <path d="M0 0 8 4 0 8Z" fill="var(--color-lineage-neutral)" />
                      </marker>
                    </defs>
                    {objects.edges.map((edge) => {
                      const sourceNode = objects.nodes.find(
                        (node) => node.id === edge.source,
                      );
                      const targetNode = objects.nodes.find(
                        (node) => node.id === edge.target,
                      );
                      if (!sourceNode || !targetNode) return null;
                      const source = objectPosOf(sourceNode);
                      const target = objectPosOf(targetNode);
                      const key = objectEdgeKey(edge);
                      const isUp = objectImpact.upstream.edgeKeys.has(key);
                      const isDown = objectImpact.downstream.edgeKeys.has(key);
                      const active = isUp || isDown;
                      const color = isUp
                        ? UP
                        : isDown
                          ? DOWN
                          : "var(--color-lineage-neutral)";
                      return (
                        <g key={key}>
                          <title>{edge.relation}</title>
                          <path
                            className={active ? "atlas-flow" : undefined}
                            d={curve(source, target, OBJECT_W, OBJECT_H)}
                            fill="none"
                            stroke={color}
                            strokeWidth={active ? 2.6 : edge.structural ? 1.3 : 1.8}
                            strokeOpacity={
                              active ? 0.96 : activeObjectId ? 0.16 : 0.55
                            }
                            strokeDasharray={
                              !active && edge.structural ? "4 5" : undefined
                            }
                            markerEnd={`url(#atlas-object-${
                              isUp
                                ? "upstream"
                                : isDown
                                  ? "downstream"
                                  : "neutral"
                            })`}
                          />
                        </g>
                      );
                    })}
                  </svg>
                  {objects.nodes.map((node) => {
                    const point = objectPosOf(node);
                    const primaryNode = node.id === activeObjectId;
                    const selectedNode =
                      selectedObjectIds.size === 0
                        ? primaryNode
                        : selectedObjectIds.has(node.id);
                    const isUp = objectImpact.upstream.ids.has(node.id);
                    const isDown = objectImpact.downstream.ids.has(node.id);
                    const dim = !!activeObjectId && !objectConnected.has(node.id);
                    const draggingNode = objectDragId === node.id;
                    const activeTable = node.table === objects.table;
                    const matches =
                      !query.trim() ||
                      node.label.toLowerCase().includes(query.trim().toLowerCase()) ||
                      node.subtitle.toLowerCase().includes(query.trim().toLowerCase());
                    const accent = primaryNode
                      ? "var(--color-primary)"
                      : isUp
                        ? UP
                        : isDown
                          ? DOWN
                          : undefined;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        aria-label={`${node.label}, ${node.subtitle}`}
                        aria-pressed={selectedNode}
                        onClick={(event) => objectNodeClick(event, node)}
                        onPointerDown={(event) => objectNodeDown(event, node)}
                        onPointerMove={objectNodeMove}
                        onPointerUp={objectNodeUp}
                        className={cn(
                          "absolute flex touch-none cursor-grab select-none items-center gap-[10px] rounded-lg border border-border bg-card px-[11px] text-left shadow-fabric-2 transition-[box-shadow,opacity,border-color,transform] hover:-translate-y-[1px] hover:shadow-fabric-8 active:cursor-grabbing",
                          selectedNode && "border-primary/70",
                          (!matches || dim) && "opacity-25",
                        )}
                        style={{
                          left: point.x,
                          top: point.y,
                          width: OBJECT_W,
                          height: OBJECT_H,
                          zIndex: draggingNode ? 7 : primaryNode ? 5 : selectedNode ? 4 : dim ? 1 : 3,
                          transform: draggingNode ? "scale(1.04)" : undefined,
                          borderColor: accent,
                          boxShadow: primaryNode
                            ? "0 0 0 2px var(--color-primary), 0 12px 28px -18px rgba(0,0,0,.8)"
                            : selectedNode
                              ? "0 0 0 1px var(--color-primary)"
                            : undefined,
                        }}
                      >
                        {accent && !primaryNode && (
                          <span
                            className="absolute -left-[6px] top-1/2 h-[11px] w-[11px] -translate-y-1/2 rounded-full ring-2 ring-card"
                            style={{ background: accent }}
                          />
                        )}
                        <span
                          className="flex h-[31px] w-[31px] shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-white"
                          style={{ background: node.color }}
                        >
                          {node.code}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold">
                            {node.label}
                          </span>
                          <span className="mt-[2px] block truncate text-[9.5px] text-muted-foreground">
                            {node.subtitle}
                          </span>
                        </span>
                        {activeTable &&
                          (node.kind === "source" || node.kind === "table") &&
                          !primaryNode && (
                          <span className="h-[8px] w-[8px] rounded-full bg-primary" />
                        )}
                      </button>
                    );
                  })}
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center p-[24px]">
                  <Card className="max-w-[450px] border-dashed p-[24px] text-center">
                    <Table2 size={36} className="mx-auto text-muted-foreground" />
                    <div className="mt-[10px] text-[15px] font-semibold">
                      No object lineage available
                    </div>
                    <div className="mt-[5px] text-[12px] leading-[1.5] text-muted-foreground">
                      Select an item with synchronized table, column or measure metadata.
                    </div>
                  </Card>
                </div>
              )}
            </div>
          </div>

          {mode === "items" && visibleItems.length > 0 && (
            <div className="pointer-events-none absolute right-[16px] top-[16px] z-20 h-[90px] w-[146px] overflow-hidden rounded-lg border border-border bg-card shadow-fabric-4">
              {visibleItems.map((item) => {
                const point = posOf(item.fabricId);
                return (
                  <span
                    key={item.fabricId}
                    className={cn(
                      "absolute h-[5px] w-[13px] rounded-sm bg-lineage-neutral",
                      item.fabricId === activeId && "bg-primary",
                      impact.upstream.ids.has(item.fabricId) && "bg-lineage-upstream",
                      impact.downstream.ids.has(item.fabricId) && "bg-lineage-downstream",
                    )}
                    style={{
                      left: 7 + (point.x / Math.max(bounds.width, 1)) * 132,
                      top: 7 + (point.y / Math.max(bounds.height, 1)) * 76,
                    }}
                  />
                );
              })}
              <span className="absolute inset-[7px] rounded border border-primary/60 bg-primary/5" />
            </div>
          )}

          <div className="sticky bottom-[14px] left-[14px] z-20 ml-[14px] flex w-fit flex-wrap items-center gap-[12px] rounded-lg border border-border bg-card px-[11px] py-[8px] text-[10px] text-muted-foreground shadow-fabric-4">
            <span className="flex items-center gap-[5px] text-lineage-upstream">
              <span className="h-[2px] w-[18px] bg-lineage-upstream" /> upstream
            </span>
            <span className="flex items-center gap-[5px] text-lineage-downstream">
              <span className="h-[2px] w-[18px] bg-lineage-downstream" /> downstream
            </span>
            <span className="flex items-center gap-[5px]">
              <HealthDot health="healthy" size={7} /> healthy
            </span>
            <span>
              {mode === "items"
                ? "Ctrl/Cmd+click to multi-select · drag selection"
                : "Ctrl/Cmd+click to multi-select · drag objects"}
            </span>
          </div>

          <div className="sticky bottom-[14px] float-right z-20 mr-[14px] flex w-fit items-center gap-[3px] rounded-lg border border-border bg-card p-[3px] shadow-fabric-4">
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => setZoom((value) => Math.max(0.55, value - 0.1))}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ZoomOut size={14} />
            </button>
            <span className="min-w-[42px] text-center font-mono text-[10px] text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => setZoom((value) => Math.min(1.35, value + 0.1))}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ZoomIn size={14} />
            </button>
            <span className="mx-[2px] h-[21px] w-px bg-border" />
            <button
              type="button"
              aria-label="Fit lineage graph"
              onClick={fit}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>

        <aside className="flex min-h-0 flex-col border-t border-border bg-card xl:border-l xl:border-t-0">
          {selected && (
            <>
              <div className="border-b border-border p-[16px]">
                <div className="flex items-start gap-[12px]">
                  <TypeGlyph type={selected.itemType} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[17px] font-bold">{selected.displayName}</div>
                    <div className="mt-[2px] text-[10px] uppercase tracking-wide text-muted-foreground">
                      {typeMeta(selected.itemType).label}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyLink()}
                    aria-label="Copy deep link"
                    className="flex h-[32px] w-[32px] items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {copied ? <Check size={14} className="text-status-healthy" /> : <Copy size={14} />}
                  </button>
                </div>
                <div className="mt-[12px] flex flex-wrap items-center gap-[7px]">
                  <HealthChip health={selected.health} />
                  <EndorsementChip
                    endorsement={
                      selected.endorsementRaw ?? selected.endorsement
                    }
                  />
                  {(selected.sensitivity || selected.sensitivityLabelId) && (
                    <span className="rounded-md bg-destructive/10 px-[8px] py-[2px] text-[10px] font-semibold text-destructive">
                      {selected.sensitivity ?? "Labeled"}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex border-b border-border px-[6px]" role="tablist">
                <InspectorTabButton active={tab === "summary"} icon={GitBranch} label="Summary" onClick={() => setTab("summary")} />
                <InspectorTabButton active={tab === "schema"} icon={Table2} label="Schema" onClick={() => setTab("schema")} />
                <InspectorTabButton active={tab === "access"} icon={Users} label="Access" onClick={() => setTab("access")} />
                <InspectorTabButton active={tab === "runs"} icon={Activity} label="Runs" onClick={() => setTab("runs")} />
              </div>

              <div className="min-h-[300px] flex-1 overflow-auto p-[16px]">
                {tab === "summary" && (
                  <div className="flex flex-col gap-[14px]">
                    {selected.description && (
                      <p className="text-[12px] leading-[1.5] text-muted-foreground">{selected.description}</p>
                    )}
                    <Card className="p-[12px]">
                      <div className="flex items-center justify-between gap-[10px] text-[12px]">
                        <span className="text-muted-foreground">Owner</span>
                        {selected.ownerName ? (
                          <span className="flex min-w-0 items-center gap-[7px] font-semibold">
                            <Avatar name={selected.ownerName} size={23} />
                            <span className="max-w-[190px] truncate">{selected.ownerName}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {selected.ownerMetadataAvailable === false
                              ? "Not collected"
                              : "Unassigned"}
                          </span>
                        )}
                      </div>
                      <div className="mt-[8px] flex items-center justify-between text-[12px]">
                        <span className="text-muted-foreground">Last refresh</span>
                        <span className="font-semibold">{relativeTime(selected.lastRefresh)}</span>
                      </div>
                    </Card>
                    <div>
                      <SectionLabel>Change impact</SectionLabel>
                      <div className="mt-[7px] grid grid-cols-3 gap-[7px]">
                        {[
                          ["Upstream", upstream.length, "text-lineage-upstream"],
                          ["Downstream", downstream.length, "text-lineage-downstream"],
                          ["Tables", schema.length, "text-foreground"],
                        ].map(([label, value, color]) => (
                          <Card key={label} className="p-[9px]">
                            <div className={cn("text-[19px] font-bold", color as string)}>{value}</div>
                            <div className="text-[9.5px] text-muted-foreground">{label}</div>
                          </Card>
                        ))}
                      </div>
                    </div>
                    {[
                      ["Downstream", downstream, impact.downstream.distance],
                      ["Upstream", upstream, impact.upstream.distance],
                    ].map(([label, list, distance]) => (
                      <div key={label as string}>
                        <SectionLabel>{label as string} · {(list as Item[]).length}</SectionLabel>
                        <div className="mt-[7px] flex flex-col gap-[3px]">
                          {(list as Item[]).length === 0 && (
                            <span className="text-[12px] text-muted-foreground">
                              {label === "Upstream" ? "No upstream source — this is a root." : "Nothing depends on this item."}
                            </span>
                          )}
                          {(list as Item[]).map((item) => (
                            <button
                              key={item.fabricId}
                              type="button"
                              onClick={() => {
                                setSelId(item.fabricId);
                                setTab("summary");
                              }}
                              className="flex items-center gap-[8px] rounded-lg px-[7px] py-[5px] text-left hover:bg-accent"
                            >
                              <TypeGlyph type={item.itemType} size={23} />
                              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{item.displayName}</span>
                              <span className="text-[9.5px] text-muted-foreground">
                                {(distance as Map<string, number>).get(item.fabricId)} hop
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div className="grid grid-cols-2 gap-[8px]">
                      <Card className="p-[11px]">
                        <div className="text-[21px] font-bold text-status-healthy">
                          {config.filter((entry) => entry.itemFabricId === activeId).length}
                        </div>
                        <div className="text-[10px] text-muted-foreground">config facts</div>
                      </Card>
                      <Card className="p-[11px]">
                        <div className="text-[21px] font-bold">
                          {comments.filter((comment) => comment.itemFabricId === activeId).length}
                        </div>
                        <div className="text-[10px] text-muted-foreground">comments</div>
                      </Card>
                    </div>
                  </div>
                )}

                {tab === "schema" && (
                  <div>
                    <div className="flex items-center justify-between gap-[8px]">
                      <SectionLabel>Deep lineage · {schema.length} tables</SectionLabel>
                      {schema.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setMode("objects");
                            setTableName(schema[0].name);
                          }}
                          className="text-[10px] font-semibold text-primary hover:underline"
                        >
                          Show on map
                        </button>
                      )}
                    </div>
                    <div className="mt-[8px] flex flex-col gap-[5px]">
                      {schema.length === 0 && (
                        <div className="rounded-xl border border-dashed border-border p-[18px] text-center text-[12px] text-muted-foreground">
                          No synchronized schema metadata for this item.
                        </div>
                      )}
                      {schema.map((table) => {
                        const open = openTables.has(table.name);
                        return (
                          <div key={table.name} className="overflow-hidden rounded-lg border border-border">
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() => toggleTable(table.name)}
                              className="flex w-full items-center gap-[6px] px-[10px] py-[7px] text-left hover:bg-accent"
                            >
                              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{table.name}</span>
                              {table.rows != null && <span className="text-[10px] text-muted-foreground">{table.rows} rows</span>}
                            </button>
                            {open && (
                              <div className="border-t border-border px-[10px] py-[8px]">
                                {table.measures.map((measure) => (
                                  <div key={measure.name} className="flex items-center gap-[7px] py-[2px] text-[11px]">
                                    <span className="h-[6px] w-[6px] rounded-sm bg-object-measure" />
                                    <span>{measure.name}</span>
                                    <span className="ml-auto text-[9px] text-muted-foreground">measure</span>
                                  </div>
                                ))}
                                {table.columns.map((column) => (
                                  <div key={column.name} className="flex items-center gap-[7px] py-[2px] text-[11px]">
                                    <span className="h-[6px] w-[6px] rounded-sm bg-object-column" />
                                    <span className="min-w-0 flex-1 truncate font-mono">{column.name}</span>
                                    <span className="text-[9px] text-muted-foreground">{column.dataType}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {tab === "access" && (
                  <div>
                    <SectionLabel>Effective access · {effectiveAccess.length}</SectionLabel>
                    <div className="mt-[8px] text-[10px] leading-[1.4] text-muted-foreground">
                      Workspace and item grants are additive. Direct shares
                      never reduce inherited access.
                    </div>
                    <div className="mt-[10px] flex flex-col gap-[7px]">
                      {effectiveAccess.map((grant) => {
                        const principal = principals.find((entry) => entry.displayName === grant.principalRef);
                        return (
                          <div key={grant.principalRef} className="flex items-center gap-[9px] rounded-lg border border-border px-[10px] py-[8px]">
                            <PrincipalAvatar name={grant.principalRef} kind={principal?.kind ?? "user"} size={27} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[12px] font-semibold">{grant.principalRef}</div>
                              <div className="text-[9.5px] text-muted-foreground">
                                {grant.inherited
                                  ? "Inherited · workspace"
                                  : grant.mixed
                                    ? "Mixed · workspace + item"
                                    : "Direct share"}
                                {grant.roleName ? ` · ${grant.roleName}` : ""}
                              </div>
                            </div>
                            <span className="rounded-md bg-primary/10 px-[7px] py-[2px] text-[10px] font-semibold capitalize text-primary">{grant.accessLevel}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {tab === "runs" && (
                  <div>
                    <SectionLabel>Recent runs · {selectedJobs.length}</SectionLabel>
                    <div className="mt-[9px] flex flex-col gap-[7px]">
                      {selectedJobs.length === 0 && (
                        <div className="rounded-xl border border-dashed border-border p-[18px] text-center text-[12px] text-muted-foreground">
                          No recent job history synchronized for this item.
                        </div>
                      )}
                      {selectedJobs.map((job, index) => (
                        <Card key={`${job.startedAt}:${index}`} className="p-[10px]">
                          <div className="flex items-center gap-[7px]">
                            <HealthDot health={job.status === "completed" ? "healthy" : job.status === "failed" ? "failing" : job.status === "running" ? "stale" : "unknown"} />
                            <span className="text-[12px] font-semibold">{job.jobType}</span>
                            <span className="ml-auto text-[10px] capitalize text-muted-foreground">{job.status}</span>
                          </div>
                          <div className="mt-[5px] text-[10px] text-muted-foreground">
                            {relativeTime(job.startedAt)} · {job.durationSec}s
                            {job.message ? ` · ${job.message}` : ""}
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-[8px] border-t border-border p-[12px]">
                <a
                  href={workspaceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-[36px] flex-1 items-center justify-center gap-[7px] rounded-lg bg-primary px-[12px] text-[12px] font-semibold text-primary-foreground hover:brightness-110"
                >
                  Open in Fabric
                  <ExternalLink size={13} />
                </a>
                <button
                  type="button"
                  onClick={() => setImpactReportOpen(true)}
                  className="flex h-[36px] items-center justify-center gap-[7px] rounded-lg border border-border px-[10px] text-[12px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <FileDown size={13} />
                  Impact
                </button>
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  aria-label="Copy deep link"
                  className="flex h-[36px] w-[36px] items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {copied ? <Check size={14} className="text-status-healthy" /> : <Copy size={14} />}
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
      {reportItemId && (
        <ImpactReportDialog
          data={data}
          itemId={reportItemId}
          object={reportObject}
          open={impactReportOpen}
          onClose={() => setImpactReportOpen(false)}
        />
      )}
    </div>
  );
}
