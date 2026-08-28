# JerkAI — Code Map

## 1. What this is, and when to distrust it

A map of how this repo is organized and where its sharp edges are, written so a PRD can
cite a fact instead of re-deriving it. It covers modules, data flow, conventions and traps.
It deliberately does not cover product intent (`docs/context.md`), schema DDL or local setup
(`README.md`), or process (`docs/definition-of-ready-and-done.md`).

**Derived at:** commit `3d86ba8` (branch `feat/footer-privacy-link`, pre-merge), 2026-08-25.

**Staleness rule.** This is a snapshot of a moving target. A PRD citing it must re-verify
the specific claims it leans on. Where a claim disagrees with the code, **the file is wrong
and the code is right** — fix the file, not the code. Claims pinned to a specific constant
value are marked *(value-pinned)* and should be re-read before use.

## 2. Layout

| Path | What lives here |
|---|---|
| `app/` | Next.js App Router: pages, `app/ui/` components, `app/api/` route handlers, colocated Server Actions |
| `lib/` | All non-React logic. `lib/dashboard/` is the read-path/derivation cluster; `lib/demo/` is the synthetic fixture |
| `migrations/` | `node-pg-migrate` files, applied to every Neon branch |
| `tests/` | The two non-colocated tiers: `tests/unit/`, `tests/integration/`, `tests/component/` |
| `scripts/` | `ci/neon-branch.mjs` (disposable test DB lifecycle), `seed-dev.mjs` |
| `docs/` | This file, product context, DoR/DoD snapshot, `docs/prd/` (+ `archive/`) |
| root | `auth.ts` (Auth.js), `proxy.ts` (session gate + demo host routing), `vitest.config.ts`, `vercel.json` |

## 3. Module inventory

**"Pure" here means: performs no I/O** — no `lib/db.ts`, no `fetch`, no `node:crypto`, no
`process.env`. It does not mean "imports nothing"; the import column is given separately
because "can this be lifted out cleanly" depends on the graph, not just on I/O. `test`
means a colocated `lib/**/*.test.ts`; tests living under `tests/` are named instead.

### `lib/` root

| Module | Purpose | Pure | Internal imports | Test |
|---|---|---|---|---|
| `db.ts` | `getSql()` — lazy Neon client; throws if `DATABASE_URL` unset | no | — | none |
| `sources.ts` | `READING_SOURCES` (fitdays, whoop, apple_health), `ACTIVE_SYNC_SOURCES` (fitdays, whoop) | yes | — | none |
| `readings.ts` | `upsertReading()` — the single write path into `biometric_readings` | no | `db`, `health-export`, `sources` | via `tests/integration/` |
| `sync-runs.ts` | `recordSyncRun()` — one `sync_runs` row per pipe run | no | `db`, `sources` | none |
| `alerts.ts` | `sendSyncFailureAlert()` — Resend email; every failure degrades to `console.error` | no | — | yes |
| `health-export.ts` | Health Auto Export payload → readings: `mapHealthExportPayload`, `extractReadingDate`, `mergeDailyPoints`, `METRIC_MAP` | yes | `sources` | yes |
| `whoop-api.ts` | Whoop v2 client: `fetchCollection` (paginates, one 429 retry), `fetchSleepById`, `WhoopApiError` | no | — | none |
| `whoop-crypto.ts` | `encryptToken`/`decryptToken`, AES-256-GCM, `v1.<iv>.<tag>.<ct>` | no | — | `tests/unit/whoop-crypto.test.ts` |
| `whoop-oauth.ts` | OAuth flow + token persistence; `getFreshAccessToken` refreshes within 60s of expiry | no | `db`, `whoop-crypto` | `tests/unit/whoop-oauth.test.ts` |
| `whoop-map.ts` | Whoop records → readings/workout rows: `mapWhoopData`, `mapWhoopWorkouts`, `localDay` | yes | `whoop-api` (types) | yes |
| `auth-callbacks.ts` | `authorized` (drives `proxy.ts`), `signIn` (multi-email allowlist via `ALLOWLISTED_EMAILS`, fails closed) | no | — | yes |
| `targets.ts` | `saveTarget`, `fetchTargets`; re-exports `resolveTargetForDate` | no | `db`, `target-resolution` | yes |
| `target-resolution.ts` | `resolveTargetForDate` — the one answer to "which target governed day X" | yes | — | via `targets.test.ts` |
| `target-validation.ts` | `validateTargetInput` — Server Action boundary, rejects rather than coerces | yes | — | yes |
| `meal-entries.ts` | Meal write/read path: `saveMealEntry`, `updateMealEntry`, `deleteMealEntry`, `fetchMealEntriesForDate`, `fetchCalorieSeries`, pure `dailyTotals` | no | `db`, `dashboard/calorie-strip`, `dashboard/series`, `dashboard/meal-type`, `targets` | yes |
| `meal-entry-validation.ts` | `validateMealEntryInput` | yes | `dashboard/meal-type` | yes |
| `meal-entries-list-heading.ts` | `headingFor(entryDate)` — "Today's meals" vs `Meals · <date>` | yes | **`@/app/ui/log-meal-form`** | yes |

### `lib/dashboard/`

| Module | Purpose | Pure | Internal imports | Test |
|---|---|---|---|---|
| `types.ts` | `DASHBOARD_METRICS` (the 8 rendered metric entries — 5 fixed `{source, metric}` pairs, plus `weight`/`bodyFatPct`/`leanBodyMass`'s `{sources, metric}` candidate-list shape, resolved per user), `DashboardData` (now carries `resolvedScaleSource`); **vendored downstream by `jerkai-mcp` under a byte-equality lock** (§6) | yes | `strain` | none |
| `config.ts` | `DASHBOARD_CONFIG` — every tuning constant, typed | yes | `meal-type` | none |
| `data.ts` | `fetchDashboardData(windowDays, userId)` — the one dashboard read query, plus its own prior `resolveScaleSource(sql, userId)` step | no | `db`, `date-key`, `series`, `types` | `tests/integration/dashboard-read.test.ts` |
| `date-key.ts` | `readingDateKey` — read-side date guard; **throws** on a non-local-day format | yes | — | yes |
| `series.ts` | `addDays`, `dayAxis`, `alignSeries` — shared axis and null-gap alignment | yes | — | yes |
| `rolling.ts` | `rollingAverage(values, window)` — trailing mean over present days only | yes | — | yes |
| `units.ts` | `toPounds(value, unit)` — converts only `kg`, else passes through | yes | — | yes |
| `strain.ts` | `STRAIN_DOMAIN` 0–21 fixed, `DAY_STRAIN_METRIC`, `strainFraction` (clamps); **vendored downstream by `jerkai-mcp` under a byte-equality lock** (§6) | yes | — | yes |
| `iso-week.ts` | `isoWeekStart`/`isoWeekEnd` (Mon–Sun) | yes | `series` | yes |
| `ledger.ts` | `buildWeeklyLedger`, `completedWeekCount` — weekly rows, cells, states | yes | `config`, `iso-week`, `series` | yes |
| `weekly-badge.ts` | `weeklyStallBadge(rows, fallback)` — hero badge from completed ledger rows | yes | `ledger`, `stall-badge` | yes |
| `stall-badge.ts` | `stallBadge(trend)` — the cold-start daily-streak badge | yes | — | yes |
| `weekly-view.ts` | `buildWeeklyView(data)` — the one place ledger + badge + smoothed series are computed | yes | `config`, `ledger`, `rolling`, `stall-badge`, `types`, `units`, `weekly-badge` | `tests/unit/demo-synthetic-data.test.ts` |
| `readouts.ts` | `leanMassChange`, `recoveryReadout` — guardrail summary numbers | yes | `config` | yes |
| `calorie-strip.ts` | `calorieBarState`, `buildCalorieSeries` — per-day bar state vs that day's target | yes | `target-resolution` | yes |
| `meal-type.ts` | `defaultMealType(hour, cfg)` | yes | — | yes |

`lib/demo/synthetic-data.ts` — deterministic 90-day fixture (`DEMO_DASHBOARD_DATA`,
`DEMO_TARGETS`, `DEMO_DAILY_CALORIES`, `DEMO_AXIS`); pure arithmetic over a day index, no
`Math.random`/`Date.now`. Imports `dashboard/series`, `dashboard/types`,
`target-resolution`. Tested by `tests/unit/demo-synthetic-data.test.ts`.

### `app/ui/` and `app/api/`

| File | Notes |
|---|---|
| `ui/dashboard.tsx` | `"use client"`, default export `Dashboard`; renders the strip stack, calls `buildWeeklyView`, `rollingAverage`, `readouts` in-component |
| `ui/weekly-ledger.tsx` | Server component; props `rows`, `completedWeeks`, `navVariant`, `dailyBasePath` |
| `ui/nav-header.tsx` | Shared header; `navVariant` switches the demo nav |
| `ui/log-meal-form.tsx` | `"use client"`; also exports **`todayLocal()`**, the device-local today used app-wide |
| `ui/log-meal-panel.tsx`, `ui/meal-entries-list.tsx`, `ui/targets-form.tsx` | Client components driving the Server Actions via `useActionState` |
| `api/ingest/health/route.ts` | `POST`; `x-api-key` compared with hashed `timingSafeEqual` |
| `api/whoop/sync/route.ts` | `GET`; Vercel Cron target, `CRON_SECRET` bearer, `maxDuration = 60` |
| `api/whoop/connect` / `callback` | OAuth start (stays session-gated) and redirect target (state-cookie gated) |
| `api/auth/[...nextauth]/route.ts` | Re-exports Auth.js `handlers` |

## 4. The read and write paths

**Ingest (Health Auto Export → Fitdays rows).** `POST /api/ingest/health` →
`mapHealthExportPayload` → `upsertReading` per reading → `recordSyncRun` per lane in
`HEALTH_EXPORT_SOURCES` (currently `["fitdays"]` only) → `sendSyncFailureAlert` on any
non-success. Readings land one at a time so one bad point degrades the run to `partial`
rather than dropping the payload. `upsertReading` is idempotent on
`(source, metric, reading_date)`.

**Ingest (Whoop pull).** `GET /api/whoop/sync` → `getFreshAccessToken` → `fetchCollection`
for recovery/sleep/cycle/workout sequentially → `mapWhoopData` + `mapWhoopWorkouts` →
`upsertReading` / `upsertWorkout` → one `sync_runs` row. Window is `?start`/`?end`, else the
trailing 7 days *(value-pinned: `DEFAULT_WINDOW_DAYS`)*. It takes **no source parameter** —
the route owns the `whoop` lane exclusively. No token row returns
`{status: "not_connected"}` with no `sync_runs` row and no alert.

**Dashboard read.** `fetchDashboardData(windowDays, userId)` takes `windowDays` and `userId` —
no date, no source, no metric filter; the metric set is fixed by `DASHBOARD_METRICS`. Before
the one dashboard query runs, a separate, isolated `resolveScaleSource(sql, userId)` call
determines which smart-scale source (`'fitdays'` or `'withings'`) this user's
`weight`/`bodyFatPct`/`leanBodyMass` resolve to — whichever candidate has the most recent
`reading_date` across those three metrics combined, ties favoring `'fitdays'`; `null` when the
user has rows in neither. That resolved source (never both) is what the main query's
`(source, metric)` parameter list uses for those three keys, so the query itself never sees
the non-resolved source's rows. The main query returns
`{axis, series, units, latestDay, resolvedScaleSource}`: `axis` is `windowDays` consecutive
device-local day keys ending at the **newest reading day in the data, not the server clock**;
`series` is one `(number|null)[]` per metric key aligned to that axis; `units` is the newest
row's unit per metric. With no rows it returns an empty axis and `latestDay: null` (with
whatever `resolvedScaleSource` the resolution step found — the two are computed independently
and either can be null/empty regardless of the other).

**Render.** `/` and `/weekly` → `fetchDashboardData(90, userId)` → `buildWeeklyView` → `WeeklyLedger`.
`/daily` → `fetchDashboardData(90, userId)` plus the sibling `fetchTargets()` +
`fetchCalorieSeries(axis, targets)` → `Dashboard`. The 30/90 toggle and the hover crosshair
re-render client-side from data already held — no second fetch. All six gated pages (`/`,
`/daily`, `/weekly`, `/log-meal`, `/settings/targets`, `/status`) are
`export const dynamic = "force-dynamic"` and re-check `auth()` themselves.

**Meal write.** `logMealAction` / `updateMealEntryAction` / `deleteMealEntryAction` in
`app/log-meal/actions.ts`: re-check `auth()` → validate → write → `revalidatePath("/log-meal")`
and `revalidatePath("/daily")` → return totals + resolved target. Nothing derived is ever
written back; totals, bar colors and trends are recomputed at render time from the rows.

**Demo.** `/demo/*` reads `lib/demo/synthetic-data.ts` and calls the same pure
`buildWeeklyView` / `buildCalorieSeries`, never `fetchDashboardData` or `lib/db.ts`.

## 5. Conventions in force

- **Lazy DB client.** Never a module-level client — `getSql()` per call (`lib/db.ts`).
  Auth.js does the same with a per-request `Pool` (`auth.ts`, config-as-function).
- **Tuning constants in a typed config module**, never inline in a component:
  `lib/dashboard/config.ts` (`DASHBOARD_CONFIG`).
- **Device-local date key.** `reading_date` is the device-local calendar day. Write side
  validates and returns null (`extractReadingDate`); read side **throws**
  (`lib/dashboard/date-key.ts`). Day arithmetic is done in UTC on date-only keys
  (`lib/dashboard/series.ts#addDays`) so DST never shifts a key.
- **Three test tiers**, defined as named projects in `vitest.config.ts`: `unit` (node;
  `lib/**/*.test.ts` + `tests/unit/`), `integration` (node; `tests/integration/`,
  `fileParallelism: false` because files share one database), `component` (jsdom;
  `tests/component/`). `npm test` runs **only** `unit`.
- **Disposable Neon branch** for integration: `scripts/ci/neon-branch.mjs create|delete`
  branches from `dev` and creates an empty `jerkai_ci_test` database. Every integration file
  refuses to run unless `DATABASE_URL`'s path contains that database name.
- **Colocated `*.test.ts`** next to pure `lib/` modules; anything needing jsdom, a real DB,
  or whole-program analysis lives under `tests/`.
- **Conventional Commits** enforced by commitlint (`commitlint.config.mjs`, `.husky/commit-msg`).
- **gitleaks pre-commit** (`.husky/pre-commit`) — requires gitleaks on PATH.

## 6. Traps

**Bigint and numeric columns arrive as strings.** *Assumption:* a Postgres `bigserial` id or
`numeric` value comes back as a JS number. *Reality:* the Neon driver returns them as
strings. `lib/meal-entries.ts#MEAL_ENTRY_COLUMNS` casts `id::int` and every macro
`::float8` for exactly this reason; `lib/targets.ts#fetchTargets` and
`lib/dashboard/data.ts` do the same with `::float8`. *Consequence:* omit a cast and a
strict `===` against a number computed elsewhere (e.g. `deleteMealEntryAction`'s
`deletedId`) silently never matches. Date columns get the same treatment via
`to_char(..., 'YYYY-MM-DD')` — read raw, they arrive as `Date`/timestamp text, not a day key.

**`lib/targets.ts` drags `lib/db.ts` into any importer.** *Assumption:* importing only the
type and the pure `resolveTargetForDate` from `targets.ts` is free. *Reality:* TypeScript
resolves the whole file including its value imports, so `getSql` comes along.
*Consequence:* the demo route and `lib/dashboard/calorie-strip.ts` must import from
`lib/target-resolution.ts` directly. The same split exists for
`lib/dashboard/data.ts` → `lib/dashboard/types.ts`. `tests/unit/demo-isolation.test.ts`
fails if this is violated.

**`lib/meal-entries-list-heading.ts` imports from `app/ui/`.** *Assumption:* `lib/` never
depends on `app/`. *Reality:* it imports `todayLocal` from `app/ui/log-meal-form.tsx`, a
`"use client"` module — the only lib→app edge in the repo. *Consequence:* the module is not
liftable, and the direction of that dependency will surprise anyone reading the graph
top-down. `app/page.tsx` likewise imports `WEEKLY_LEDGER_WINDOW_DAYS` from
`app/weekly/page.tsx`, a page-to-page value import.

**`stallBadge`'s streak counts present points, not calendar days.** *Assumption:*
"non-increasing for 10 consecutive days" means 10 calendar days. *Reality:* it filters nulls
out first and takes deltas across the compacted array, so a gap neither breaks nor extends a
streak — two readings a week apart are one "day" of streak. *Consequence:* on sparse data
the badge reads a longer decline than the calendar supports. Deliberate (gaps must not
fabricate a rise), but not what the label says. Note also that the badge on screen usually
comes from `weeklyStallBadge`; `stallBadge` is only the cold-start fallback below two
completed weeks.

**Rolling averages average over available days.** `rollingAverage(values, 7)` divides by the
number of *present* values in the window, not by 7. A slot backed by one reading is a
"7-day average". Nulls stay null only when the whole window is empty.

**`leanMassChange` reports a span, not the window.** It returns `spanDays = end - start`
between the two present endpoints, which is ≤ `cfg.windowDays` *(value-pinned: 30)*. A
caller labeling the output "30-day change" without reading `spanDays` will mislabel short
history. `recoveryReadout` similarly averages only present days and counts red days only
among them.

**`alignSeries` silently drops out-of-axis values.** Values dated outside the axis are
discarded, not clamped onto the nearest day. Combined with `fetchDashboardData`'s axis
ending at the newest *reading* day, a metric that stopped updating weeks ago simply renders
as trailing nulls rather than as an error.

**`upsertReading`'s cumulative branch is read-then-write, not atomic.** For
`aggregation: "sum"` it reads the stored payload, merges by timestamp and writes back.
Concurrent writers can lose an update; it self-heals only because merging is idempotent and
the single client sends sequentially. No currently mapped metric is cumulative, so this path
is dormant — a new cumulative metric re-arms it.

**The `proxy.ts` matcher is exact-match by design.** `privacy$`, `api/whoop/callback$`,
`api/whoop/sync$`, `demo(?:$|/)` — loosening any of these to a prefix opens sibling paths.
The `demo.jerkai.app` host rewrite happens **inside** `proxy()`'s body, before `auth()`; a
`next.config.ts` rewrite cannot substitute for it, because Proxy always runs before
`next.config.js` rewrites. `tests/unit/proxy-matcher.test.ts` covers the matcher.

**A `"use server"` file may only export async functions.** Adding a constant or type to
`app/log-meal/actions.ts` fails at runtime, not at build; that is why
`app/log-meal/action-state.ts` exists.

**`lib/dashboard/types.ts` and `strain.ts` have an out-of-repo consumer, and its drift
check will not catch you.** *Assumption:* these are internal modules, free to refactor like
any other `lib/dashboard/` file — and, for anyone who has heard there is a drift check
somewhere, that the check will fail if that is wrong. *Reality:* the sibling repo
`jerkai-mcp` (shipped 2026-07-29) carries byte-pinned copies at `src/vendor/types.ts` and
`src/vendor/strain.ts`, each behind a four-line `//` provenance header
(`vendor.lock.json#headerLines` is `4`), and derives its whole metric registry from them at
import time. Its `scripts/check-vendor-drift.mjs` strips that header and compares the copy
against the upstream bytes **at the commit SHA recorded in `vendor.lock.json`** — it resolves
them with `git show <locked-sha>:<path>` against a local jerkai checkout (`JERKAI_REPO`,
default `../jerkai`) — **not** against this repo's current `main`. The `Vendor drift`
workflow runs that same script on `push` to `main`, on `pull_request`, on a weekly `schedule`
(cron `0 6 * * 1`) and on `workflow_dispatch`. *Consequence:* it is the reverse of what the
setup suggests. Editing `lib/dashboard/types.ts` or `strain.ts` on this repo's `main` fails
nothing, anywhere. The drift check keeps passing, because the commit it reads is immutable
and its contents can never change. What happens instead is that `jerkai-mcp` goes on serving
a stale metric registry indefinitely, with a green CI badge. The check detects local
tampering with the vendored copies; it does not detect upstream change, and cannot. Nothing
in either repo notices an edit to the registry here — picking one up is a deliberate human
step in that repo: re-copy both files, bump `sha` in `vendor.lock.json`, re-run the check.
(As of this snapshot the lock still names `26b3d069ab17f84e682dea074f8f4ecb12b3c2ef` — the
commit this file *was* pinned to as of the 2026-07-31 snapshot, not the commit above. `main`
has since moved without either vendored file changing, so the lock is still accurate; but
its sha and this file's "Derived at" commit no longer being equal is normal, not a sign of
drift — check `vendor.lock.json` directly, never infer its state from this file's own commit
line.)

## 7. Id series in use

Derived from `docs/prd/` and `docs/prd/archive/` at the pinned commit. Series belonging to
the sibling repo `jerkai-mcp` are derived from that repo instead; its PRDs live in the vault,
not in either checkout, so its ids are read from source, tests and commit subjects there.

| Prefix | Repo | Highest used | Introduced by |
|---|---|---|---|
| `AC-D` | jerkai | 21 | v1 dashboard (`docs/prd/archive/v1-dashboard.md`; carried forward unchanged by v1.1; AC-D18–AC-D21 added by Nav Header Cleanup & Status Page Chrome) |
| `AC-N` | jerkai | 14 | v1.1 dashboard |
| `AC-W` | jerkai | 15 | Weekly Ledger (`docs/prd/archive/weekly-ledger.md`; AC-W13–AC-W15 added by Weekly Ledger Week Column Wrap, `docs/prd/weekly-ledger-week-column-wrap.md`) |
| `AC-M` | jerkai | 35 | Log Meal and its fast-follows |
| `AC-PD` | jerkai | 7 | Public Demo |
| `AC-AB` | jerkai | 9 | Demo About |
| `AC-AU` | jerkai | 7 | Extend Sign-In Allowlist (`docs/prd/extend-signin-allowlist.md`) |
| `AC-MU` | jerkai | 12 | Multi-User Data Model Retrofit (`docs/prd/multi-user-data-model-retrofit.md`) |
| `AC-WT` | jerkai | 13 | Whoop Multi-Tenancy |
| `AC-PUE` | jerkai | 4 | Primary User Email Alert Gap (`AC-PUE4` is an ops/manual check, not code-tested) |
| `AC-PM` | jerkai | 4 | Preview Migration Gap Fix (`docs/prd/preview-migration-gap-fix.md`; all four ACs are ops/manual checks, not code-tested) |
| `AC-ST` | jerkai | 4 | Status Sync Times — Local Timezone (`docs/prd/status-sync-local-timezone.md`, PR #31, shipped 2026-08-24) |
| `AC-FT` | jerkai | 4 | Footer Privacy Policy Link (`docs/prd/footer-privacy-link.md`; `AC-FT3`/`AC-FT4` are regression checks satisfied by existing/full-suite test runs, not new assertions). The NFR-92 no-duplication test checks `href="/privacy"`/`<footer` rather than the PRD §6 text's literal `"Privacy Policy"` substring — a bare substring check would false-positive against `app/privacy/page.tsx`'s own `<h1>Privacy Policy</h1>`, so the as-built check is the correct one. |
| `AC-WS` | jerkai | 20 | Withings Smart-Scale Integration (`docs/prd/withings-smart-scale-integration.md`, PR #33) |
| `AC-DR` | jerkai | 9 | Dashboard Multi-Source Metric Resolution & Tagging (`docs/prd/dashboard-multi-source-metric-resolution-and-tagging.md`, PR #34) |
| `AC-ES` | jerkai | 6 | Resend Sending Domain Switch (`docs/prd/resend-sending-domain-switch.md`, this slice) |
| `AC-MF` | jerkai-mcp | 9 | MCP metric registry, slice 1 (`AC-MF9`, the vendor drift check) |

**NFR** is one ascending series **per repo**, not per-slice and not global across repos
(DL-2026-07-31-a). In **jerkai** it is numeric, high-water mark **NFR-115** as of this slice
(NFR-116–119, this slice, `docs/prd/resend-sending-domain-switch.md`; before it, NFR-115
from `docs/prd/dashboard-multi-source-metric-resolution-and-tagging.md`, PR #34 — this
table's prior high-water mark of NFR-97 was stale, understating it: it omitted the
reservations made by Extend Sign-In Allowlist, Multi-User Data Model Retrofit, Withings
Smart-Scale Integration, and Dashboard Multi-Source Metric Resolution & Tagging, the same
staleness this edit also corrects for `AC-AU`/`AC-MU`/`AC-WS`/`AC-DR` above). **NFR-86–87
shipped** via Weekly Ledger Week Column Wrap (`docs/prd/weekly-ledger-week-column-wrap.md`).
**NFR-88–91 shipped** via Status Sync Times — Local Timezone
(`docs/prd/status-sync-local-timezone.md`, PR #31, merged 2026-08-24). **NFR-92–93 shipped**
via Footer Privacy Policy Link (`docs/prd/footer-privacy-link.md`) — the footer is rendered
from exactly one place (NFR-92) and adds no new I/O to `app/layout.tsx` (NFR-93). In
**jerkai-mcp** it is a separate lettered series, **NFR-A..NFR-D**, which does not continue
jerkai's numbering and never will.

Docs-only sessions carry no PRD and no id series; they are identified by their commit
subject and PR number. The `AC-` and `NFR-` series are unaffected and remain per-repo.
