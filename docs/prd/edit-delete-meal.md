# JerkAI — Build PRD: Edit & Delete Meal

Type: Build PRD (per-slice handoff spec for one Claude Code build session). Thin and reference-heavy — derives from [[JerkAI - Product Brief]] and cites [[JerkAI - Decision Log]] rather than restating product philosophy. Archive when shipped. Status: Draft — created 2026-07-20 as the first fast-follow after Log Meal shipped. Scope: The correction path deferred from Log Meal (AC-M7). In-place edit and delete of an already-logged meal entry, with every downstream surface recomputing correctly. NOT in this slice: Favorites/Recents quick-add (model 2d), any macro estimation, TDEE math, the Ledger Adherence Column, or any new strip. Author: Acting Director of Product Management (product spec) + Forward Deployed Engineer (non-functional + DoD). Purpose: Self-contained handoff spec for a Claude Code build session. A build agent should be able to work from this doc + the repo context docs without re-reading legacy history. Supersedes: Discharges AC-M7's fast-follow obligation from [[JerkAI - Build PRD - Log Meal]]; all Log Meal ACs (M1–M15) remain in force. Source artifact: the shipped Log Meal surface and `manual_macro_entries` schema. Date: 2026-07-20

## Step 0 — Branch from a fresh main (before writing anything)

Before writing anything, create your working branch from an up-to-date `main`:

```
git checkout main
git fetch origin --prune
git pull --ff-only
git checkout -b feat/edit-delete-meal

```

Do not branch from any existing feature branch, and do not reuse a leftover local branch. Confirm your new branch's base is current — `git log --oneline -1 main` should match `origin/main` — before starting work. (Standing rule, [[JerkAI - Definition of Ready & Done]] "Session start"; DL-2026-07-18-c.)

## 0. Scope & Sequencing Note (read first)

Log Meal shipped the first write path: a structured entry form, effective-dated targets, and the Calories-vs-target strip on `/daily`. It deliberately left out the correction path — AC-M7 held edit/delete as an explicit fast-follow so the first slice stayed thin and carried only its first migration and new surface. This slice closes that gap: it is a mutation-and-recompute slice, adding no new table, no new surface concept, and no new metric — its only schema change is one small additive column (`updated_at`, below). Every hard problem here is downstream fidelity — a corrected entry must move the running daily total, the day's bar on the calories strip, over/under coloring, and scrub readouts to exactly the state they'd hold had the corrected value been the one originally logged.

The design decision that shapes everything (from Log Meal, unchanged): JerkAI stores what the user enters and never invents a number. Edit preserves that — the user retypes values; the app re-persists them exactly as typed. Nothing is derived or estimated on the correction path either.

Schema this slice operates on: `manual_macro_entries` is one row per logged meal — many rows per day by design. There is no unique constraint on `entry_date` (or `entry_date` + anything); the only unique constraint is on `idempotency_key`, and `entry_date` carries a plain (non-unique) index for query performance. The day's total is not a stored column: `fetchDailyCalorieTotals` in `lib/meal-entries.ts` sums across all of a day's rows (matching AC-M1's per-meal chips and AC-M3's running total built from all entries). Consequently edit/delete resolve a single meal by its row `id`, and every recompute in §4.4 is that same summing function re-reading the mutated row set — never a written-back aggregate (NFR-35).

One additive migration (`updated_at`), reconciling shipped schema to the design. The as-shipped `manual_macro_entries` has `created_at` but no `updated_at` column — yet the draft schema in [[JerkAI - Architecture & Data Model]] always specified `updated_at timestamptz not null default now()` alongside `created_at`. The Log Meal migration dropped it (nothing wrote it, since v1 had no mutation path). AC-M18 needs it to record an honest last-modified time. This slice therefore carries one small, additive, non-destructive migration — `ADD COLUMN updated_at timestamptz not null default now()` — which realigns the live schema with its own design doc rather than inventing new scope. Run against the dev/disposable Neon branch only; called out explicitly in the PR per NFR-38 (README schema section is now touched — see NFR-38, changed from the initial "no migration" assumption). The application UPDATE sets `updated_at = now()` on edit (a DB-level trigger is optional and not required; setting it in the write path is sufficient and simpler at this scale).

Decision-log (Albert logged in PM/vault, outside of jerkai repo — all confirmed 2026-07-20, see [[JerkAI - Decision Log]] DL-2026-07-20-b):

* DL-2026-07-20-b1 (hard delete, not soft delete) — A deleted meal entry is removed from `manual_macro_entries`, not tombstoned with a status flag. Rationale: single-user app, no audit/compliance need, and the raw-preserved principle (NFR-1) protects ingested biometric readings, not user-authored manual corrections — a mistyped snack the user chose to delete is not a reading to preserve. `raw_payload`-style provenance does not apply to manual entries. Revisit only if a future undo/history feature is scoped.
* DL-2026-07-20-b2 (edit is a value-mutation, not a delete-and-re-add) — Edit updates the existing row in place (same `id`, `updated_at` bumped), preserving the row's identity and creation time. This directly forbids the delete-and-re-add workaround AC-M7 warned against, and keeps `created_at` honest for any future "when was this first logged" question.
* DL-2026-07-20-b3 (confirm before destroy, not before edit) — Delete requires an explicit confirm step (undo-less destructive action, baseline session rule). Edit does not — a Save on the edit form is itself the confirmation, and an over-confirmed edit flow is friction on the most common correction.

What this slice is NOT: no Favorites/Recents quick-add (model 2d — the schema already supports it; build nothing for it now), no bulk edit/delete, no undo/history/trash, no soft-delete tombstone, no macro estimation, no TDEE math, no changes to targets, the badge, the ledger, or any strip beyond ensuring they recompute from the mutated data.

## 1. Required reading (build agent, before any code)

Read, in order: `CLAUDE.md`, `AGENTS.md`, `docs/context.md`, `docs/prd/archive/log-meal.md` (the shipped predecessor this slice extends — the entry surface, the target resolver, and the calories strip are all the baseline you mutate), this document, `docs/definition-of-ready-and-done.md`, `README.md` (schema truth — this slice makes one additive change, adding `updated_at` to `manual_macro_entries`; confirm the shipped shape before writing and update this section in the same PR, NFR-38). Per `AGENTS.md`, read the relevant Next.js guides in `node_modules/next/dist/docs/` before writing Next.js code; do not assume APIs from training data. The Log Meal form, the single effective-dated target resolver (NFR-30), and the calories strip are the implementation baseline — reuse them; do not fork a parallel edit form.

## 2. Problem statement

Every logged meal is currently permanent. AC-M7 shipped Log Meal with the correction path deliberately absent, on the bet that a wrong entry would be tolerable until the fast-follow. In practice a fat-fingered calorie count or a meal logged to the wrong day now silently poisons the running daily total, the day's over/under state, and the calories strip — the exact surfaces Log Meal exists to make trustworthy — with no way to fix it short of a database edit. Because the future TDEE Engine slice consumes this intake history, an uncorrectable bad row isn't just a display annoyance; it's corrupt training data accruing every day the correction path is missing.

## 3. Objective

Correcting a mistake is as cheap as making the original entry: from the day's logged meals the user can open an entry, change any field (values, meal type, date, description), and Save — or delete it outright behind one confirm — and every downstream surface reflects the corrected state immediately, evaluated against the same effective-dated targets and the same shared axis as everything else. Editing a meal's date re-attributes it across days correctly. Success = a wrong entry is never a reason to distrust the totals or the strip, and the intake dataset the TDEE Engine will inherit is clean.

## 4. Functional Requirements — user-centered acceptance criteria

Written as testable Given/When/Then. "The user" = Albert (single user). AC-M7 is discharged and expanded here; new ids continue AC-M16+.

### 4.1 Reaching a logged entry

* AC-M7 [discharged] — Given a meal has been logged, When the user views the day's logged meals, Then each entry exposes an Edit and a Delete affordance. The Log-Meal-era "a wrong entry stays until the fast-follow" limitation ends with this slice.
* AC-M16 — Given the day's logged meals are listed (below the entry form and/or on a day view), When rendered, Then each row shows enough to identify the entry unambiguously — meal type, kcal, and description if present — so the user edits the right one; the list is phone-usable (AC-M9's standard).

### 4.2 Editing an entry

* AC-M17 — Given the user opens Edit on an entry, When the edit form renders, Then it is pre-populated with that entry's exact stored values (meal type, date, description, kcal/P/C/F) — not blank, not defaulted — reusing the Log Meal form component, not a forked one.
* AC-M18 — Given the user changes any field and Saves, Then the same row is updated in place (same `id`, same `idempotency_key`, `created_at` unchanged, `updated_at` bumped) with the new values persisted exactly as typed — no rounding, no derivation, no delete-and-re-add (DL-2026-07-20-b2, NFR-28's raw-preserved principle applied to the mutation). An edit is an UPDATE, not a new INSERT, so it neither mints nor collides on `idempotency_key`.
* AC-M19 — Given the user edits an entry's date to a different day, When saved, Then the entry detaches from the old day and attaches to the new one: both days' running totals, both days' calories-strip bars, and both days' over/under coloring recompute against each day's effective target (AC-M4/M10 semantics, now on the edit path).
* AC-M20 — Given the user opens Edit but Saves no changes (or cancels), Then the entry is unchanged and no spurious `updated_at` churn or duplicate is created; cancel returns to the list with the original intact.

### 4.3 Deleting an entry

* AC-M21 — Given the user chooses Delete on an entry, Then an explicit confirm step is required before anything is removed (DL-2026-07-20-b3); on confirm the row is hard-deleted from `manual_macro_entries` (DL-2026-07-20-b1); on cancel nothing changes.
* AC-M22 — Given an entry is deleted, Then that day's running total, macro totals, and calories-strip bar recompute from the remaining entries; if it was the day's only entry, the day reverts to a gap — a no-bar gap, not a zero bar (AC-M8's gap ≠ zero distinction holds on the delete path).

### 4.4 Downstream fidelity (the whole point of this slice)

* AC-M23 — Given any edit or delete completes, Then the running daily total + progress-vs-target below the form, the `/daily` calories strip bar and its over/under/neutral coloring, and the hover-scrub readout for the affected day(s) all reflect the post-mutation state with no stale value anywhere and no page-reload required to see it.
* AC-M24 — Given an edit or delete touches a day, Then only genuinely affected surfaces change: unrelated days' bars, the Day Strain strip, the badge, guardrail readouts, and the (future) ledger are unregressed. The five-chart count (AC-M14) and all prior strip behaviors (AC-M15) stay green untouched.

## 5. Non-Functional Requirements (FDE)

Aligned to [[JerkAI - Architecture & Data Model]]. All prior NFRs (1–33) remain in force where applicable; the following are additive, numbered continuing from the Log Meal PRD.

* NFR-34 — Mutation authorization on the write path. Edit and delete resolve the target row by `id` and must confirm the row belongs to the single allowlisted user before mutating — no cross-entry clobber, no delete-by-guessed-id. Even at single-user scale the endpoints fail closed on a missing/unknown id (404, not a silent no-op that reads as success). Integration-tested.
* NFR-35 — Recompute is derived, never written back. Edit/delete change only the stored entry; all totals, colors, and strip bars remain derived downstream at read time (NFR-28 extended to mutations). No denormalized daily-total column is updated in parallel — the single source of truth stays the row set, so an edit cannot leave a cached aggregate disagreeing with the entries.
* NFR-36 — Effective-dated target resolution reused, not reimplemented. The recompute after a date-edit uses the exact same single `lib/` target resolver Log Meal introduced (NFR-30) for "which target governs day X" — the edit path must not grow its own copy of that lookup. One resolver, consumed by form total, strip coloring, and now the edit recompute.
* NFR-37 — No lost updates / safe concurrent-tab semantics. An edit or delete against a stale view (row already changed or deleted in another tab) resolves deterministically — last-write-wins on edit, and a delete of an already-deleted row is idempotent (returns success/absent, not a 500). Integration-tested for the delete-then-delete and edit-then-delete orderings.
* NFR-38 — Repo docs updated in the same PR (NFR-27/NFR-32 pattern). (a) `docs/context.md` — note that logged meals are now editable/deletable if any surface description implies permanence; (b) this PRD lands as `docs/prd/edit-delete-meal.md`, `CLAUDE.md` imports updated, `log-meal.md` archived per convention. `README.md` schema section updated to document the new `manual_macro_entries.updated_at` column (this slice adds one additive migration — the initial "no migration" assumption was corrected once AC-M18 surfaced that the shipped schema lacks `updated_at`; see §0). The [[JerkAI - Architecture & Data Model]] draft already shows `updated_at`, so no draft change is needed — flag in the PR that shipped schema now matches the draft. Same PR, never a follow-up.
* NFR-39 — Test continuity. Existing Vitest + disposable-Neon-branch patterns; AC ids in test names. Required fixtures: the `updated_at` migration applies cleanly from the shipped schema and an edit bumps `updated_at` while leaving `created_at` untouched (AC-M18); exact-as-typed persistence on edit (AC-M18), date-edit re-attribution across two days with different effective targets (AC-M19), no-op save produces no churn (AC-M20), delete reverts a single-entry day to a gap not a zero (AC-M22), delete-then-delete and edit-then-delete idempotency (NFR-37), mutation on an unknown/foreign id fails closed (NFR-34).

## 6. Definition of Done

* [x] Each logged meal exposes Edit and Delete; the day's entries list identifies rows unambiguously and is phone-usable (AC-M7, M16).
* [x] Edit form reuses the Log Meal form, pre-populated with the entry's exact stored values (AC-M17).
* [x] Additive `updated_at` migration applied to `manual_macro_entries` (dev/disposable branch only), realigning shipped schema with the draft (§0); migration proven to apply cleanly from the shipped schema (NFR-39).
* [x] Save updates the same row in place, exactly as typed, no delete-and-re-add, `created_at` preserved / `updated_at` bumped (AC-M18, DL-2026-07-20-b2, NFR-28).
* [x] Editing an entry's date re-attributes it: both old and new days recompute totals, bars, and coloring against each day's effective target (AC-M19, NFR-36).
* [x] No-op edit / cancel leaves the entry and its timestamps untouched (AC-M20).
* [x] Delete requires one confirm, then hard-deletes the row; cancel is a no-op (AC-M21, DL-2026-07-20-b1, DL-2026-07-20-b3).
* [x] Deleting the day's only entry reverts it to a gap, not a zero bar (AC-M22).
* [x] All downstream surfaces (daily total, progress bar, calories strip bar + coloring, scrub readout) reflect the post-mutation state with no reload and no stale value (AC-M23) — via `revalidatePath` + `force-dynamic` on `/daily`, and an explicit re-fetch of the day's entries list on `/log-meal`.
* [x] Unrelated days, Day Strain, badge, guardrails, ledger, and the five-chart count are unregressed; prior AC tests green untouched (AC-M24, M14, M15).
* [x] Mutation endpoints fail closed on unknown/foreign id and confirm ownership (NFR-34); recompute stays derived, no denormalized aggregate written (NFR-35).
* [x] Concurrent/stale-view semantics deterministic: delete idempotent, edit last-write-wins (NFR-37), integration-tested.
* [x] Repo docs updated in the same PR: README schema section documents `manual_macro_entries.updated_at`, context.md, PRD landed at `docs/prd/edit-delete-meal.md`, CLAUDE.md imports, log-meal PRD archived (NFR-38).
* [ ] All NFR-39 fixtures present and green in CI (written TDD-first; awaiting the CI disposable-branch run to confirm green, since local integration runs require Neon API credentials not available in this session).
* [ ] Spot-check: edit a real entry's value and its date, and delete one, verifying totals and strip against hand arithmetic before calling done (performed by the product owner directly against the dev branch, not the build agent — see session close notes).
* [x] DL-2026-07-20-b1/-b2/-b3 recorded in the decision log with final ids (confirmed 2026-07-20).

Plus the baseline DoD (auth, no public data, CI green, responsive, shared date key, secret hygiene, PR-merged) — see [[JerkAI - Definition of Ready & Done]]. Do not restate it here.

Fast-follows (separate slices, not this PRD): Favorites/Recents quick-add (model 2d); undo/trash/history if delete regret proves real in practice (revisit trigger, not built now); free-text LLM estimation (model 2c — still deferred pending an accuracy-tolerance decision).

## 7. Session ground rules (build agent)

Same as prior build sessions, restated for self-containment: TDD — write the test from the AC first, watch it fail, implement to green, refactor; AC id in every test name. Short-lived feature branch per Step 0; PR, never direct to `main`; ask before any push to a shared remote or opening the PR. Neon dev branch only; this slice carries one additive migration (add `updated_at` to `manual_macro_entries`) — run it against the dev/disposable branch only, and ask before running it; if you discover any further migration is needed beyond this one, stop and ask. Secret hygiene: gitleaks pre-commit and secret scanning stay green. Ask before destructive or irreversible actions (note: hard-delete of a user's own manual entry behind an in-app confirm is the feature, not a session-level destructive action needing a separate ask). Conventional Commits in small green increments. Close the session with: summary, DoD checklists, AC→test map, anything manually verified, open questions.

## 8. Open Questions

* OQ-1 (non-blocking, default provided) — resolved as specified: the day's entries list lives directly below the Log Meal form on `/log-meal` (`app/ui/log-meal-panel.tsx`, `app/ui/meal-entries-list.tsx`), each entry inline-editable via Edit (lifts the entry into `LogMealForm`'s `editEntry` prop).

  **Residual gap closed (2026-07-21):** the list was scoped as today-only, so an entry re-attributed to a past day via AC-M19 became unreachable through the `/log-meal` UI (no in-UI path back to that day). This was closed by `docs/prd/date-scoped-entries-list.md` — the list now follows a single page-wide date context owned by `LogMealPanel`, which snaps to the saved date after any edit/create save.
* OQ-2 (non-blocking, default provided) — resolved as specified: delete confirm is a lightweight inline Confirm/Cancel step per row, not a modal.
* OQ-3 (non-blocking) — not separately built: an edit that moves an entry to a targetless day falls through to the same `state.target === null` branch `LogMealForm` already renders for a new entry (AC-M11's passive "set a target" prompt), since both edit and new-entry saves return through the same `totals`/`target` shape. No new component was needed.
