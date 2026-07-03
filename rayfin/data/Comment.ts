import { entity, role, uuid, text, date } from '@microsoft/rayfin-core';

/**
 * A team comment thread entry, attached either to the whole workspace
 * (`itemFabricId` empty) or to a specific item. Stored in the Fabric-backed
 * database so notes persist and are shared across the team.
 */
@entity()
@role('authenticated', '*')
export class Comment {
  @uuid() id!: string;
  @uuid() workspace_id!: string;
  @text({ max: 100, optional: true }) itemFabricId?: string;
  @text({ max: 150 }) authorId!: string;
  @text({ max: 160 }) authorName!: string;
  @text({ max: 160, optional: true }) authorEmail?: string;
  @text({ max: 2000 }) body!: string;
  @date() createdAt!: Date;
}
