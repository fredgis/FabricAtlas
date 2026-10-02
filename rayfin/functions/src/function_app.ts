import {
  AudienceType,
  UserDataFunctions,
  type RayfinContext,
} from '@microsoft/fabric-user-data-functions';
import type { AtlasSchema } from '../../data/schema.js';
import { createPingResult, type PingResult } from './ping.js';
import { SyncOrchestrator } from './sync/orchestrator.js';
import { safeSyncCall, type SyncResponse, type SyncUuidInput } from './sync/protocol.js';
import {
  workspaceCollectCore,
  type WorkspaceCoreEnvelope,
} from './workspace-collector.js';
import {
  workspaceCollectDefinitions,
  type DefinitionItemsInput,
  type DefinitionStageEnvelope,
} from './workspace-definitions.js';
import {
  workspaceCollectItemRelations,
  type ItemRelationsEvidenceEnvelope,
  type ItemRelationsRootItemIdsInput,
} from './workspace-item-relations.js';
import {
  workspaceCollectKqlMetadata,
  type KqlMetadataItemsInput,
  type KqlMetadataStageEnvelope,
} from './workspace-kql-metadata.js';
import {
  workspaceDiscover,
  type WorkspaceDiscoveryResult,
} from './workspace-discovery.js';

const udf = new UserDataFunctions();

/** Bounded health probe with no secrets, external calls or data writes. */
udf.func('ping', (): PingResult => createPingResult(), []);
udf.func(
  'workspaceDiscover',
  async (
    ctx: RayfinContext<AtlasSchema, AudienceType.Fabric>,
  ): Promise<WorkspaceDiscoveryResult> => workspaceDiscover(ctx),
  [],
);

// Read-only dual-run Core collector stage; its envelope is never published as a snapshot.
// A defaulted nullable parameter keeps typegen and runtime binding aligned:
// typed callers pass null explicitly, and an omitted value binds to null.
udf.func(
  'workspaceCollectCore',
  async (
    ctx: RayfinContext<AtlasSchema, AudienceType.Fabric>,
    protocolVersion: 1,
    workspaceId: SyncUuidInput,
    correlationId: SyncUuidInput | null = null,
  ): Promise<WorkspaceCoreEnvelope> =>
    workspaceCollectCore(ctx, protocolVersion, workspaceId, correlationId),
  [],
);

// Read-only dual-run definition stage for an allowlisted item batch; never authoritative.
udf.func(
  'workspaceCollectDefinitions',
  async (
    ctx: RayfinContext<AtlasSchema, AudienceType.Fabric>,
    protocolVersion: 1,
    workspaceId: SyncUuidInput,
    items: DefinitionItemsInput,
    correlationId: SyncUuidInput | null = null,
  ): Promise<DefinitionStageEnvelope> =>
    workspaceCollectDefinitions(ctx, protocolVersion, workspaceId, items, correlationId),
  [],
);

// Read-only Item Relations API (Beta) evidence for a bounded root-item batch; never authoritative.
udf.func(
  'workspaceCollectItemRelations',
  async (
    ctx: RayfinContext<AtlasSchema, AudienceType.Fabric>,
    protocolVersion: 1,
    workspaceId: SyncUuidInput,
    itemIds: ItemRelationsRootItemIdsInput,
    correlationId: SyncUuidInput | null = null,
  ): Promise<ItemRelationsEvidenceEnvelope> =>
    workspaceCollectItemRelations(ctx, protocolVersion, workspaceId, itemIds, correlationId),
  [],
);

// Read-only KQL structural metadata: Fabric REST properties plus the documented getDefinition
// `DatabaseSchema.kql` part. The Kusto data plane stays unused; Rayfin 1.36.2 has no Kusto audience.
udf.func(
  'workspaceCollectKqlMetadata',
  async (
    ctx: RayfinContext<AtlasSchema, AudienceType.Fabric>,
    protocolVersion: 1,
    workspaceId: SyncUuidInput,
    items: KqlMetadataItemsInput,
    correlationId: SyncUuidInput | null = null,
  ): Promise<KqlMetadataStageEnvelope> =>
    workspaceCollectKqlMetadata(ctx, protocolVersion, workspaceId, items, correlationId),
  [],
);

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
