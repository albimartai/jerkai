# JerkAI — Definition of Ready & Done (Standard)

**Type:** Durable standard — the one shared definition of DoR and the **baseline** DoD for every JerkAI slice. Each build PRD references this and adds only its own **feature-specific** completion criteria (never restating the baseline). See [[JerkAI - Decision Log]] DL-2026-07-16-e.

**Canonical source is this vault file.** The repo carries a build-time snapshot at `docs/definition-of-ready-and-done.md` (authored/refreshed by a Claude Code session), the same source-in-vault / snapshot-in-repo pattern used for build PRDs. When this standard changes, update here and re-snapshot the repo copy — do not edit the two independently.

**Last updated:** 2026-07-21

---

## Session start (every Claude Code build/docs prompt)

Every build or docs session prompt opens with an explicit branch-from-fresh-main step, before any other work:

```
git checkout main
git fetch origin --prune
git pull --ff-only
git checkout -b <type>/<short-name>   # e.g. feat/log-meal
```

Do not branch from any existing feature branch, and do not reuse a leftover local branch. Confirm the new branch's base is current — `git log --oneline -1 main` should match `origin/main` — before starting work. (DL-2026-07-18-c.)

## Definition of Ready (entry gate)

A slice is ready to enter development when all of these are true:

- [ ] **Acceptance criteria** are written and testable (Given/When/Then, with stable IDs).
- [ ] **Thin vertical slice** — scoped to the smallest end-to-end usable unit; enhancements deferred to explicit fast-follows (delivery principle, DL-2026-07-16-b).
- [ ] **Data source & schema impact identified** — which `biometric_readings` metric / which table; whether a migration is needed.
- [ ] **Relevant NFRs identified** for this slice (perf, privacy, resilience, etc.).
- [ ] **Test approach known** — which of the three tiers each AC lands in: **node-env unit** (pure logic), **disposable-Neon-branch integration** (DB/write-path), and **jsdom interactive component** (`@testing-library/react` + `jsdom`, for ACs that require simulating a DOM event and asserting a re-render/re-fetch); TDD expected (derive tests from ACs). Any AC describing user-visible client interactivity (change a field, click, and assert what re-renders) belongs in the interactive tier — string-match/`renderToStaticMarkup` tests do not satisfy it. The interactive tier was adopted 2026-07-21 (DL-2026-07-21-b); a slice that first introduces a new test tier lands that harness setup as a separate self-contained commit ahead of feature work.
- [ ] **Auth/privacy considered** — behind Auth.js; no real data on public/demo routes.
- [ ] **Dependencies / blockers identified** — including which other slices must ship first.
- [ ] **Design / reference artifact linked** — wireframe, hi-fi, or spec the build follows.
- [ ] **Dev environment plan clear** — Neon dev branch, migration plan, env vars.

## Definition of Done — baseline (exit gate, every slice)

A slice is done only when all of these are true, **in addition to** the feature-specific DoD in its build PRD:

- [ ] **All acceptance criteria met** and demonstrably covered by tests (node-env unit + disposable-Neon integration + jsdom interactive component, as applicable to the AC), authored TDD-style from the ACs.
- [ ] **CI green** — lint + typecheck + unit + jsdom component + integration on a disposable Neon branch.
- [ ] **Behind auth** — Auth.js magic-link; no real biometric/nutrition data reachable on any public/demo route.
- [ ] **Responsive** — usable on a phone browser.
- [ ] **Shared date key** — dated data normalized to the device-local calendar day where the slice touches it.
- [ ] **Raw-data-preserved** — raw values shown/stored; trends/derivations computed at render time, never overwriting raw records.
- [ ] **Secret hygiene intact** — no secrets committed; gitleaks pre-commit + GitHub secret scanning passing.
- [ ] **Merged via PR** (not direct to `main`), with the DoD checklist completed in the PR.
- [ ] **Product-truth reconciliation flagged.** Any material change to product facts — scope, north-star / driver metrics, or a decision — surfaced during the slice is called out in the PR summary for reconciliation into [[JerkAI - Product Brief]] and [[JerkAI - Decision Log]]. This flag is the build session's responsibility; the vault edits themselves are a PM step, **not** performed by the build agent. When the Brief changes, re-snapshot `docs/context.md` into the repo so the repo's product context doesn't drift from the vault.

## How PRDs use this

Each build PRD:
- assumes the DoR above was satisfied before build started;
- includes a **feature-specific DoD** section listing only the completion criteria tied to that feature's own ACs;
- ends its DoD with: *"Plus the baseline DoD — see [[JerkAI - Definition of Ready & Done]]."*
