# JerkAI — Definition of Ready & Done (Standard)

> **Type:** Durable standard — the one shared definition of DoR and the **baseline** DoD for every JerkAI slice. Each build PRD references this and adds only its own **feature-specific** completion criteria (never restating the baseline). See [[JerkAI - Decision Log]] DL-2026-07-16-e.
>
> **Canonical source is this vault file.** The repo carries a build-time snapshot at `docs/definition-of-ready-and-done.md` (authored/refreshed by a Claude Code session), the same source-in-vault / snapshot-in-repo pattern used for build PRDs. When this standard changes, update here and re-snapshot the repo copy — do not edit the two independently.
>
> **Last updated:** 2026-07-26

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
- [ ] **Production migration plan clear (if the slice has a migration)** — how the migration reaches prod (the automated `migrate:prod` job once it exists, else the manual diagnose→snapshot→apply→verify release step), identified before build, not discovered at deploy (DL-2026-07-21-c).
- [ ] **Verification method known for anything CI cannot reach.** If the slice's behavior depends on deploy-time or request-time infrastructure that tests don't exercise — host/domain routing, proxy/middleware ordering, redirects, env-var-dependent branches — name how it will be verified *before* build, and prefer a locally reproducible method (production-mode server + spoofed headers) over "open it in a browser after deploy." Where the behavior spans more than one file (e.g. a `proxy.ts` matcher plus a `next.config.ts` rewrite), state the full ordered path a request takes and which file owns each step: each file can be correct in isolation while the pair fails entirely (DL-2026-07-23-a).

## Definition of Done — baseline (exit gate, every slice)

A slice is done only when all of these are true, **in addition to** the feature-specific DoD in its build PRD:

- [ ] **All acceptance criteria met** and demonstrably covered by tests (node-env unit + disposable-Neon integration + jsdom interactive component, as applicable to the AC), authored TDD-style from the ACs.
- [ ] **CI green** — lint + typecheck + unit + jsdom component + integration on a disposable Neon branch.
- [ ] **Migrations applied to production.** If the slice carries a migration, it is not done until that migration is applied to the production Neon database — `npm run migrate` (dev, `--envPath .env.local`) and `migrate:ci` (disposable test branch) do **not** touch prod. Once the automated prod-migrate path exists (`migrate:prod` + the on-merge-to-`main` GitHub Actions job against the `PRODUCTION_DATABASE_URL` secret, DL-2026-07-21-c), this item is satisfied by that job running green on merge; until then it is a manual release step (diagnose prod's `pgmigrations` ledger → snapshot prod → apply → verify). The production connection string is a live credential (Sensitive in Vercel) — never share it into an agent session or commit it; the agent prepares the command, a human runs the prod write. Added after the 2026-07-21 incident where the Log Meal + Edit & Delete Meal tables never reached prod (DL-2026-07-21-c).
- [ ] **Production spot-check performed against the deployed commit.** If a slice is verified by opening a live URL, first confirm the deployment carrying the change is actually live — the Vercel deployment for the merge commit, green and promoted to Production — *before* interpreting what the URL does. A live-domain check run before or during deploy cannot distinguish "not deployed yet" from "broken": the two produce identical symptoms, and a true, independently-verifiable explanation for the first will mask the second. A sufficient explanation is not an exclusive one — when a known-benign cause fully accounts for an anomaly, ask whether the check could have distinguished the alternative at all; if it couldn't, the anomaly is unresolved, not explained. For **host-based routing** specifically, the live-domain browser check is not sufficient evidence in either direction — verify with a production-mode `next start` server and spoofed `Host` headers (and an automated test via `next/experimental/testing/server`, per `tests/unit/proxy-matcher.test.ts`). Added after the 2026-07-23 incident where `demo.jerkai.app` 307'd to `jerkai.app/signin` on merge, and a pre-merge spot-check that *did* surface the exact symptom was correctly-but-insufficiently explained away as "PR not merged yet, plus `auth.ts`'s canonical-host `AUTH_URL` pinning" (DL-2026-07-23-a).
- [ ] **Behind auth** — Auth.js magic-link; no real biometric/nutrition data reachable on any public/demo route.
- [ ] **Responsive** — usable on a phone browser.
- [ ] **Shared date key** — dated data normalized to the device-local calendar day where the slice touches it.
- [ ] **Raw-data-preserved** — raw values shown/stored; trends/derivations computed at render time, never overwriting raw records.
- [ ] **Secret hygiene intact** — no secrets committed; gitleaks pre-commit + GitHub secret scanning passing.
- [ ] Repo PRD snapshot landed. The PRD's repo-side copy is written to `docs/prd/[kebab].md` in the same PR that ships the slice — the import-drop item below presupposes this already happened. A PR that drops the `CLAUDE.md` import without ever landing the file leaves `docs/prd/` silently pointing at whichever slice shipped last.
- [ ] **Merged via PR** (not direct to `main`), with the DoD checklist completed in the PR.
- [ ] **PRD import dropped from `CLAUDE.md` in the same PR.** A Build PRD is imported into `CLAUDE.md` only while its slice is being built; once the slice ships, the shipping PR removes that import. The PRD file stays where it is and remains reachable through the citing PRD's §1 "Required reading" — this drops automatic loading, not availability. `CLAUDE.md` imports durable, every-session context only (`AGENTS.md`, `docs/context.md`, `docs/definition-of-ready-and-done.md`). Added after the import list accumulated five shipped PRDs, so every session loaded completed requirements as live context and could not tell what was still in force (DL-2026-07-26-b, PR #17).
- [ ] **Product-truth reconciliation flagged.** Any material change to product facts — scope, north-star / driver metrics, or a decision — surfaced during the slice is called out in the PR summary for reconciliation into [[JerkAI - Product Brief]] and [[JerkAI - Decision Log]]. This flag is the build session's responsibility; the vault edits themselves are a PM step, **not** performed by the build agent. "PM step" means the PM side of the repo/vault boundary — a Cowork session with the vault mounted, which may author the entry once Albert has confirmed the decision (see "Authoring vs. deciding" below). It does not mean Albert types it. When the Brief changes, re-snapshot `docs/context.md` into the repo so the repo's product context doesn't drift from the vault.

### Authoring vs. deciding (Decision Log and Product Brief)

Added 2026-07-26 (DL-2026-07-26-a).

**Deciding is Albert's and is not delegable.** Every Decision Log entry records his confirmed judgment. An agent that infers a decision from discussion and logs it has fabricated product truth.

**Authoring is mechanical and is delegated.** Once Albert has confirmed a decision, a Cowork PM-side session allocates the `DL-YYYY-MM-DD-x` id, writes the entry in house format, propagates it to the vault docs named in **Affects**, and reports which repo snapshots need re-syncing. Albert reviews the drafted entry before it is appended, and reviews wording only — the mechanics are already handled.

**The build agent's rule is unchanged.** A repo-scoped Claude Code session still flags only and never writes to the vault (DL-2026-07-17-a). That constraint is about a coding agent crossing the boundary, not about who may hold a pen on the PM side.

**Three properties make delegated authoring safe.** The log is append-only, so the worst failure is a visibly wrong new entry rather than corrupted history; reversals are new entries carrying **Supersedes**, never edits; and the entry format is rigid enough to check mechanically. The vault is *not* version-controlled, which is why the draft-then-approve gate exists.

## How PRDs use this

Each build PRD:
- assumes the DoR above was satisfied before build started;
- includes a **feature-specific DoD** section listing only the completion criteria tied to that feature's own ACs;
- ends its DoD with: *"Plus the baseline DoD — see [[JerkAI - Definition of Ready & Done]]."*
