# Contributing

JerkAI is a single-user project built in public. This doc records the workflow so every session (human or agent) follows the same rails.

## Branching model — trunk-based

- `main` is always deployable. It is the Vercel Production deployment (jerkai.app) and is backed by the Neon `production` branch.
- All work happens on short-lived feature branches cut from `main`, merged back via PR. No direct pushes to `main` (enforced by the "Protect main" repository ruleset).
- Every non-`main` branch gets a Vercel Preview deployment backed by the Neon `dev` branch. Preview deployments never touch production data.
- Branch names: `<type>/<short-slug>`, e.g. `feat/dashboard-strips`, `fix/step-count-merge`, `docs/project-rails`.

## Commits — Conventional Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<optional scope>): <description>`.

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `perf`.

A commitlint `commit-msg` hook enforces the format locally; the gitleaks `pre-commit` hook scans staged changes for secrets. Both are installed by `npm install` (via husky).

## Issues and PRs

- A feature slice must meet the **Definition of Ready** before work starts, and the **baseline Definition of Done** (plus its PRD's feature-specific DoD) before merge. Both live in [docs/definition-of-ready-and-done.md](docs/definition-of-ready-and-done.md) — the single source for the standard. PRDs and templates reference it and never restate it.
- Use the issue templates (feature request includes the DoR gate; bug report captures repro steps).
- Use the PR template: summary, linked issue, testing done, and the DoD checklist.
- Merging to `main` happens by PR; the ruleset refuses anything else. The current requirements are whatever `gh api repos/albimartai/jerkai/rulesets` prints — see [Repository rules for `main`](#repository-rules-for-main).

## CI

`.github/workflows/ci.yml` runs on every PR and on pushes to `main`: install → lint → typecheck → unit tests (Vitest) → integration tests against a **disposable Neon branch** created per run and always torn down (`scripts/ci/neon-branch.mjs`, via the Neon API).

Rules:

- CI never touches the persistent `dev` or `production` Neon branches, and never the deployed app.
- No real external services in CI: outbound email (Resend) and the Whoop API must be mocked or stubbed in tests — never called for real.
- Required secrets (GitHub Actions → repository secrets): `NEON_API_KEY`, `NEON_PROJECT_ID`.

## Environments and data safety

| Environment | Vercel | Neon branch |
|---|---|---|
| Production (`main`) | jerkai.app | `production` |
| Preview (branches/PRs) | `*.vercel.app` | `dev` |
| CI (per run) | — | disposable branch, created and deleted per run |

Never run migrations or tests against the Neon `production` branch from a dev machine or CI.

## Secret hygiene

- `.env.local` is gitignored and must stay that way. Never commit a secret of any kind.
- The gitleaks pre-commit hook (requires `brew install gitleaks`) is active — keep it working. It reads `.gitleaks.toml`, which extends gitleaks' default ruleset and adds a custom `postgres-connection-string` rule so the Postgres/Neon connection strings this repo handles are caught before they can be committed. `.env.example` is allowlisted as a non-secret fixture.
- On GitHub, **secret scanning** and **push protection** are both enabled. **Non-provider pattern scanning is not enabled**, and is unavailable to a repo owned by a personal account — GitHub will not match a generic Postgres URL for us. That gap is exactly why the local custom rule above exists.

## Repository rules for `main`

`main` is governed by a repository **ruleset**. Direct pushes and force pushes are refused. What exactly is enforced is read from GitHub, not from this file:

```
gh api repos/albimartai/jerkai/rulesets
```

In the UI: repo → Settings → Rules.
