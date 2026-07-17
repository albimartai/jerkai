# Branch protection for `main`

These settings require repo-admin access on GitHub and must be applied by the repo owner (a build session cannot change repo settings). Run once with the [GitHub CLI](https://cli.github.com/) authenticated as `albimartai`:

```bash
gh api --method PUT repos/albimartai/jerkai/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["test"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

What this enforces:

- **PRs only** — no direct pushes to `main` (applies to admins too, via `enforce_admins`).
- **Required review** — 1 approving review per PR. (Single-owner repo: GitHub does not count self-approval, so this makes merges deliberate via admin merge; drop `required_pull_request_reviews` to `null` if it proves too much friction solo.)
- **CI must pass** — the `test` job from `.github/workflows/ci.yml` is a required status check.
- **Branch up to date** — `strict: true` requires the PR branch to be current with `main` before merge.
- **No force pushes or branch deletion** on `main`.

Verify with:

```bash
gh api repos/albimartai/jerkai/branches/main/protection | jq '{checks: .required_status_checks, reviews: .required_pull_request_reviews.required_approving_review_count, admins: .enforce_admins.enabled}'
```

Click-path alternative: repo → Settings → Branches → Add branch protection rule → pattern `main` → check "Require a pull request before merging" (1 approval), "Require status checks to pass" (select `test`, check "Require branches to be up to date"), "Do not allow bypassing the above settings".
