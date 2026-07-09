/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Auth.js (NextAuth) tables, per the official Postgres adapter schema —
 * column names and casing are dictated by @auth/neon-adapter's queries.
 * Sessions are JWT-based, so `sessions` stays empty in practice; it's
 * created anyway to satisfy the full adapter contract. The magic-link
 * flow only touches verification_token and users.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    create table verification_token (
      identifier text not null,
      expires timestamptz not null,
      token text not null,
      primary key (identifier, token)
    );

    create table users (
      id serial primary key,
      name varchar(255),
      email varchar(255),
      "emailVerified" timestamptz,
      image text
    );

    create table accounts (
      id serial primary key,
      "userId" integer not null,
      type varchar(255) not null,
      provider varchar(255) not null,
      "providerAccountId" varchar(255) not null,
      refresh_token text,
      access_token text,
      expires_at bigint,
      id_token text,
      scope text,
      session_state text,
      token_type text
    );

    create table sessions (
      id serial primary key,
      "userId" integer not null,
      expires timestamptz not null,
      "sessionToken" varchar(255) not null
    );
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    drop table sessions;
    drop table accounts;
    drop table users;
    drop table verification_token;
  `);
};
