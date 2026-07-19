# JerkAI — Product Context (for build sessions)

Reading protocol: **the Build PRD in `docs/prd/` is the spec of record** for the current slice; **`README.md` is schema/stack truth**; **this file is durable product context**. Deeper product management history (decision log, architecture rationale, prior build sessions) lives in a separate Career vault and can be provided on request; it is intentionally not in this repo.

## What JerkAI is
A single-user personal health dashboard that turns a noisy daily body-fat reading into a trustworthy trend and, when the trend stalls, makes it fast to see which driver explains it. Also a public-built FDE portfolio artifact. No real biometric data is ever exposed publicly (the public demo uses synthetic data).

## North star & driver tree
North star: **body fat % trend** (7-day and 30-day rolling average) as the decision signal — but the **raw daily reading is always shown alongside it, never hidden or replaced**. Raw = record of truth; trend = the lens for deciding whether anything changed.

- **Energy balance** — *driver* — calories/macros vs target, from manual meal logging.
- **Training** — *driver* — **Whoop Day Strain (Cycle Strain, 0–21)**, from the Whoop API. NOT workout-log tonnage (tonnage is permanently not a dashboard metric).
- **Recovery Score** — *guardrail* — Whoop's own Recovery Score, via the direct Whoop API. Surfaced as a guardrail readout plus a strip inside the collapsible Whoop detail, not a main-stack strip (decision DL-2026-07-18-a).
- **Lean body mass** — *guardrail* — from Fitdays via Apple Health. Surfaced as a main-stack strip plus a 30-day-change readout.

## v1.1 dashboard (direction 1c) — dashboard only
Stacked strips on one shared date axis; hover scrubs a crosshair across all strips to the
same day. One rendering rule everywhere: raw daily values are low-emphasis dots and the
7-day rolling line is the dominant mark — no strip renders a raw daily line as its primary
mark. **v1.1 main stack (top → bottom):** Body fat % (raw dots + 7d/30d lines, tallest) →
Weight (Fitdays) → Day Strain trend (driver · Whoop, 7d line over faint 0–21 dailies) →
Lean body mass (guardrail · Fitdays) → guardrail readout row (lean-mass 30-day change +
Recovery Score 7-day summary) → collapsible Whoop detail (HRV, RHR, sleep, Recovery Score).
A passive stall badge — no cause diagnosis.
- **Recovery Score is a readout, not a main-stack strip.** It surfaces as a guardrail
  readout (7-day average + red-zone-day count) and as a full strip inside the collapsible
  Whoop detail. Demoted from the v1 main stack (decision DL-2026-07-18-a).
- **Weight is a main-stack strip** (Fitdays, already ingested), added below body fat
  (decision DL-2026-07-18-b). It is a strip in its own right, not a north-star/driver/
  guardrail metric.
- **No Calories-vs-target strip** — it arrives with Log Meal (its own later slice) and is
  added to the dashboard then.
- **No "+ Log meal" / "+ Log workout" header CTAs** — hidden until their features ship.
  Only "Status" is present.

## Later, separate slices (not v1 — do not build/test here)
- **Log Meal:** structured manual form (meal type, date, optional description, kcal/P/C/F) — JerkAI stores what you enter; it does not estimate macros. Adds the Calories-vs-target strip to the dashboard. Edit/delete and favorites/recents quick-add are post-v1 fast-follows.
- **Log Workout:** free text → LLM parse → editable Movement/Set/Reps/Load table → Draft/Completed. Parse extracts only what the text states and never invents a load. Standalone screen, **not** surfaced on the dashboard in v1. No dashboard dependency.

## Delivery principle
Thin vertical slices over wide ones: smallest end-to-end usable slice first, enhancements as separate follow-ups.
