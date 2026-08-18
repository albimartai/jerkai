/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Whoop Multi-Tenancy (docs/prd/whoop-multi-tenancy.md, §0/§4/§5): makes
 * whoop_tokens, whoop_workouts, and sync_runs per-user.
 *
 * whoop_tokens: the surrogate id smallint PK (default 1, check (id = 1)) is
 * dropped along with its check constraint (both confirmed live via
 * pg_constraint at authoring time — whoop_tokens_id_check, whoop_tokens_pkey
 * — NFR-82); user_id becomes the primary key itself (AC-WT2/AC-WT5, §0),
 * since a Whoop connection is one-per-user.
 *
 * whoop_workouts: gains user_id (not null once backfilled) but keeps its
 * existing `id text primary key` (Whoop's own globally-unique workout UUID)
 * unchanged — it does not become part of a composite key.
 *
 * sync_runs: gains user_id, but stays NULLABLE — the pre-existing,
 * DO-NOT-EDIT-headered AC-PUE2 lane (tests/integration/ingest.test.ts:375-419)
 * requires writing a sync_runs failure row when resolvePrimaryUserId() itself
 * fails to resolve, the one case with no userId to write (§0). sync_runs
 * carries no constraint that needs dropping (confirmed live — only
 * sync_runs_pkey exists on id; NFR-82).
 *
 * All three backfills resolve PRIMARY_USER_EMAIL the same way
 * lib/primary-user.ts#resolvePrimaryUserId does (NFR-81) — never "the sole
 * row in users," which is unsafe once a second (allowlisted) user may exist
 * (§0) — and only when a table actually holds a pre-existing row to
 * backfill; zero rows (every disposable CI branch, and production before
 * Albert's first Whoop connection) is always a clean no-op, never an abort
 * (AC-WT10/AC-WT11).
 *
 * CORRECTION to NFR-81's own worked example, found at migration-authoring
 * time (per this NFR's own "confirm... at migration-authoring time"
 * discipline): pgm.sql's `{param}` mustache templating does NOT produce a
 * single-quoted string literal for a plain JS string value. Traced against
 * the installed v8.0.4 source
 * (dist/legacy/utils/createTransformer.js + dist/legacy/migrationBuilder.js:598):
 * every plain-string substitution is routed through `literal()`, which
 * migrationBuilder.js binds to `createSchemalize({ shouldQuote: true })` —
 * an IDENTIFIER-quoting function (double quotes), not a value-escaping one.
 * Manually verified: `{primaryUserEmail}` rendered as
 * `email = "someone@example.com"`, which Postgres parses as an identifier
 * and rejects with "column ... does not exist" — not as the intended string
 * comparison. `escapeValue()` (which *does* dollar-quote strings correctly)
 * is dead code for this call path — the ternary's `typeof val === "string"`
 * branch catches every plain string before `escapeValue` is ever reached.
 * pgStringLiteral() below escapes and quotes the value locally and is
 * interpolated directly into the template string instead of being passed
 * through pgm.sql's mapping argument. An unset PRIMARY_USER_EMAIL is treated
 * as '' so the lookup naturally resolves to zero rows instead of a malformed
 * SQL fragment.
 *
 * (Dollar-quoting was tried first and discarded: an EMPTY value collapses
 * `$tag$` + '' + `$tag$` into a literal `$$` in the middle, which collides
 * with the outer `do $$ ... $$` block's own empty-tag delimiter and
 * truncates it — manually reproduced and confirmed against live Postgres.
 * Standard single-quote escaping has no such collision with dollar-quoted
 * blocks and is the traditional, well-understood mechanism here.)
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */

// Safe, injection-proof embedding of a plain string value into raw SQL text.
function pgStringLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

export const up = (pgm) => {
  const primaryUserEmail = pgStringLiteral(process.env.PRIMARY_USER_EMAIL ?? "");

  pgm.sql(
    `
    alter table whoop_tokens add column user_id integer references users (id);

    do $$
    declare
      resolved_count integer;
      target_user_id integer;
    begin
      if exists (select 1 from whoop_tokens) then
        select count(*) into resolved_count from users where email = ${primaryUserEmail};
        if resolved_count <> 1 then
          raise exception 'whoop_tokens migration: PRIMARY_USER_EMAIL resolved to % users (expected exactly 1)', resolved_count;
        end if;
        select id into target_user_id from users where email = ${primaryUserEmail};
        update whoop_tokens set user_id = target_user_id;
      end if;
    end $$;

    alter table whoop_tokens drop constraint whoop_tokens_id_check;
    alter table whoop_tokens drop constraint whoop_tokens_pkey;
    alter table whoop_tokens drop column id;
    alter table whoop_tokens alter column user_id set not null;
    alter table whoop_tokens add primary key (user_id);

    alter table whoop_workouts add column user_id integer references users (id);

    do $$
    declare
      resolved_count integer;
      target_user_id integer;
    begin
      if exists (select 1 from whoop_workouts) then
        select count(*) into resolved_count from users where email = ${primaryUserEmail};
        if resolved_count <> 1 then
          raise exception 'whoop_workouts migration: PRIMARY_USER_EMAIL resolved to % users (expected exactly 1)', resolved_count;
        end if;
        select id into target_user_id from users where email = ${primaryUserEmail};
        update whoop_workouts set user_id = target_user_id;
      end if;
    end $$;

    alter table whoop_workouts alter column user_id set not null;
    create index on whoop_workouts (user_id);

    alter table sync_runs add column user_id integer references users (id);

    do $$
    declare
      resolved_count integer;
      target_user_id integer;
    begin
      if exists (select 1 from sync_runs) then
        select count(*) into resolved_count from users where email = ${primaryUserEmail};
        if resolved_count <> 1 then
          raise exception 'sync_runs migration: PRIMARY_USER_EMAIL resolved to % users (expected exactly 1)', resolved_count;
        end if;
        select id into target_user_id from users where email = ${primaryUserEmail};
        update sync_runs set user_id = target_user_id;
      end if;
    end $$;

    create index on sync_runs (user_id);
  `,
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    drop index sync_runs_user_id_idx;
    alter table sync_runs drop column user_id;

    drop index whoop_workouts_user_id_idx;
    alter table whoop_workouts drop column user_id;

    alter table whoop_tokens drop constraint whoop_tokens_pkey;
    alter table whoop_tokens add column id smallint;
    update whoop_tokens set id = 1;
    alter table whoop_tokens alter column id set not null;
    alter table whoop_tokens add constraint whoop_tokens_id_check check (id = 1);
    alter table whoop_tokens add primary key (id);
    alter table whoop_tokens drop column user_id;
  `);
};
