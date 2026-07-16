/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Reviewed, deliberate deletion (Session 9, decided 2026-07-15 — PRD: Data
 * Sources → Whoop, 2026-07-15): remove the last rows tagged source = 'whoop'
 * that are NOT Whoop-direct records, restoring the invariant the Session 8
 * backfill established — every whoop row's raw_payload is the full raw Whoop
 * API record.
 *
 * Scoped by PROVENANCE, not by date: a genuine Whoop-direct row's
 * raw_payload always carries a score_state key (verified across all 21k+
 * backfilled rows); the legacy Apple-Health-era rows are single Health Auto
 * Export data points ({date, qty, source?}) and never do. The condition
 * targets exactly "rows that aren't Whoop-direct-shaped" — the actual thing
 * being removed.
 *
 * Confirmed against Production before writing this (2026-07-15), 25 rows:
 *   - 24 rows, 2021-05-01 → 2021-05-12 (12 hrv + 12 rhr): predate Whoop's
 *     own first scored data (~05-12/13, its calibration period), so they are
 *     almost certainly Apple Watch measurements mis-tagged 'whoop' by the
 *     pre-Session-8 ingest assumption. No Whoop-direct row can ever exist
 *     for these dates — no correction path, same class as the step_count
 *     deletion (migration 1784135751879).
 *   - 1 row, rhr 2026-06-01: a HealthKit-era value on a day Whoop has no
 *     scored recovery (device not worn), so the backfill had nothing to
 *     overwrite it with. Genuinely Whoop-derived-via-HealthKit, but kept out
 *     of scope-narrative terms: it is removed for being non-Whoop-direct
 *     provenance in an otherwise uniform timeline, per the provenance
 *     condition above.
 * The dev branch additionally held 3 manual-test artifacts from early local
 * dev-server testing (2026-07-08/09); same condition removes them.
 *
 * The whoop-direct rows (1,829 hrv + 1,829 rhr at review time) all carry
 * score_state and are untouched — pinned by the integration test that runs
 * this exact exported statement.
 */
export const DELETION_SQL = `
  delete from biometric_readings
  where source = 'whoop' and metric in ('rhr', 'hrv')
    and not (raw_payload ? 'score_state');
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
    "irreversible: the legacy Apple-Health-era whoop rhr/hrv rows were deliberately deleted (see up); restore from a Neon point-in-time branch if ever needed",
  );
};
