/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Multi-User Data Model Retrofit (docs/prd/multi-user-data-model-retrofit.md): adds user_id
 * to biometric_readings, manual_macro_entries, and daily_targets, backfills Albert's existing
 * rows onto his own users row, and widens biometric_readings' uniqueness to include user_id.
 *
 * Precondition (NFR-69): more than one row in `users` aborts the whole transaction untouched
 * — refusing to guess an owner among multiple candidates. Zero or one row proceeds (zero rows
 * is every disposable CI branch's starting state, not a failure). The precondition check, the
 * column adds, the backfill, and the constraint widening all run inside one DO block, which is
 * itself one statement inside node-pg-migrate's own transaction — a raised exception rolls
 * back everything, including node-pg-migrate's bookkeeping, so a failed run stays fully
 * re-runnable rather than half-migrated.
 *
 * The dropped unique constraint's name was confirmed live against the dev database via
 * `select conname from pg_constraint where conrelid = 'biometric_readings'::regclass and
 * contype = 'u'` (NFR-72) — it is `biometric_readings_source_metric_reading_date_key`,
 * Postgres's own default name, but that was confirmed rather than assumed.
 *
 * user_id has no ON DELETE rule (OQ-3 default: Postgres's implicit NO ACTION/RESTRICT) — no
 * user-deletion feature exists yet, so no AC exercises cascade behavior.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    do $$
    declare
      existing_user_count integer;
      sole_user_id integer;
    begin
      select count(*) into existing_user_count from users;

      if existing_user_count > 1 then
        raise exception
          'user_id retrofit migration aborted: users holds % rows (expected 0 or 1) — refusing to guess an owner among multiple candidates',
          existing_user_count;
      end if;

      alter table biometric_readings add column user_id integer references users (id);
      alter table manual_macro_entries add column user_id integer references users (id);
      alter table daily_targets add column user_id integer references users (id);

      if existing_user_count = 1 then
        select id into sole_user_id from users limit 1;
        update biometric_readings set user_id = sole_user_id;
        update manual_macro_entries set user_id = sole_user_id;
        update daily_targets set user_id = sole_user_id;
      end if;

      alter table biometric_readings alter column user_id set not null;
      alter table manual_macro_entries alter column user_id set not null;
      alter table daily_targets alter column user_id set not null;

      alter table biometric_readings
        drop constraint biometric_readings_source_metric_reading_date_key;
      alter table biometric_readings
        add constraint biometric_readings_user_id_source_metric_reading_date_key
        unique (user_id, source, metric, reading_date);
    end $$;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    alter table biometric_readings
      drop constraint biometric_readings_user_id_source_metric_reading_date_key;
    alter table biometric_readings
      add constraint biometric_readings_source_metric_reading_date_key
      unique (source, metric, reading_date);

    alter table biometric_readings drop column user_id;
    alter table manual_macro_entries drop column user_id;
    alter table daily_targets drop column user_id;
  `);
};
