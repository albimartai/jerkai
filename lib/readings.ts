import { getSql } from "@/lib/db";
import { mergeDailyPoints, type DailyPoints } from "@/lib/health-export";
import type { ReadingSource } from "@/lib/sources";

// The one write path into biometric_readings, shared by every pipe (Health
// Auto Export ingest, Whoop sync, and the future Whoop historical backfill —
// which is only safe because this upsert is idempotent per
// (source, metric, reading_date)). Moved out of the ingest route in
// Session 8 unchanged.

export type UpsertableReading = {
  source: ReadingSource;
  metric: string;
  readingDate: string; // yyyy-MM-dd, user/device-local calendar day
  value: number;
  unit: string | null;
  aggregation: "latest" | "sum";
  rawPayload: unknown;
};

export async function upsertReading(reading: UpsertableReading): Promise<void> {
  const sql = getSql();

  let { value, rawPayload } = reading;
  if (reading.aggregation === "sum") {
    // Cumulative metric: a day's samples split across incremental sends, so
    // overwriting would drop everything from earlier calls (the bug that
    // corrupted the step_count backfill). Merge with the stored samples by
    // timestamp and recompute the day's total. The read-then-write pair is
    // not atomic, but the only client is a single phone sending sequential
    // requests; a lost race re-heals on the next re-send because merging is
    // idempotent. (No current metric is cumulative — step_count retired in
    // Session 8 — but the machinery stays for the next one.)
    const existing = await sql`
      select raw_payload from biometric_readings
      where source = ${reading.source} and metric = ${reading.metric}
        and reading_date = ${reading.readingDate}
    `;
    const merged = mergeDailyPoints(
      existing[0]?.raw_payload,
      (reading.rawPayload as DailyPoints).points,
    );
    value = merged.total;
    rawPayload = { points: merged.points };
  }

  // Idempotent per (source, metric, date): pipes re-send current days on
  // every scheduled run, and backfills overlap days.
  await sql`
    insert into biometric_readings (source, metric, reading_date, value, unit, raw_payload)
    values (${reading.source}, ${reading.metric}, ${reading.readingDate},
            ${value}, ${reading.unit}, ${JSON.stringify(rawPayload)}::jsonb)
    on conflict (source, metric, reading_date)
    do update set value = excluded.value,
                  unit = excluded.unit,
                  raw_payload = excluded.raw_payload,
                  synced_at = now()
  `;
}
