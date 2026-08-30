import { entity, authenticated, uuid, text, set, boolean } from '@microsoft/rayfin-core';
import { SYNC_WRITER_EMAIL } from './sync-policy.js';

export type PrincipalKind = 'user' | 'group' | 'servicePrincipal' | 'guest';

/**
 * A user, group, service principal or guest that has access to the workspace
 * or one of its items. Powers the Access views.
 */
@entity()
@authenticated('read')
@authenticated('delete', {
  policy: (claims) => claims.email.eq(SYNC_WRITER_EMAIL),
})
@authenticated('create', {
  policy: (claims, item) =>
    claims.email
      .eq(item.writerEmail)
      .and(claims.email.eq(SYNC_WRITER_EMAIL)),
})
export class Principal {
  @uuid() id!: string;
  @uuid() workspace_id!: string;
  @uuid({ optional: true }) snapshotId?: string;
  @text({ max: 160, optional: true }) writerEmail?: string;
  @text({ max: 150 }) principalId!: string;
  @text({ max: 200 }) displayName!: string;
  @set('user', 'group', 'servicePrincipal', 'guest') kind!: PrincipalKind;
  @text({ max: 150, optional: true }) email?: string;
  @boolean({ default: false }) external!: boolean;
}
