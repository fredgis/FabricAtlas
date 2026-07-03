import { entity, role, uuid, text, set, int, date } from '@microsoft/rayfin-core';

export type SyncStatus = 'running' | 'completed' | 'failed';

/**
 * An audit record of a Sync run: when the workspace was last read from the
 * Fabric APIs, by whom, and how much was ingested.
 */
@entity()
@role('authenticated', '*')
export class SyncRun {
  @uuid() id!: string;
  @uuid() workspace_id!: string;
  @date() startedAt!: Date;
  @date({ optional: true }) finishedAt?: Date;
  @set('running', 'completed', 'failed') status!: SyncStatus;
  @int({ optional: true }) itemsSynced?: number;
  @text({ max: 160, optional: true }) triggeredBy?: string;
  @text({ max: 500, optional: true }) summary?: string;
}
