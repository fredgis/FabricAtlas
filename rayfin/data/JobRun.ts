import { entity, role, uuid, text, set, int, date } from '@microsoft/rayfin-core';

export type JobStatus = 'completed' | 'failed' | 'running' | 'cancelled';

/**
 * A run of a refresh / pipeline / notebook job, from the Fabric job history
 * APIs. Drives the Jobs / Health view.
 */
@entity()
@role('authenticated', '*')
export class JobRun {
  @uuid() id!: string;
  @uuid() workspace_id!: string;
  @text({ max: 100 }) itemFabricId!: string;
  @text({ max: 200 }) itemName!: string;
  @text({ max: 60 }) jobType!: string;
  @set('completed', 'failed', 'running', 'cancelled') status!: JobStatus;
  @date({ optional: true }) startedAt?: Date;
  @int({ optional: true }) durationSec?: number;
  @text({ max: 400, optional: true }) message?: string;
}
