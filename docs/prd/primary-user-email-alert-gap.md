# JerkAI — Build PRD: Restore `PRIMARY_USER_EMAIL` + Close the Alert-on-Config-Failure Gap

> **Type:** Build PRD (bug fix). Thin and reference-heavy per house convention — derives from the already-confirmed root cause in the incident report, cites code by exact location. **Scope:** (1) restore the missing `PRIMARY_USER_EMAIL` env var in Vercel Production and Preview; (2) fix the actual code-level defect this incident exposed — `resolvePrimaryUserId()` failures in both machine-to-machine routes are swallowed silently instead of triggering the existing sync-failure alert path, which is why 4 days of failures produced zero emails. NOT in this slice: any change to `resolvePrimaryUserId()`'s fail-closed logic itself (correct as designed), any change to the Multi-User Data Model Retrofit (PR #25) that introduced the dependency, any new monitoring system beyond the one that already exists (`sync_runs` + `sendSyncFailureAlert`). **Author:** Albi (product) + Claude (spec + FDE pass). **Purpose:** Self-contained handoff spec for a build session to close a live production incident. **Supersedes:** N/A — first PRD against this defect. **Source artifacts:** `lib/primary-user.ts`, `app/api/whoop/sync/route.ts`, `app/api/ingest/health/route.ts`. **Date:** 2026-08-17

---

## Step 0 — Branch from a fresh `main`

```
git checkout main
git fetch origin --prune
git pull --ff-only
git checkout -b fix/primary-user-email-alert-gap
```

Confirm `git log --oneline -1 main` matches `origin/main` before starting. Do not branch from any leftover local branch.

## 1. Required reading (build agent, before any code)

`CLAUDE.md`, `AGENTS.md`, `docs/context.md`, `docs/definition-of-ready-and-done.md`, this document. Then read the three files this slice depends on, in full: `lib/primary-user.ts` (read-only — see NFR-74; do not modify), `app/api/whoop/sync/route.ts` and `app/api/ingest/health/route.ts` (both modified) — specifically each route's `syncFailed` / `recordRejectedRequest` helper and how every *other* early-failure branch in the same route already calls it. Then read `lib/sync-runs.ts` and `lib/alerts.ts` in full — `recordSyncRun()`'s signature has no user-scoping parameter (the `sync_runs` table carries no `user_id` column), which is what makes it safe to call `syncFailed()`/`recordRejectedRequest()` on the `resolvePrimaryUserId()` failure path without a resolved user id. Also read `lib/auth-callbacks.ts:16-28` (read-only, background context) — confirms the `ALLOWLISTED_EMAILS` mechanism §3 references; the value was independently verified against `.env.local` at falsification time (see §3).

## 2. Problem statement (root cause, already diagnosed — not new investigation)

Since the Multi-User Data Model Retrofit (PR #25, 2026-08-13), both `/api/whoop/sync` and `/api/ingest/health` call `resolvePrimaryUserId()` before doing any work. `PRIMARY_USER_EMAIL` was never added to Vercel Production or Preview — confirmed via `npx vercel env ls production` (absent as of 2026-08-17 — re-run before build; the exact var count is incidental and not load-bearing here), and it's absent from `preview` too. Every invocation of either route since then has 500'd on that first call.

That's one bug. The second, more important one is what happened *after* the throw. In both routes, the catch block around `resolvePrimaryUserId()` is:

```ts
let primaryUserId: number;
try {
  primaryUserId = await resolvePrimaryUserId();
} catch (err) {
  console.error("whoop sync rejected:", err instanceof Error ? err.message : err);
  return Response.json({ error: "server is not configured for whoop sync" }, { status: 500 });
}
```

(`app/api/whoop/sync/route.ts`; `app/api/ingest/health/route.ts` has the identical shape with `"ingest rejected:"`.) This is *one of several* failure branches in these routes that doesn't go through `syncFailed()` / `recordRejectedRequest()` — but it is the one that actually caused the 4-day incident, and the one this slice fixes. Tracing every early-return in both routes: `app/api/whoop/sync/route.ts`'s `isAuthorized()` 401 branch (bad/missing `CRON_SECRET`, lines 44–56) and its invalid-`?start`/`?end` 400 branch (lines 158–164) also return without calling `syncFailed()`; `app/api/ingest/health/route.ts`'s missing-`HEALTH_EXPORT_SHARED_SECRET` 500 branch (lines 54–58 — the block immediately above the one this PRD fixes) also returns without calling `recordRejectedRequest()`. All three share the same silent-config-failure shape this incident exposed. This slice deliberately scopes to the `resolvePrimaryUserId()` branch only, because that is the branch that actually caused the incident; the sibling gaps are real and tracked in OQ-3 rather than silently dropped. Every other early rejection this slice *does* cover — token refresh failure, Whoop API failure — already writes a `sync_runs` failure row and calls `sendSyncFailureAlert()`, which is exactly the mechanism `SYNC_ALERT_EMAIL_TO` exists for. This one branch just logs to `console.error` (which nobody was watching) and returns. That's why the Whoop cron and every Health Auto Export push failed for 4 full days with zero alert emails: the one failure mode most likely to be an unnoticed config problem is the one failure mode this codebase's own alerting doesn't cover.

Restoring the env var fixes the immediate outage. It does not fix the fact that any future config regression in this exact shape (env var typo'd, rotated, or scoped to the wrong Vercel environment) will again fail silently for as long as it takes to notice by hand.

## 3. Objective

1. `PRIMARY_USER_EMAIL` is set in Vercel Production and Preview, matching `.env.local` and the allowlisted address (`albert.martinez.90@gmail.com` — confirmed present in `.env.local`'s `ALLOWLISTED_EMAILS` at falsification time on 2026-08-17 via `lib/auth-callbacks.ts:16-28`'s allowlist mechanism; value not printed here per NFR-75), and both routes resolve it successfully in production.
2. A `resolvePrimaryUserId()` failure in either route is no longer a silent 500 — it records a `sync_runs` failure row and fires the same alert email every other failure mode in these routes already fires, so the next time this class of bug happens, an alert email fires same-day instead of the failure going unnoticed for days.

## 4. Functional Requirements — acceptance criteria

* **AC-PUE1** — Given `PRIMARY_USER_EMAIL` is unset (or resolves to zero/multiple rows) at request time, When `/api/whoop/sync` is invoked with a valid `CRON_SECRET`, Then the route still returns 500, **and** a `sync_runs` row is written for the `whoop` lane with `status: "failure"` and an `errorMessage` containing the underlying reason, **and** `sendSyncFailureAlert` is called once — matching the existing `syncFailed()` contract used by this route's other *alerting* failure branches (token refresh failure, Whoop API pull failure) — not every early-return in the route; see §2 and OQ-3 for the ones that still won't alert after this slice.
* **AC-PUE2** — Given the same precondition, When `/api/ingest/health` is invoked with a valid `x-api-key`, Then the route still returns 500, **and** `sync_runs` failure rows are written for every source in `HEALTH_EXPORT_SOURCES` (matching `recordRejectedRequest`'s existing multi-lane behavior for other rejected-before-mapping cases), **and** `sendSyncFailureAlert` is called once.
* **AC-PUE3** — Given `PRIMARY_USER_EMAIL` **is** correctly configured, When either route runs, Then behavior is byte-for-byte unchanged from today — this slice only changes what happens on the resolve-failure path, nothing on the happy path.
* **AC-PUE4** (ops, not code — tracked here so it isn't lost) — `npx vercel env ls production` and `npx vercel env ls preview` each list a `PRIMARY_USER_EMAIL` variable scoped to that environment (existence/scope check only — this command does not expose values); the *value* is separately confirmed either via `vercel env pull --environment=production` (compare the decrypted line to `albert.martinez.90@gmail.com`) or via the manual spot-check in §6, since a successful real sync against the live route is what actually proves `resolvePrimaryUserId()` resolved the intended row.

## 5. Non-Functional Requirements

* **NFR-73** — Reuse the existing helpers exactly as they are (`syncFailed` in the sync route, `recordRejectedRequest` in the ingest route) — do not introduce a new alerting path or a new `sync_runs` status value. The fix is routing the existing catch block through the existing helper, not new alerting infrastructure. `sync_runs` is not scoped by user (`lib/sync-runs.ts`'s insert has no `user_id` column), so `syncFailed()`/`recordRejectedRequest()` can be called before or without a resolved `primaryUserId` — this is what makes NFR-74 (don't touch `lib/primary-user.ts`) compatible with AC-PUE1/AC-PUE2.
* **NFR-74** — Preserve the fail-closed contract of `resolvePrimaryUserId()` itself unchanged (`lib/primary-user.ts`) — this slice does not touch that file.
* **NFR-75** — No secrets in logs: keep the existing `console.error` line as a second signal, don't remove it, just stop treating it as the *only* signal.
* **NFR-76** — No schema change, no migration.

## 6. Definition of Done (feature-specific)

* [x] `resolvePrimaryUserId()` failures in `/api/whoop/sync` go through `syncFailed()` (AC-PUE1, NFR-73, NFR-75).
* [x] `resolvePrimaryUserId()` failures in `/api/ingest/health` go through `recordRejectedRequest()` (AC-PUE2, NFR-73, NFR-75).
* [x] Happy-path behavior unchanged for both routes, `lib/primary-user.ts` untouched, no schema/migration (NFR-74, NFR-76).
* [ ] Existing happy-path tests in `tests/integration/whoop-sync.test.ts` and `tests/integration/ingest.test.ts` continue to pass unmodified; add one dedicated assertion named for **AC-PUE3** confirming response status/shape for the correctly-configured case is unchanged after the fix.
* [ ] Integration tests added to `tests/integration/whoop-sync.test.ts` and `tests/integration/ingest.test.ts` exercising the unset-`PRIMARY_USER_EMAIL` case defined above (`sync_runs` failure row + alert call), TDD-style — write the test, watch it fail against current code, then implement. The new unset-`PRIMARY_USER_EMAIL` test case must restore the value at the end of the test body (matching the `CRON_SECRET`-unset test's manual `vi.stubEnv(...)` restore in `tests/integration/whoop-sync.test.ts`) — neither file's `afterEach` calls `vi.unstubAllEnvs()`.
* [ ] `PRIMARY_USER_EMAIL` confirmed present (existence/scope) in `npx vercel env ls production` and `preview`, and its value confirmed correct via `vercel env pull` or the manual spot-check below (AC-PUE4) — see deploy plan below; this can happen before, during, or right after the PR merges, but the slice isn't done until it's confirmed.
* [ ] Manual spot-check after both the code deploy and the env var are live: trigger a real Whoop sync (`?start=`/`?end=` against a known-good window) and confirm rows land in Postgres — don't just trust a green response.
* [x] Repo docs: this PRD landed at `docs/prd/primary-user-email-alert-gap.md`; `CLAUDE.md` imports updated per the source-in-vault/snapshot-in-repo pattern.
* [x] `CLAUDE.md`'s import of `docs/prd/multi-user-data-model-retrofit.md` is stale (that slice shipped 2026-08-13 per PR #25) and should have been dropped already per the baseline DoD's "PRD import dropped from `CLAUDE.md` on ship" rule — drop it in this PR's docs commit alongside this slice's own `docs/prd` landing, or open a fast-follow note if genuinely out of scope for this PR.

Plus the baseline DoD (CI green, secret hygiene, merged via PR, PRD import dropped from `CLAUDE.md` on ship) — see [[JerkAI - Definition of Ready & Done]]. This slice has no migration and touches no auth/public surface, so those baseline items are trivially satisfied, not skipped.

## 7. Deploy plan

Two independent actions, do not conflate them:

1. **Env var restore (ops, not part of the PR).** This is a Vercel project-config change, not a code change, and it's the one that actually stops today's outage:
   ```
   npx vercel env add PRIMARY_USER_EMAIL production
   npx vercel env add PRIMARY_USER_EMAIL preview
   ```
   value `albert.martinez.90@gmail.com`. Per this repo's own convention for prod-facing credentials ([[JerkAI - Definition of Ready & Done]], baseline DoD), an agent prepares this command but a human runs it, or runs it only with explicit go-ahead — same rule the prod `DATABASE_URL` gets, applied here because it's still a live production config write. **This can and should happen independently of the code PR below** — don't block restoring service on code review.
   Vercel does not retroactively apply new env vars to an already-running deployment; after adding it to Production, redeploy (`git commit --allow-empty` + push to `main`, or a redeploy from the Vercel dashboard) so the running instance actually picks it up. Confirm existence via `npx vercel env ls production` **and** confirm the value via `vercel env pull --environment=production` (or the manual spot-check in §6) before considering AC-PUE4 done — `env ls` alone only proves a variable named `PRIMARY_USER_EMAIL` exists, not that its value is correct.
2. **Code PR (this slice).** Normal path: branch → TDD the two integration tests → implement → PR → CI green → merge to `main` → Vercel auto-deploys Production from `main`. No migration, so no separate prod-migration step.

## 8. Session ground rules (build agent)

TDD — write each integration test from its AC first, watch it fail, implement to green. AC id in every test name. Short-lived branch per Step 0. PR, never direct to `main`. Conventional Commits (`fix: ...` for the code change). Ask before running the `vercel env add` commands in §7 — that's a production write outside this PR's diff and needs explicit go-ahead separately from code review. Close the session with: summary, DoD status, AC→test map, confirmation the env var is live in both environments, anything verified manually.

## Appendix — Open Questions (outside the §0–§8 convention; not a numbered section)

* **OQ-1** — Should this incident (silent alerting gap surviving 4 days) get a Decision Log / Build Failure Ledger entry once shipped? Plausible candidate for `jerkai-learn` after the PR merges — flag it for the retro rather than deciding it here.
* **OQ-2** — Is `PRIMARY_USER_EMAIL` missing from Preview also worth a guard (e.g., a startup check in a non-prod-only code path), or is "Preview 500s the same way Production did" an acceptable Preview-environment failure mode since Preview never serves the real cron/ingest traffic? Leaning toward "acceptable, no extra code" — Preview's whole point is disposable dev-branch data — but flagging so it's a conscious call, not a gap nobody noticed.
* **OQ-3** — `app/api/whoop/sync/route.ts`'s bad-auth (401) and invalid-window (400) branches, and `app/api/ingest/health/route.ts`'s missing-`HEALTH_EXPORT_SHARED_SECRET` (500) branch, share the exact silent-failure shape this incident exposed (config/input rejection → `console.error` only, no `sync_runs` row, no alert) but are out of scope for this slice. Worth a fast-follow PRD, or worth a conscious "acceptable, no code" call — flagging so it isn't a gap nobody noticed.

---

reconcile: 2026-08-17 — Applied FM-01 (§2 "only failure branch" claim corrected + OQ-3 added + AC-1 clause narrowed), I-literal (§6 DoD now cites NFR-1–NFR-4), FM-07 (§1 required reading extended to `lib/sync-runs.ts`/`lib/alerts.ts`; invariant stated in NFR-1), I-literal (§6 dedup of AC-1/AC-2 tags on the integration-tests bullet), FM-05 (§6 dedicated AC-3 test bullet added), FM-01 (§2 "12 vars" count reworded to non-load-bearing), FM-16 (§6 integration-tests bullet notes required `vi.stubEnv` restore pattern); Overrides: F (no house-rule source found in `CLAUDE.md`/`AGENTS.md`/DoD/Ledger for "new §9 is itself a finding" — declined as a PRD text change, flagged to Albert for confirmation outside this doc).

reconcile: 2026-08-17 (round 2) — Applied FM-03 (AC-4 → AC-PUE4, reworded to separate the existence/scope check `vercel env ls` can actually do from the value confirmation it can't — §4, §6, §7 updated to match), F/FM-04 (§9 renamed to an unnumbered Appendix — resolves round 1's declined Override F: `jerkai-spec` authors §0–§8 only, so a numbered §9 is itself outside convention), FM-01 (AC-1..AC-4 → AC-PUE1..AC-PUE4 and NFR-1..NFR-4 → NFR-73..NFR-76 across §4/§5/§6/§1/§3/§7, after a live repo grep confirmed true jerkai NFR high-water at NFR-72 — restarting at NFR-1/AC-1 would have collided with `lib/primary-user.ts`'s existing NFR-71 citation), I-literal (duplicate AC-3 citation on the §6 happy-path bullet removed, left only on its dedicated test-assertion bullet), FM-01 (§3's "allowlisted address" claim was unverified in round 1 — independently confirmed true at this falsification against `.env.local`'s `ALLOWLISTED_EMAILS`, without printing the value; §1 reading list extended to `lib/auth-callbacks.ts:16-28`), FM-01 (§6 DoD: added a bullet flagging that `CLAUDE.md` still imports the already-shipped `docs/prd/multi-user-data-model-retrofit.md`, which is stale per the baseline DoD's own "PRD import dropped from `CLAUDE.md` on ship" rule — PR #25 shipped 2026-08-13 and never dropped it); F (§1's "three files this slice touches" reworded to distinguish the one read-only file from the two modified ones, avoiding the apparent contradiction with NFR-74). Overrides: none this round — all 4 blocking and 3 non-blocking findings from this round were applied.
