// Short passive trend descriptor for the guardrail strips (AC-D12): the
// latest value against the mean of the trailing week's present values.
// Same passivity rule as the stall badge (AC-D7): direction only, no cause.

const WINDOW_DAYS = 7;
const STEADY_BAND = 0.02; // within ±2% of the week mean reads as steady

export function trendDescriptor(series: readonly (number | null)[]): "steady" | "up" | "down" {
  const present = series.filter((value): value is number => value !== null);
  if (present.length < 2) return "steady";

  const latest = present[present.length - 1];
  const week = present.slice(-WINDOW_DAYS, -1);
  const mean = week.reduce((sum, value) => sum + value, 0) / week.length;
  if (mean === 0) return "steady";

  const ratio = latest / mean - 1;
  if (ratio > STEADY_BAND) return "up";
  if (ratio < -STEADY_BAND) return "down";
  return "steady";
}
