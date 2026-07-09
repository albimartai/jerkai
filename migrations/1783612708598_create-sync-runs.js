/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Pipeline observability: one row per ingest run per source.
 * Backs the /status route (last successful sync per source) and
 * same-day failure alerting.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    create table sync_runs (
      id bigserial primary key,
      source text not null check (source in ('whoop', 'fitdays')),
      started_at timestamptz not null default now(),
      finished_at timestamptz,
      status text not null check (status in ('success', 'failure', 'partial')),
      rows_synced int,
      error_message text
    );
    create index on sync_runs (source, started_at desc);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`drop table sync_runs;`);
};
