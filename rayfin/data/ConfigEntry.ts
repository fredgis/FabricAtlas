import { entity, role, uuid, text } from '@microsoft/rayfin-core';

/**
 * One key/value configuration fact about an item (definition parts, settings,
 * schedules, connection info, parameters, ...). Stored flat so the Config view
 * can render an exhaustive, groupable, expand/collapse tree per item.
 */
@entity()
@role('authenticated', '*')
export class ConfigEntry {
  @uuid() id!: string;
  @uuid() workspace_id!: string;
  @text({ max: 100 }) itemFabricId!: string;
  @text({ max: 80 }) section!: string;
  @text({ max: 160 }) label!: string;
  @text({ max: 2000, optional: true }) value?: string;
}
