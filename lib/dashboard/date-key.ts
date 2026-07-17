// Shared date key for the dashboard read path (NFR-2; README timezone
// convention): reading_date is the DEVICE-LOCAL calendar day. This is the
// read-side counterpart of extractReadingDate() in lib/health-export.ts —
// same accepted shapes, but it THROWS instead of returning null, because a
// non-local-day format reaching the dashboard means the convention broke
// upstream and must fail loudly, not render a silently shifted day.

// "yyyy-MM-dd" (bare calendar day) or "yyyy-MM-dd HH:mm:ss ±HHMM" (local
// time with explicit offset) — in both, the leading component IS the local
// day, so a reading just after local midnight keeps its local date. ISO-8601
// "T"/"Z" forms never match: their leading component could be the UTC day.
const LOCAL_DAY_FORMAT = /^(\d{4}-\d{2}-\d{2})( \d{2}:\d{2}:\d{2} [+-]\d{4})?$/;

export function readingDateKey(raw: string): string {
  const day = raw.match(LOCAL_DAY_FORMAT)?.[1];
  if (!day) {
    throw new Error(
      `not a device-local calendar day: ${JSON.stringify(raw)} — ` +
        "expected yyyy-MM-dd or yyyy-MM-dd HH:mm:ss ±HHMM (never UTC/ISO-8601)",
    );
  }
  return day;
}
