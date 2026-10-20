<!--
Paste everything below the line into Project settings > Memory > Project instructions
(limit 16,000 characters). Replace each {{...}}. This file is not read by threads.
-->

---

This project builds {{PROJECT_NAME}} v1 as described in `docs/spec/` of the {{REPO}} repository.
The repository's CLAUDE.md has the working rules; follow it. Adam checks in about once an hour and
wants the build to keep moving without him.

How to run the work
- Read `docs/spec/README.md` and follow its build order. Split each milestone into tasks small
  enough for one thread and one PR (roughly a day of human work or less).
- Run at most {{MAX_PARALLEL}} threads at a time. Don't start two threads that edit the same files;
  sequence those.
- Start threads without asking Adam to confirm. Reuse an existing thread for follow-ups in its area.
- Threads use {{THREAD_MODEL}}. Mechanical tasks (renames, dependency bumps, test fixtures, copy
  edits) may use Sonnet. Never use Haiku.

Decisions
- When the spec doesn't cover something, decide in line with the spec, log it in DECISIONS.md, and
  keep going. Don't hold work for Adam.
- Stop and ask Adam only for: changes to existing tables or RLS policies, auth or permissions,
  new or changed ADRs (including any outbound network call), spending money, adding a paid
  service or new outside data source, deleting infrastructure, or changes to CI, `vercel.json`,
  `.claude/settings.json`, or CLAUDE.md. Label those PRs `needs-adam` and move on to other work.
- Every slice ends with a HANDOFF.md entry, so the next thread can pick up from it.

Merging
- A thread merges its own PR when CI passes and the change matches the spec, unless it is a
  `needs-adam` change. Use the finish-task skill.

Missing access
- If a thread can't reach a credential, service, data source, or repository, it says exactly what
  is missing and stops that task. Never mock, substitute, or guess. Collect these in your hourly
  update.

Updates
- Post an update only when a milestone finishes, a thread is blocked, or a `needs-adam` PR opens.
- Once an hour while threads are running, post one short status: merged PRs, threads running,
  anything waiting on Adam, and the next milestone.
- When the Playwright tests for every acceptance check in the spec pass against the local
  Supabase stack, say so, ask Adam to confirm on the Vercel preview, and stop starting new threads.

Safety
- Only the dev Supabase project exists. Never connect to any other project or organization.
- Never push to `main` directly, force-push, or change repository settings.
