import { authenticated, date, entity, int, set, text, uuid } from '@microsoft/rayfin-core';
import { SYNC_WRITER_SUBJECT } from './sync-policy.js';

export type SyncTaskState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

@entity()
@authenticated(['read', 'create', 'update', 'delete'], {
  policy: (claims) => claims.sub.eq(SYNC_WRITER_SUBJECT),
})
export class SyncTask {
  @uuid() id!: string;
  @uuid() workspace_id!: string;
  @uuid() jobId!: string;
  @text({ max: 80, unique: true }) taskKey!: string;
  @set('probe') kind!: 'probe';
  @set('pending', 'running', 'completed', 'failed', 'cancelled')
  state!: SyncTaskState;
  @int() attemptCount!: number;
  // A running checkpoint can only be resumed by its original command; no leases.
  @uuid({ optional: true }) claimRequestId?: string;
  @date() createdAt!: Date;
  @date() updatedAt!: Date;
  @date({ optional: true }) finishedAt?: Date;
  @text({ max: 64, optional: true }) failureCode?: string;
  @text({ max: 240, optional: true }) failureMessage?: string;
}
