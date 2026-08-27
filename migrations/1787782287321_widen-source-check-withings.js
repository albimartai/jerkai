/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Widen both source-check constraints to accept 'withings' (AC-WS18/AC-WS19,
 * OQ-3: one file for both, since they are independent additive ALTERs with
 * no shared precondition — same drop/add pattern as
 * 1783612708597_widen-source-check-apple-health.js and
 * 1784053997735_widen-sync-runs-source-apple-health.js). Additive only — no
 * pre-existing row is touched.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    alter table biometric_readings
      drop constraint biometric_readings_source_check;
    alter table biometric_readings
      add constraint biometric_readings_source_check
      check (source in ('whoop', 'fitdays', 'apple_health', 'withings'));

    alter table sync_runs
      drop constraint sync_runs_source_check;
    alter table sync_runs
      add constraint sync_runs_source_check
      check (source in ('whoop', 'fitdays', 'apple_health', 'withings'));
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    alter table biometric_readings
      drop constraint biometric_readings_source_check;
    alter table biometric_readings
      add constraint biometric_readings_source_check
      check (source in ('whoop', 'fitdays', 'apple_health'));

    alter table sync_runs
      drop constraint sync_runs_source_check;
    alter table sync_runs
      add constraint sync_runs_source_check
      check (source in ('whoop', 'fitdays', 'apple_health'));
  `);
};
