/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Daily biometric readings from Whoop and Fitdays, one row per source/metric/date.
 * A "tall" shape (rather than one table per source) because the driver-tree panels
 * join metrics across sources on a shared date key.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    create table biometric_readings (
      id bigserial primary key,
      source text not null check (source in ('whoop', 'fitdays')),
      metric text not null,          -- 'recovery_score', 'hrv', 'rhr', 'sleep_performance',
                                     -- 'strain', 'weight', 'body_fat_pct', 'bmi', 'muscle_mass_lb'
      reading_date date not null,
      value numeric not null,
      unit text,
      raw_payload jsonb,
      synced_at timestamptz not null default now(),
      unique (source, metric, reading_date)
    );
    create index on biometric_readings (reading_date);
    create index on biometric_readings (source, metric, reading_date);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`drop table biometric_readings;`);
};
