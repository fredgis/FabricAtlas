import { AudienceType, type RayfinContext } from '@microsoft/fabric-user-data-functions';
import sql from 'mssql';
import type { AtlasSchema } from '../../../data/schema.js';
import { ExecutionDeadline, FabricRestClient, RequestBudget } from '../fabric-rest.js';
import { requireAtlasSynchronizer } from '../synchronizer-gate.js';
import { uuid } from './graph-protocol.js';

export interface SqlControlTarget {
  workspaceId: string;
  databaseItemId: string;
}
export interface SqlControlCoordinates {
  server: string;
  database: string;
}
export type SqlControlCode =
  | 'SQL_TARGET_REQUIRED' | 'SQL_COORDINATES_INVALID' | 'SQL_AUTHORIZATION_FAILED'
  | 'SQL_LOCK_UNAVAILABLE' | 'SQL_TRANSACTION_UNAVAILABLE' | 'SQL_COMMIT_UNCONFIRMED'
  | 'SQL_GRAPH_FENCING_REQUIRED' | 'SQL_PAYLOAD_INVALID' | 'SQL_PAYLOAD_CONFLICT';
export class SqlControlError extends Error {
  constructor(readonly code: SqlControlCode) {
    super(code);
    this.name = 'SqlControlError';
  }
}

export const SQL_LOCK_RESOURCE = 'atlas:metadata-payload:v1';
export const SQL_CONTROL_QUERIES = {
  acquire: `DECLARE @code int;
EXEC @code = sys.sp_getapplock @Resource = N'${SQL_LOCK_RESOURCE}',
 @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 0, @DbPrincipal = 'public';
SELECT @code AS code;`,
  assert: `SELECT CASE WHEN XACT_STATE() = 1 AND
APPLOCK_MODE('public', N'${SQL_LOCK_RESOURCE}', 'Transaction') = 'Exclusive'
THEN 1 ELSE 0 END AS held;`,
  manifest: `SELECT id, taskId, checkpointId, schemaId, checksumVersion, contentHash, byteCount, chunkCount
FROM dbo.SyncPayloadManifests WHERE id = @id;`,
  chunks: `SELECT TOP (293) id, payloadId, ordinal, content, contentHash
FROM dbo.SyncPayloadChunks WHERE payloadId = @payloadId ORDER BY ordinal;`,
  insertChunk: `IF LOWER(CONVERT(varchar(64), HASHBYTES('SHA2_256', CONVERT(varbinary(max), @content)), 2)) <> @contentHash
THROW 51000, 'PAYLOAD_CHECKSUM_INVALID', 1;
INSERT INTO dbo.SyncPayloadChunks (id, payloadId, ordinal, content, contentHash)
VALUES (@id, @payloadId, @ordinal, @content, @contentHash);`,
  insertManifest: `INSERT INTO dbo.SyncPayloadManifests
(id, taskId, checkpointId, schemaId, checksumVersion, contentHash, byteCount, chunkCount)
VALUES (@id, @taskId, @checkpointId, @schemaId, @checksumVersion, @contentHash, @byteCount, @chunkCount);`,
  probe: `SELECT
CONVERT(nvarchar(20), DATABASEPROPERTYEX(DB_NAME(), 'Updateability')) AS updateability,
HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE') AS canCreateTable,
HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE PROCEDURE') AS canCreateProcedure,
CASE WHEN OBJECT_ID('dbo.SyncPayloadManifests', 'U') IS NOT NULL
AND OBJECT_ID('dbo.SyncPayloadChunks', 'U') IS NOT NULL THEN 1 ELSE 0 END AS payloadSchemaPresent,
LOWER(CONVERT(varchar(64), HASHBYTES('SHA2_256', CONVERT(varbinary(max), @content)), 2)) AS checksum;`,
} as const;
export type SqlControlQuery = keyof typeof SQL_CONTROL_QUERIES;
export type SqlParameters = Record<string, string | number | null>;
export type SqlRow = Record<string, unknown>;
export interface SqlControlSession {
  begin(): Promise<void>;
  query(name: SqlControlQuery, parameters?: SqlParameters): Promise<SqlRow[]>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}
export type SqlControlDriver = () => Promise<SqlControlSession>;
export interface LockedSqlPayloadSession {
  query(name: Exclude<SqlControlQuery, 'acquire' | 'assert'>, parameters?: SqlParameters): Promise<SqlRow[]>;
}

/** Only SQL operations on this transaction are serialized. Deliberately does
 * not implement ExternalSerializer: GraphQL writes use different sessions.
 */
export class SqlTransactionBoundary {
  constructor(
    private readonly open: SqlControlDriver,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async transaction<T>(work: (session: LockedSqlPayloadSession) => Promise<T>): Promise<T> {
    let session: SqlControlSession | undefined;
    let active = false;
    let committing = false;
    const deadline = this.now() + 120_000;
    try {
      session = await this.open();
      await session.begin();
      const result = await session.query('acquire');
      if (result.length !== 1 || (result[0].code !== 0 && result[0].code !== 1)) throw new SqlControlError('SQL_LOCK_UNAVAILABLE');
      active = true;
      const assert = async () => {
        if (!active || this.now() >= deadline) throw new SqlControlError('SQL_TRANSACTION_UNAVAILABLE');
        const rows = await session!.query('assert');
        if (rows.length !== 1 || rows[0].held !== 1) throw new SqlControlError('SQL_TRANSACTION_UNAVAILABLE');
      };
      const resultValue = await work({
        query: async (name, parameters) => {
          await assert();
          return session!.query(name, parameters);
        },
      });
      await assert();
      active = false;
      committing = true;
      await session.commit();
      return resultValue;
    } catch (error) {
      active = false;
      try { await session?.rollback(); } catch { /* A lost connection is not permission to resume. */ }
      if (committing) throw new SqlControlError('SQL_COMMIT_UNCONFIRMED');
      if (error instanceof SqlControlError) throw error;
      throw new SqlControlError('SQL_TRANSACTION_UNAVAILABLE');
    } finally {
      active = false;
      try { await session?.close(); } catch { /* No uncertain session is reused. */ }
    }
  }
}

export function sqlCoordinates(value: unknown, target: SqlControlTarget): SqlControlCoordinates {
  if (!value || typeof value !== 'object') throw new SqlControlError('SQL_COORDINATES_INVALID');
  const item = value as { id?: unknown; workspaceId?: unknown; type?: unknown; properties?: Record<string, unknown> };
  if (item.id !== target.databaseItemId || item.workspaceId !== target.workspaceId || item.type !== 'SQLDatabase') {
    throw new SqlControlError('SQL_COORDINATES_INVALID');
  }
  const server = item.properties?.serverFqdn;
  const database = item.properties?.databaseName;
  if (typeof server !== 'string' ||
      !/^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?\.database\.fabric\.microsoft\.com(?:,1433)?$/.test(server) ||
      typeof database !== 'string' || database.length < 1 || database.length > 128 ||
      /[;=\\/"']/.test(database) ||
      [...database].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new SqlControlError('SQL_COORDINATES_INVALID');
  return { server: server.replace(/,1433$/, ''), database };
}

export async function resolveSqlControlTarget(
  target: SqlControlTarget | null,
  get: (path: string) => Promise<unknown>,
): Promise<SqlControlCoordinates> {
  if (!target) throw new SqlControlError('SQL_TARGET_REQUIRED');
  let normalized: SqlControlTarget;
  try { normalized = { workspaceId: uuid(target.workspaceId), databaseItemId: uuid(target.databaseItemId) }; }
  catch { throw new SqlControlError('SQL_TARGET_REQUIRED'); }
  try {
    return sqlCoordinates(await get(`/v1/workspaces/${normalized.workspaceId}/sqlDatabases/${normalized.databaseItemId}`), normalized);
  } catch (error) {
    if (error instanceof SqlControlError) throw error;
    throw new SqlControlError('SQL_COORDINATES_INVALID');
  }
}

export function mssqlControlDriver(coordinates: SqlControlCoordinates, token: string): SqlControlDriver {
  return async () => {
    const pool = new sql.ConnectionPool({
      ...coordinates, port: 1433,
      authentication: { type: 'azure-active-directory-access-token', options: { token } },
      options: { encrypt: true, trustServerCertificate: false, abortTransactionOnError: true },
      connectionTimeout: 15_000, requestTimeout: 10_000,
      pool: { min: 0, max: 1 },
    });
    let failed = false;
    pool.on('error', () => { failed = true; });
    try { await pool.connect(); } catch { await pool.close().catch(() => {}); throw new SqlControlError('SQL_TRANSACTION_UNAVAILABLE'); }
    const transaction = new sql.Transaction(pool);
    transaction.on('rollback', () => { failed = true; });
    return {
      begin: async () => { await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED); },
      query: async (name, parameters = {}) => {
        if (failed) throw new SqlControlError('SQL_TRANSACTION_UNAVAILABLE');
        const request = new sql.Request(transaction);
        for (const [key, value] of Object.entries(parameters)) {
          if (key === 'id' || key === 'payloadId' || key === 'taskId' || key === 'checkpointId') request.input(key, sql.UniqueIdentifier, value);
          else if (typeof value === 'number') request.input(key, sql.Int, value);
          else request.input(key, sql.NVarChar(key === 'content' ? 1800 : key === 'schemaId' ? 80 : 64), value);
        }
        return (await request.query(SQL_CONTROL_QUERIES[name])).recordset ?? [];
      },
      commit: async () => { if (failed) throw new SqlControlError('SQL_TRANSACTION_UNAVAILABLE'); await transaction.commit(); },
      rollback: async () => { await transaction.rollback(); },
      close: async () => { failed = true; await pool.close(); },
    };
  };
}

export type SqlControlContext = RayfinContext<AtlasSchema, AudienceType.Fabric | AudienceType.Sql>;

/** target comes from reviewed server deployment configuration, never Function input. */
export async function createSqlPayloadBoundary(ctx: SqlControlContext, target: SqlControlTarget | null): Promise<SqlTransactionBoundary> {
  if (!target) throw new SqlControlError('SQL_TARGET_REQUIRED');
  try {
    await requireAtlasSynchronizer(ctx.getDataClient(), 'SQL payload store', 'Synchronization authorization failed.');
  } catch { throw new SqlControlError('SQL_AUTHORIZATION_FAILED'); }
  const rest = new FabricRestClient(ctx.Tokens.Fabric, {
    deadline: new ExecutionDeadline(30_000), maxAttempts: 2, maxResponseBytes: 64 * 1024,
  });
  const coordinates = await resolveSqlControlTarget(target, (path) => rest.getObject(path, new RequestBudget(2)));
  return new SqlTransactionBoundary(mssqlControlDriver(coordinates, ctx.Tokens.Sql));
}

export function requireSqlGraphFence(): never {
  throw new SqlControlError('SQL_GRAPH_FENCING_REQUIRED');
}
