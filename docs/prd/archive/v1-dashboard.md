# JerkAI — Build PRD: v1 Dashboard

**Type:** Build PRD (per-slice handoff spec for one Claude Code build session). Thin and reference-heavy — derives from the product context in [docs/context.md](../context.md) and cites the project decision log (kept in the Career vault, not this repo) rather than restating product philosophy. Archive when shipped.

**Status:** Approved 2026-07-16 — ready for build.

**Scope:** Dashboard only. Log Meal and Log Workout are separate later slices with their own build PRDs (not in this repo yet).

**Author:** Acting Director of Product Management (product spec) + Forward Deployed Engineer (non-functional + DoD).

**Purpose:** Self-contained handoff spec for a Claude Code build session. A build agent should be able to work from this doc + the product context without re-reading legacy history.

**Source artifacts:** `JerkAI Dashboard.dc.html` (dashboard direction 1c hi-fi, stacked strips) and `JerkAI Wireframes.dc.html` (workflow map 1a; dashboard directions 1b–1d). Deep reference (data model, architecture): [README.md](../../README.md).

**Date:** 2026-07-16

## 0. Scope & Sequencing Note (read first)

v1 is the dashboard read surface only. Direction 1c (stacked strips on one shared date axis) is locked; the hi-fi in `JerkAI Dashboard.dc.html` is the reference.

Why dashboard-only (per decision DL-2026-07-16-d in the decision log): the north-star strip plus Day Strain, Recovery Score, and Lean body mass are all fed by ingest that is already live (Fitdays + Whoop), so this slice ships on existing data. The two logging features were severed from the dashboard by earlier decisions — Day Strain now comes from Whoop, not the workout log (DL-2026-07-16-a), so Log Workout has no dashboard dependency at all, and Log Meal only feeds the future Calories-vs-target strip. Both are therefore their own later slices.

Two consequences for this build:

- **No Calories-vs-target strip in v1.** It is omitted entirely until the Log Meal slice ships, at which point it is added to the dashboard. Do not render a placeholder for it.
- **The "+ Log meal" and "+ Log workout" header CTAs are hidden in v1.** This resolves the reported dead-link bug (`href="#"`, inert) by removal rather than by wiring buttons to screens that don't exist. Each CTA returns when its feature ships. The "Status" action stays.

v1 strip stack (top → bottom): Body fat % (north star, tallest) · Day Strain (driver · Whoop) · Recovery Score (guardrail · Whoop) · Lean body mass (guardrail · Fitdays) · collapsible Whoop detail (HRV, RHR, sleep). One driver strip in v1 (Day Strain); the second driver (calories) arrives with Log Meal.

## 1. Feature: Dashboard (direction 1c hi-fi)

### 1.1 Overview

A single-user, single-page read surface. One vertical scan answers "what changed when the body-fat trend changed?" Every metric is a horizontal strip stacked on one shared date axis; hovering any strip scrubs a crosshair across all strips to the same day. Body fat % (north star) is the tallest strip; one driver strip (Day Strain) and two guardrail strips (Recovery Score, lean body mass) sit below; a collapsible Whoop-detail section holds secondary series.

**Primary user story:** As Albert, checking a few times a week, I want to see my raw body-fat reading and its 7-/30-day trend together, and — on the same date axis — my training load and recovery/lean-mass guardrails, so that when the trend stalls I can scan one screen to see what co-moved, instead of opening several apps.

### 1.2 Layout (top → bottom)

1. **Header bar** — "JerkAI" wordmark + `SYNTHETIC DEMO` pill (real dashboard omits the pill); right-aligned action: Status. (The "+ Log meal" / "+ Log workout" CTAs from the hi-fi are not present in v1 — see §0.)
2. **Hero** — `BODY FAT · TODAY, RAW` label; large raw % value; inline `7-day` and `30-day` trend values; a stall badge (color-coded); window label ("last 30 days · hover any strip to scrub").
3. **Strip stack** (single card, shared X axis):
   - **Body fat %** — raw dots + 7-day line + 30-day line (tallest strip); legend (raw / 7-day / 30-day).
   - **Day strain** — `DRIVER · Whoop` — daily value on a fixed 0–21 scale.
   - **Recovery Score** — `GUARDRAIL · Whoop` — thin line with zone bands.
   - **Lean body mass** — `GUARDRAIL · Fitdays` — thin line.
4. **Whoop detail** — collapsible; expands to HRV (rMSSD), Resting heart rate, Sleep duration strips.
5. **Footer** — synthetic-data disclaimer (demo build only).

### 1.3 Controls / props

- **Data window:** 30 (default) or 90 days.
- **Hover-scrub:** crosshair follows the cursor across all strips; each strip's right-hand readout updates to the hovered date's values; leaving the chart returns each readout to its "today / summary" state.

### 1.4 Functional Requirements — user-centered acceptance criteria

Written as testable Given/When/Then. "The user" = Albert (single user).

**Trend legibility (north star)**

- **AC-D1** — Given the dashboard loads, When it renders, Then the hero shows today's raw body-fat % and the 7-day and 30-day rolling averages simultaneously; the raw value is never hidden or replaced by a trend.
- **AC-D2** — Given the body-fat strip renders, When the user views it, Then raw daily readings appear as dots and the 7-day and 30-day rolling averages appear as distinct lines, visually distinguishable via the legend.
- **AC-D3** — Given fewer than 30 (or 90) days of history exist, When the strip renders, Then rolling averages are computed over available days only and the chart does not error or show gaps beyond genuine source-side gaps.

**Stall badge**

- **AC-D4** — Given the 30-day trend has been non-increasing for ≥10 consecutive days, When the dashboard renders, Then the badge reads "▾ trending down N wks" in the "good" color.
- **AC-D5** — Given the 30-day trend has been rising for ≤2 recent days (reversal), When the dashboard renders, Then the badge reads "▴ trend rising — check drivers" in a warning color.
- **AC-D6** — Given the trend is neither clearly falling nor rising, Then the badge reads "— trend flat" in a neutral color.
- **AC-D7** — The badge is passive: it never asserts a cause. No stall diagnosis ships in v1.

**Shared axis & scrubbing**

- **AC-D8** — Given the user hovers any strip at a horizontal position, When the cursor moves, Then a crosshair appears at the same date across all strips (and the Whoop-detail strips if expanded).
- **AC-D9** — Given the user is hovering a date, When the crosshair is active, Then each strip's right-hand readout shows that date's value (e.g., "Jul 12 · raw 18.4% · 7d 18.6% · 30d 18.7%"; "Jul 12 · 14.2 strain"; "Jul 12 · 72%").
- **AC-D10** — Given the user moves the cursor off the chart, Then every readout returns to its default summary state (today's value / period average).

**Driver & guardrails**

- **AC-D11** — Given Whoop Day Strain exists for a day, When the day-strain strip renders, Then it plots that day's strain on a fixed 0–21 domain and the readout shows the numeric strain value on hover. The strain value is sourced from Whoop, not derived from the workout log.
- **AC-D12** — Given Recovery Score and lean body mass data exist, Then each guardrail strip renders on the shared axis with zone context (Recovery) and reads its latest value plus a short trend descriptor ("steady").
- **AC-D13** — Given a day is missing a value for a strip (e.g., Whoop not worn), When that strip renders, Then the missing day is a gap, not a zero or a fabricated value.

**Header / navigation**

- **AC-D14** — Given the dashboard header renders in v1, Then the "+ Log meal" and "+ Log workout" CTAs are not present (no inert links). Only the "Status" action appears. (This is the resolution of the reported dead-link bug for v1.)
- **AC-D15** — Given the user clicks Status, Then the existing `/status` sync-health page opens.

**Window control**

- **AC-D16** — Given the user switches the window between 30 and 90 days, When applied, Then all strips re-render over the new window on the same shared axis and the window label updates.

**Responsive**

- **AC-D17** — Given the user opens the dashboard on a phone browser, When it renders, Then all strips remain readable and vertically scannable on the shared axis, and hover-scrub degrades gracefully to touch (tap/drag) without breaking layout.

## 2. Non-Functional Requirements (FDE)

Aligned to the stack in [README.md](../../README.md) (Next.js App Router + TS, Neon Postgres, Vercel, Auth.js magic-link, Whoop OAuth, Health Auto Export ingest).

**Architecture & data integrity**

- **NFR-1** — *Raw-data-preserved principle.* The dashboard shows raw readings alongside computed trends; trends are computed at render time and never overwrite raw records.
- **NFR-2** — *Shared date key.* All series join on device-local calendar day; the dashboard must align every strip on that key (AC-D8).
- **NFR-3** — *Read-path correctness on idempotent data.* Ingest upserts on `(source, metric, reading_date)`; the dashboard must render correctly when a day's row has been re-sent/updated (latest value wins, no duplicate points).
- **NFR-4** — *Day Strain source.* The day-strain strip reads `biometric_readings` where `source='whoop'` and `metric='strain'`. No dependence on the workout log.

**Performance & UX**

- **NFR-5** — *Render budget.* Dashboard interactive (strips drawn, hover working) within ~1.5s on a warm load over the 30-day window; the 90-day window must not visibly degrade scrubbing.
- **NFR-6** — *Scrub smoothness.* Hover-scrub updates all strip readouts within one animation frame; no per-move network calls (data for the active window is client-side).
- **NFR-7** — *Responsive.* Dashboard is fully usable on a phone browser (v1 requirement).
- **NFR-8** — *Graceful empty/partial states.* Missing-data days render as gaps, not zeros or errors (AC-D13).

**Security & privacy**

- **NFR-9** — *Auth on all real-data routes.* The dashboard sits behind Auth.js single-allowlisted-email magic-link; no real biometric data is reachable unauthenticated.
- **NFR-10** — *No real data in the public/demo path.* The `SYNTHETIC DEMO` build serves pre-generated static props only; no live DB access from any public route.
- **NFR-11** — *Secrets.* Whoop OAuth tokens and the ingest shared secret encrypted at rest; nothing in the client bundle. Public repo → secret scanning + gitleaks pre-commit remain enabled.

**Observability & testing**

- **NFR-12** — *Sync visibility.* Existing `sync_runs` + `/status` continue to surface per-source sync health; the day-strain and Recovery strips depend on Whoop sync, so a Whoop sync failure must be visible on `/status`.
- **NFR-13** — *Test coverage.* Pure-logic units (rolling-average calc, stall-badge logic, day-strain 0–21 domain mapping, shared date-key normalization) covered by Vitest; integration tests run against a disposable Neon branch (per existing CI decision). No new code merges with zero tests.

## 3. Definition of Done

### 3.1 Dashboard (v1)

- Direction 1c stacked-strip layout renders with the four v1 strips (body fat, Day Strain, Recovery Score, Lean body mass) on one shared date axis, matching `JerkAI Dashboard.dc.html` structure (minus the `SYNTHETIC DEMO` pill in the real build, minus the Calories strip and the two Log CTAs — see §0).
- Hero shows raw + 7d + 30d simultaneously; raw never hidden (AC-D1).
- Stall badge implements the ≥10-day / ≤2-day / flat logic and stays passive (AC-D4–D7).
- Hover-scrub crosshair + synchronized readouts work across all strips incl. expanded Whoop detail (AC-D8–D10).
- Day Strain strip on a fixed 0–21 domain, sourced from `biometric_readings` (`metric='strain'`) (AC-D11, NFR-4).
- Recovery + Lean body mass guardrail strips render on the shared axis with context/latest value (AC-D12).
- The "+ Log meal" / "+ Log workout" CTAs are absent in v1; only "Status" is present and routes to `/status` (AC-D14, AC-D15). This closes the reported dead-link bug for v1.
- 30/90 window toggle re-renders all strips (AC-D16).
- Missing-data days render as gaps, not zeros (AC-D13, NFR-8).
- Rolling-average, stall-badge, and day-strain-domain logic unit-tested (AC-derived, TDD).

### 3.2 Dashboard-specific globals

- `/status` reflects Whoop sync health (day-strain + Recovery dependency) (NFR-12).
- Spot-check: dashboard values match source apps (Fitdays, Whoop) on ≥3 dates before calling done.

Plus the baseline DoD (auth, no public data, CI green, responsive, shared date key, raw-preserved, secret hygiene, PR-merged) — see [docs/definition-of-ready-and-done.md](../definition-of-ready-and-done.md). Do not restate it here.

## 4. Open Questions

None blocking. Strain band/source resolved (per earlier decisions DL-2026-07-16-a and -b); dashboard-only scope resolved (DL-2026-07-16-d). Meal- and workout-specific questions live in their respective build PRDs (later slices, not in this repo).
