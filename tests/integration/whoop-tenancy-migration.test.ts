import path from "node:path";

import { neon } from "@neondatabase/serverless";
import { runner } from "node-pg-migrate";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// AC-WT10/AC-WT11's migration-safety harness — the same isolated-schema
// pattern tests/integration/multi-user-migration.test.ts established for
// AC-MU8/AC-MU9 (PRD §1, §6). CI's migrate:ci step already fully migrates the
// `public` schema — including this slice's own user_id retrofit migration —
// before any integration test file runs (.github/workflows/ci.yml), so
// reconstructing pre-migration state against `public` is impossible. This
// harness instead builds every table up to but excluding this migration
// inside a dedicated schema on the same DATABASE_URL, fresh per case (never
// shared — node-pg-migrate records a migration as applied in that schema's
// own tracking table on first success, so reusing one schema/tracking-table
// instance across cases would make every case after the first a silent no-op).

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const CI_DATABASE = "jerkai_ci_test";
const sql = neon(DATABASE_URL || "postgresql://unset:unset@unset/unset"); //gitleaks:allow — non-secret placeholder, same pattern as every other integration test file

const SCHEMA = "whoop_tenancy_premigration_test";
const MIGRATIONS_TABLE = "pgmigrations_whoop_tenancy_test";
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations");

// The current high-water mark before this slice's own migration file lands
// (§1; §8 OQ-1 defaults to one migration file covering whoop_tokens,
// whoop_workouts, and sync_runs).
const LAST_PRIOR_MIGRATION_TIMESTAMP = 1786637399180;

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
  vi.unstubAllEnvs();
});

// Builds every table up to (but excluding) this slice's migration, fresh,
// inside the isolated schema — a real node-pg-migrate run, not a hand-rolled
// schema copy.
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
// gives it. `timestamp: false` is explicit — see multi-user-migration.test.ts's
// own note on the `{ ...options, count: 1 }` footgun this avoids.
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
 * PRD Target: JerkAI — Build PRD: Whoop Multi-Tenancy
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("whoop_tokens/sync_runs migration — AC-WT10/AC-WT11 (isolated whoop_tenancy_premigration_test schema)", () => {
  it("AC-WT10: whoop_tokens migration is a clean no-op (schema change lands, no PRIMARY_USER_EMAIL resolution required) when whoop_tokens holds zero rows", async () => {
    await buildPreMigrationSchema();

    await runThisMigration();

    const columns = await tableColumnNames("whoop_tokens");
    expect(columns).toContain("user_id");
    expect(await rowCount("whoop_tokens")).toBe(0);
  });

  it("AC-WT10: backfills the sole pre-existing whoop_tokens row to PRIMARY_USER_EMAIL's resolved user_id, not to 'the sole row in users'", async () => {
    await buildPreMigrationSchema();
    const primaryEmail = "wt10-primary@example.com";
    await sql.query(`insert into ${SCHEMA}.users (email) values ($1)`, [primaryEmail]);
    // A second, non-primary user already exists — proves the backfill target
    // is PRIMARY_USER_EMAIL's resolved row, not merely "whichever row exists
    // in users" (§0's dedicated decision, the exact mistake this PRD exists
    // to prevent — see §7).
    await sql.query(`insert into ${SCHEMA}.users (email) values ($1)`, [
      "wt10-someone-else@example.com",
    ]);
    await sql.query(
      `insert into ${SCHEMA}.whoop_tokens (id, access_token_enc, refresh_token_enc, expires_at, scope)
       values (1, 'enc-access', 'enc-refresh', now() + interval '1 hour', null)`,
    );
    vi.stubEnv("PRIMARY_USER_EMAIL", primaryEmail);

    await runThisMigration();

    const primaryUser = (await sql.query(`select id from ${SCHEMA}.users where email = $1`, [
      primaryEmail,
    ])) as { id: number }[];
    const rows = (await sql.query(`select user_id from ${SCHEMA}.whoop_tokens`)) as {
      user_id: number;
    }[];
    expect(rows).toEqual([{ user_id: primaryUser[0].id }]);
  });

  it("AC-WT10: aborts without modifying whoop_tokens when a pre-existing row exists but PRIMARY_USER_EMAIL is unset", async () => {
    await buildPreMigrationSchema();
    await sql.query(
      `insert into ${SCHEMA}.whoop_tokens (id, access_token_enc, refresh_token_enc, expires_at, scope)
       values (1, 'enc-access', 'enc-refresh', now() + interval '1 hour', null)`,
    );
    vi.stubEnv("PRIMARY_USER_EMAIL", "");

    await expect(runThisMigration()).rejects.toThrow();

    const columns = await tableColumnNames("whoop_tokens");
    expect(columns).not.toContain("user_id");
    expect(await rowCount("whoop_tokens")).toBe(1);
  });

  it("AC-WT11: sync_runs migration is a clean no-op (user_id added, no PRIMARY_USER_EMAIL resolution required) when sync_runs holds zero rows", async () => {
    await buildPreMigrationSchema();

    await runThisMigration();

    const columns = await tableColumnNames("sync_runs");
    expect(columns).toContain("user_id");
    expect(await rowCount("sync_runs")).toBe(0);
  });

  it("AC-WT11: backfills every pre-existing sync_runs row to the same PRIMARY_USER_EMAIL-resolved user_id as AC-WT10, non-null", async () => {
    await buildPreMigrationSchema();
    const primaryEmail = "wt11-primary@example.com";
    await sql.query(`insert into ${SCHEMA}.users (email) values ($1)`, [primaryEmail]);
    await sql.query(
      `insert into ${SCHEMA}.sync_runs (source, status, rows_synced) values ('whoop', 'success', 5)`,
    );
    await sql.query(
      `insert into ${SCHEMA}.sync_runs (source, status, rows_synced) values ('fitdays', 'failure', 0)`,
    );
    vi.stubEnv("PRIMARY_USER_EMAIL", primaryEmail);

    await runThisMigration();

    const primaryUser = (await sql.query(`select id from ${SCHEMA}.users where email = $1`, [
      primaryEmail,
    ])) as { id: number }[];
    const rows = (await sql.query(`select user_id from ${SCHEMA}.sync_runs`)) as {
      user_id: number | null;
    }[];
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.user_id === primaryUser[0].id)).toBe(true);

    const nullRows = (await sql.query(
      `select count(*)::int as count from ${SCHEMA}.sync_runs where user_id is null`,
    )) as { count: number }[];
    expect(nullRows[0].count).toBe(0);
  });

  it("AC-WT11: aborts without modifying sync_runs when pre-existing rows exist but PRIMARY_USER_EMAIL resolves to more than one user", async () => {
    await buildPreMigrationSchema();
    const primaryEmail = "wt11-dupe@example.com";
    await sql.query(`insert into ${SCHEMA}.users (email) values ($1)`, [primaryEmail]);
    await sql.query(`insert into ${SCHEMA}.users (email) values ($1)`, [primaryEmail]);
    await sql.query(
      `insert into ${SCHEMA}.sync_runs (source, status, rows_synced) values ('whoop', 'success', 5)`,
    );
    vi.stubEnv("PRIMARY_USER_EMAIL", primaryEmail);

    await expect(runThisMigration()).rejects.toThrow();

    const columns = await tableColumnNames("sync_runs");
    expect(columns).not.toContain("user_id");
    expect(await rowCount("sync_runs")).toBe(1);
  });
});
