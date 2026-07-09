/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Widen the source check to allow 'apple_health' — for metrics not attributable
 * to a single device (e.g. step_count, HealthKit's merged/deduped aggregate
 * rather than a Whoop- or Fitdays-filtered value).
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
      check (source in ('whoop', 'fitdays', 'apple_health'));
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
      check (source in ('whoop', 'fitdays'));
  `);
};
