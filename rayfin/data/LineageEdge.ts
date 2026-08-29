import { entity, authenticated, uuid, text, boolean } from '@microsoft/rayfin-core';

/**
 * A directed dependency between two Fabric items (source -> target), derived
 * from Fabric lineage / relations. Drives the Map and Lineage views.
 */
@entity()
@authenticated('read')
@authenticated('create', {
  policy: (claims, item) => claims.email.eq(item.writerEmail),
})
export class LineageEdge {
  @uuid() id!: string;
  @uuid() workspace_id!: string;
  @uuid({ optional: true }) snapshotId?: string;
  @text({ max: 160, optional: true }) writerEmail?: string;
  @text({ max: 100 }) sourceFabricId!: string;
  @text({ max: 100 }) targetFabricId!: string;
  @text({ max: 60 }) relation!: string;
  @boolean({ default: false }) broken!: boolean;
}
