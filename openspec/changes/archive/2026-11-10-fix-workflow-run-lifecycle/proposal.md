# Proposal

## Why

GitHub issue #4 reports that the shipped `task-review` workflow (and the other
auto-created runs) can leave runs `running` or `blocked` for hours: a run attributed to
another session cannot be advanced or cancelled, an existing delegation PASS record is
not reused, a run whose checked task was edited away retries a dispatch that cannot
succeed, and a transient dispatch failure leaves `resume` with an inconsistent run.
The stale run also keeps the archive gate blocked after the review already passed.

## What Changes

- `task-review` `start-review` settles from a matching delegation PASS/ERROR record
  instead of dispatching `delegate` again.
- A task-review run whose checked task id is no longer in `tasks.md` is cancelled as
  `superseded` before any dispatch; a duplicate run for the same change and task is not
  created while a live-session run for that pair is open.
- A failed tool dispatch is retried at most three times across turn closes; an
  exhausted run becomes `failed` (terminal), and `resume` accepts a failed run and
  reopens its failed step with a reset attempt count.
- A run owned by a session whose agent is disposed is marked `interrupted`; another
  session may cancel such a run, and the active-runs system-prompt section lists only
  the requesting session's runs.
- `workflows list` names a definition with `allowModelStart: false` as user-started
  instead of reporting a refused model start.

Not a breaking change: run files keep version 1, the shipped definitions keep their
steps, and the archive gate still requires a portable PASS per checked task.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflows`: run lifecycle (session-end interruption), run resume (failed runs),
  model interface (list wording, dead-session cancel, failed resume), system prompt
  context (session scope), and the owned task-review gate (record reuse, supersession,
  duplicate suppression, bounded dispatch attempts).

## Impact

- `packages/plugin-workflows/src/host/{tools,index,intake,resume,runs,executors,gates}.ts`
  and the matching tests under `packages/plugin-workflows/test/`.
- `docs/workflows.md`.
- Generated `packages/plugin-workflows/lib/**` and the vendored
  `packages/setup/node_modules/@dsh-setup/**` tree, refreshed with `pnpm build` and
  `pnpm gen`.
- No new dependency, no definition schema change, no setup default change.
