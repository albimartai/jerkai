// Shared day axis (NFR-2, AC-D8) and missing-day handling (AC-D13, NFR-8).
// Every strip aligns its values onto one axis of device-local calendar days
// so the crosshair maps a cursor position to the same date everywhere; a day
// without a value is a null gap, never a zero or a fabricated value.

// Date-only arithmetic in UTC on purpose: reading_date keys are calendar
// days with no time component, so treating them as UTC noon-less instants
// keeps day math free of DST wobble — no local-timezone conversion ever
// touches the keys themselves.
function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Inclusive run of `windowDays` calendar days ending at `endDay` — the one
// axis every strip (and the hover-scrub) shares.
export function dayAxis(endDay: string, windowDays: number): string[] {
  return Array.from({ length: windowDays }, (_, i) => addDays(endDay, i - (windowDays - 1)));
}

// Places dated values onto their axis slots. Days absent from `valuesByDay`
// become null gaps (AC-D13); values dated outside the axis are dropped, not
// smeared onto a neighboring day.
export function alignSeries(
  axis: readonly string[],
  valuesByDay: ReadonlyMap<string, number>,
): (number | null)[] {
  return axis.map((day) => valuesByDay.get(day) ?? null);
}
