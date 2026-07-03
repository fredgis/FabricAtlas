import { entity, role, uuid, text, int, date } from '@microsoft/rayfin-core';

/**
 * A Fabric workspace that FabricAtlas has indexed. One row is written per
 * synced workspace; everything else in the catalog hangs off `fabricId`.
 */
@entity()
@role('authenticated', '*')
export class Workspace {
  @uuid() id!: string;
  @text({ max: 100 }) fabricId!: string;
  @text({ max: 200 }) displayName!: string;
  @text({ max: 120, optional: true }) capacity?: string;
  @text({ max: 120, optional: true }) region?: string;
  @int({ optional: true }) itemCount?: number;
  @date({ optional: true }) syncedAt?: Date;
}
