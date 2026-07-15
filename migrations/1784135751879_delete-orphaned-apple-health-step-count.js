/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Reviewed, deliberate deletion (Session 8, decided 2026-07-15): remove the
 * orphaned apple_health step_count rows — 1,901 rows in Production at review
 * time (2021-05-01 → 2026-07-14).
 *
 * Why deletion, when this project otherwise preserves history: these values
 * are iPhone-only step counts (roughly 5x lower than real activity — a real
 * comparison found 1,657 stored vs 8,930 on Whoop's own app for the same
 * day), step count is permanently out of v1 scope, and NO pipe exists or is
 * planned that could ever correct them: Whoop's API doesn't expose step
 * count, and Apple Health ingestion is Fitdays-only now (the step_count
 * mapping was removed from lib/health-export.ts in the same session, so a
 * stray phone re-export cannot recreate these rows). Unlike the RHR/sleep
 * history — kept, because the Whoop-direct backfill will overwrite it with
 * correct values — this data is actively misleading with no correction path,
 * exactly what an LLM/agent querying "all metrics" must not find.
 *
 * Scope check before running (verified 2026-07-15): nothing references these
 * rows — no foreign keys point at biometric_readings, and no code reads the
 * step_count metric.
 *
 * DELETION_SQL is exported so the integration test exercises the exact
 * statement this migration runs, proving it touches nothing but the
 * (source = 'apple_health', metric = 'step_count') rows.
 */
export const DELETION_SQL = `
  delete from biometric_readings
  where source = 'apple_health' and metric = 'step_count';
`;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(DELETION_SQL);
};

/**
 * @returns {Promise<void> | void}
 */
export const down = () => {
  throw new Error(
    "irreversible: the orphaned step_count rows were deliberately deleted (see up); restore from a Neon point-in-time branch if ever needed",
  );
};
