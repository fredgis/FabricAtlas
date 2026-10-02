import { authenticated, date, entity, set, text, uuid } from '@microsoft/rayfin-core';
import { SYNC_WRITER_SUBJECT } from './sync-policy.js';

export type SyncCommandKind = 'start' | 'continue' | 'cancel';

@entity()
@authenticated(['read', 'create', 'update', 'delete'], {
  policy: (claims) => claims.sub.eq(SYNC_WRITER_SUBJECT),
})
export class SyncCommand {
  @uuid() id!: string;
  @uuid() workspace_id!: string;
  @text({ max: 80, unique: true }) recordKey!: string;
  @uuid() requestId!: string;
  @set('start', 'continue', 'cancel') command!: SyncCommandKind;
  @uuid({ optional: true }) jobId?: string;
  @text({ max: 64 }) inputHash!: string;
  @set('accepted', 'completed', 'failed') state!: 'accepted' | 'completed' | 'failed';
  @date() createdAt!: Date;
  @date({ optional: true }) completedAt?: Date;
  // The intended outcome is checkpointed before work so retries keep the same slice.
  @text({ max: 64, optional: true }) outcomeCode?: string;
}
