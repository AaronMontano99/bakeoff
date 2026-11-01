/**
 * Data colors. Categorical slots are the dataviz reference palette in its
 * validated order (CVD-checked), stepped per theme in globals.css as --s1..8.
 * A target's color follows its position in config/targets.json, never its
 * rank, so filtering never repaints it. Charts always pair color with a
 * legend or a direct label.
 */
export const SERIES_COUNT = 8;

/** Past eight targets, colors fold to neutral ink and charts lean on labels. */
export function seriesColor(index: number): string {
  return index >= 0 && index < SERIES_COUNT ? `var(--s${index + 1})` : 'var(--ink-3)';
}

/** Sequential cheese ramp for magnitude (quality heat cells). --h0..8 are stepped per theme. */
export function rampColor(v: number): { bg: string; fg: string } {
  const i = Math.max(0, Math.min(8, Math.round(v * 8)));
  return { bg: `var(--h${i})`, fg: `var(--hf${i})` };
}
