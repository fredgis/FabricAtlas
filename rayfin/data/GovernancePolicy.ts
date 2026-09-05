import { authenticated, date, entity, int, text, uuid } from '@microsoft/rayfin-core';
import { SYNC_WRITER_EMAIL } from './sync-policy.js';

@entity()
@authenticated('read')
@authenticated('create', {
  policy: (claims, item) =>
    claims.email
      .eq(item.writerEmail)
      .and(claims.email.eq(SYNC_WRITER_EMAIL)),
})
@authenticated('update', {
  policy: (claims) => claims.email.eq(SYNC_WRITER_EMAIL),
  include: [
    'documentationTarget',
    'ownershipTarget',
    'sensitivityTarget',
    'accessTarget',
    'lineageTarget',
    'operationsTarget',
    'updatedById',
    'updatedByName',
    'updatedByEmail',
    'updatedAt',
  ],
})
@authenticated('delete', {
  policy: (claims) => claims.email.eq(SYNC_WRITER_EMAIL),
})
export class GovernancePolicy {
  @uuid() id!: string;
  @uuid() workspace_id!: string;
  @text({ max: 100, unique: true }) recordKey!: string;
  @text({ max: 160 }) writerEmail!: string;
  @int() documentationTarget!: number;
  @int() ownershipTarget!: number;
  @int() sensitivityTarget!: number;
  @int() accessTarget!: number;
  @int() lineageTarget!: number;
  @int() operationsTarget!: number;
  @text({ max: 160 }) updatedById!: string;
  @text({ max: 160 }) updatedByName!: string;
  @text({ max: 160 }) updatedByEmail!: string;
  @date() updatedAt!: Date;
}
