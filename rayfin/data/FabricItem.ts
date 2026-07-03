import { entity, role, uuid, text, set, date } from '@microsoft/rayfin-core';

export type ItemHealth = 'healthy' | 'stale' | 'failing' | 'unknown';
export type Endorsement = 'none' | 'promoted' | 'certified';

/**
 * A single Fabric item (Lakehouse, Notebook, Pipeline, Semantic model,
 * Report, Warehouse, Eventhouse, Dataflow, ...). Populated by Sync from the
 * Fabric REST APIs; the catalog, map and health views all read from here.
 */
@entity()
@role('authenticated', '*')
export class FabricItem {
  @uuid() id!: string;
  @uuid() workspace_id!: string;
  @text({ max: 100 }) fabricId!: string;
  @text({ max: 200 }) displayName!: string;
  @text({ max: 60 }) itemType!: string;
  @text({ max: 600, optional: true }) description?: string;
  @text({ max: 120, optional: true }) ownerName?: string;
  @text({ max: 150, optional: true }) ownerEmail?: string;
  @set('healthy', 'stale', 'failing', 'unknown') health!: ItemHealth;
  @set('none', 'promoted', 'certified') endorsement!: Endorsement;
  @text({ max: 60, optional: true }) sensitivity?: string;
  @text({ max: 300, optional: true }) tags?: string;
  @date({ optional: true }) lastRefresh?: Date;
  @date({ optional: true }) itemCreatedAt?: Date;
  @date({ optional: true }) itemUpdatedAt?: Date;
}
