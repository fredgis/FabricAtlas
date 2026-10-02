import { execSync } from 'node:child_process';
import {
  mssqlControlDriver, resolveSqlControlTarget, SqlControlError,
} from '../rayfin/functions/dist/src/sync/sql-control.js';
import { payloadDigest } from '../rayfin/functions/dist/src/sync/sql-payload-store.js';
import { ExecutionDeadline, FabricRestClient } from '../rayfin/functions/dist/src/fabric-rest.js';

const [workspaceId, databaseItemId] = process.argv.slice(2);
const sessions = [];
const token = (resource) => execSync(`az account get-access-token --resource ${resource} --query accessToken -o tsv --only-show-errors`, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

try {
  const rest = new FabricRestClient(token('https://api.fabric.microsoft.com'), {
    deadline: new ExecutionDeadline(30_000), maxAttempts: 2, maxResponseBytes: 64 * 1024,
  });
  const coordinates = await resolveSqlControlTarget({ workspaceId, databaseItemId }, (path) => rest.getObject(path));
  const open = mssqlControlDriver(coordinates, token('https://database.windows.net/'));
  for (let i = 0; i < 2; i++) {
    const session = await open();
    sessions.push(session);
    await session.begin();
  }
  const content = JSON.stringify({ metadata: 'Unicode: \u00e9 \ud83d\ude80' });
  const probe = (await sessions[0].query('probe', { content }))[0];
  const first = (await sessions[0].query('acquire'))[0].code;
  const contended = (await sessions[1].query('acquire'))[0].code;
  await sessions[0].rollback();
  await sessions[0].close();
  sessions[0] = null;
  const afterRollback = (await sessions[1].query('acquire'))[0].code;
  const checksumMatches = probe.checksum === payloadDigest(content);
  console.log(JSON.stringify({
    authoringIdentityOnly: true, persistentWrites: false,
    updateability: probe.updateability, canCreateTable: probe.canCreateTable,
    canCreateProcedure: probe.canCreateProcedure, payloadSchemaPresent: probe.payloadSchemaPresent === 1,
    first, contended, afterRollback, checksumMatches,
    graphActivation: 'blocked-cross-connection-fencing',
  }));
  if (first !== 0 || contended !== -1 || afterRollback !== 0 || !checksumMatches) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof SqlControlError ? error.code : 'SQL_PROBE_UNAVAILABLE');
  process.exitCode = 1;
} finally {
  for (const session of sessions) {
    if (session) {
      await session.rollback().catch(() => {});
      await session.close().catch(() => {});
    }
  }
}
