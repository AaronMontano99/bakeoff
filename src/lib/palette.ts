/**
 * Data colors. Categorical slots are the dataviz reference palette in its
 * validated order (CVD-checked); a target's color follows its position in
 * config/targets.json, never its rank, so filtering never repaints it.
 * Charts always pair color with a legend or a direct label.
 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'] as const;

/** Past eight targets, colors fold to neutral ink and charts lean on labels. */
export function seriesColor(index: number): string {
  return index >= 0 && index < SERIES.length ? SERIES[index]! : '#6f8077';
}

/** Sequential forest ramp for magnitude (quality heat cells). Light -> dark. */
export const FOREST_RAMP = ['#eef6f1', '#d6eadd', '#b6d9c3', '#8fc4a4', '#64aa82', '#3f8e64', '#237a55', '#17603f', '#0f4a30'] as const;

export function rampColor(v: number): { bg: string; fg: string } {
  const i = Math.max(0, Math.min(FOREST_RAMP.length - 1, Math.round(v * (FOREST_RAMP.length - 1))));
  return { bg: FOREST_RAMP[i]!, fg: i >= 5 ? '#ffffff' : '#0e1c15' };
}
