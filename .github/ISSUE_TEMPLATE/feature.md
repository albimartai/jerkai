---
name: Feature slice
about: A thin vertical slice of work. Must meet the Definition of Ready before build starts.
title: ""
labels: enhancement
---

## What & why

<!-- One paragraph: the user-facing outcome and the reason it matters now. -->

## Spec

<!-- Link the build PRD in docs/prd/ (or the section of an existing PRD) that defines this slice. -->

## Definition of Ready

Work does not start until every item in the [Definition of Ready](https://github.com/albimartai/jerkai/blob/main/docs/definition-of-ready-and-done.md#definition-of-ready-entry-gate) holds for this slice:

- [ ] Acceptance criteria written and testable (Given/When/Then, stable IDs)
- [ ] Scoped to a thin vertical slice; enhancements deferred to explicit fast-follows
- [ ] Data source & schema impact identified (metric/table; migration needed?)
- [ ] Relevant NFRs identified
- [ ] Test approach known (unit vs. disposable-Neon-branch integration; TDD from ACs)
- [ ] Auth/privacy considered (behind Auth.js; no real data on public/demo routes)
- [ ] Dependencies / blockers identified
- [ ] Design / reference artifact linked
- [ ] Dev environment plan clear (Neon dev branch, migration plan, env vars)
