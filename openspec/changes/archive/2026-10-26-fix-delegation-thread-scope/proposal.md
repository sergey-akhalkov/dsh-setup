## Why

The delegation gate evaluates every active OpenSpec change in whatever thread the agent runs. A
change created in one thread therefore steers the spec-review and the task-review in every other
thread that opens the same workspace. The owner observed both reviews running in a second thread;
the review obligations should be scoped to the thread where the change's work happens.

## What Changes

- Persist the thread that first observes each active change as its owner under `.dsh/delegation`.
- Evaluate the change-scoped automatic triggers (`spec-ready`, `spec-task-ready`,
  `implementation-work`, `implementation-complete`, and the optional integration review) only in the
  owning thread.
- Refuse a delegated review for a foreign change before starting a target; report the owning thread
  in `delegation_status` and in the review record.
- Keep `task_progress` notes, answer runs, and patch runs available in any thread.
- Add unit coverage and a two-thread live acceptance.
