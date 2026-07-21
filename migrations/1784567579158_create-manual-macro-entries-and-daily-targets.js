/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Log Meal (docs/prd/log-meal.md): the first write path since ingest. manual_macro_entries
 * is what the user typed, exactly (NFR-28: raw-preserved, never mutated by *computation* —
 * totals/colors/TDEE math are always derived downstream, never written back). At the time
 * this migration landed, the app had no correction path at all: edit/delete shipped later
 * as its own fast-follow slice (AC-M7, docs/prd/edit-delete-meal.md), which added the
 * updated_at column and the in-place UPDATE/DELETE paths — see that slice's migration.
 * daily_targets remains insert-only; the app never updates or deletes a row there.
 *
 * daily_targets is effective-dated (DL-pending-3): "changing a target" means inserting a
 * new row with a later effective_date, so which target governed a past day never changes.
 * Resolution ("which target is in force on day X") is a pure lib function
 * (lib/targets.ts#resolveTargetForDate, NFR-30), not a query here.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    create table manual_macro_entries (
      id bigserial primary key,
      meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
      entry_date date not null,
      description text,
      calories numeric not null,
      protein_g numeric,
      carbs_g numeric,
      fat_g numeric,
      idempotency_key text not null unique,
      created_at timestamptz not null default now()
    );
    create index on manual_macro_entries (entry_date);

    create table daily_targets (
      id bigserial primary key,
      effective_date date not null,
      calories_target numeric not null,
      protein_target_g numeric not null,
      carbs_target_g numeric,
      fat_target_g numeric,
      created_at timestamptz not null default now()
    );
    create index on daily_targets (effective_date);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    drop table manual_macro_entries;
    drop table daily_targets;
  `);
};
