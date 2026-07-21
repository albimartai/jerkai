# JerkAI

A personal, single-user health dashboard. It lands biometric data from disconnected sources (Fitdays smart scale, Whoop, via Apple Health) into one Postgres store and turns a noisy daily body fat reading into a trustworthy trend.

This repo is also a portfolio artifact: it is built in public, with the same secret hygiene and code quality expected of production work. No real biometric data is ever exposed publicly.

## Stack

- **Frontend / API:** Next.js (App Router, TypeScript), React Server Components for data fetching
- **Database:** Neon Postgres (production branch + dev branch)
- **Hosting:** Vercel (Production on `main`, Preview on every other branch), custom domain `jerkai.app`
- **Migrations:** [node-pg-migrate](https://github.com/salsita/node-pg-migrate)
- **Secret hygiene:** `.env.local` gitignored from the first commit, GitHub secret scanning, and a [gitleaks](https://github.com/gitleaks/gitleaks) pre-commit hook via husky

## Local development

```bash
npm install                 # also installs the husky pre-commit hook
cp .env.example .env.local  # fill in the Neon dev-branch connection string
npm run migrate             # apply migrations
npm run seed:dev            # insert a sample reading (dev only)
npm run dev                 # http://localhost:3000
```

The pre-commit hook requires gitleaks on your PATH (`brew install gitleaks`).

## Database

One migration-managed schema, applied to both Neon branches. `biometric_readings` stores one row per source/metric/date in a tall shape, so metrics from different sources join on a shared date key.

Log Meal (`docs/prd/archive/log-meal.md`) added the first write path since ingest, in two tables. `daily_targets` stays insert-only. `manual_macro_entries` gained in-place edit and hard-delete in the Edit & Delete Meal fast-follow (`docs/prd/edit-delete-meal.md`):

- `manual_macro_entries` — one row per logged meal: `meal_type` (breakfast/lunch/dinner/snack), `entry_date`, optional `description`, `calories` (required) plus optional `protein_g`/`carbs_g`/`fat_g`, persisted exactly as typed — the app never estimates or derives a macro. `idempotency_key` is unique, so a retried/double-tapped submit is a no-op rather than a duplicate row. `created_at` is set once, at insert. `updated_at` (added by Edit & Delete Meal, `docs/prd/edit-delete-meal.md`) defaults to the insert-time value and is bumped only when an in-place edit actually changes a value (a no-op save leaves it untouched); a delete is a hard delete of the row, not a tombstone.
- `daily_targets` — effective-dated daily targets (`calories_target` and `protein_target_g` required, `carbs_target_g`/`fat_target_g` optional). Changing a target inserts a new row with a later `effective_date`; existing rows are never updated, so which target governed a past day never changes. "Which target is in force on day X" is resolved by one pure function, `lib/targets.ts#resolveTargetForDate`.

Unified-schema conventions (verified against real ingested history, 2026-07-14):

- **Timezone:** `reading_date` is the device-local calendar day. Health Auto Export sends timestamps as local time with an explicit UTC offset (`yyyy-MM-dd HH:mm:ss ±HHMM`), and the leading date component is stored as-is. It is never derived from UTC, so a reading taken shortly after midnight local time lands on the correct local day. The parser rejects UTC/ISO-8601 date formats outright, so a format change would fail loudly (ingest error + alert) rather than silently shifting evening readings to the next UTC day.
- **Units:** `value` and `unit` are stored exactly as sent, never converted. Weight and lean body mass arrive uniformly in `lb` across all history.
- **Raw data:** `raw_payload` preserves each data point exactly as received. Normalization is always additive, never a replacement, the same principle the dashboard applies by showing raw readings alongside computed trends.
- **Cumulative metrics:** step count arrives as many interval samples per day, split across "Since Last Sync" runs, so its daily `value` is a sum over samples merged by timestamp (`raw_payload` holds every contributing sample under `points`). Merging is idempotent: a full re-send replaces sample-for-sample instead of double-counting, and an incremental batch adds only what it newly carries.

- `npm run migrate` applies pending migrations (uses `DATABASE_URL` from `.env.local`)
- `npm run migrate:create <name>` scaffolds a new migration
- `npm run migrate:prod` applies pending migrations to the production Neon branch — run automatically by the `migrate-production` CI job on every merge to `main` (after tests pass), using the `PRODUCTION_DATABASE_URL` repo secret. Before this existed, migrations reached the dev branch (used by local dev and Preview deployments) but never production, so a merged migration file did not mean production's schema was actually up to date — this is why every migration-adding slice must confirm the CI job went green, not just that the file landed on `main`.

## Environments

| Environment | Vercel | Neon branch |
|---|---|---|
| Production (`main`) | jerkai.app | `production` |
| Preview (branches/PRs) | `*.vercel.app` preview URLs | `dev` |

Preview deployments never touch production data.
