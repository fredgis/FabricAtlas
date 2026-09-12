import {
  authenticated,
  date,
  entity,
  int,
  set,
  text,
  uuid,
} from '@microsoft/rayfin-core';
import { SYNC_WRITER_SUBJECT } from './sync-policy.js';

export type ItemRelationsBetaRowType = 'manifest' | 'chunk';

@entity()
@authenticated('read')
@authenticated('delete', {
  policy: (claims) => claims.sub.eq(SYNC_WRITER_SUBJECT),
})
@authenticated('create', {
  policy: (claims, item) =>
    claims.email
      .eq(item.writerEmail)
      .and(claims.sub.eq(SYNC_WRITER_SUBJECT)),
})
export class ItemRelationsBetaSnapshot {
  @uuid() id!: string;
  @uuid() workspace_id!: string;
  @uuid() snapshotId!: string;
  @text({ max: 160 }) writerEmail!: string;
  @set('manifest', 'chunk') rowType!: ItemRelationsBetaRowType;
  @int() chunkIndex!: number;
  @int() chunkCount!: number;
  @text({ max: 3500 }) payload!: string;
  @date() collectedAt!: Date;
}
