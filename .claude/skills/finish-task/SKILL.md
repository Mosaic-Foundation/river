---
name: finish-task
description: Steps to take a completed task from working branch to merged PR in this repo. Use whenever you believe a task is done.
---

# Finish a task

1. Run `npm run check`. If you changed a user flow, also run `npm run test:e2e`. If you changed
   an endpoint and `tests/api` has tests, run them against local Supabase. Fix failures at the
   root cause; don't skip or weaken tests.
2. Ask the `spec-reviewer` subagent to review the change. Fix any blocking gaps it reports and run
   the checks again.
3. Add an entry at the top of `HANDOFF.md` in the format shown there. Update `TESTING.md` if tests
   changed. If you made a call the spec didn't cover, add it to `DECISIONS.md`.
4. Commit in small, focused commits with `Area: what changed` subjects.
5. Before the first push: `git fetch origin main`, rebase on `origin/main`, and re-run step 1.
   After a branch is pushed, never rebase it; if it falls behind, use the update-branch call in
   `CLAUDE.md`.
6. Push, then open a PR with `gh api` (see Merging in `CLAUDE.md`), filling `body` from
   `.github/pull_request_template.md` and linking the spec section. `gh pr` commands are blocked
   in cloud sessions.
7. Check the merge rules in `CLAUDE.md`:
   - If the PR needs Adam, add the label `needs-adam`, say why in the PR, and stop here.
   - Otherwise wait for the `ci` check to pass on the PR's head commit, then squash-merge it.
     If CI fails, fix the cause and push again.
8. If the PR added migrations, after the merge check the `deploy-migrations` run with
   `gh api repos/__REPO__/actions/runs?branch=main&per_page=5` and report its result.
9. In your final message: what changed, the check summary lines, the PR link, and whether it
   merged or is waiting on Adam.
