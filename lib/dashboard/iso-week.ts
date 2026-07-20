// ISO week bucketing (Mon–Sun) for the Weekly Ledger (AC-W1), on the same
// device-local calendar day keys as the rest of the dashboard read path
// (see date-key.ts, series.ts). Date-only arithmetic in UTC on purpose, for
// the same reason as series.ts: reading_date keys have no time component,
// so treating them as UTC noon-less instants keeps day math free of DST
// wobble without ever touching the local-day meaning of the key itself.
import { addDays } from "@/lib/dashboard/series";

// ISO weekday: Monday = 1 ... Sunday = 7 (JS getUTCDay() is Sunday = 0).
function isoWeekday(day: string): number {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

// The Monday that starts `day`'s ISO week.
export function isoWeekStart(day: string): string {
  return addDays(day, -(isoWeekday(day) - 1));
}

// The Sunday that ends `day`'s ISO week.
export function isoWeekEnd(day: string): string {
  return addDays(isoWeekStart(day), 6);
}
