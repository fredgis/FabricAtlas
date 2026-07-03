import { entity, role, uuid, text, set, boolean } from '@microsoft/rayfin-core';

export type PrincipalKind = 'user' | 'group' | 'servicePrincipal' | 'guest';

/**
 * A user, group, service principal or guest that has access to the workspace
 * or one of its items. Powers the Access views.
 */
@entity()
@role('authenticated', '*')
export class Principal {
  @uuid() id!: string;
  @uuid() workspace_id!: string;
  @text({ max: 150 }) principalId!: string;
  @text({ max: 200 }) displayName!: string;
  @set('user', 'group', 'servicePrincipal', 'guest') kind!: PrincipalKind;
  @text({ max: 150, optional: true }) email?: string;
  @boolean({ default: false }) external!: boolean;
}
