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

- `npm run migrate` applies pending migrations (uses `DATABASE_URL` from `.env.local`)
- `npm run migrate:create <name>` scaffolds a new migration

## Environments

| Environment | Vercel | Neon branch |
|---|---|---|
| Production (`main`) | jerkai.app | `production` |
| Preview (branches/PRs) | `*.vercel.app` preview URLs | `dev` |

Preview deployments never touch production data.
