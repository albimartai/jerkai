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

Unified-schema conventions (verified against real ingested history, 2026-07-14):

- **Timezone:** `reading_date` is the device-local calendar day. Health Auto Export sends timestamps as local time with an explicit UTC offset (`yyyy-MM-dd HH:mm:ss ±HHMM`), and the leading date component is stored as-is. It is never derived from UTC, so a reading taken shortly after midnight local time lands on the correct local day. The parser rejects UTC/ISO-8601 date formats outright, so a format change would fail loudly (ingest error + alert) rather than silently shifting evening readings to the next UTC day.
- **Units:** `value` and `unit` are stored exactly as sent, never converted. Weight and lean body mass arrive uniformly in `lb` across all history.
- **Raw data:** `raw_payload` preserves each data point exactly as received. Normalization is always additive, never a replacement, the same principle the dashboard applies by showing raw readings alongside computed trends.

- `npm run migrate` applies pending migrations (uses `DATABASE_URL` from `.env.local`)
- `npm run migrate:create <name>` scaffolds a new migration

## Environments

| Environment | Vercel | Neon branch |
|---|---|---|
| Production (`main`) | jerkai.app | `production` |
| Preview (branches/PRs) | `*.vercel.app` preview URLs | `dev` |

Preview deployments never touch production data.
