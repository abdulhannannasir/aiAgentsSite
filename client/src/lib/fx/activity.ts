/** Characters per second at which the activity waveform reaches full height (a brisk model streams ~100-150). */
export const FULL_ACTIVITY_CPS = 140;

/** Maps streaming throughput to a 0..1 waveform amplitude. */
export function activityLevel(charsPerSecond: number): number {
  if (!Number.isFinite(charsPerSecond) || charsPerSecond <= 0) return 0;
  return Math.min(1, charsPerSecond / FULL_ACTIVITY_CPS);
}

/** Exponential smoothing so the waveform swells and settles instead of jumping between samples. */
export function smoothLevel(previous: number, next: number, weight = 0.5): number {
  return previous * (1 - weight) + next * weight;
}
