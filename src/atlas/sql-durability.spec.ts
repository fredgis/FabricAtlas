// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { ExternalSerializer } from '../../rayfin/functions/src/sync/graph-protocol';
import { identity } from '../../rayfin/functions/src/sync/graph-protocol';
import {
  createSqlPayloadBoundary, resolveSqlControlTarget, requireSqlGraphFence, sqlCoordinates,
  SqlTransactionBoundary, SQL_CONTROL_QUERIES,
  type SqlControlDriver, type SqlControlQuery, type SqlParameters, type SqlRow, type SqlControlSession,
} from '../../rayfin/functions/src/sync/sql-control';
import { canonicalProjection, payloadDigest, SqlMetadataPayloadStore } from '../../rayfin/functions/src/sync/sql-payload-store';

const TARGET = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  databaseItemId: '22222222-2222-4222-8222-222222222222',
};
const TASK = identity('test-task');
const ITEM = {
  id: TARGET.databaseItemId, workspaceId: TARGET.workspaceId, type: 'SQLDatabase',
  properties: { serverFqdn: 'unit-database.database.fabric.microsoft.com,1433', databaseName: 'metadata-control' },
};
const codec = {
  schemaId: 'unit-metadata-v1',
  parse(value: unknown): { label: string } {
    if (!value || typeof value !== 'object' || Object.keys(value).length !== 1 ||
        typeof (value as { label?: unknown }).label !== 'string') throw new Error('private codec details');
    return value as { label: string };
  },
};

function database() {
  let headers = new Map<string, SqlRow>();
  let chunks = new Map<string, SqlRow>();
  let owner: number | null = null;
  let sessionId = 0;
  let failQuery: SqlControlQuery | null = null;
  let loseCommit = false;
  let forceLockCode: number | null = null;
  const events: { sessionId: number; name: string; parameters?: SqlParameters }[] = [];
  const driver: SqlControlDriver = async () => {
    const id = ++sessionId;
    let localHeaders = new Map<string, SqlRow>();
    let localChunks = new Map<string, SqlRow>();
    let closed = false;
    const session: SqlControlSession = {
      async begin() { events.push({ sessionId: id, name: 'begin' }); },
      async query(name, parameters = {}) {
        if (closed) throw new Error('private connection error');
        events.push({ sessionId: id, name, parameters });
        if (failQuery === name) { failQuery = null; throw new Error('private token driver detail'); }
        if (name === 'acquire') {
          if (forceLockCode !== null) return [{ code: forceLockCode }];
          if (owner !== null && owner !== id) return [{ code: -1 }];
          owner = id;
          localHeaders = structuredClone(headers);
          localChunks = structuredClone(chunks);
          return [{ code: 0 }];
        }
        if (name === 'assert') return [{ held: owner === id ? 1 : 0 }];
        if (owner !== id) throw new Error('lock not owned');
        if (name === 'manifest') return localHeaders.has(String(parameters.id)) ? [structuredClone(localHeaders.get(String(parameters.id))!)] : [];
        if (name === 'chunks') return [...localChunks.values()].filter((row) => row.payloadId === parameters.payloadId)
          .sort((a, b) => Number(a.ordinal) - Number(b.ordinal)).slice(0, 293).map((row) => structuredClone(row));
        if (name === 'insertChunk') {
          if (localChunks.has(String(parameters.id)) || payloadDigest(String(parameters.content)) !== parameters.contentHash) throw new Error('constraint');
          localChunks.set(String(parameters.id), structuredClone(parameters));
          return [];
        }
        if (name === 'insertManifest') {
          if (localHeaders.has(String(parameters.id))) throw new Error('constraint');
          localHeaders.set(String(parameters.id), structuredClone(parameters));
          return [];
        }
        return [];
      },
      async commit() {
        if (owner !== id) throw new Error('lock lost');
        events.push({ sessionId: id, name: 'commit' });
        headers = structuredClone(localHeaders);
        chunks = structuredClone(localChunks);
        owner = null;
        if (loseCommit) { loseCommit = false; throw new Error('private commit token details'); }
      },
      async rollback() { events.push({ sessionId: id, name: 'rollback' }); if (owner === id) owner = null; },
      async close() { closed = true; if (owner === id) owner = null; events.push({ sessionId: id, name: 'close' }); },
    };
    return session;
  };
  const boundary = () => new SqlTransactionBoundary(driver);
  return {
    driver, boundary, events,
    headers: () => headers, chunks: () => chunks,
    fail(name: SqlControlQuery) { failQuery = name; },
    loseCommit() { loseCommit = true; },
    loseLock() { owner = null; },
    lockCode(code: number) { forceLockCode = code; },
    store: () => new SqlMetadataPayloadStore(boundary(), codec),
  };
}

describe('trusted SQL target resolution', () => {
  it('uses fixed documented Fabric SQLDatabase routes and validates exact item binding', async () => {
    const get = vi.fn(async () => ITEM);
    expect(await resolveSqlControlTarget(TARGET, get)).toEqual({
      server: 'unit-database.database.fabric.microsoft.com', database: 'metadata-control',
    });
    expect(get).toHaveBeenCalledWith(`/v1/workspaces/${TARGET.workspaceId}/sqlDatabases/${TARGET.databaseItemId}`);
    expect(() => sqlCoordinates({ ...ITEM, id: TASK }, TARGET)).toThrow('SQL_COORDINATES_INVALID');
    expect(() => sqlCoordinates({ ...ITEM, type: 'Warehouse' }, TARGET)).toThrow('SQL_COORDINATES_INVALID');
    expect(() => sqlCoordinates({ ...ITEM, workspaceId: TASK }, TARGET)).toThrow('SQL_COORDINATES_INVALID');
  });

  it.each([
    'https://unit-database.database.fabric.microsoft.com',
    'localhost', '127.0.0.1', 'unit-database.database.fabric.microsoft.com.attacker.test',
    'unit-database.database.fabric.microsoft.com,1444', 'unit-database.database.fabric.microsoft.com;Password=value',
  ])('rejects non-SQLDatabase endpoints %s', (serverFqdn) => {
    expect(() => sqlCoordinates({ ...ITEM, properties: { ...ITEM.properties, serverFqdn } }, TARGET)).toThrow('SQL_COORDINATES_INVALID');
  });

  it('fails closed before lookup without a strict configured target and never echoes upstream errors', async () => {
    const get = vi.fn(async () => { throw new Error('secret driver token'); });
    await expect(resolveSqlControlTarget(null, get)).rejects.toThrow('SQL_TARGET_REQUIRED');
    await expect(resolveSqlControlTarget({ ...TARGET, databaseItemId: 'https://attacker.test' }, get)).rejects.toThrow('SQL_TARGET_REQUIRED');
    expect(get).not.toHaveBeenCalled();
    await expect(resolveSqlControlTarget(TARGET, get)).rejects.toMatchObject({ message: 'SQL_COORDINATES_INVALID' });
  });

  it('requires caller-scoped synchronizer authority before touching application SQL/Fabric tokens', async () => {
    const tokens = vi.fn(() => { throw new Error('tokens should not be accessed'); });
    const ctx = {
      getDataClient: () => ({
        SynchronizerAuthority: { findById: async () => null, create: async () => { throw new Error('denied'); } },
      }),
      get Tokens() { return tokens(); },
    } as unknown as Parameters<typeof createSqlPayloadBoundary>[0];
    await expect(createSqlPayloadBoundary(ctx, TARGET)).rejects.toThrow('SQL_AUTHORIZATION_FAILED');
    expect(tokens).not.toHaveBeenCalled();
  });
});

describe('transaction-owned SQL serialization', () => {
  it.each([-1, -2, -3, -999])('never executes work for lock return code %s', async (code) => {
    const db = database();
    db.lockCode(code);
    const work = vi.fn();
    await expect(db.boundary().transaction(work)).rejects.toThrow('SQL_LOCK_UNAVAILABLE');
    expect(work).not.toHaveBeenCalled();
    expect(db.events.map((event) => event.name)).toEqual(['begin', 'acquire', 'rollback', 'close']);
  });

  it('serializes separate driver sessions and releases ownership only through SQL commit or rollback', async () => {
    const db = database();
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const first = db.boundary().transaction(async () => { entered(); await wait; return 'first'; });
    await ready;
    await expect(db.boundary().transaction(async () => 'second')).rejects.toThrow('SQL_LOCK_UNAVAILABLE');
    release();
    expect(await first).toBe('first');
    expect(await db.boundary().transaction(async () => 'third')).toBe('third');
  });

  it('rolls back on connection loss, refuses a reused session and does not reconnect during a transaction', async () => {
    const db = database();
    let retained: Parameters<Parameters<SqlTransactionBoundary['transaction']>[0]>[0] | undefined;
    await expect(db.boundary().transaction(async (session) => {
      retained = session;
      db.loseLock();
      await session.query('manifest', { id: TASK });
    })).rejects.toThrow('SQL_TRANSACTION_UNAVAILABLE');
    await expect(retained!.query('manifest', { id: TASK })).rejects.toThrow('SQL_TRANSACTION_UNAVAILABLE');
    expect(db.events.filter((event) => event.name === 'begin')).toHaveLength(1);
    expect(db.events.some((event) => event.name === 'commit')).toBe(false);
  });

  it('never commits a slice after its total transaction budget expires', async () => {
    const db = database();
    let now = 0;
    const boundary = new SqlTransactionBoundary(db.driver, () => now);
    await expect(boundary.transaction(async () => { now = 120_000; })).rejects.toThrow('SQL_TRANSACTION_UNAVAILABLE');
    expect(db.events.some((event) => event.name === 'commit')).toBe(false);
    expect(db.events.some((event) => event.name === 'rollback')).toBe(true);
  });

  it.each([null, undefined, '0', 2])('rejects malformed lock success value %s without coercion', async (code) => {
    const db = database();
    const driver: SqlControlDriver = async () => {
      const session = await db.driver();
      return { ...session, query: async (name, parameters) => name === 'acquire' ? [{ code }] : session.query(name, parameters) };
    };
    const work = vi.fn();
    await expect(new SqlTransactionBoundary(driver).transaction(work)).rejects.toThrow('SQL_LOCK_UNAVAILABLE');
    expect(work).not.toHaveBeenCalled();
  });

  it('cannot serve as the graph serializer while GraphQL operations run in other sessions', () => {
    expectTypeOf<SqlTransactionBoundary>().not.toExtend<ExternalSerializer>();
    expect(() => requireSqlGraphFence()).toThrow('SQL_GRAPH_FENCING_REQUIRED');
    const functions = readFileSync(resolve('rayfin/functions/src/sync/graph-functions.ts'), 'utf8');
    expect(functions).toContain('new GraphOrchestrator(ctx.getDataClient())');
    expect(functions).not.toContain('new SqlTransactionBoundary');
  });
});

describe('append-only immutable SQL payloads', () => {
  it('uses stable task/checkpoint IDs, canonical order, SQL-compatible checksums and manifest-last commit', async () => {
    const db = database();
    const ref = await db.store().writeOnce(TASK, null, { label: 'méta 🚀'.repeat(400) });
    expect(await db.store().read(ref)).toEqual({ label: 'méta 🚀'.repeat(400) });
    expect(await db.store().writeOnce(TASK, null, { label: 'méta 🚀'.repeat(400) })).toEqual(ref);
    expect(db.headers().size).toBe(1);
    expect(db.chunks().size).toBeGreaterThan(1);
    const firstSession = db.events.filter((event) => event.sessionId === 1).map((event) => event.name);
    expect(firstSession.lastIndexOf('insertChunk')).toBeLessThan(firstSession.indexOf('insertManifest'));
    expect(firstSession.indexOf('insertManifest')).toBeLessThan(firstSession.indexOf('commit'));
    expect(canonicalProjection({ b: 1, a: null })).toBe(canonicalProjection({ a: null, b: 1 }));
    expect(ref.hash).toBe(payloadDigest(canonicalProjection({ label: 'méta 🚀'.repeat(400) })));
    expect(await db.store().writeOnce(TASK, identity('checkpoint'), { label: 'next' })).not.toEqual(ref);
  });

  it('rolls back an interrupted write instead of leaving a readable partial payload', async () => {
    const db = database();
    db.fail('insertManifest');
    await expect(db.store().writeOnce(TASK, null, { label: 'x'.repeat(4000) })).rejects.toThrow('SQL_TRANSACTION_UNAVAILABLE');
    expect(db.headers().size).toBe(0);
    expect(db.chunks().size).toBe(0);
    const ref = await db.store().writeOnce(TASK, null, { label: 'x'.repeat(4000) });
    expect(await db.store().read(ref)).toEqual({ label: 'x'.repeat(4000) });
  });

  it('recovers a lost committed response by reading immutable rows, without overwriting changed retries', async () => {
    const db = database();
    db.loseCommit();
    await expect(db.store().writeOnce(TASK, null, { label: 'committed' })).rejects.toThrow('SQL_COMMIT_UNCONFIRMED');
    expect(db.headers().size).toBe(1);
    const ref = await db.store().writeOnce(TASK, null, { label: 'committed' });
    expect(await db.store().read(ref)).toEqual({ label: 'committed' });
    await expect(db.store().writeOnce(TASK, null, { label: 'changed' })).rejects.toThrow('SQL_PAYLOAD_CONFLICT');
    expect(await db.store().read(ref)).toEqual({ label: 'committed' });
    expect(db.events.filter((event) => event.name === 'insertManifest')).toHaveLength(1);
  });

  it.each(['missing', 'modified', 'hash', 'ordinal', 'header', 'extra'] as const)('rejects %s corruption by read-back', async (fault) => {
    const db = database();
    const ref = await db.store().writeOnce(TASK, null, { label: 'x'.repeat(4000) });
    const first = [...db.chunks().values()][0];
    if (fault === 'missing') db.chunks().delete(String(first.id));
    if (fault === 'modified') first.content = 'changed';
    if (fault === 'hash') first.contentHash = '0'.repeat(64);
    if (fault === 'ordinal') first.ordinal = 2;
    if (fault === 'header') db.headers().get(ref.id)!.byteCount = 2;
    if (fault === 'extra') db.chunks().set(identity('extra'), { ...first, id: identity('extra'), ordinal: 10 });
    await expect(db.store().read(ref)).rejects.toThrow('SQL_PAYLOAD_INVALID');
  });

  it('rejects wrong schema, sensitive fields, secret strings, arbitrary URLs and giant payloads before SQL', async () => {
    const db = database();
    for (const value of [
      { label: 'https://private.invalid' }, { label: 'Bearer secret' },
      { label: 'x'.repeat(65_537) }, { label: 'name', accessToken: 'secret' },
    ]) await expect(db.store().writeOnce(TASK, null, value)).rejects.toThrow('SQL_PAYLOAD_INVALID');
    for (const value of [{ accessToken: 'secret' }, { password: 'secret' }, { apiKey: 'secret' }, { raw: new Date() },
      { label: Number.NaN }, { label: undefined }, { list: Array(10_001).fill(1) }]) {
      expect(() => canonicalProjection(value)).toThrow('SQL_PAYLOAD_INVALID');
    }
    expect(db.events).toHaveLength(0);
    const ref = await db.store().writeOnce(TASK, null, { label: 'valid' });
    await expect(new SqlMetadataPayloadStore(db.boundary(), { ...codec, schemaId: 'other-metadata-v1' }).read(ref)).rejects.toThrow('SQL_PAYLOAD_INVALID');
  });

  it('declares append-only payload policies and limits SQL operations to fixed commands', () => {
    for (const entity of ['SyncPayloadManifest', 'SyncPayloadChunk']) {
      const source = readFileSync(resolve(`rayfin/data/${entity}.ts`), 'utf8');
      expect(source).toContain("@authenticated(['read', 'create']");
      expect(source).toContain('claims.sub.eq(SYNC_WRITER_SUBJECT)');
      expect(source).not.toMatch(/['"](?:update|delete)['"]/);
      for (const match of source.matchAll(/@text\(([^)]*)\)/g)) expect(match[1]).toMatch(/max:\s*\d+/);
    }
    for (const query of Object.values(SQL_CONTROL_QUERIES)) {
      expect(query.replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(?:DELETE|UPDATE|ALTER|DROP|CREATE TABLE|CREATE PROCEDURE)\b/i);
    }
    expect(SQL_CONTROL_QUERIES.acquire).toContain("@LockOwner = 'Transaction'");
    expect(SQL_CONTROL_QUERIES.acquire).toContain('@LockTimeout = 0');
    expect(SQL_CONTROL_QUERIES.insertChunk).toContain("HASHBYTES('SHA2_256'");
  });
});
