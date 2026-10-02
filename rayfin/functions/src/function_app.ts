import { UserDataFunctions, type RayfinContext } from '@microsoft/fabric-user-data-functions';
import type { AtlasSchema } from '../../data/schema.js';
import { createPingResult, type PingResult } from './ping.js';
import { SyncOrchestrator } from './sync/orchestrator.js';
import { safeSyncCall, type SyncResponse, type SyncUuidInput } from './sync/protocol.js';

const udf = new UserDataFunctions();

/** Bounded health probe with no secrets, external calls or data writes. */
udf.func('ping', (): PingResult => createPingResult(), []);

udf.func(
  'syncStart',
  async (
    ctx: RayfinContext<AtlasSchema>,
    protocolVersion: 1,
    workspaceId: SyncUuidInput,
    requestId: SyncUuidInput,
  ): Promise<SyncResponse> => safeSyncCall(() =>
    new SyncOrchestrator(ctx.getDataClient()).start({ protocolVersion, workspaceId, requestId })),
  [],
);

udf.func(
  'syncContinue',
  async (
    ctx: RayfinContext<AtlasSchema>,
    protocolVersion: 1,
    workspaceId: SyncUuidInput,
    jobId: SyncUuidInput,
    requestId: SyncUuidInput,
  ): Promise<SyncResponse> => safeSyncCall(() =>
    new SyncOrchestrator(ctx.getDataClient()).continue({ protocolVersion, workspaceId, jobId, requestId })),
  [],
);

udf.func(
  'syncStatus',
  async (
    ctx: RayfinContext<AtlasSchema>,
    protocolVersion: 1,
    workspaceId: SyncUuidInput,
    jobId?: SyncUuidInput,
  ): Promise<SyncResponse> => safeSyncCall(() =>
    new SyncOrchestrator(ctx.getDataClient()).status({ protocolVersion, workspaceId, jobId })),
  [],
);

udf.func(
  'syncCancel',
  async (
    ctx: RayfinContext<AtlasSchema>,
    protocolVersion: 1,
    workspaceId: SyncUuidInput,
    jobId: SyncUuidInput,
    requestId: SyncUuidInput,
  ): Promise<SyncResponse> => safeSyncCall(() =>
    new SyncOrchestrator(ctx.getDataClient()).cancel({ protocolVersion, workspaceId, jobId, requestId })),
  [],
);
