# Repository rules for `main`

`main` is governed by a **repository ruleset**, not by classic branch protection. This
distinction matters: the classic `branches/main/protection` API returns 404 for this repo
(see "Verify" below), which reads like "no protection" if you don't know a ruleset is what
is actually in force.

## What governs `main`

| | |
|---|---|
| Ruleset name | **Protect main** |
| Ruleset id | **19113136** |
| Target | `branch`, applied to `~DEFAULT_BRANCH` (i.e. `main`) |
| Enforcement | **active** |
| Bypass actors | **none** (`bypass_actors` is `[]`, `current_user_can_bypass: "never"`) |

An empty `bypass_actors` list means nobody is exempt: the rules apply to the repo owner too.
This is the rulesets equivalent of the classic setting that applied protection to admins.
There is no admin escape hatch.

## What it enforces

One bullet per rule type actually present in the ruleset:

- **`pull_request`** — changes reach `main` only through a pull request. Direct pushes are
  rejected. **Zero approving reviews are required** (`required_approving_review_count: 0`),
  so a solo owner can merge their own PR once the checks are green. Code-owner review, stale
  review dismissal, last-push approval and review-thread resolution are all off.
- **`required_status_checks`** — the required checks must be green before merge, and
  `strict_required_status_checks_policy: true` means the PR branch must additionally be
  **up to date with `main`** at merge time. If `main` moves ahead while your PR is open, you
  must update the branch and let the checks re-run before the merge button unlocks.
- **`required_linear_history`** — `main` must keep a linear history, so a merge that would
  create a merge commit is rejected. In practice this means merging with **squash** or
  **rebase**, never a merge commit. (See the known inconsistency below.)
- **`non_fast_forward`** — force pushes to `main` are rejected. History on `main` is
  append-only.
- **`deletion`** — `main` cannot be deleted.

## Required status checks

One context is required:

- **`test`** (integration id `15368`) — the `test` job in `.github/workflows/ci.yml`:
  install → lint → typecheck → unit tests → integration tests against a disposable Neon
  branch.

That is the right set for this repo because `test` is the only job that runs at PR time and
gates the whole quality bar in one context. The other job in the workflow,
`migrate-production`, runs **on push to `main` after the merge has already happened** — it
applies pending migrations to the production Neon branch. A job that only ever runs
post-merge can never report a status on the PR, so it cannot be a required PR check. Adding
it would deadlock every PR waiting for a context that never arrives.

## Known inconsistency: linear history vs. allowed merge methods

The ruleset requires linear history, but both the ruleset's own
`allowed_merge_methods` (`["merge", "squash", "rebase"]`) and the repo setting
`allow_merge_commit: true` still permit merge commits. The consequence is that GitHub offers
a "Create a merge commit" option that the linear-history rule then rejects, so choosing it
fails at merge time rather than being hidden up front. Use squash or rebase. Resolving this
is a repo-settings change and therefore Albert's step, not a session's.

`delete_branch_on_merge` is `false`, so merged feature branches must be deleted by hand.

## Verify

Read the live state with a GET against the rulesets endpoint:

```bash
gh api repos/albimartai/jerkai/rulesets
```

For the full rule list, including required contexts and bypass actors:

```bash
gh api repos/albimartai/jerkai/rulesets/19113136
```

**Note on the older endpoint.** `gh api repos/albimartai/jerkai/branches/main/protection`
returns `404 Branch not protected`. That is expected and is *not* evidence that `main` is
unprotected — it reports only classic branch protection, which this repo does not use. Read
the rulesets endpoint instead.

## Where it lives in the UI

Repo → **Settings** → **Rules** → **Rulesets** → **Protect main**.

Not Settings → Branches; that page covers classic protection and shows nothing here.

## Changing this

Edits are made in the UI at the path above, or via a `PUT` to
`repos/albimartai/jerkai/rulesets/19113136`. Either way this is a repo-settings change and is
**Albert's step, not a build or docs session's** — sessions are read-only against the GitHub
API and must report a needed change rather than making it.
