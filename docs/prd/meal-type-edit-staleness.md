# JerkAI — Build PRD: Meal-Type Edit Staleness Fix

> **Type:** Build PRD (per-slice handoff spec for one Claude Code build session). Thin and reference-heavy — derives from [[JerkAI - Product Brief]] and cites [[JerkAI - Decision Log]] rather than restating product philosophy. Archive when shipped. **Status:** Draft — created 2026-07-21, surfaced as a known-and-deferred bug during the [[JerkAI - Build PRD - Date-Scoped Entries List]] build session. **Scope:** Fix `LogMealForm`'s meal-type selector so it shows the entry's actual stored `mealType` when the user opens Edit, instead of a stale leftover value. NOT in this slice: any other field's edit-mode pre-population (all already correct), any change to create-mode's time-of-day default logic, any new UI, any schema change. **Author:** Acting Director of Product Management (product spec) + Forward Deployed Engineer (non-functional + DoD). **Purpose:** Self-contained handoff spec for a Claude Code build session. A build agent should be able to work from this doc + the repo context docs without re-reading legacy history. **Supersedes:** N/A — this is a defect fix against the shipped Edit & Delete Meal surface, not scoped by any prior PRD's open question. **Source artifact:** `app/ui/log-meal-form.tsx`, specifically the `mealType` state and its mount effect. **Date:** 2026-07-21

---

## Step 0 — Branch from a fresh main (before writing anything)

Before writing anything, create your working branch from an up-to-date `main`:

```
git checkout main
git fetch origin --prune
git pull --ff-only
git checkout -b fix/meal-type-edit-staleness
```

Do not branch from any existing feature branch, and do not reuse a leftover local branch. Confirm your new branch's base is current — `git log --oneline -1 main` should match `origin/main` — before starting work. (Standing rule, [[JerkAI - Definition of Ready & Done]] "Session start"; DL-2026-07-18-c.)

## 0. Scope & Sequencing Note (read first)

This bug was found, diagnosed, and deliberately **not** fixed during the Date-Scoped Entries List build session (2026-07-21), which fixed the analogous bug for the form's `entryDate` field but flagged `mealType` as out-of-scope for that slice. This PRD closes that follow-up.

**Root cause (already diagnosed, not new investigation needed):** `LogMealForm` is mounted exactly once by `LogMealPanel` and never remounts — only the inner `<form key={editEntry?.id ?? "new"}>` remounts when `editEntry` changes (a deliberate trick that resets uncontrolled `defaultValue` inputs like description/calories/macros). `mealType`'s `useState<MealType | null>(editEntry?.mealType ?? null)` initializer only runs once, at the form's true first mount — which always happens in create mode, since `editEntry` starts `null`. The mount effect that seeds a real value (`setMealType(defaultMealType(...))`) also only runs once, guarded by `if (editEntry) return`, and it too only ever fires in create mode for the same reason. Net effect: once the form has mounted, `mealType` is permanently owned by whatever create-mode's clock-based default was (or whatever a previous edit last set it to) — clicking Edit on any entry updates every other field correctly but leaves the meal-type selector showing a stale, unrelated value.

**The fix is already proven and shipped for the same bug class**, just on a different field: the Date-Scoped Entries List slice added this effect to `app/ui/log-meal-form.tsx` for `entryDate` —

```ts
useEffect(() => {
  if (editEntry) {
    setEditDate(editEntry.entryDate);
  }
}, [editEntry]);
```

— which re-seeds the edit-mode-local date every time `editEntry` changes (including the null→entry transition on the very first Edit click). This PRD's entire implementation is the same pattern, applied to `mealType` instead of `entryDate`. There is no new mechanism to design.

What this slice is NOT: a rewrite of `LogMealForm`'s state model, a fix for any other field (description/calories/macros are already correct via the `key`-remount + `defaultValue` mechanism — only *controlled* state, i.e. `mealType` and previously `entryDate`, was ever affected), a change to the create-mode default-meal-type-by-time-of-day logic (`defaultMealType`, unchanged), or a schema/migration change (none needed).

## 0b. Erratum — found during build (supersedes the "single effect" framing; needs author sign-off)

> **Erratum (found during build):** IN-1's single `useEffect` is necessary but not sufficient — `mealType`, unlike `entryDate`, has **no create/edit split**, so that effect alone lets an edited value leak into create mode after Cancel/Save, violating AC-M35. The `editDate` fix that AC-M35's reasoning was borrowed from worked *because* of the `editDate`/`createDate` split (`log-meal-form.tsx:132`), not because of the effect alone. Adding only the `[editEntry]`-keyed effect would fix AC-M32–M34 but break AC-M35: editing a `dinner` entry then Cancelling leaves the shared `mealType` state on `"dinner"`, and since the mount effect is `[]`-keyed (already spent), nothing re-seeds create mode's own time-of-day default — the edited value leaks into create mode, which is exactly what AC-M35 forbids.
>
> **Revised approach — confirmed with the product owner** (selected over (a) bolting on ad-hoc reset-on-exit code or (b) weakening AC-M35's wording): apply the same split to `mealType` that already exists for `entryDate`, not just the same effect:
> - Add a new `createMealType` state (`useState<MealType | null>`), owned by create mode only. The mount effect's `setMealType(defaultMealType(...))` seed writes to `createMealType` instead.
> - Keep `mealType` (existing name) as **edit-mode-local** state only, re-seeded by `useEffect(() => { if (editEntry) setMealType(editEntry.mealType); }, [editEntry])`.
> - Derive the rendered/submitted value as `editEntry ? mealType : createMealType`, matching the existing `const entryDate = editEntry ? editDate : createDate;` pattern at line 132.
> - The radio's `onChange` branches on mode, matching the date input's `onChange` at lines 174–180: `editEntry ? setMealType(value) : setCreateMealType(value)`.
>
> This closes the leak **structurally** — create mode's state is never written to by the edit path, so AC-M35 needs no conditional/reset logic, consistent with IN-2's original spirit (a structural guarantee, not a reset). **NFR-46 and NFR-47 below are revised accordingly** (see the strikethrough notes inline), since the split contradicts their original literal wording ("do not restructure the create/edit state split"; "no new state variable") — the amendment updates them to match the design that actually satisfies all four ACs. Land this erratum as part of the same PR that ships the fix, and flag it in the PR description as a correction to the original build spec for the PM/FDE authors to ratify.

## 1. Required reading (build agent, before any code)

Read, in order: `CLAUDE.md`, `AGENTS.md`, `docs/context.md`, `docs/prd/edit-delete-meal.md` (AC-M17 — edit form must show the entry's exact stored values, which this slice restores for `mealType`), `docs/prd/date-scoped-entries-list.md` (§9 IN-2, and the shipped `editDate`-sync effect this PRD mirrors), this document. Per `AGENTS.md`, read the relevant Next.js guides in `node_modules/next/dist/docs/` before writing Next.js code. The one file you mutate is `app/ui/log-meal-form.tsx`.

## 2. Problem statement

AC-M17 (Edit & Delete Meal) requires the edit form to be "pre-populated with that entry's exact stored values (meal type, date, description, kcal/P/C/F) — not blank, not defaulted." Every field satisfies this except `mealType`: opening Edit on a breakfast entry after the form has already shown "Lunch" (from a fresh page load at midday, or from editing a different entry) leaves the meal-type selector showing "Lunch," not "Breakfast." The user can silently re-save an entry under the wrong meal type without ever having touched that control, because it looks selected and untouched. This was caught by inspection while building the Date-Scoped Entries List slice's AC-M27 interactive test, which exercises the exact same live edit-then-save transition — but fixing `mealType` there would have been scope creep on an unrelated slice, so it was deferred here.

## 3. Objective

Opening Edit on any logged entry shows that entry's actual stored meal type, every time, regardless of what the selector showed a moment before — matching how `entryDate`, `description`, `calories`, and the macro fields already behave. Success = AC-M17 is fully satisfied for every field, and a user can no longer save an entry under an unintended meal type just because they didn't happen to notice a stale selection.

## 4. Functional Requirements — user-centered acceptance criteria

Written as testable Given/When/Then. "The user" = Albert (single user). New ids continue AC-M32+ (after Date-Scoped Entries List's AC-M25–M31).

* AC-M32 — Given a logged entry with meal type `breakfast`, When the user clicks Edit on it (from any prior state of the selector — a fresh page load's time-of-day default, or a previous edit's leftover value), Then the meal-type selector shows **Breakfast** selected, matching the entry's actual stored value.
* AC-M33 — Given the user edits entry A (meal type `lunch`) and, without reloading the page, either (a) clicks Cancel and then clicks Edit on a different entry B (meal type `dinner`), or (b) clicks Edit directly on entry B while A is still being edited — both are reachable today, since the list's Edit buttons are never disabled while another entry is mid-edit (`app/ui/meal-entries-list.tsx` applies no such guard) — When B's edit form renders, Then the selector shows **Dinner**, not a leftover **Lunch** from editing A. (The sync must re-fire on every `editEntry` transition — A→null→B and A→B directly — not just the first.)
* AC-M34 — Given the user is in create mode (no entry being edited), Then the meal-type default continues to be computed from device-local time-of-day via the existing `defaultMealType()` mount effect, exactly as before this fix — this slice changes nothing about create-mode's own default logic.
* AC-M35 — Given the user edits an entry (any meal type) and then Cancels or Saves, When they next look at the form in create mode (e.g. immediately start logging a brand-new entry), Then the meal-type selector reflects create-mode's own state — the edited entry's meal type must not leak into or overwrite create mode's value. (Guards against an overcorrection where the new sync effect clobbers create-mode state on the way out of edit mode.) **This guarantee is verified, not newly built**: it depends entirely on the existing parent contract in `LogMealPanel` — `onEditComplete` sets `editEntry` back to `null`, at which point the new effect's `if (editEntry)` guard is false and it does nothing (see IN-2). Do not add "reset on exit" logic to satisfy this AC; the test confirms the existing contract holds, it does not exercise new code.

## 5. Non-Functional Requirements (FDE)

Aligned to [[JerkAI - Architecture & Data Model]]. All prior NFRs remain in force where applicable; the following are additive.

* NFR-46 — **Revised per §0b Erratum:** reuse the proven fix pattern — specifically the *`editDate`/`createDate` split* pattern, not just the effect shape. Add the `[editEntry]`-keyed `useEffect` that calls `setMealType(editEntry.mealType)` when `editEntry` is non-null, **and** give `mealType` the same create/edit split `entryDate` already has (`createMealType` for create mode; `mealType` edit-mode-local; derive `editEntry ? mealType : createMealType`). ~~Do not restructure the create-mode/edit-mode state split established by that slice.~~ (The original wording — "do not restructure the split" — was written on the false premise that `mealType` already had `entryDate`'s split; it does not, so the faithful mirror of the shipped pattern *is* to add the split. See §0b.)
* NFR-47 — **Revised per §0b Erratum:** no new component and no new prop. ~~No new state variable~~ — permit exactly **one** new state variable, `createMealType`, as the split's necessary counterpart, consistent with `editDate`/`createDate` already being two variables for the same reason. `mealType` becomes edit-mode-local rather than a single shared state. `editEntry.mealType` is confirmed non-nullable (`MealEntryRow.mealType: MealType`, `lib/meal-entries.ts`) — the assignment needs no null guard beyond the existing `if (editEntry)` check.
* NFR-48 — Test continuity, interactive tier. **The `component` Vitest project already exists** (`jsdom` environment, wired into `vitest.config.ts` and CI by the Date-Scoped Entries List slice, `tests/component/**/*.test.tsx`) — do not create it, just add test files to it. This is DOM-event/re-render behavior (clicking Edit on one entry, then another, and asserting which radio is checked) — it belongs in that project, not a `renderToStaticMarkup` string-match test, per the interactive-tier standard adopted in [[JerkAI - Definition of Ready & Done]] (DL-2026-07-21-b). AC ids in every test name. Required fixtures: AC-M32 (stale-then-correct on first Edit click); AC-M33, **both transitions** — cancel-then-edit-different-entry (A→null→B) and edit-different-entry-directly-while-mid-edit (A→B, since the list's Edit buttons are never disabled mid-edit); AC-M34 (create-mode default unaffected, unit- or component-level as convenient); AC-M35 (no leak back into create mode after Cancel/Save — asserts the existing parent contract holds, per IN-2, not new behavior).

## 6. Definition of Done

* [ ] Opening Edit on any entry shows its actual stored meal type, regardless of the selector's prior state (AC-M32).
* [ ] Switching from editing one entry to editing another (without reload) re-syncs the meal-type selector each time (AC-M33).
* [ ] Create-mode's time-of-day default meal type is unchanged (AC-M34).
* [ ] Cancelling or saving an edit does not leak the edited entry's meal type into subsequent create-mode state (AC-M35).
* [ ] Fix implemented as the `editDate`/`createDate` split applied to `mealType` (new `createMealType` state + `[editEntry]`-keyed sync effect), mirroring the shipped `editDate` pattern — no new component or prop (NFR-46, NFR-47, §0b Erratum).
* [ ] Interactive component test(s) added in `tests/component/` covering AC-M32–M35, green in CI (NFR-48).
* [ ] No schema change, no migration.
* [ ] Repo docs: this PRD landed at `docs/prd/meal-type-edit-staleness.md`; `CLAUDE.md` imports updated.
* [ ] Spot-check (product owner, against the dev or production branch): edit a breakfast entry, confirm the selector shows Breakfast; cancel, edit a dinner entry, confirm it now shows Dinner without a page reload.

Plus the baseline DoD (auth, no public data, CI green, responsive, shared date key, secret hygiene, PR-merged, migrations-reach-production if applicable) — see [[JerkAI - Definition of Ready & Done]]. Do not restate it here.

## 7. Session ground rules (build agent)

Same as prior build sessions, restated for self-containment: TDD — write the test from the AC first, watch it fail, implement to green; AC id in every test name. Short-lived feature branch per Step 0; PR, never direct to `main`; ask before any push to a shared remote or opening the PR. **This slice carries no migration.** Conventional Commits in small green increments. Close the session with: summary, DoD checklist status, AC→test map, anything verified manually, open questions.

## 8. Open Questions

* OQ-1 (non-blocking) — **updated per §0b Erratum:** the fix is the `editDate`/`createDate` split applied to `mealType` (new `createMealType` state + `[editEntry]`-keyed sync effect) in `app/ui/log-meal-form.tsx`, not a new component. The original "single `useEffect`, no restructuring of the split" framing was superseded once it was found that `mealType` (unlike `entryDate`) never had that split, so the effect alone would leak the edited value into create mode and break AC-M35. The split approach was confirmed with the product owner over ad-hoc reset code or weakening AC-M35.
* OQ-2 (non-blocking) — out of scope, not a build-agent judgment call: whether any *other* field could theoretically suffer the same staleness class in the future is not something to audit exhaustively here — `entryDate` and `mealType` are the only two controlled-state fields in the form (everything else is uncontrolled via `defaultValue` + the `key`-remount trick), so this fix closes the bug class completely for the fields that exist today.

## 9. Implementation notes (build agent)

* **IN-1 — Exact changes (revised per §0b Erratum — the split, not just the effect).** File: `app/ui/log-meal-form.tsx`.
  1. Replace the single `mealType` state (line 73) with two states:
     ```ts
     const [mealType, setMealType] = useState<MealType | null>(editEntry?.mealType ?? null); // edit-mode-local
     const [createMealType, setCreateMealType] = useState<MealType | null>(null); // create-mode only
     ```
  2. In the mount effect (lines 98–108), change `setMealType(defaultMealType(...))` to `setCreateMealType(defaultMealType(...))`. That effect stays deliberately mount-only (`[]` deps) and must keep seeding `idempotencyKey` exactly once in create mode, per PRD §9 IN-1 of the Date-Scoped Entries List slice.
  3. Add the sync effect, adjacent to the existing `editDate` one (lines 91–96) — include the `eslint-disable` comment; the repo lints `react-hooks/set-state-in-effect`, already suppressed this same way three times in this file, and CI will fail lint without it:
     ```ts
     useEffect(() => {
       if (editEntry) {
         // eslint-disable-next-line react-hooks/set-state-in-effect
         setMealType(editEntry.mealType);
       }
     }, [editEntry]);
     ```
  4. Derive the effective value near line 132, alongside `entryDate`:
     ```ts
     const effectiveMealType = editEntry ? mealType : createMealType;
     ```
     Use `effectiveMealType` everywhere the radio's `checked`/`ready` computation currently reads `mealType` (lines 133–135, 150, 159).
  5. The radio's `onChange` (line 160) branches by mode, matching the date input's `onChange` at lines 174–180:
     ```ts
     onChange={() => (editEntry ? setMealType(value) : setCreateMealType(value))}
     ```
  No schema change. No change to `defaultMealType()` itself (AC-M34).
* **IN-2 — AC-M35's guard is structural, not extra code.** Because create mode now reads and writes only `createMealType`, and the edit path only ever writes `mealType` (guarded by `if (editEntry)` / `editEntry ? …`), there is no code path where the edit path writes into create-mode state — the leak is closed structurally by the split, not by a reset. Cancel and Save set `editEntry` back to `null` (via `onEditComplete`), at which point the render falls back to `createMealType`, which the edit path never touched. No additional "reset on exit" logic should be needed; if a build agent finds they need one, that's a signal something else is wrong and worth stopping to ask about, not building around.
