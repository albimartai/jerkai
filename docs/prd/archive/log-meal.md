# JerkAI — Build PRD: Log Meal

Type: Build PRD (per-slice handoff spec for one Claude Code build session). Thin and reference-heavy — derives from JerkAI - Product Brief and cites JerkAI - Decision Log rather than restating product philosophy. Archive when shipped. Status: Draft — updated 2026-07-20 to the current template and post-Weekly-Ledger state of JerkAI; pending decision-log entries (see §0) and approval. Scope: First write-path slice. Meal entry surface, in-app targets, and the Calories-vs-target strip on `/daily`. New table + migration. NOT in this slice: the Weekly Ledger adherence column (own follow-up slice, see §0), edit/delete, Favorites/Recents, any macro estimation, any TDEE math. Author: Acting Director of Product Management (product spec) + Forward Deployed Engineer (non-functional + DoD). Purpose: Self-contained handoff spec for a Claude Code build session. A build agent should be able to work from this doc + the repo context docs without re-reading legacy history. Supersedes: AC-N13's four-chart count (amended to five, §4.4). AC-D14's "+ Log meal" CTA removal ends per its own terms (the CTA returns with this slice). All other dashboard v1/dashboard v1.1/Weekly-Ledger ACs remain in force. Source artifact: `JerkAI Wireframes.dc.html` nutrition model 2b (selected). Date: 2026-07-20

## Step 0 — Branch from a fresh main (before writing anything)

Before writing anything, create your working branch from an up-to-date `main`:

```
git checkout main
git fetch origin --prune
git pull --ff-only
git checkout -b feat/log-meal

```

Do not branch from any existing feature branch, and do not reuse a leftover local branch. Confirm your new branch's base is current — `git log --oneline -1 main` should match `origin/main` — before starting work. (Standing rule, JerkAI - Definition of Ready & Done "Session start"; DL-2026-07-18-c.)

## 0. Scope & Sequencing Note (read first)

Log Meal is the first input feature and the first write path: everything shipped so far (Dashboard v1, Dashboard v1.1, Weekly Ledger) reads data that ingest already produces. This slice adds the missing driver — energy balance — as three thin pieces: a structured entry form, in-app effective-dated targets, and the Calories-vs-target strip on the `/daily` stack.

The design decision that shapes everything (unchanged from 2026-07-16, wireframe model 2b SELECTED): JerkAI stores what the user enters; it does not estimate macros. Estimation happens outside the app (a quick browser/AI search), and the user types the numbers in. Free-text LLM estimation (model 2c) remains explicitly deferred — it is the one place AI would invent numbers, and needs an accuracy-tolerance decision not yet made.

Decision-log (Albert logged in PM/vault, outside of jerkai repo):

* DL-pending-1 (slice split) — The Weekly Ledger adherence column ("days in calorie range" per week) is NOT part of this slice; it ships as its own follow-up slice ("Ledger Adherence Column"), which also carries the deferred NFR-23 obligation: refactor `lib/dashboard/ledger.ts` to the typed column-descriptor array as its first step, using the existing green tests as the harness. Rationale: thin slices (DL-2026-07-16-b) — this slice already carries the first migration and a new surface; and the descriptor refactor belongs in the slice that adds the sixth column.
* DL-pending-2 (strip form + chart count) — The Calories-vs-target strip renders as daily bars colored over/under target, not raw-dots-plus-trend-line. This is a scoped exemption to AC-N1, whose rule governs noisy sampled biometric series; logged intake is a discrete daily behavior where the daily value is the decision-relevant mark. Consequently AC-N13's chart count is amended from four to five. Existing AC-N13 tests are re-scoped per NFR-20's mapping rule.
* DL-pending-3 (effective-dated targets) — Daily targets (kcal, protein at minimum) are set in-app and are effective-dated: changing a target applies from its effective date forward and never recolors history. Targets live in the database (they are user data that changes across cut/maintenance phases), not the code config module.

What this slice is NOT: no ledger changes of any kind (surface or lib), no edit/delete (fast-follow, AC-M7), no Favorites/Recents quick-add (model 2d, fast-follow), no macro estimation, no TDEE math, no changes to existing strips, badge, scrub, or window toggle beyond adding the calories strip and re-scoping the chart-count test.

## 1. Required reading (build agent, before any code)

Read, in order: `CLAUDE.md`, `AGENTS.md`, `docs/context.md`, `docs/prd/archive/weekly-ledger.md` (the shipped predecessor and template precedent, archived per convention once this slice landed), this document, `docs/definition-of-ready-and-done.md`, `README.md` (schema/stack truth — this slice changes it; see NFR-32). Per `AGENTS.md`, read the relevant Next.js guides in `node_modules/next/dist/docs/` before writing Next.js code; do not assume APIs from training data. The v1.1 strip component, shared-axis scrub, and config module are the implementation baseline — extend them; do not fork.

## 2. Problem statement

The product's driver tree names energy balance as the primary driver of the body-fat north star, but JerkAI captures nothing about it: the `/daily` stack shows one driver (Day Strain) and the Weekly Ledger explains weeks with training and recovery data only. When the trend stalls, the most likely cause is invisible to every surface. The user currently estimates meals ad hoc and retains the numbers nowhere, so the future TDEE Engine slice — which needs weeks of intake history — cannot even begin accruing data until this slice ships.

## 3. Objective

Logging a meal takes under 30 seconds on a phone and the system reflects it everywhere it should: the running daily total against target, and the day's bar on the `/daily` calories strip, on the shared axis, scrubbable like every other strip. Values persist exactly as typed — the app never invents a number. Success = the user logs consistently enough (this slice's job is to make that cheap) that the adherence column and TDEE Engine slices inherit a usable dataset.

## 4. Functional Requirements — user-centered acceptance criteria

Written as testable Given/When/Then. "The user" = Albert (single user). AC-M ids continue from the 2026-07-16 draft; amended ACs are marked.

### 4.1 Entry surface (wireframe model 2b)

* AC-M1 — Given the user opens Log Meal, When the form renders, Then meal-type chips (Breakfast / Lunch / Dinner / Snack) default by local time of day (boundaries in config, OQ-1), the date defaults to today (device-local, editable), and the kcal/P/C/F fields are empty and ready for input.
* AC-M2 — Given the user enters calories and macros and saves, Then the entry persists to `manual_macro_entries` with meal type, date, optional description, and the four numeric values exactly as typed — deterministic, no rounding, no derivation of macros the user didn't enter.
* AC-M5 — Given the description is blank, When saved, Then the entry saves successfully (description is optional).
* AC-M9 — Given the user is on a phone browser, Then the form is fully usable: numeric keypads on number fields, no layout breakage (AC-D17's standard).
* AC-M13 — Given any page header renders, Then a "+ Log meal" action appears and routes to the Log Meal form — the return of the CTA per AC-D14's own terms ("each CTA returns when its feature ships"). The "+ Log workout" CTA remains absent.

### 4.2 Targets & daily total

* **AC-M10 — Given the user opens Settings → Targets, Then they can set daily kcal and protein (g) targets (carbs/fat optional) with an effective date defaulting to today; Given a target is changed, Then days before the effective date keep the target that was in force at the time — historical over/under states never recolor (DL-pending-3).
* **AC-M3 — Given a meal is saved, Then the running daily total below the form updates: kcal vs the day's effective target with a progress bar, plus macro totals (protein vs its target). Passive presentation — states, not advice (AC-D7's standard).
* AC-M11 — Given no target is in force for a day, Then totals render without over/under state and the form shows a passive one-line prompt to set targets; the calories strip renders that day's bar in a neutral (uncolored) state. Nothing errors.

### 4.3 Backfill & attribution

* AC-M4 — Given the user sets the date to a prior day, When saved, Then the entry attributes to that device-local calendar day and the calories strip reflects it on that day's bar — evaluated against that day's effective target.

### 4.4 Calories-vs-target strip (on `/daily`)

* AC-M6 — Given logged meals exist, When `/daily` renders, Then a Calories-vs-target strip appears in the main stack labeled `DRIVER · MANUAL`, directly below the Day Strain strip (drivers grouped; OQ-2), rendering one bar per day colored over/under the day's effective target (neutral when no target, AC-M11), participating in the shared axis, window toggle, and hover-scrub (readout e.g. "Jul 12 · 2,140 kcal · target 2,300 · −160").
* AC-M8 — Given no meals are logged for a day, Then that day contributes no bar — a gap, not a zero (extends AC-D13). A gap and a genuinely-logged low day must be visually distinct.
* AC-M14 (supersedes AC-N13's count) — Given `/daily` loads with the Whoop detail collapsed, Then exactly five charts are visible (body fat, weight, strain, calories, lean mass) plus the readout row; the AC-N13 chart-count test is re-scoped to five with the mapping noted in the PR (NFR-20).
* AC-M15 — Given the calories strip is added, Then all existing strip behaviors are unregressed: scrub sync (AC-N11), badge (AC-W10–W12), guardrail readouts (AC-N8–N10), window toggle (AC-D16). Their tests stay green untouched except the AC-N13 re-scope.

### 4.5 Correction path (explicitly out of scope)

* AC-M7 [fast-follow, unchanged] — Edit/delete ships as its own fast-follow slice. In this slice a wrong entry stays until then; do not build a partial delete-and-re-add workaround. (Revisit trigger unchanged: if an uncorrectable wrong entry proves painful in practice, the fast-follow moves up.)

## 5. Non-Functional Requirements (FDE)

Aligned to JerkAI - Architecture & Data Model. All prior NFRs (1–27) remain in force where applicable; the following are additive, numbered continuing from the Weekly Ledger PRD.

* NFR-28 — First write path, proper migration. `manual_macro_entries` and the targets table ship as reviewed migrations (the first since ingest). Written values are never mutated by computation — the raw-preserved principle (NFR-1) extends to manual entries: totals, colors, and future TDEE math are always derived downstream, never written back.
* NFR-29 — No silent duplicates. Double-submit (double-tap, retry, back-button resubmit) must not create duplicate entries — idempotency key or equivalent on the write path, integration-tested. Deliberate identical meals (two real snacks with identical values) must still be possible: protect the submission, not the values.
* NFR-30 — Effective-dated target resolution in one place. "Which target governs day X" is a pure `lib/` function used by the form total, the strip coloring, and (later) the adherence column and TDEE slices — one resolver, no duplicated lookup logic (the NFR-21 pattern applied to targets).
* NFR-31 — Strip integration without regression. The calories strip reuses the existing strip component/axis machinery (NFR-14) with a bar-series variant; render budget holds (~1.5s warm, NFR-5/18); scrub stays one-animation-frame (NFR-6/17).
* NFR-32 — Repo docs updated in the same PR (NFR-27 pattern). (a) `README.md` — schema section documents both new tables (this slice changes schema truth, unlike the read-only predecessors); (b) `docs/context.md` — driver tree gains the live energy-balance driver, `/daily` stack and CTA descriptions updated, five-chart count noted; (c) this PRD lands as `docs/prd/log-meal.md`, `CLAUDE.md` imports updated, `weekly-ledger.md` archived per convention. Same PR, never a follow-up.
* NFR-33 — Test continuity. Existing Vitest + disposable-Neon-branch patterns; AC ids in test names. Required fixtures: exact-as-typed persistence (AC-M2), backdated entry against a historical target (AC-M4/M10), target-change boundary day (DL-pending-3), double-submit (NFR-29), gap-vs-logged-low-day rendering (AC-M8), five-chart count (AC-M14).

## 6. Definition of Done

* 2b structured form: meal-type chips (time-of-day default), editable date, optional description, kcal/P/C/F, Save; phone-usable with numeric keypads (AC-M1, M5, M9).
* Entries persist deterministically, exactly as typed, via migration-created `manual_macro_entries`; no macro invented by the app (AC-M2, NFR-28).
* Settings → Targets with effective dating; history never recolors on target change (AC-M10, DL-pending-3, NFR-30).
* Running daily total + progress vs effective target updates on save; targetless days degrade passively (AC-M3, M11).
* Backdated entries attribute to the correct device-local day against that day's target (AC-M4).
* Calories-vs-target strip live on `/daily` below Day Strain: daily bars, over/under/neutral coloring, gaps ≠ zeros ≠ logged-low, scrub/window/readout integrated (AC-M6, M8).
* "+ Log meal" CTA restored in all page headers; "+ Log workout" still absent (AC-M13).
* Five-chart count asserted; AC-N13 test re-scoped with mapping in the PR; all other prior AC tests green untouched (AC-M14, M15, NFR-20).
* Double-submit protection integration-tested; deliberate duplicate values still possible (NFR-29).
* Target resolver is a single pure `lib/` function consumed by form + strip; confirmed in PR description (NFR-30).
* Repo docs updated in the same PR: README schema, context.md driver tree/surfaces, PRD landed at `docs/prd/log-meal.md`, CLAUDE.md imports, weekly-ledger PRD archived (NFR-32).
* All NFR-33 fixtures present and green in CI.
* Spot-check: log ≥3 real meals (incl. one backdated), verify totals and strip against hand arithmetic before calling done.
* DL-pending-1/-2/-3 recorded in the decision log with final ids before merge.

Plus the baseline DoD (auth, no public data, CI green, responsive, shared date key, raw-preserved, secret hygiene, PR-merged) — see JerkAI - Definition of Ready & Done. Do not restate it here.

Fast-follows (separate slices, not this PRD): edit/delete with recompute (AC-M7); Favorites/Recents quick-add (model 2d — the data model above already supports it; build nothing for it now); Ledger Adherence Column (adherence column + the NFR-23 descriptor-array refactor, per DL-pending-1); free-text LLM estimation (model 2c — still deferred pending an accuracy-tolerance decision).

## 7. Session ground rules (build agent)

Same as prior build sessions, restated for self-containment: TDD — write the test from the AC first, watch it fail, implement to green, refactor; AC id in every test name. Short-lived feature branch per Step 0; PR, never direct to `main`; ask before any push to a shared remote or opening the PR. Neon dev branch only; migrations run against dev/disposable branches only — never production (first-migration slice: extra care; ask before running any migration). Secret hygiene: gitleaks pre-commit and secret scanning stay green. Ask before destructive or irreversible actions. Conventional Commits in small green increments. Close the session with: summary, DoD checklists, AC→test map, anything manually verified, open questions.

## 8. Open Questions

* OQ-1 (non-blocking, default provided): Meal-type time-of-day default boundaries — default: Breakfast <11:00, Lunch 11:00–16:00, Dinner 16:00–21:00, Snack otherwise; local time; config per NFR-24's module. Adjust in config, not code.
* OQ-2 (non-blocking, default provided): Calories strip position — default: directly below Day Strain (drivers grouped, north-star pair on top). If the hi-fi pass argues for below Weight (inputs-then-outputs reading), record as a decision-log entry; do not decide in-build.
* OQ-3 (non-blocking): Protein target's role in the strip — v1 of the strip colors on kcal only; protein appears in the scrub readout and daily total but does not affect bar color. Revisit when the adherence column slice defines protein adherence.
