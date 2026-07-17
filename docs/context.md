# JerkAI — Product Context (for build sessions)

Reading protocol: **the Build PRD in `docs/prd/` is the spec of record** for the current slice; **`README.md` is schema/stack truth**; **this file is durable product context**. Deeper product management history (decision log, architecture rationale, prior build sessions) lives in a separate Career vault and can be provided on request; it is intentionally not in this repo.

## What JerkAI is
A single-user personal health dashboard that turns a noisy daily body-fat reading into a trustworthy trend and, when the trend stalls, makes it fast to see which driver explains it. Also a public-built FDE portfolio artifact. No real biometric data is ever exposed publicly (the public demo uses synthetic data).

## North star & driver tree
North star: **body fat % trend** (7-day and 30-day rolling average) as the decision signal — but the **raw daily reading is always shown alongside it, never hidden or replaced**. Raw = record of truth; trend = the lens for deciding whether anything changed.

- **Energy balance** — *driver* — calories/macros vs target, from manual meal logging.
- **Training** — *driver* — **Whoop Day Strain (Cycle Strain, 0–21)**, from the Whoop API. NOT workout-log tonnage (tonnage is permanently not a dashboard metric).
- **Recovery Score** — *guardrail* — Whoop's own Recovery Score, via the direct Whoop API.
- **Lean body mass** — *guardrail* — from Fitdays via Apple Health.

## v1 dashboard (direction 1c) — dashboard only
Stacked strips on one shared date axis; hover scrubs a crosshair across all strips to the same day. **v1 strips:** Body fat % (raw dots + 7d/30d lines, tallest) → Day Strain (driver · Whoop, 0–21) → Recovery Score (guardrail · Whoop) → Lean body mass (guardrail · Fitdays) → collapsible Whoop detail (HRV, RHR, sleep). A passive stall badge — no cause diagnosis in v1.
- **No Calories-vs-target strip in v1** — it arrives with Log Meal (its own later slice) and is added to the dashboard then.
- **No "+ Log meal" / "+ Log workout" header CTAs in v1** — hidden until their features ship (this is the resolution of the inert `href="#"` dead-link bug for v1). Only "Status" is present.

## Later, separate slices (not v1 — do not build/test here)
- **Log Meal:** structured manual form (meal type, date, optional description, kcal/P/C/F) — JerkAI stores what you enter; it does not estimate macros. Adds the Calories-vs-target strip to the dashboard. Edit/delete and favorites/recents quick-add are post-v1 fast-follows.
- **Log Workout:** free text → LLM parse → editable Movement/Set/Reps/Load table → Draft/Completed. Parse extracts only what the text states and never invents a load. Standalone screen, **not** surfaced on the dashboard in v1. No dashboard dependency.

## Delivery principle
Thin vertical slices over wide ones: smallest end-to-end usable slice first, enhancements as separate follow-ups.
