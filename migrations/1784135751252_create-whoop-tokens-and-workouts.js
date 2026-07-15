/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Direct Whoop API integration (Session 8):
 *
 * whoop_tokens — encrypted-at-rest OAuth access/refresh tokens. Exactly one
 * row (single-user app, one Whoop account; id = 1 enforced). The *_enc
 * columns hold AES-256-GCM ciphertext produced by lib/whoop-crypto.ts —
 * plaintext tokens never touch the database.
 *
 * whoop_workouts — per-workout records, keyed by Whoop's own workout id.
 * A separate table rather than biometric_readings because a day can hold
 * several workouts, which the (source, metric, reading_date) one-row-per-day
 * shape cannot represent; day-level strain still lands in biometric_readings
 * as whoop/day_strain. Distinct from the Phase 1.5 `workouts` draft (LLM-
 * parsed Chalk It Pro logs) — Whoop HR-detected activities and deliberately
 * logged training are different datasets that will often describe the same
 * session, so merging them into one table would conflate provenance.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    create table whoop_tokens (
      id smallint primary key default 1 check (id = 1),
      access_token_enc text not null,
      refresh_token_enc text not null,
      expires_at timestamptz not null,
      scope text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table whoop_workouts (
      id text primary key,               -- Whoop's workout id (v2 UUID)
      reading_date date not null,        -- user-local day of workout start
      sport_name text,
      start_time timestamptz not null,
      end_time timestamptz,
      timezone_offset text,              -- '+hh:mm' / '-hh:mm' / 'Z', as sent
      score_state text not null,         -- SCORED / PENDING_SCORE / UNSCORABLE
      strain numeric,                    -- Whoop's 0-21 scale, null until scored
      average_heart_rate numeric,
      max_heart_rate numeric,
      kilojoule numeric,
      raw_payload jsonb not null,
      synced_at timestamptz not null default now()
    );
    create index on whoop_workouts (reading_date);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    drop table whoop_workouts;
    drop table whoop_tokens;
  `);
};
