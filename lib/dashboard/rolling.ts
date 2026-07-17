// Trailing rolling average for the dashboard trend lines (AC-D2, AC-D3).
// Operates on a series already aligned to the shared day axis (see
// series.ts), where null marks a genuine source-side gap (AC-D13).
//
// Raw-data-preserved principle (NFR-1): trends are computed here at render
// time from the raw series; nothing is ever written back.

// Per-slot trailing mean over the last `window` slots, counting only days
// that have a value — so short history (fewer than `window` days, AC-D3) and
// in-window gaps (AC-D13) average over the available days instead of erroring
// or diluting toward zero. A window with no values at all stays a gap.
export function rollingAverage(
  values: readonly (number | null)[],
  window: number,
): (number | null)[] {
  if (!Number.isInteger(window) || window < 1) {
    throw new Error(`rolling window must be a positive integer, got ${window}`);
  }
  return values.map((_, index) => {
    const slice = values.slice(Math.max(0, index - window + 1), index + 1);
    const present = slice.filter((value): value is number => value !== null);
    if (present.length === 0) return null;
    return present.reduce((sum, value) => sum + value, 0) / present.length;
  });
}
