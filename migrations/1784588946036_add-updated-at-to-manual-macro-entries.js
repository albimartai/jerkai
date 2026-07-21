/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Edit & Delete Meal (docs/prd/edit-delete-meal.md): manual_macro_entries is no longer
 * insert-only — this slice adds in-place edit and hard-delete (DL-2026-07-20-b1/b2),
 * superseding the "never updated or deleted" framing from the Log Meal migration.
 * updated_at is bumped by the application on every in-place UPDATE; it is left at its
 * insert-time default for rows that have never been edited, so created_at stays the
 * honest "first logged" timestamp (AC-M18).
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    alter table manual_macro_entries
      add column updated_at timestamptz not null default now();
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    alter table manual_macro_entries drop column updated_at;
  `);
};
