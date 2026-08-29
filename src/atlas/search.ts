import type { AtlasData, ModelTableSchema } from "./model";

export type SearchTargetKind =
  | "workspace"
  | "item"
  | "table"
  | "view"
  | "column"
  | "measure"
  | "principal"
  | "comment"
  | "config"
  | "job";

export interface SearchTarget {
  kind: SearchTargetKind;
  workspaceId?: string;
  itemId?: string;
  principalId?: string;
  commentId?: string;
  jobId?: string;
  section?: string;
  tableName?: string;
  objectName?: string;
}

export interface SearchIndexEntry {
  id: string;
  kind: SearchTargetKind;
  title: string;
  subtitle?: string;
  target: SearchTarget;
  searchText: string;
  normalizedTitle: string;
}

export interface SearchResult extends SearchIndexEntry {
  score: number;
}

export interface SearchOptions {
  limit?: number;
}

const KIND_SCORE: Record<SearchTargetKind, number> = {
  workspace: 30,
  item: 30,
  table: 25,
  view: 25,
  column: 20,
  measure: 20,
  principal: 20,
  config: 10,
  job: 10,
  comment: 0,
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function stablePart(value: string): string {
  return encodeURIComponent(normalizeSearchText(value) || "(blank)");
}

function entry(
  id: string,
  kind: SearchTargetKind,
  title: string,
  subtitle: string | undefined,
  target: SearchTarget,
  values: unknown[],
): SearchIndexEntry {
  return {
    id,
    kind,
    title,
    subtitle,
    target,
    normalizedTitle: normalizeSearchText(title),
    searchText: normalizeSearchText(
      [title, subtitle, ...values].map(text).filter(Boolean).join(" "),
    ),
  };
}

function tableKind(table: ModelTableSchema): "table" | "view" {
  return normalizeSearchText(table.objectType ?? "") === "view"
    ? "view"
    : "table";
}

export function searchJobId(
  itemId: string,
  jobType: string,
  startedAt: string,
): string {
  return [
    "job",
    stablePart(itemId),
    stablePart(jobType),
    stablePart(startedAt),
  ].join(":");
}

export function buildSearchIndex(data: AtlasData): SearchIndexEntry[] {
  const entries: SearchIndexEntry[] = [];
  const itemNames = new Map(
    data.items.map((item) => [item.fabricId, item.displayName]),
  );

  entries.push(
    entry(
      `workspace:${stablePart(data.workspace.fabricId)}`,
      "workspace",
      data.workspace.displayName,
      "Workspace",
      {
        kind: "workspace",
        workspaceId: data.workspace.fabricId,
      },
      [
        data.workspace.fabricId,
        data.workspace.capacity,
        data.workspace.region,
        data.workspace.deploymentId,
      ],
    ),
  );

  for (const item of data.items) {
    entries.push(
      entry(
        `item:${stablePart(item.fabricId)}`,
        "item",
        item.displayName,
        item.itemType,
        { kind: "item", itemId: item.fabricId },
        [
          item.fabricId,
          item.description,
          item.ownerName,
          item.ownerEmail,
          item.health,
          item.endorsement,
          item.sensitivity,
          ...item.tags,
        ],
      ),
    );
  }

  const schemaEntries = Object.entries(data.schema ?? {}).sort(
    ([left], [right]) => compareText(left, right),
  );
  for (const [itemId, itemSchema] of schemaEntries) {
    const item = data.items.find((candidate) => candidate.fabricId === itemId);
    const itemName = item?.displayName ?? itemId;
    for (const table of itemSchema) {
      const kind = tableKind(table);
      const tableId = [
        "schema",
        stablePart(itemId),
        kind,
        stablePart(table.name),
      ].join(":");
      entries.push(
        entry(
          tableId,
          kind,
          table.name,
          `${kind === "view" ? "View" : "Table"} in ${itemName}`,
          {
            kind,
            itemId,
            tableName: table.name,
          },
          [
            itemName,
            item?.itemType,
            table.description,
            table.objectType,
            table.source,
            typeof table.rows === "number" ? String(table.rows) : "",
          ],
        ),
      );

      for (const column of table.columns) {
        entries.push(
          entry(
            `${tableId}:column:${stablePart(column.name)}`,
            "column",
            column.name,
            `Column in ${table.name} · ${itemName}`,
            {
              kind: "column",
              itemId,
              tableName: table.name,
              objectName: column.name,
            },
            [
              table.name,
              itemName,
              column.dataType,
              column.description,
              column.isHidden ? "hidden" : "",
            ],
          ),
        );
      }

      for (const measure of table.measures) {
        entries.push(
          entry(
            `${tableId}:measure:${stablePart(measure.name)}`,
            "measure",
            measure.name,
            `Measure in ${table.name} · ${itemName}`,
            {
              kind: "measure",
              itemId,
              tableName: table.name,
              objectName: measure.name,
            },
            [
              table.name,
              itemName,
              measure.description,
              measure.expr,
              measure.isHidden ? "hidden" : "",
            ],
          ),
        );
      }
    }
  }

  for (const principal of data.principals) {
    entries.push(
      entry(
        `principal:${stablePart(principal.principalId)}`,
        "principal",
        principal.displayName,
        principal.kind,
        { kind: "principal", principalId: principal.principalId },
        [
          principal.principalId,
          principal.email,
          principal.workspaceRole,
          principal.external ? "external" : "",
        ],
      ),
    );
  }

  for (const comment of data.comments) {
    entries.push(
      entry(
        `comment:${stablePart(comment.id)}`,
        "comment",
        comment.body,
        `Comment by ${comment.authorName}`,
        {
          kind: "comment",
          itemId: comment.itemFabricId,
          principalId: comment.authorId,
          commentId: comment.id,
        },
        [
          comment.authorName,
          comment.authorEmail,
          comment.createdAt,
          comment.itemFabricId
            ? itemNames.get(comment.itemFabricId)
            : data.workspace.displayName,
        ],
      ),
    );
  }

  for (const config of data.config) {
    entries.push(
      entry(
        [
          "config",
          stablePart(config.itemFabricId),
          stablePart(config.section),
          stablePart(config.label),
          stablePart(config.value),
        ].join(":"),
        "config",
        config.label,
        `${config.section} · ${itemNames.get(config.itemFabricId) ?? config.itemFabricId}`,
        {
          kind: "config",
          itemId: config.itemFabricId,
          section: config.section,
          objectName: config.label,
        },
        [
          config.value,
          config.section,
          itemNames.get(config.itemFabricId),
        ],
      ),
    );
  }

  for (const job of data.jobs) {
    const id = searchJobId(job.itemFabricId, job.jobType, job.startedAt);
    entries.push(
      entry(
        id,
        "job",
        `${job.jobType}: ${job.itemName}`,
        job.status,
        { kind: "job", itemId: job.itemFabricId, jobId: id },
        [
          job.itemFabricId,
          job.message,
          job.startedAt,
          String(job.durationSec),
        ],
      ),
    );
  }

  return entries.sort((left, right) => compareText(left.id, right.id));
}

export const createSearchIndex = buildSearchIndex;

function tokenScore(entry: SearchIndexEntry, token: string): number {
  const titleWords = entry.normalizedTitle.split(" ");
  if (entry.normalizedTitle === token) return 160;
  if (entry.normalizedTitle.startsWith(token)) return 100;
  if (titleWords.some((word) => word === token)) return 80;
  if (titleWords.some((word) => word.startsWith(token))) return 55;
  if (entry.normalizedTitle.includes(token)) return 35;
  return 10;
}

export function searchIndex(
  index: SearchIndexEntry[],
  query: string,
  options?: SearchOptions,
): SearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  const tokens = [...new Set(normalizedQuery.split(" ").filter(Boolean))];
  const limit = Math.max(0, Math.floor(options?.limit ?? 50));
  if (limit === 0) return [];

  return index
    .filter((candidate) =>
      tokens.every((token) => candidate.searchText.includes(token)),
    )
    .map((candidate) => {
      let score =
        KIND_SCORE[candidate.kind] +
        tokens.reduce(
          (total, token) => total + tokenScore(candidate, token),
          0,
        );
      if (candidate.normalizedTitle === normalizedQuery) score += 1_000;
      else if (candidate.normalizedTitle.startsWith(normalizedQuery))
        score += 500;
      else if (candidate.normalizedTitle.includes(normalizedQuery))
        score += 200;
      return { ...candidate, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        compareText(left.normalizedTitle, right.normalizedTitle) ||
        compareText(left.kind, right.kind) ||
        compareText(left.id, right.id),
    )
    .slice(0, limit);
}

export function searchAtlas(
  data: AtlasData,
  query: string,
  options?: SearchOptions,
): SearchResult[] {
  return searchIndex(buildSearchIndex(data), query, options);
}

export const globalSearch = searchAtlas;
export const searchAtlasData = searchAtlas;
