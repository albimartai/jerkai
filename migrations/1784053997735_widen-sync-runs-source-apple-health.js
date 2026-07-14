/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Give step_count ('apple_health') its own observability lane: widen the
 * sync_runs source check (same ALTER pattern as the biometric_readings
 * widening in 1783612708597) so the ingest route can log an independent
 * run per source instead of letting step-count failures ride along with
 * the whoop lane.
 *
 * Also documents the Session 5 unified-schema conventions on the columns
 * they govern. Both changes are additive — no rows are touched.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    alter table sync_runs
      drop constraint sync_runs_source_check;
    alter table sync_runs
      add constraint sync_runs_source_check
      check (source in ('whoop', 'fitdays', 'apple_health'));

    comment on column biometric_readings.reading_date is
      'Device-local calendar day (unified-schema convention, 2026-07-14). '
      'Health Auto Export sends local time with an explicit UTC offset; '
      'the leading date component is stored as-is. Never derived from UTC.';
    comment on column biometric_readings.unit is
      'Unit exactly as sent by Health Auto Export, never converted. '
      'Verified 2026-07-14: weight and lean_body_mass arrive uniformly in lb.';
    comment on column biometric_readings.raw_payload is
      'Original Health Auto Export data point exactly as received. '
      'Preserved verbatim; any normalization lives alongside, never replaces it.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    alter table sync_runs
      drop constraint sync_runs_source_check;
    alter table sync_runs
      add constraint sync_runs_source_check
      check (source in ('whoop', 'fitdays'));

    comment on column biometric_readings.reading_date is null;
    comment on column biometric_readings.unit is null;
    comment on column biometric_readings.raw_payload is null;
  `);
};
