/**
 * OpenLineage file reader (v2.7 External lineage).
 *
 * Pure TypeScript, no Rayfin or React. Reads a standard OpenLineage file
 * (NDJSON, JSON array or a single event) and keeps only what the map needs:
 * job identity, input/output datasets, the columnLineage facet and the last
 * run per edge. SQL text, source code, data samples and every other facet are
 * dropped during parsing and never leave this module.
 *
 * {@link exportOpenLineage} writes the reverse: the Fabric graph as standard
 * OpenLineage JobEvents and DatasetEvents (NDJSON).
 */

import type { AtlasData, Item, ItemType } from './model';
import type { ExternalLineage } from './external-lineage';

export const OL_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxEvents: 50_000,
  maxDatasets: 5_000,
} as const;

export const OL_EXTENSIONS = ['.json', '.ndjson'] as const;

export type OlFormat = 'ndjson' | 'json-array' | 'json-object';
export type OlStatus = 'accepted' | 'rejected';

export interface OlDataset {
  key: string;
  namespace: string;
  name: string;
  platform: string;
}

export interface OlColumnPair {
  from: string;
  to: string;
  transform?: string;
}

export interface OlEdge {
  key: string;
  sourceKey: string;
  targetKey: string;
  jobNamespace: string;
  jobName: string;
  lastRunState?: string;
  lastRunTime?: string;
  runId?: string;
  columns: OlColumnPair[];
}

export interface OlJob {
  namespace: string;
  name: string;
  platform: string;
}

export interface OlWarning {
  line: number;
  message: string;
}

export interface OlParseResult {
  status: OlStatus;
  rejectReason?: string;
  format?: OlFormat;
  eventCount: number;
  datasets: OlDataset[];
  edges: OlEdge[];
  jobs: OlJob[];
  warnings: OlWarning[];
  /** Most frequent job namespace in the file (shown under the file name). */
  namespace?: string;
  /** Platform of {@link namespace}, e.g. Oracle, Databricks. */
  platform?: string;
}

/** Checks name and size before the file is read. Returns a reject reason. */
export function checkOpenLineageFile(fileName: string, size: number): string | null {
  const lower = fileName.toLowerCase();
  if (!OL_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return 'Unsupported file type (use .json or .ndjson)';
  }
  if (size > OL_LIMITS.maxBytes) return 'File too large (max 20 MB)';
  return null;
}

/** Lowercases the URI scheme and authority and strips trailing slashes. */
export function normalizeNamespace(namespace: string): string {
  const trimmed = namespace.trim().replace(/\/+$/, '');
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)(.*)$/i.exec(trimmed);
  if (!m) return trimmed;
  return `${m[1].toLowerCase()}://${m[2].toLowerCase()}${m[3]}`;
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\/+$/, '');
}

export function datasetKey(namespace: string, name: string): string {
  return `${normalizeNamespace(namespace)}|${normalizeName(name)}`;
}

export function edgeKey(sourceKey: string, targetKey: string, jobNamespace: string, jobName: string): string {
  return `${sourceKey}>${targetKey}@${normalizeNamespace(jobNamespace)}|${jobName.trim()}`;
}

const SCHEME_PLATFORMS: Record<string, string> = {
  source: 'Data source',
  oracle: 'Oracle',
  databricks: 'Databricks',
  snowflake: 'Snowflake',
  bigquery: 'BigQuery',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  redshift: 'Redshift',
  teradata: 'Teradata',
  db2: 'Db2',
  hive: 'Hive',
  hdfs: 'HDFS',
  s3: 'S3',
  s3a: 'S3',
  gs: 'GCS',
  kafka: 'Kafka',
  file: 'File',
  sqlserver: 'SQL Server',
  mssql: 'SQL Server',
  abfss: 'ADLS',
  wasbs: 'Azure Blob',
  dbfs: 'Databricks',
  airflow: 'Airflow',
  dbt: 'dbt',
  spark: 'Spark',
};

/** Derives a display platform from an OpenLineage namespace. */
export function platformOf(namespace: string): string {
  const ns = normalizeNamespace(namespace);
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)/.exec(ns);
  if (!m) return 'Other';
  const [, scheme, host] = m;
  if (host.endsWith('.fabric.microsoft.com')) return 'Fabric';
  if (scheme === 'abfss' && host.includes('azuredatabricks')) return 'Databricks';
  return SCHEME_PLATFORMS[scheme] ?? scheme.toUpperCase();
}

const TERMINAL = new Set(['COMPLETE', 'FAIL', 'ABORT']);

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

interface RawEvent {
  value: unknown;
  line: number;
}

function splitEvents(text: string): { format: OlFormat; events: RawEvent[]; warnings: OlWarning[] } | { error: string } {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return { error: 'Empty file' };
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(arr)) return { error: 'Not OpenLineage' };
      return { format: 'json-array', events: arr.map((value, i) => ({ value, line: i + 1 })), warnings: [] };
    } catch {
      return { error: 'Invalid JSON' };
    }
  }
  try {
    const single = JSON.parse(trimmed) as unknown;
    return { format: 'json-object', events: [{ value: single, line: 1 }], warnings: [] };
  } catch {
    // Not a single document: read it as NDJSON below.
  }
  const events: RawEvent[] = [];
  const warnings: OlWarning[] = [];
  const lines = trimmed.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      events.push({ value: JSON.parse(line) as unknown, line: i + 1 });
    } catch {
      warnings.push({ line: i + 1, message: 'Invalid JSON, line skipped' });
    }
  }
  if (!events.length) return { error: 'Invalid JSON' };
  return { format: 'ndjson', events, warnings };
}

function looksLikeEvent(v: Json): boolean {
  return typeof v.eventTime === 'string' && (isObject(v.job) || isObject(v.dataset) || isObject(v.run));
}

function rejected(reason: string, format?: OlFormat, warnings: OlWarning[] = []): OlParseResult {
  return { status: 'rejected', rejectReason: reason, format, eventCount: 0, datasets: [], edges: [], jobs: [], warnings };
}

function newerRun(
  cur: { time?: string; state?: string },
  time: string | undefined,
  state: string | undefined,
): boolean {
  if (!time) return !cur.time && !cur.state && !!state;
  if (!cur.time) return true;
  const a = Date.parse(time);
  const b = Date.parse(cur.time);
  if (a !== b) return a > b;
  return TERMINAL.has(state ?? '') && !TERMINAL.has(cur.state ?? '');
}

function transformLabel(input: Json, field: Json): string | undefined {
  const list = Array.isArray(input.transformations) ? input.transformations : [];
  for (const t of list) {
    if (!isObject(t)) continue;
    const label = str(t.subtype) ?? str(t.type);
    if (label) return label;
  }
  return str(field.transformationType);
}

/** Parses an OpenLineage file. Never throws. */
export function parseOpenLineage(text: string): OlParseResult {
  if (text.length > OL_LIMITS.maxBytes) return rejected('File too large (max 20 MB)');
  const split = splitEvents(text);
  if ('error' in split) return rejected(split.error);
  const { format, events } = split;
  const warnings = [...split.warnings];
  if (events.length > OL_LIMITS.maxEvents) {
    return rejected(`Too many events (max ${OL_LIMITS.maxEvents.toLocaleString('en-US')})`, format, warnings);
  }

  const datasets = new Map<string, OlDataset>();
  const edges = new Map<string, OlEdge>();
  const edgeRuns = new Map<string, { time?: string; state?: string }>();
  const jobs = new Map<string, OlJob>();
  const jobNsCount = new Map<string, number>();
  let eventCount = 0;

  const addDataset = (raw: unknown, line: number, side: string): string | null => {
    if (!isObject(raw)) return null;
    const namespace = str(raw.namespace);
    const name = str(raw.name);
    if (!namespace || !name) {
      warnings.push({ line, message: `${side} dataset without namespace or name, skipped` });
      return null;
    }
    const key = datasetKey(namespace, name);
    if (!datasets.has(key)) {
      datasets.set(key, {
        key,
        namespace: normalizeNamespace(namespace),
        name: normalizeName(name),
        platform: platformOf(namespace),
      });
    }
    return key;
  };

  for (const { value, line } of events) {
    if (!isObject(value) || !looksLikeEvent(value)) {
      if (format !== 'json-object') warnings.push({ line, message: 'Not an OpenLineage event, skipped' });
      continue;
    }
    if (isObject(value.dataset) && !isObject(value.job)) {
      if (addDataset(value.dataset, line, 'Event')) eventCount++;
      continue;
    }
    const job = isObject(value.job) ? value.job : undefined;
    const jobNamespace = job ? str(job.namespace) : undefined;
    const jobName = job ? str(job.name) : undefined;
    if (!jobNamespace || !jobName) {
      warnings.push({ line, message: 'Event without job namespace or name, skipped' });
      continue;
    }
    eventCount++;
    const jobKey = `${normalizeNamespace(jobNamespace)}|${jobName.trim()}`;
    if (!jobs.has(jobKey)) {
      jobs.set(jobKey, { namespace: normalizeNamespace(jobNamespace), name: jobName.trim(), platform: platformOf(jobNamespace) });
    }
    jobNsCount.set(normalizeNamespace(jobNamespace), (jobNsCount.get(normalizeNamespace(jobNamespace)) ?? 0) + 1);

    const runId = isObject(value.run) ? str(value.run.runId) : undefined;
    const state = str(value.eventType)?.toUpperCase();
    const time = str(value.eventTime);

    const inputs = (Array.isArray(value.inputs) ? value.inputs : [])
      .map((d) => addDataset(d, line, 'Input'))
      .filter((k): k is string => !!k);
    const rawOutputs = Array.isArray(value.outputs) ? value.outputs : [];
    for (const out of rawOutputs) {
      const targetKey = addDataset(out, line, 'Output');
      if (!targetKey) continue;
      const colFields =
        isObject(out) && isObject(out.facets) && isObject(out.facets.columnLineage) && isObject(out.facets.columnLineage.fields)
          ? out.facets.columnLineage.fields
          : {};
      const columnsBySource = new Map<string, OlColumnPair[]>();
      for (const [outField, spec] of Object.entries(colFields)) {
        if (!isObject(spec) || !Array.isArray(spec.inputFields)) continue;
        for (const input of spec.inputFields) {
          if (!isObject(input)) continue;
          const ns = str(input.namespace);
          const nm = str(input.name);
          const field = str(input.field);
          if (!ns || !nm || !field) continue;
          const srcKey = datasetKey(ns, nm);
          const pair: OlColumnPair = { from: field, to: outField };
          const transform = transformLabel(input, spec);
          if (transform) pair.transform = transform;
          const list = columnsBySource.get(srcKey) ?? [];
          list.push(pair);
          columnsBySource.set(srcKey, list);
        }
      }
      const sources = new Set(inputs);
      for (const srcKey of columnsBySource.keys()) {
        const [ns, ...rest] = srcKey.split('|');
        if (addDataset({ namespace: ns, name: rest.join('|') }, line, 'Column')) sources.add(srcKey);
      }
      for (const sourceKey of sources) {
        if (sourceKey === targetKey) continue;
        const key = edgeKey(sourceKey, targetKey, jobNamespace, jobName);
        let edge = edges.get(key);
        if (!edge) {
          edge = {
            key,
            sourceKey,
            targetKey,
            jobNamespace: normalizeNamespace(jobNamespace),
            jobName: jobName.trim(),
            columns: [],
          };
          edges.set(key, edge);
          edgeRuns.set(key, {});
        }
        const cur = edgeRuns.get(key)!;
        if (newerRun(cur, time, state)) {
          cur.time = time;
          cur.state = state;
          edge.lastRunTime = time;
          edge.lastRunState = state;
          edge.runId = runId;
        }
        for (const pair of columnsBySource.get(sourceKey) ?? []) {
          if (!edge.columns.some((c) => c.from === pair.from && c.to === pair.to)) edge.columns.push(pair);
        }
      }
    }
    if (datasets.size > OL_LIMITS.maxDatasets) {
      return rejected(`Too many datasets (max ${OL_LIMITS.maxDatasets.toLocaleString('en-US')})`, format, warnings);
    }
  }

  if (!eventCount) return rejected('Not OpenLineage', format, warnings);

  let namespace: string | undefined;
  let best = 0;
  for (const [ns, n] of jobNsCount) {
    if (n > best) {
      best = n;
      namespace = ns;
    }
  }
  return {
    status: 'accepted',
    format,
    eventCount,
    datasets: [...datasets.values()],
    edges: [...edges.values()],
    jobs: [...jobs.values()],
    warnings,
    namespace,
    platform: namespace ? platformOf(namespace) : undefined,
  };
}

/** Compact column lineage for storage: `[[from,to,transform?],…]` within `max` chars. */
export function encodeColumns(columns: OlColumnPair[], max = 1800): { text: string; truncated: boolean } {
  const rows = columns.map((c) => (c.transform ? [c.from, c.to, c.transform] : [c.from, c.to]));
  let text = JSON.stringify(rows);
  if (text.length <= max) return { text, truncated: false };
  while (rows.length && text.length > max) {
    rows.pop();
    text = JSON.stringify(rows);
  }
  return { text, truncated: true };
}

export function decodeColumns(text: string | undefined | null): OlColumnPair[] {
  if (!text) return [];
  try {
    const rows = JSON.parse(text) as unknown;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r): r is string[] => Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'string')
      .map((r) => (r[2] ? { from: r[0], to: r[1], transform: r[2] } : { from: r[0], to: r[1] }));
  } catch {
    return [];
  }
}

/* ------------------------------- export ------------------------------- */

export const OL_PRODUCER = 'https://github.com/fredgis/FabricAtlas/v2.7';
export const OL_SPEC_URL = 'https://openlineage.io/spec/2-0-2/OpenLineage.json';
const JOB_TYPE_FACET_URL = 'https://openlineage.io/spec/facets/2-0-3/JobTypeJobFacet.json#/$defs/JobTypeJobFacet';
const COLUMN_FACET_URL = 'https://openlineage.io/spec/facets/1-2-0/ColumnLineageDatasetFacet.json#/$defs/ColumnLineageDatasetFacet';

/** Fabric items that run work; every other item is exported as a dataset. */
export const JOB_ITEM_TYPES: ReadonlySet<ItemType> = new Set<ItemType>([
  'Notebook',
  'DataPipeline',
  'Dataflow',
  'Eventstream',
  'UserDataFunction',
]);

export interface OlExportOptions {
  /** Restricts the export to these item ids (map selection). All items when omitted. */
  itemIds?: ReadonlySet<string>;
  /** Adds the imported external edges that touch a linked Fabric item. */
  includeExternal?: boolean;
  external?: ExternalLineage;
  eventTime?: string;
}

export interface OlExportResult {
  text: string;
  eventCount: number;
  jobCount: number;
  datasetCount: number;
  externalEdgeCount: number;
  fileName: string;
}

interface OlDatasetRef {
  namespace: string;
  name: string;
  facets?: Record<string, unknown>;
}

/** `abfss://<workspace>@onelake.dfs.fabric.microsoft.com`, the namespace the auto-link reads back. */
export function oneLakeNamespace(workspace: Pick<AtlasData['workspace'], 'fabricId' | 'displayName'>): string {
  const id = workspace.fabricId || workspace.displayName || 'workspace';
  return `abfss://${encodeURIComponent(id)}@onelake.dfs.fabric.microsoft.com`;
}

/** Item root path `<name>.<Type>`, optionally with `Tables/<schema>/<table>` or `Files/…`. */
export function oneLakeName(item: Pick<Item, 'displayName' | 'itemType'>, objectName?: string): string {
  const root = `${item.displayName.replace(/\//g, '%2F')}.${item.itemType}`;
  if (!objectName) return root;
  if (objectName.startsWith('Files/')) return `${root}/${objectName}`;
  return `${root}/Tables/${objectName.split('.').join('/')}`;
}

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
}

/** Writes the Fabric graph (plus linked external edges on demand) as OpenLineage NDJSON. Pure. */
export function exportOpenLineage(
  data: Pick<AtlasData, 'workspace' | 'items' | 'edges'>,
  opts: OlExportOptions = {},
): OlExportResult {
  const eventTime = opts.eventTime ?? new Date().toISOString();
  const namespace = oneLakeNamespace(data.workspace);
  const inScope = (id: string) => !opts.itemIds || opts.itemIds.has(id);
  const items = new Map(data.items.filter((i) => inScope(i.fabricId)).map((i) => [i.fabricId, i]));
  const isJob = (i: Item) => JOB_ITEM_TYPES.has(i.itemType);
  const ref = (i: Item, objectName?: string): OlDatasetRef => ({ namespace, name: oneLakeName(i, objectName) });
  const base = { eventTime, producer: OL_PRODUCER };
  const lines: string[] = [];
  const datasetsSeen = new Set<string>();
  const jobsSeen = new Set<string>();
  const trackDataset = (d: OlDatasetRef) => datasetsSeen.add(`${d.namespace}|${d.name}`);

  const jobEvent = (
    job: { namespace: string; name: string; type?: string; integration?: string },
    inputs: OlDatasetRef[],
    outputs: OlDatasetRef[],
  ) => {
    inputs.forEach(trackDataset);
    outputs.forEach(trackDataset);
    jobsSeen.add(`${job.namespace}|${job.name}`);
    const facets = job.type
      ? {
          jobType: {
            _producer: OL_PRODUCER,
            _schemaURL: JOB_TYPE_FACET_URL,
            processingType: 'BATCH',
            integration: job.integration ?? 'FABRIC',
            jobType: job.type,
          },
        }
      : undefined;
    lines.push(
      JSON.stringify({
        ...base,
        schemaURL: `${OL_SPEC_URL}#/$defs/JobEvent`,
        job: { namespace: job.namespace, name: job.name, ...(facets ? { facets } : {}) },
        inputs,
        outputs,
      }),
    );
  };

  // Fabric jobs (notebooks, pipelines…): dataset inputs → job → dataset outputs.
  const jobInputs = new Map<string, Item[]>();
  const jobOutputs = new Map<string, Item[]>();
  // Direct dataset → dataset edges, grouped by target and relation.
  const direct = new Map<string, { target: Item; relation: string; sources: Item[] }>();
  const push = (m: Map<string, Item[]>, k: string, v: Item) => {
    const list = m.get(k) ?? [];
    if (!list.includes(v)) list.push(v);
    m.set(k, list);
  };
  for (const e of data.edges) {
    const s = items.get(e.source);
    const t = items.get(e.target);
    if (!s || !t || s === t) continue;
    if (isJob(t) && !isJob(s)) push(jobInputs, t.fabricId, s);
    else if (isJob(s) && !isJob(t)) push(jobOutputs, s.fabricId, t);
    else if (!isJob(s) && !isJob(t)) {
      const key = `${t.fabricId}|${e.relation}`;
      const g = direct.get(key) ?? { target: t, relation: e.relation, sources: [] };
      if (!g.sources.includes(s)) g.sources.push(s);
      direct.set(key, g);
    }
  }
  for (const item of items.values()) {
    if (!isJob(item)) continue;
    const ins = jobInputs.get(item.fabricId) ?? [];
    const outs = jobOutputs.get(item.fabricId) ?? [];
    if (!ins.length && !outs.length) continue;
    jobEvent(
      { namespace, name: oneLakeName(item), type: item.itemType.toUpperCase() },
      ins.map((i) => ref(i)),
      outs.map((i) => ref(i)),
    );
  }
  for (const g of direct.values()) {
    jobEvent(
      { namespace, name: `${oneLakeName(g.target)}#${g.relation || 'lineage'}`, type: 'LINEAGE' },
      g.sources.map((i) => ref(i)),
      [ref(g.target)],
    );
  }

  let externalEdgeCount = 0;
  if (opts.includeExternal && opts.external) {
    const byId = new Map(opts.external.datasets.map((d) => [d.id, d]));
    const refOf = (id: string): { ref: OlDatasetRef; linked: boolean } | null => {
      const d = byId.get(id);
      if (!d) return null;
      const item = d.state === 'linked' && d.fabricItemId ? data.items.find((i) => i.fabricId === d.fabricItemId) : undefined;
      if (item) return { ref: ref(item, d.fabricObjectName || undefined), linked: inScope(item.fabricId) };
      return { ref: { namespace: d.namespace, name: d.name }, linked: false };
    };
    for (const e of opts.external.edges) {
      const src = refOf(e.sourceDatasetId);
      const tgt = refOf(e.targetDatasetId);
      if (!src || !tgt || (!src.linked && !tgt.linked)) continue;
      const output: OlDatasetRef = { ...tgt.ref };
      if (e.columns.length) {
        const fields: Record<string, { inputFields: unknown[] }> = {};
        for (const c of e.columns) {
          const f = (fields[c.to] ??= { inputFields: [] });
          f.inputFields.push({
            namespace: src.ref.namespace,
            name: src.ref.name,
            field: c.from,
            ...(c.transform
              ? { transformations: [{ type: /^(DIRECT|INDIRECT)$/i.test(c.transform) ? c.transform.toUpperCase() : 'DIRECT', subtype: c.transform }] }
              : {}),
          });
        }
        output.facets = { columnLineage: { _producer: OL_PRODUCER, _schemaURL: COLUMN_FACET_URL, fields } };
      }
      jobEvent({ namespace: e.jobNamespace, name: e.jobName }, [src.ref], [output]);
      externalEdgeCount++;
    }
  }

  // Every dataset in scope, including items with no edge.
  const datasetRefs: OlDatasetRef[] = [];
  for (const item of items.values()) if (!isJob(item)) datasetRefs.push(ref(item));
  for (const key of datasetsSeen) {
    const [ns, ...rest] = key.split('|');
    if (!datasetRefs.some((d) => d.namespace === ns && d.name === rest.join('|'))) datasetRefs.push({ namespace: ns, name: rest.join('|') });
  }
  for (const d of datasetRefs) {
    lines.push(JSON.stringify({ ...base, schemaURL: `${OL_SPEC_URL}#/$defs/DatasetEvent`, dataset: d }));
  }

  const day = eventTime.slice(0, 10);
  return {
    text: lines.length ? `${lines.join('\n')}\n` : '',
    eventCount: lines.length,
    jobCount: jobsSeen.size,
    datasetCount: datasetRefs.length,
    externalEdgeCount,
    fileName: `fabric-atlas-${slug(data.workspace.displayName || data.workspace.fabricId)}-openlineage-${day}.ndjson`,
  };
}
