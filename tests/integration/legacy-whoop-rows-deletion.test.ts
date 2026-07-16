import { neon } from "@neondatabase/serverless";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// Verifies the Session 9 deletion migration's exact statement (imported from
// the migration file, not re-typed) against real Postgres: it must remove
// every legacy Apple-Health-shaped whoop rhr/hrv row and nothing else — in
// particular, never a Whoop-direct row (raw_payload carries score_state).
// CI also runs the migration itself via migrate:ci before these tests; that
// run happens on an empty database, which proves nothing about scope.
import { DELETION_SQL } from "@/migrations/1784169518986_delete-legacy-hae-whoop-rows.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const CI_DATABASE = "jerkai_ci_test";

const sql = neon(DATABASE_URL || "postgresql://unset:unset@unset/unset");

beforeAll(() => {
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Integration tests need a disposable Neon branch — see scripts/ci/neon-branch.mjs.",
    );
  }
  if (!new URL(DATABASE_URL).pathname.includes(CI_DATABASE)) {
    throw new Error(
      `refusing to run: DATABASE_URL does not point at the '${CI_DATABASE}' database. ` +
        "These tests delete rows between cases and must never target the persistent dev/prod branches.",
    );
  }
});

beforeEach(async () => {
  await sql`delete from biometric_readings`;
});

// Legacy Health Auto Export shape: a single data point, no score_state key.
const LEGACY_PAYLOAD = { date: "2021-05-01 07:30:00 -0500", qty: 50, source: "Whoop" };
// Whoop-direct shape: the full raw API record, always carrying score_state.
const DIRECT_PAYLOAD = { cycle_id: 93845, score_state: "SCORED", score: { resting_heart_rate: 49 } };

const seed = (metric: string, day: string, payload: unknown, source = "whoop") => sql`
  insert into biometric_readings (source, metric, reading_date, value, unit, raw_payload)
  values (${source}, ${metric}, ${day}, 50, 'unit', ${JSON.stringify(payload)}::jsonb)
`;

describe("delete-legacy-hae-whoop-rows migration", () => {
  it("deletes exactly the legacy-shaped whoop rhr/hrv rows and nothing adjacent", async () => {
    // The doomed rows, mirroring Production's 25: pre-calibration and the
    // stray 2026-06-01 not-worn day.
    await seed("rhr", "2021-05-01", LEGACY_PAYLOAD);
    await seed("hrv", "2021-05-01", LEGACY_PAYLOAD);
    await seed("rhr", "2026-06-01", LEGACY_PAYLOAD);
    // Whoop-direct rows for the SAME metrics (one even on the same day as a
    // doomed row's neighbor) — must survive: provenance, not date, decides.
    await seed("rhr", "2021-05-13", DIRECT_PAYLOAD);
    await seed("hrv", "2026-06-02", DIRECT_PAYLOAD);
    // A whoop row outside rhr/hrv with a legacy-shaped payload — the
    // condition is metric-scoped and must not touch it regardless of shape.
    await seed("sleep_duration", "2024-01-25", { totalSleep: 7.4 });
    // Same metric names under a different source (hypothetical) — survive.
    await seed("rhr", "2021-05-01", LEGACY_PAYLOAD, "fitdays");

    await sql.query(DELETION_SQL);

    const remaining = await sql`
      select source, metric, reading_date::text as day from biometric_readings
      order by source, metric, reading_date
    `;
    expect(remaining).toEqual([
      { source: "fitdays", metric: "rhr", day: "2021-05-01" },
      { source: "whoop", metric: "hrv", day: "2026-06-02" },
      { source: "whoop", metric: "rhr", day: "2021-05-13" },
      { source: "whoop", metric: "sleep_duration", day: "2024-01-25" },
    ]);
  });

  it("is a no-op when only Whoop-direct rows exist (the post-migration steady state)", async () => {
    await seed("rhr", "2026-07-15", DIRECT_PAYLOAD);
    await seed("hrv", "2026-07-15", DIRECT_PAYLOAD);
    await sql.query(DELETION_SQL);
    expect(await sql`select count(*)::int as n from biometric_readings`).toEqual([{ n: 2 }]);
  });
});
