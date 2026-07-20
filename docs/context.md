# JerkAI — Product Context (for build sessions)

Reading protocol: **the Build PRD in `docs/prd/` is the spec of record** for the current slice; **`README.md` is schema/stack truth**; **this file is durable product context**. Deeper product management history (decision log, architecture rationale, prior build sessions) lives in a separate Career vault and can be provided on request; it is intentionally not in this repo.

## What JerkAI is
A single-user personal health dashboard that turns a noisy daily body-fat reading into a trustworthy trend and, when the trend stalls, makes it fast to see which driver explains it. Also a public-built FDE portfolio artifact. No real biometric data is ever exposed publicly (the public demo uses synthetic data).

## North star & driver tree
North star: **body fat % trend** (7-day and 30-day rolling average) as the decision signal — but the **raw daily reading is always shown alongside it, never hidden or replaced**. Raw = record of truth; trend = the lens for deciding whether anything changed.

- **Energy balance** — *driver* — calories/macros vs target, from manual meal logging (Log
  Meal, shipped: `/log-meal` + Settings → Targets, `docs/prd/log-meal.md`). JerkAI stores
  what's entered; it does not estimate macros — that happens outside the app.
- **Training** — *driver* — **Whoop Day Strain (Cycle Strain, 0–21)**, from the Whoop API. NOT workout-log tonnage (tonnage is permanently not a dashboard metric).
- **Recovery Score** — *guardrail* — Whoop's own Recovery Score, via the direct Whoop API. Surfaced as a guardrail readout plus a strip inside the collapsible Whoop detail, not a main-stack strip (decision DL-2026-07-18-a).
- **Lean body mass** — *guardrail* — from Fitdays via Apple Health. Surfaced as a main-stack strip plus a 30-day-change readout.

## Surfaces & routes (Weekly Ledger, DL-2026-07-19-a)
Two resolutions, one nav: **`/weekly`** (the Weekly Ledger) is the default landing page —
one row per ISO week (Mon–Sun), five columns of deltas/states, newest week first, capped at
13 completed weeks plus the current in-progress week. It answers "how did my weeks go?" in
one scan. **`/daily`** is the strip stack (below) — the drill-down surface opened from a
ledger row, or directly for day-level co-movement investigation. Every page header carries
Weekly/Daily nav plus Status (unchanged, AC-D15).

The hero stall badge is computed from completed Weekly Ledger rows, not daily streaks
(DL-2026-07-19-b): a body-fat trend delta at or below −ε reads "trending down N wks", at or
above +ε reads "trend rising", otherwise "trend flat" (ε default 0.05 pp/week, config). The
daily-streak logic (the badge's pre-Weekly-Ledger computation) survives only as the
cold-start fallback while fewer than 2 completed weeks exist. The badge is still passive —
it never asserts a cause, on either surface.

## v1.1 dashboard (direction 1c) — the `/daily` drill-down surface
Stacked strips on one shared date axis; hover scrubs a crosshair across all strips to the
same day. One rendering rule everywhere: raw daily values are low-emphasis dots and the
7-day rolling line is the dominant mark — no strip renders a raw daily line as its primary
mark (the calories strip, below, is the one deliberate exception). **Main stack (top →
bottom):** Body fat % (raw dots + 7d/30d lines, tallest) → Weight (Fitdays) → Day Strain
trend (driver · Whoop, 7d line over faint 0–21 dailies) → **Calories vs target (driver ·
manual, daily bars — Log Meal)** → Lean body mass (guardrail · Fitdays) → guardrail readout
row (lean-mass 30-day change + Recovery Score 7-day summary) → collapsible Whoop detail
(HRV, RHR, sleep, Recovery Score). Five charts render with the Whoop detail collapsed. The
hero stall badge shown here is the same one described above.
- **Recovery Score is a readout, not a main-stack strip.** It surfaces as a guardrail
  readout (7-day average + red-zone-day count) and as a full strip inside the collapsible
  Whoop detail. Demoted from the v1 main stack (decision DL-2026-07-18-a).
- **Weight is a main-stack strip** (Fitdays, already ingested), added below body fat
  (decision DL-2026-07-18-b). It is a strip in its own right, not a north-star/driver/
  guardrail metric.
- **Calories-vs-target strip** (Log Meal, `docs/prd/log-meal.md`): daily bars colored
  over/under that day's effective target, not the dots+trend treatment — logged intake is a
  discrete daily behavior where the daily value is the decision-relevant mark
  (DL-pending-2). Each day resolves against whatever target was in force *that day*
  (`lib/targets.ts#resolveTargetForDate`), so a later target change never recolors history
  (DL-pending-3). A day with no logged entry is a gap, not a zero.
- **"+ Log meal" header CTA is live** (`/log-meal`), per AC-D14's own terms — it returns
  once its feature ships. **"+ Log workout" stays absent** until its slice ships.

## Later, separate slices (not built here)
- **Log Meal fast-follows:** edit/delete (a wrong entry is uncorrectable until this ships),
  Favorites/Recents quick-add, and free-text LLM estimation (deferred pending an
  accuracy-tolerance decision — JerkAI does not currently estimate macros at all). The
  Weekly Ledger's adherence column (days-in-range per week) is also a separate follow-up.
- **Log Workout:** free text → LLM parse → editable Movement/Set/Reps/Load table → Draft/Completed. Parse extracts only what the text states and never invents a load. Standalone screen, **not** surfaced on the dashboard. No dashboard dependency.

## Delivery principle
Thin vertical slices over wide ones: smallest end-to-end usable slice first, enhancements as separate follow-ups.
