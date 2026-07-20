# JerkAI — Build PRD: Weekly Ledger

**Type:** Build PRD (per-slice handoff spec for one Claude Code build session). Thin and reference-heavy — derives from [docs/context.md](../context.md) and cites the project decision log (kept in the Career vault, not this repo) rather than restating product philosophy. Archive when shipped.

**Status:** Approved 2026-07-19 — decision-log entries DL-2026-07-19-a and DL-2026-07-19-b recorded (see §0).

**Scope:** New default landing surface (`/weekly`) + stall-badge recomputation. No new data sources, no schema changes, no Log Meal / Log Workout / TDEE work. The v1.1 strip dashboard is untouched except the hero badge, header nav, and its route (it yields the root URL to the ledger and moves to `/daily`).

**Author:** Acting Director of Product Management (product spec) + Forward Deployed Engineer (non-functional + DoD).

**Purpose:** Self-contained handoff spec for a Claude Code build session. A build agent should be able to work from this doc + the repo context docs without re-reading legacy history.

**Supersedes:** AC-D4–AC-D6 (stall-badge daily-streak logic) as marked in §4.4. AC-D7 (badge passivity) remains in force. All other v1/v1.1 ACs remain in force.

**Date:** 2026-07-19

## Step 0 — Branch from a fresh main (before writing anything)

Before writing anything, create your working branch from an up-to-date `main`:

    git checkout main
    git fetch origin --prune
    git pull --ff-only
    git checkout -b <type>/<short-name>   # e.g. feat/weekly-ledger

Do not branch from any existing feature branch, and do not reuse a leftover local branch. Confirm your new branch's base is current — `git log --oneline -1 main` should match `origin/main` — before starting work. (Standing rule, [docs/definition-of-ready-and-done.md](../definition-of-ready-and-done.md) "Session start"; DL-2026-07-18-c.)

## 0. Scope & Sequencing Note (read first)

The v1.1 dashboard is a daily-resolution inspection surface: it answers "what co-moved?" once you already suspect a change. But the physiology and the decisions operate at weekly resolution — a daily strip stack cannot answer "how did this week go, and how does it compare to the last twelve?" without mental arithmetic. The Weekly Ledger is the decision surface: one row per week, deltas and states rather than raw values. The strip dashboard is demoted (in role, not in code) to the drill-down you open when a ledger row looks wrong.

This slice also fixes a latent badge defect surfaced in v1.1 acceptance: the hero stall badge keys off daily streaks of the 30-day trend (AC-D4–D6), which can read "trend flat" while the weekly view shows real movement, and vice versa. Once weekly rows exist they are the truer signal; the badge is recomputed from them (§4.4).

Decision-log prerequisites (recorded before build; entries live in the project decision log, kept in the Career vault, not this repo):

* DL-2026-07-19-a — Weekly Ledger added at `/weekly` and made the default landing page; the strip stack moves to `/daily` as the drill-down surface, one nav click away (routes named by resolution: Weekly/Daily).
* DL-2026-07-19-b — Stall badge re-derived from completed ledger weeks, superseding the daily-streak logic of AC-D4–D6 and the "N wks" counting rule of DL-2026-07-17-b (N now counts completed ledger weeks; daily-streak logic survives only as the cold-start fallback, AC-W11).

Designed-for, not built-now: the ledger's column model must accept future columns without rework — adherence columns arrive with Log Meal / Log Workout; deficit and predicted-vs-actual columns arrive with the TDEE Engine. Do not build placeholders for them (same rule as the v1 Calories strip).

What this slice is NOT: no new ingest, no schema changes, no adherence or TDEE math, no changes to strips, scrub, window toggle, guardrail readout row, or Whoop detail.

## 1. Required reading (build agent, before any code)

Read, in order: `CLAUDE.md`, `AGENTS.md`, `docs/context.md`, `docs/prd/archive/v1-dashboard.md` and `docs/prd/archive/v1.1-dashboard.md` (the baseline surfaces, archived now that both have shipped), this document, `docs/definition-of-ready-and-done.md`, `README.md` (schema/stack truth). Per `AGENTS.md`, read the relevant Next.js guides in `node_modules/next/dist/docs/` before writing Next.js code; do not assume APIs from training data. The v1.1 dashboard code and test suite are the implementation baseline — reuse its rolling-average lib, config module, and readout state logic; do not fork them.

## 2. Problem statement

The user checks the dashboard a few times a week to answer "am I on track?" — but the strip stack answers a different question ("what co-moved on which day?"). Weekly judgments — did body fat trend down this week, did I hold lean mass, was training load up or down, how many red recovery days — require scanning four charts and doing arithmetic across a shared axis. There is no surface where a week is a first-class object, so the highest-frequency question the product exists to answer has no direct answer. Separately, the hero badge derives trend state from daily streaks and can disagree with what any weekly reading of the same data shows (observed in v1.1 acceptance: badge "flat" while 7d sits above raw and weekly deltas are non-zero).

## 3. Objective

One table answers "how did my weeks go?" in a single scan: one row per ISO week, five columns of deltas and states computed from smoothed series, newest week first. The badge and the ledger agree by construction, because the badge is computed from the ledger's completed weeks. Success = the user's routine check starts (and usually ends) at `/weekly`; the strips are opened only when a row demands investigation.

## 4. Functional Requirements — user-centered acceptance criteria

Written as testable Given/When/Then. "The user" = Albert (single user).

### 4.1 The week row (definitions the whole slice hangs on)

* AC-W1 (week key) — Given biometric data exists, When the ledger computes, Then rows are ISO weeks (Mon–Sun) in the device-local calendar (same date key as NFR-2); the current partial week renders as a visually distinct "in progress" row labeled with days elapsed (e.g., "this week · 4 of 7 days"), never presented as comparable to completed weeks.
* AC-W2 (delta convention) — Given a completed week, Then every delta column compares end-of-week smoothed values, not raw values: a week's value for a series is its last available 7-day rolling value in that week, and the delta is versus the prior week's. Rationale: week-boundary raw readings would reintroduce the BIA noise v1.1 removed; this is testable with fixtures (a noisy series with flat smoothed trend must produce ~0 deltas).
* AC-W3 (columns, v1 of the ledger) — Given the ledger renders, Then each row shows exactly five metric columns: (1) body fat trend Δ (percentage points, from the 30-day line), (2) weight Δ (lb, from the 7-day line), (3) avg daily strain for the week (0–21, one decimal), (4) recovery: weekly avg % + red-day count (<34%, config per NFR-16), (5) lean mass Δ (lb, from the 7-day line) with holding/warning state (weekly band ±0.15 lb/week, confirmed 2026-07-19; ≈ the AC-N8 30-day ±0.5 lb band ÷ 4; config per NFR-24). No other columns render.
* AC-W4 (states not just numbers) — Given a delta column renders, Then it carries a directional state (good / neutral / warning) using the existing v1.1 config thresholds and colors; state semantics are per-column (body fat down = good; lean mass down = warning; strain and recovery states are neutral/informational). No column asserts a cause (extends AC-D7 to the ledger).

### 4.2 The ledger view

* AC-W5 (layout) — Given the user opens `/weekly`, Then rows render newest-first, 13 completed weeks maximum (≈ one quarter) plus the in-progress row, in a single table that fits a phone screen width without horizontal scrolling (columns may abbreviate on small screens; responsive per AC-D17's standard).
* AC-W6 (drill-down) — Given the user activates a completed week's row (click/tap), Then the strip dashboard opens scoped to a window containing that week (the existing 30d window positioned so the selected week is visible), so investigation continues on the co-movement surface. No new chart is built for drill-down.
* AC-W7 (sparse weeks) — Given a week has fewer than 4 days of data for a series, Then that cell renders as "insufficient data" (em-dash + tooltip with day count), not a delta computed from thin data; a week with no data at all renders as a single collapsed gap row. Extends AC-D13 (gaps, not zeros) to weekly aggregation.
* AC-W8 (navigation & default landing) — Given the user opens JerkAI's root URL (authenticated), Then the Weekly Ledger renders as the landing page. Every page header contains nav between "Weekly" (`/weekly`) and "Daily" (`/daily`, the strip stack's new route); the strip stack's previous URL redirects to `/daily` so existing deep links/bookmarks resolve. "Status" behavior is unchanged (AC-D15).

### 4.3 Cold start & history

* AC-W9 — Given fewer than 2 completed weeks of data exist, Then the ledger shows available rows plus a passive note "ledger builds as weeks complete — N weeks so far"; it never errors and never fabricates a comparison row.

### 4.4 Stall badge — recomputed from weekly rows (supersedes AC-D4–D6)

* AC-W10 (weekly basis) — Given ≥2 completed ledger weeks exist, When the hero badge computes, Then its state derives only from completed weeks' body-fat trend deltas (AC-W3 column 1), not from daily streaks: down ("▾ trending down N wks", good color) when the most recent completed week's delta ≤ −ε, N = count of consecutive such weeks; rising ("▴ trend rising — check drivers", warning color) when the most recent completed week's delta ≥ +ε; flat ("— trend flat", neutral) when within ±ε. ε is a config threshold (default 0.05 pp/week, NFR-16 module), not hardcoded.
* AC-W11 (fallback) — Given <2 completed weeks exist, Then the badge falls back to the AC-D4–D6 daily-streak logic unchanged, so the badge never disappears during cold start. The fallback path must be explicitly unit-tested.
* AC-W12 (consistency guarantee — the point of the change) — Given the same underlying data, Then the badge state and the most recent completed ledger row's body-fat state can never disagree — provable with a shared fixture asserted against both computations. AC-D7 (passivity: the badge never asserts a cause) remains in force verbatim.
* Superseded: AC-D4–AC-D6 as the badge's primary logic (they survive only as the AC-W11 cold-start fallback; their existing unit tests are retained and re-scoped to the fallback path per NFR-20's mapping rule).

### 4.5 Unchanged and in force

All v1.1 ACs (AC-N1–N14) and surviving v1 ACs per v1.1 §4.6, except AC-D4–D6 as superseded above. The strip dashboard's rendering, scrub, window toggle, readout row, and Whoop detail are untouched; their tests must stay green.

## 5. Non-Functional Requirements (FDE)

Aligned to the architecture and data model in the project decision log / vault (kept out of this repo). All v1 NFRs (1–13) and v1.1 NFRs (14–20) remain in force; the following are additive.

* NFR-21 — Weekly aggregation is a pure library. Week bucketing, end-of-week smoothed-value selection, deltas, states, and the weekly badge computation are pure functions in `lib/` (input: daily series + config; output: typed row objects), unit-testable with no DB or rendering. The `/weekly` page and the hero badge are thin consumers of the same functions — the badge must not reimplement any ledger math (this is what makes AC-W12 cheap to guarantee).
* NFR-22 — Read-only slice. No schema changes, no migrations, no ingest changes. Weekly rows are computed at read time from `biometric_readings`; they are not persisted. (If profiling ever demands materialization, that is a future decision-log call, not a build choice.)
* NFR-23 — Extensible column model. Ledger columns are declared in one typed config array (key, label, series source, delta rule, state rule, unit). Adding the future adherence and TDEE columns must be a config-plus-lib change, not a table rewrite. Do not add speculative fields beyond what AC-W3's five columns need.
* NFR-24 — Config over constants (extends NFR-16). ε (badge/week flat band), the weekly lean-mass band, minimum-days-per-week (AC-W7's 4), and row cap (13) live in the existing typed config module.
* NFR-25 — Render budget. `/weekly` interactive within the existing ~1.5s warm-load budget; the ledger's data window (13 weeks ≈ 91 days) reuses the existing 90-day read path rather than introducing a new query shape.
* NFR-26 — Test continuity. Extend existing Vitest + disposable-Neon-branch patterns; AC ids in test names. Fixtures must include: a noisy-flat series (AC-W2), a sparse week (AC-W7), a cold start (AC-W9, AC-W11), and a badge/ledger consistency case (AC-W12). Re-scoped AC-D4–D6 tests mapped per NFR-20.
* NFR-27 — Repo docs updated in the same PR (docs-as-code). This slice changes what the repo docs assert (default surface, routes, badge semantics), so the PR must update them or the next build session inherits stale truth: (a) `docs/context.md` — surfaces section reflects Weekly Ledger as default landing at `/weekly`, the strip stack as drill-down at `/daily`, and the badge's weekly derivation (citing DL-2026-07-19-a/-b); (b) this PRD lands as `docs/prd/weekly-ledger.md` and `CLAUDE.md`'s imports are updated to load it (whether the shipped v1.1 PRD import is archived/dropped follows the existing "archive when shipped" convention); (c) `README.md` only if any route/read-path documentation there is affected (no schema changes per NFR-22). Docs changes ship in the same PR as the code, never as a follow-up.

## 6. Definition of Done

### 6.1 Weekly Ledger

* `/weekly` renders newest-first ISO-week rows with exactly the five AC-W3 columns, in-progress row visually distinct, 13-completed-week cap (AC-W1, AC-W3, AC-W5).
* All deltas computed from end-of-week smoothed values; noisy-flat fixture produces ~0 deltas (AC-W2, NFR-26).
* Per-column directional states use existing config thresholds/colors; no causal language anywhere in the ledger (AC-W4).
* Row drill-down opens the strip dashboard scoped to the selected week (AC-W6).
* Sparse weeks render "insufficient data", empty weeks collapse; no zeros, no thin-data deltas (AC-W7).
* Weekly Ledger is the default landing page; Weekly/Dashboard nav on all pages; old dashboard links still resolve (AC-W8).
* Cold-start note at <2 completed weeks (AC-W9).
* Hero badge computes from completed ledger weeks with config ε; daily-streak logic retained solely as the tested cold-start fallback (AC-W10, AC-W11).
* Badge/ledger consistency fixture test in CI proving they cannot disagree (AC-W12, NFR-26).
* Weekly math lives in pure `lib/` functions consumed by both page and badge; confirmed in PR description (NFR-21).
* Column model is config-driven with no speculative columns (NFR-23); no schema/migration diff (NFR-22).
* All v1.1 and surviving v1 AC tests green; AC-D4–D6 test re-scoping mapped in the PR (NFR-20, NFR-26).
* Spot-check: ledger deltas for ≥3 completed weeks hand-verified against dashboard strip values and source apps (Fitdays, Whoop).
* Repo docs updated in the same PR: `docs/context.md` surfaces + badge sections, PRD landed at `docs/prd/weekly-ledger.md`, `CLAUDE.md` imports updated (NFR-27).
* DL-2026-07-19-a and DL-2026-07-19-b recorded in the decision log — done 2026-07-19.

Plus the baseline DoD (auth, no public data, CI green, responsive, shared date key, raw-preserved, secret hygiene, PR-merged) — see [docs/definition-of-ready-and-done.md](../definition-of-ready-and-done.md). Do not restate it here.

## 7. Session ground rules (build agent)

Same as prior build sessions, restated for self-containment: TDD — write the test from the AC first, watch it fail, implement to green, refactor; AC id in every test name. Short-lived feature branch per Step 0; PR, never direct to `main`; ask before any push to a shared remote or opening the PR. Neon dev branch only; never touch production data. Secret hygiene: gitleaks pre-commit and secret scanning stay green. Ask before destructive or irreversible actions. Conventional Commits in small green increments. Close the session with: summary, DoD checklists, AC→test map, anything manually verified, open questions.

## 8. Open Questions

* ~~OQ-1~~ Resolved 2026-07-19: `/weekly` is the default landing page from this slice (AC-W8, DL-pending-1).
* ~~OQ-2~~ Resolved 2026-07-19: weekly lean-mass band = ±0.15 lb/week, in config (AC-W3, NFR-24).
* ~~OQ-3~~ Resolved 2026-07-19: the DL-2026-07-17-b "N wks" counting-rule supersession is stated inside DL-2026-07-19-b (see §0); the decision log holds one live definition of N.
