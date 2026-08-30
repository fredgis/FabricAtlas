import { entity, authenticated, uuid, text, set } from '@microsoft/rayfin-core';
import { SYNC_WRITER_EMAIL } from './sync-policy.js';

export type AccessLevel = 'owner' | 'edit' | 'view' | 'none';
export type AccessSource =
  | 'workspaceRole'
  | 'directShare'
  | 'group'
  | 'orgLink'
  | 'itemOwner';

/**
 * The effective access a principal has, either at the workspace level
 * (`itemFabricId` empty) or on a specific item. `source` records where the
 * access comes from so the object-level view can explain "how they got it".
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
export class AccessGrant {
  @uuid() id!: string;
  @uuid() workspace_id!: string;
  @uuid({ optional: true }) snapshotId?: string;
  @text({ max: 160, optional: true }) writerEmail?: string;
  @text({ max: 100, optional: true }) itemFabricId?: string;
  @text({ max: 150 }) principalRef!: string;
  @set('owner', 'edit', 'view', 'none') accessLevel!: AccessLevel;
  @set('workspaceRole', 'directShare', 'group', 'orgLink', 'itemOwner')
  source!: AccessSource;
  @text({ max: 60, optional: true }) roleName?: string;
  @text({ max: 80, optional: true }) flag?: string;
}
