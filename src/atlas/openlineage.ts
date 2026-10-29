/**
 * OpenLineage file reader (v2.7 External lineage).
 *
 * Pure TypeScript, no Rayfin or React. Reads a standard OpenLineage file
 * (NDJSON, JSON array or a single event) and keeps only what the map needs:
 * job identity, input/output datasets, the columnLineage facet and the last
 * run per edge. SQL text, source code, data samples and every other facet are
 * dropped during parsing and never leave this module.
 */

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
  /** Platform of {@link namespace}, e.g. SAS, Databricks. */
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
  sas: 'SAS',
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
