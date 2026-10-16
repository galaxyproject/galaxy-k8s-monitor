export const BRAND_DARK = '#2c3143';
export const BRAND_PRIMARY = '#25537b';
export const BRAND_GOLD = '#ffd700';
export const BRAND_GREY = '#58585a';

// 12-color soft, muted/pastel non-red categorical palette.
// Red and red-adjacent hues are excluded so normal usage never resembles overdraw.
export const POD_GROUP_PALETTE = [
  '#60A3BC', // Clear Water (soft ocean blue)
  '#78C2AD', // Muted Seafoam
  '#A29BFE', // Wild Lavender
  '#E6B86A', // Warm Honey Sand
  '#82CCDD', // Sky Gazing (pastel sky)
  '#88C999', // Soft Sage Green
  '#9BB1FF', // Pastel Periwinkle
  '#5AA9A4', // Muted Teal
  '#C3A6E8', // Dusty Lilac
  '#B8D89A', // Soft Moss
  '#7BA7CC', // Dusty Cornflower
  '#94A7B8'  // Soft Cool Slate
];

// Semantic metric and chart chrome constants (muted to harmonize with pastel series)
export const CPU_CURRENT_COLOR = '#5AA9A4';
export const CPU_PEAK_COLOR = '#60A3BC';
export const CPU_RADAR_COLOR = '#5AA9A4';

export const MEMORY_CURRENT_COLOR = '#7BA7CC';
export const MEMORY_PEAK_COLOR = '#A29BFE';
export const MEMORY_RADAR_COLOR = '#7BA7CC';

export const DISK_DATA_COLOR = '#5AA9A4';
export const DISK_IMAGES_COLOR = '#7BA7CC';
export const DISK_POSTGRES_COLOR = '#A29BFE';
export const DISK_AVAILABLE_COLOR = '#25537b';
export const DISK_PSI_SOME_COLOR = '#E6B86A';
export const DISK_PSI_FULL_COLOR = '#A29BFE';
export const DISK_GC_LINE_COLOR = '#b45309';

export const NETWORK_INGRESS_COLOR = '#5AA9A4';
export const NETWORK_EGRESS_COLOR = '#A29BFE';
export const NETWORK_CONTENTION_COLOR = '#b45309';

export const REQUEST_LINE_COLOR = '#2c3143';
export const ACTIVE_SAMPLE_LINE_COLOR = '#2c3143';
export const CHART_GRID_COLOR = '#dce5ed';
export const CHART_AXIS_COLOR = '#58585a';
export const CHART_SELECTION_FILL = '#60A3BC';

// Reserved strictly for resource overdraw (usage exceeding request) and error alerts
export const OVERDRAW_COLOR = '#dc2626';

export type GroupColorMap = Record<string, string>;

/**
 * Extends an existing group-to-color mapping with any newly discovered pod groups.
 * Existing groups keep their assigned color; unseen groups are appended in sorted order.
 */
export function updateGroupColorMap(
  previousMap: GroupColorMap,
  groups: Iterable<string>
): GroupColorMap {
  const paletteSet = new Set(POD_GROUP_PALETTE);
  const hasStalePaletteColor = Object.values(previousMap).some(color => !paletteSet.has(color));
  const baseMap: GroupColorMap = hasStalePaletteColor ? {} : previousMap;

  const unseen: string[] = [];
  for (const group of groups) {
    if (!(group in baseMap)) {
      unseen.push(group);
    }
  }

  if (unseen.length === 0) {
    return baseMap;
  }

  unseen.sort((left, right) => left.localeCompare(right));
  const nextMap: GroupColorMap = { ...baseMap };
  let nextIndex = Object.keys(nextMap).length;

  for (const group of unseen) {
    nextMap[group] = POD_GROUP_PALETTE[nextIndex % POD_GROUP_PALETTE.length];
    nextIndex += 1;
  }

  return nextMap;
}

export function getGroupColor(
  groupColorMap: GroupColorMap | undefined,
  groupName: string,
  fallbackIndex = 0
): string {
  if (groupColorMap && groupColorMap[groupName]) {
    return groupColorMap[groupName];
  }
  return POD_GROUP_PALETTE[fallbackIndex % POD_GROUP_PALETTE.length];
}
