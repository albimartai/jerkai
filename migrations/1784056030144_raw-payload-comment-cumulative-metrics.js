/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Refresh the raw_payload column doc for the step_count aggregation fix:
 * cumulative metrics now store every contributing sample ({points: [...]})
 * instead of a single data point, because HealthKit reports step_count as
 * many interval samples per day and Health Auto Export's "Since Last Sync"
 * splits a day across calls. Metadata-only — no schema or row changes.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    comment on column biometric_readings.raw_payload is
      'Original Health Auto Export data exactly as received. Single-measurement '
      'metrics store their one data point verbatim; cumulative metrics '
      '(step_count) store {points: [...]} with every contributing sample '
      'verbatim, merged by sample timestamp across syncs. value is the sum '
      'over the merged samples for cumulative metrics. Raw data is preserved; '
      'any normalization lives alongside, never replaces it.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    comment on column biometric_readings.raw_payload is
      'Original Health Auto Export data point exactly as received. '
      'Preserved verbatim; any normalization lives alongside, never replaces it.';
  `);
};
