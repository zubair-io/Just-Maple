# Branch Protection Configuration

To ensure deployments are blocked by failing tests, configure these branch protection rules on GitHub:

## Main Branch Protection

**Settings → Branches → Branch protection rules → Add rule**

**Branch name pattern:** `main`

### Required Settings:

✅ **Require a pull request before merging**

- Require approvals: 1

✅ **Require status checks to pass before merging**

- Require branches to be up to date before merging
- **Required status checks:**
    - `build-and-test` (CI job)
    - `e2e-tests` (E2E tests job)

✅ **Require conversation resolution before merging**

✅ **Do not allow bypassing the above settings**

- Includes administrators (recommended for strict enforcement)

### Optional but Recommended:

✅ **Require linear history** (no merge commits)

✅ **Require deployments to succeed before merging**

- This ensures staging deploys work before merging to main

## Development Branch Protection

**Branch name pattern:** `development`

Same as main, but you can optionally:

- Reduce required approvals to 0 for faster iteration
- Keep status checks required

## How it Works

1. **Developer opens PR** → CI runs automatically
2. **CI runs:**
    - Unit tests (`build-and-test` job)
    - E2E tests (`e2e-tests` job)
3. **If CI fails** → PR cannot be merged
4. **If CI passes** → PR can be merged
5. **On merge to main** → Deploy workflow triggers
6. **Deploy workflow checks** → Only runs if CI passed
7. **Deployment happens** → Only when all tests pass

## Emergency Override

If you need to bypass protection (production emergency):

1. Use `workflow_dispatch` trigger in deploy-api.yml
2. Manually trigger deployment from GitHub Actions tab
3. This bypasses CI requirement (use with caution!)

## Testing the Setup

1. Create a branch with a failing test
2. Open PR to main
3. Verify CI runs and fails
4. Verify PR shows "Required status checks must pass"
5. Verify merge button is disabled
