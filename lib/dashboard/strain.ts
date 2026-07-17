// Day Strain strip domain (AC-D11, NFR-4): Whoop scores day strain on a
// fixed 0–21 scale, and the strip renders on that scale regardless of what
// range the loaded window happens to span — a light week must not stretch to
// fill the strip.

export const STRAIN_DOMAIN = { min: 0, max: 21 } as const;

// Where the strip's data comes from (NFR-4): the Whoop cycle-strain rows
// written by lib/whoop-map.ts, never the workout log. (The PRD's NFR-4 says
// metric='strain'; the metric the Whoop sync actually writes is 'day_strain'
// — see mapWhoopData — so that is the name used here.)
export const DAY_STRAIN_METRIC = { source: "whoop", metric: "day_strain" } as const;

// Position of a strain value on the fixed domain, as a 0–1 fraction for
// rendering. Out-of-range values clamp; the domain never rescales.
export function strainFraction(value: number): number {
  const clamped = Math.min(STRAIN_DOMAIN.max, Math.max(STRAIN_DOMAIN.min, value));
  return (clamped - STRAIN_DOMAIN.min) / (STRAIN_DOMAIN.max - STRAIN_DOMAIN.min);
}
