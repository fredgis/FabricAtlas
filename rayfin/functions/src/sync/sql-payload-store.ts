import { createHash } from 'node:crypto';
import type { SyncPayloadManifest } from '../../../data/SyncPayloadManifest.js';
import type { SyncPayloadChunk } from '../../../data/SyncPayloadChunk.js';
import type { MetadataPayloadStore } from './graph-orchestrator.js';
import { identity, reference, uuid, type PayloadReference } from './graph-protocol.js';
import { SqlControlError, type LockedSqlPayloadSession, type SqlTransactionBoundary } from './sql-control.js';

const MAX_BYTES = 1024 * 1024;
const CHUNK_CHARS = 1800;
const MAX_CHUNKS = 292;
const CHECKSUM_VERSION = 'sha256-utf16le-v1';
export interface ProjectionCodec<T> {
  schemaId: string;
  /** Must validate the actual collector projection, not cast unknown or accept raw rows. */
  parse(value: unknown): T;
}

function invalid(): never { throw new SqlControlError('SQL_PAYLOAD_INVALID'); }
export function payloadDigest(content: string): string {
  return createHash('sha256').update(content, 'utf16le').digest('hex');
}
export function canonicalProjection(value: unknown): string {
  let nodes = 0;
  let chars = 0;
  const visit = (value: unknown, depth: number): string => {
    if (++nodes > 65_536 || depth > 40) return invalid();
    if (value === null || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : invalid();
    if (typeof value === 'string') {
      chars += value.length;
      if (chars > MAX_BYTES / 2 || value.length > 65_536 ||
          /(?:[a-z][a-z0-9+.-]*:\/\/|Bearer\s+\S+|eyJ[\w-]+\.[\w-]+\.[\w-]+|(?:password|client_secret|access_token)\s*[:=])/i.test(value)) return invalid();
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      if (value.length > 10_000) return invalid();
      return `[${value.map((entry) => visit(entry, depth + 1)).join(',')}]`;
    }
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return invalid();
    const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, entry]) => {
      if (key.length > 200 || /^(?:__proto__|constructor|prototype|authorization|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|secret[_-]?key|private[_-]?key|api[_-]?key|credentials?|password|connection[_-]?string)$/i.test(key)) return invalid();
      chars += key.length;
      if (chars > MAX_BYTES / 2) return invalid();
      return `${JSON.stringify(key)}:${visit(entry, depth + 1)}`;
    }).join(',')}}`;
  };
  const result = visit(value, 0);
  if (Buffer.byteLength(result, 'utf16le') > MAX_BYTES) return invalid();
  return result;
}

function split(content: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < content.length;) {
    let end = Math.min(offset + CHUNK_CHARS, content.length);
    if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1])) end--;
    chunks.push(content.slice(offset, end));
    offset = end;
  }
  if (chunks.length < 1 || chunks.length > MAX_CHUNKS) return invalid();
  return chunks;
}

function sameHeader(stored: SyncPayloadManifest, expected: SyncPayloadManifest): boolean {
  return stored.id === expected.id && stored.taskId === expected.taskId &&
    (stored.checkpointId ?? null) === (expected.checkpointId ?? null) &&
    stored.schemaId === expected.schemaId && stored.checksumVersion === expected.checksumVersion &&
    stored.contentHash === expected.contentHash && stored.byteCount === expected.byteCount &&
    stored.chunkCount === expected.chunkCount;
}

/** Fixed SQL commands only. Both rows and the manifest commit in the applock
 * transaction; a lost commit response is recovered by replaying writeOnce.
 */
export class SqlMetadataPayloadStore<T> implements MetadataPayloadStore<T> {
  constructor(private readonly boundary: SqlTransactionBoundary, private readonly codec: ProjectionCodec<T>) {
    if (!/^[a-z][a-z0-9.-]{2,79}$/.test(codec.schemaId) || typeof codec.parse !== 'function') invalid();
  }

  async writeOnce(taskId: string, checkpointId: string | null, projection: T): Promise<PayloadReference> {
    const task = uuid(taskId);
    const checkpoint = checkpointId === null ? null : uuid(checkpointId);
    let content: string;
    try { content = canonicalProjection(this.codec.parse(projection)); } catch { return invalid(); }
    const parts = split(content);
    const id = identity('sql-payload', 1, this.codec.schemaId, task, checkpoint);
    const manifest: SyncPayloadManifest = {
      id, taskId: task, ...(checkpoint ? { checkpointId: checkpoint } : {}),
      schemaId: this.codec.schemaId, checksumVersion: CHECKSUM_VERSION,
      contentHash: payloadDigest(content), byteCount: Buffer.byteLength(content, 'utf16le'), chunkCount: parts.length,
    };
    return this.boundary.transaction(async (session) => {
      const existing = await session.query('manifest', { id });
      if (existing.length) {
        if (existing.length !== 1 || !sameHeader(existing[0] as unknown as SyncPayloadManifest, manifest)) {
          throw new SqlControlError('SQL_PAYLOAD_CONFLICT');
        }
        await this.readWithin(session, { id, hash: manifest.contentHash });
        return { id, hash: manifest.contentHash };
      }
      const oldChunks = await session.query('chunks', { payloadId: id });
      if (oldChunks.length) throw new SqlControlError('SQL_PAYLOAD_CONFLICT');
      for (let ordinal = 0; ordinal < parts.length; ordinal++) {
        const chunk: SyncPayloadChunk = {
          id: identity('sql-payload-chunk', id, ordinal), payloadId: id, ordinal,
          content: parts[ordinal], contentHash: payloadDigest(parts[ordinal]),
        };
        await session.query('insertChunk', { ...chunk });
      }
      await session.query('insertManifest', { ...manifest, checkpointId: checkpoint });
      await this.readWithin(session, { id, hash: manifest.contentHash });
      return { id, hash: manifest.contentHash };
    });
  }

  async read(value: PayloadReference): Promise<T> {
    let ref: PayloadReference;
    try { ref = reference(value); } catch { return invalid(); }
    return this.boundary.transaction((session) => this.readWithin(session, ref));
  }

  private async readWithin(session: LockedSqlPayloadSession, ref: PayloadReference): Promise<T> {
    const headers = await session.query('manifest', { id: ref.id });
    if (headers.length !== 1) return invalid();
    const header = headers[0] as unknown as SyncPayloadManifest;
    if (header.id !== ref.id || header.schemaId !== this.codec.schemaId ||
        header.checksumVersion !== CHECKSUM_VERSION || header.contentHash !== ref.hash ||
        !Number.isInteger(header.byteCount) || header.byteCount < 2 || header.byteCount > MAX_BYTES ||
        !Number.isInteger(header.chunkCount) || header.chunkCount < 1 || header.chunkCount > MAX_CHUNKS) return invalid();
    try {
      if (header.id !== identity('sql-payload', 1, this.codec.schemaId, uuid(header.taskId),
        header.checkpointId == null ? null : uuid(header.checkpointId))) return invalid();
    } catch { return invalid(); }
    const chunks = await session.query('chunks', { payloadId: ref.id }) as unknown as SyncPayloadChunk[];
    if (chunks.length !== header.chunkCount) return invalid();
    let content = '';
    for (let ordinal = 0; ordinal < chunks.length; ordinal++) {
      const chunk = chunks[ordinal];
      if (chunk.ordinal !== ordinal || chunk.payloadId !== ref.id ||
          chunk.id !== identity('sql-payload-chunk', ref.id, ordinal) ||
          typeof chunk.content !== 'string' || chunk.content.length < 1 || chunk.content.length > CHUNK_CHARS ||
          payloadDigest(chunk.content) !== chunk.contentHash) return invalid();
      content += chunk.content;
    }
    if (Buffer.byteLength(content, 'utf16le') !== header.byteCount || payloadDigest(content) !== ref.hash) return invalid();
    try {
      const projection = this.codec.parse(JSON.parse(content));
      if (canonicalProjection(projection) !== content) return invalid();
      return projection;
    } catch { return invalid(); }
  }
}
