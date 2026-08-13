import path from "node:path";

import { neon } from "@neondatabase/serverless";
import { runner } from "node-pg-migrate";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// AC-MU8/AC-MU9's migration-safety harness (PRD §1, 6th reconcile round). CI's
// `migrate:ci` step already fully migrates the `public` schema — including this
// slice's own user_id retrofit migration — before any integration test file runs
// (.github/workflows/ci.yml:57-63), so reconstructing pre-migration state against
// `public` is impossible. This harness instead builds every table up to but
// excluding this migration inside a dedicated `premigration_test` Postgres schema
// on the same DATABASE_URL, fresh per case (never shared — node-pg-migrate records
// a migration as applied in that schema's own tracking table on first success, so
// reusing one schema/tracking-table instance across cases would make every case
// after the first a silent no-op).

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const CI_DATABASE = "jerkai_ci_test";
const sql = neon(DATABASE_URL || "postgresql://unset:unset@unset/unset"); //gitleaks:allow — non-secret placeholder, same pattern as every other integration test file

const SCHEMA = "premigration_test";
const MIGRATIONS_TABLE = "pgmigrations_test";
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations");

// The immediately-prior migration's timestamp — the current high-water mark
// before this slice's own user_id retrofit migration lands (§1, §8 OQ-2: one
// migration file for all three tables).
const LAST_PRIOR_MIGRATION_TIMESTAMP = 1784588946036;

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
  await sql.query(`drop schema if exists ${SCHEMA} cascade`);
});

afterEach(async () => {
  await sql.query(`drop schema if exists ${SCHEMA} cascade`);
});

// Builds every table up to (but excluding) this slice's migration, fresh, inside
// the isolated schema — a real node-pg-migrate run, not a hand-rolled schema copy.
async function buildPreMigrationSchema(): Promise<void> {
  await runner({
    databaseUrl: DATABASE_URL,
    dir: MIGRATIONS_DIR,
    schema: SCHEMA,
    migrationsSchema: SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
    direction: "up",
    count: LAST_PRIOR_MIGRATION_TIMESTAMP,
    timestamp: true,
    createSchema: true,
    createMigrationsSchema: true,
  });
}

// Runs exactly one pending migration against the schema built above — this
// slice's own user_id retrofit migration, whatever timestamp the build agent
// gives it. `timestamp: false` is explicit: `{ ...options, count: 1 }` alone
// would silently inherit `timestamp: true` from the first call above, making
// `count: 1` target migration-timestamp `1` instead of "run one pending
// migration" (the bug the 6th reconcile round fixed).
async function runThisMigration(): Promise<void> {
  await runner({
    databaseUrl: DATABASE_URL,
    dir: MIGRATIONS_DIR,
    schema: SCHEMA,
    migrationsSchema: SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
    direction: "up",
    count: 1,
    timestamp: false,
  });
}

async function seedUsers(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await sql.query(`insert into ${SCHEMA}.users (email) values ($1)`, [`seed-${i}@example.com`]);
  }
}

async function tableColumnNames(table: string): Promise<string[]> {
  const rows = await sql.query(
    `select column_name from information_schema.columns where table_schema = $1 and table_name = $2`,
    [SCHEMA, table],
  );
  return (rows as { column_name: string }[]).map((row) => row.column_name);
}

async function rowCount(table: string): Promise<number> {
  const rows = (await sql.query(`select count(*)::int as count from ${SCHEMA}.${table}`)) as {
    count: number;
  }[];
  return rows[0].count;
}

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Multi-User Data Model Retrofit
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("multi-user data model retrofit migration — AC-MU8/AC-MU9 (isolated premigration_test schema)", () => {
  it("AC-MU8: aborts without modifying biometric_readings, manual_macro_entries, or daily_targets when users holds more than one row", async () => {
    await buildPreMigrationSchema();
    await seedUsers(2);
    await sql.query(
      `insert into ${SCHEMA}.biometric_readings (source, metric, reading_date, value, unit)
       values ('fitdays', 'body_fat_pct', '2026-07-01', 18.3, '%')`,
    );
    await sql.query(
      `insert into ${SCHEMA}.manual_macro_entries (meal_type, entry_date, calories, idempotency_key)
       values ('lunch', '2026-07-01', 500, 'mu8-seed-key')`,
    );
    await sql.query(
      `insert into ${SCHEMA}.daily_targets (effective_date, calories_target, protein_target_g)
       values ('2026-07-01', 2200, 170)`,
    );

    await expect(runThisMigration()).rejects.toThrow();

    for (const table of ["biometric_readings", "manual_macro_entries", "daily_targets"]) {
      const columns = await tableColumnNames(table);
      expect(columns).not.toContain("user_id");
    }
    expect(await rowCount("biometric_readings")).toBe(1);
    expect(await rowCount("manual_macro_entries")).toBe(1);
    expect(await rowCount("daily_targets")).toBe(1);
  });

  it("AC-MU9: backfills the sole existing user's rows and enforces user_id not null when users holds exactly one row", async () => {
    await buildPreMigrationSchema();
    await seedUsers(1);
    await sql.query(
      `insert into ${SCHEMA}.biometric_readings (source, metric, reading_date, value, unit)
       values ('fitdays', 'body_fat_pct', '2026-07-01', 18.3, '%')`,
    );
    await sql.query(
      `insert into ${SCHEMA}.manual_macro_entries (meal_type, entry_date, calories, idempotency_key)
       values ('lunch', '2026-07-01', 500, 'mu9-seed-key')`,
    );
    await sql.query(
      `insert into ${SCHEMA}.daily_targets (effective_date, calories_target, protein_target_g)
       values ('2026-07-01', 2200, 170)`,
    );

    await runThisMigration();

    const users = (await sql.query(`select id from ${SCHEMA}.users`)) as { id: number }[];
    expect(users).toHaveLength(1);
    const soleUserId = users[0].id;

    for (const table of ["biometric_readings", "manual_macro_entries", "daily_targets"]) {
      const columns = await tableColumnNames(table);
      expect(columns).toContain("user_id");

      const rows = (await sql.query(`select user_id from ${SCHEMA}.${table}`)) as {
        user_id: number | null;
      }[];
      expect(rows.every((row) => row.user_id === soleUserId)).toBe(true);

      const nullRows = (await sql.query(
        `select count(*)::int as count from ${SCHEMA}.${table} where user_id is null`,
      )) as { count: number }[];
      expect(nullRows[0].count).toBe(0);
    }
  });

  it("AC-MU9: backfills as a no-op and still enforces user_id not null when users holds zero rows (the migrate:ci empty-branch path)", async () => {
    await buildPreMigrationSchema();

    await runThisMigration();

    for (const table of ["biometric_readings", "manual_macro_entries", "daily_targets"]) {
      const columns = await tableColumnNames(table);
      expect(columns).toContain("user_id");
      expect(await rowCount(table)).toBe(0);
    }
  });
});
