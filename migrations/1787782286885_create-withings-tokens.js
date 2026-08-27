/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Withings Smart-Scale Integration (§0/NFR-98/NFR-106):
 *
 * withings_tokens — encrypted-at-rest OAuth access/refresh tokens, created
 * directly in the post-multi-tenancy shape: user_id is the primary key
 * itself (no surrogate id, no singleton phase). Unlike whoop_tokens, which
 * started single-user (id smallint primary key default 1) and needed a
 * later retrofit migration (1787083550593_whoop-multi-tenancy.js), there is
 * no pre-existing Withings data to migrate away from — this table is
 * created once, correctly, from the start. Column shape otherwise mirrors
 * whoop_tokens column-for-column (1784135751252_create-whoop-tokens-and-workouts.js).
 *
 * No withings_workouts-shaped second table: Withings body-composition
 * readings are daily scalars, at most one meaningfully "current" value per
 * metric per day — exactly like Fitdays' shape — so they land directly in
 * biometric_readings, no new table needed (NFR-106).
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    create table withings_tokens (
      user_id integer primary key references users(id),
      access_token_enc text not null,
      refresh_token_enc text not null,
      expires_at timestamptz not null,
      scope text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    drop table withings_tokens;
  `);
};
