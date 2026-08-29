import { entity, authenticated, uuid, text, int, date } from '@microsoft/rayfin-core';

/**
 * A Fabric workspace that Fabric Atlas has indexed. One row is written per
 * synced workspace; everything else in the catalog hangs off `fabricId`.
 */
@entity()
@authenticated('read')
@authenticated('create', {
  policy: (claims, item) => claims.email.eq(item.writerEmail),
})
export class Workspace {
  @uuid() id!: string;
  @uuid({ optional: true }) snapshotId?: string;
  @text({ max: 160, optional: true }) writerEmail?: string;
  @text({ max: 200, optional: true }) deploymentId?: string;
  @text({ max: 100 }) fabricId!: string;
  @text({ max: 200 }) displayName!: string;
  @text({ max: 120, optional: true }) capacity?: string;
  @text({ max: 120, optional: true }) region?: string;
  @int({ optional: true }) itemCount?: number;
  @int({ optional: true }) edgeCount?: number;
  @int({ optional: true }) principalCount?: number;
  @int({ optional: true }) grantCount?: number;
  @int({ optional: true }) jobCount?: number;
  @int({ optional: true }) configCount?: number;
  @int({ optional: true }) schemaEntryCount?: number;
  @date({ optional: true }) syncedAt?: Date;
}
