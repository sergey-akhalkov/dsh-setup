## Why

Two review-delegation problems block the normal review flow:

- `delegate` for a review is synchronous: the tool call waits for the Codex target, so the turn is
  blocked and three finished tasks cannot be reviewed in parallel. The engine also picks "the next
  checked task" itself, so parallel task-review calls race onto the same task.
- The Codex target starts a fresh app-server conversation per run, so every repeated review of the
  same change/task rebuilds its context instead of continuing the earlier review thread.

## What Changes

- Start review runs asynchronously: `delegate` returns a run id once the target is started; the run
  writes its digest-bound record when done and is visible in `delegation_status`; several runs can
  proceed at once.
- Make the review target stable per task: accept an explicit task id for task-scoped reviews so
  parallel calls do not race the engine's next-task selection.
- Reuse one Codex app-server conversation per review key (change + task): persist the thread id and
  resume it for later reviews of the same key instead of creating a new thread each run.
- Keep the existing review contract, records, gates, read-only/write isolation, Serena restrictions,
  and `task_progress`/answer/patch availability.
