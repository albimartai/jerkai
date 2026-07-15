import { neon } from "@neondatabase/serverless";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// Verifies the Session 8 deletion migration's exact statement (imported from
// the migration file, not re-typed) against real Postgres: it must remove
// every apple_health/step_count row and nothing else. CI also runs the
// migration itself via migrate:ci before these tests — this suite exists
// because that run happens on an empty database, which proves nothing about
// scope.
import { DELETION_SQL } from "@/migrations/1784135751879_delete-orphaned-apple-health-step-count.js";

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

const seed = (source: string, metric: string, day: string, value: number) => sql`
  insert into biometric_readings (source, metric, reading_date, value, unit, raw_payload)
  values (${source}, ${metric}, ${day}, ${value}, 'unit', '{}'::jsonb)
`;

describe("delete-orphaned-apple-health-step-count migration", () => {
  it("deletes exactly the apple_health/step_count rows and nothing adjacent", async () => {
    // The doomed rows, mirroring Production's orphans.
    await seed("apple_health", "step_count", "2021-05-01", 12);
    await seed("apple_health", "step_count", "2026-07-14", 1657);
    // Same source, different metric (hypothetical) — must survive.
    await seed("apple_health", "some_future_metric", "2026-07-01", 1);
    // Same metric name under a different source (hypothetical) — must survive.
    await seed("fitdays", "step_count", "2026-07-01", 2);
    // The neighbors the migration must never touch: whoop and fitdays history.
    await seed("whoop", "rhr", "2026-07-01", 51);
    await seed("whoop", "sleep_duration", "2026-07-01", 7.4);
    await seed("fitdays", "body_fat_pct", "2026-07-01", 18.3);

    await sql.query(DELETION_SQL);

    const remaining = await sql`
      select source, metric from biometric_readings order by source, metric
    `;
    expect(remaining).toEqual([
      { source: "apple_health", metric: "some_future_metric" },
      { source: "fitdays", metric: "body_fat_pct" },
      { source: "fitdays", metric: "step_count" },
      { source: "whoop", metric: "rhr" },
      { source: "whoop", metric: "sleep_duration" },
    ]);
  });

  it("is a no-op when no orphaned rows exist (CI's empty-database migration run)", async () => {
    await seed("fitdays", "weight", "2026-07-01", 180);
    await sql.query(DELETION_SQL);
    expect(await sql`select count(*)::int as n from biometric_readings`).toEqual([{ n: 1 }]);
  });
});
