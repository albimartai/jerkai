## Summary

<!-- What does this PR do, and why? Link the spec section (PRD ACs) it implements. -->

## Linked issue

<!-- Closes #NN, or "n/a" with a reason. -->

## Testing done

<!-- Unit / integration tests added or updated; manual verification performed. -->

## Definition of Done

Baseline DoD — every item, from [docs/definition-of-ready-and-done.md](https://github.com/albimartai/jerkai/blob/main/docs/definition-of-ready-and-done.md):

- [ ] All acceptance criteria met, covered by tests authored TDD-style from the ACs
- [ ] CI green (lint + typecheck + unit + integration on a disposable Neon branch)
- [ ] Behind auth — no real biometric/nutrition data reachable on any public/demo route
- [ ] Responsive — usable on a phone browser
- [ ] Shared date key — dated data normalized to the device-local calendar day where touched
- [ ] Raw-data-preserved — derivations computed at render time, never overwriting raw records
- [ ] Secret hygiene intact — no secrets committed; gitleaks + secret scanning passing
- [ ] Merging via PR with this checklist completed

Feature-specific DoD: see the slice's build PRD in `docs/prd/` (for the current slice: [archive/v1-dashboard.md](https://github.com/albimartai/jerkai/blob/main/docs/prd/archive/v1-dashboard.md) §3).

- [ ] Feature-specific DoD from the slice's PRD completed (or n/a for non-feature PRs)
