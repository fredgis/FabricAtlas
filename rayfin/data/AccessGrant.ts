import { entity, role, uuid, text, set } from '@microsoft/rayfin-core';

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
@role('authenticated', '*')
export class AccessGrant {
  @uuid() id!: string;
  @uuid() workspace_id!: string;
  @text({ max: 100, optional: true }) itemFabricId?: string;
  @text({ max: 150 }) principalRef!: string;
  @set('owner', 'edit', 'view', 'none') accessLevel!: AccessLevel;
  @set('workspaceRole', 'directShare', 'group', 'orgLink', 'itemOwner')
  source!: AccessSource;
  @text({ max: 60, optional: true }) roleName?: string;
  @text({ max: 80, optional: true }) flag?: string;
}
