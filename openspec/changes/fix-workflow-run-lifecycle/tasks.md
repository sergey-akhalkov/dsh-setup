# Tasks

The change has one serial order: the run-lifecycle engine first, then the docs and the
generated tree. Both lanes are serial because one agent owns the whole change; no
parallel work is planned.

## 1. Run lifecycle engine (serial, owns `packages/plugin-workflows/src/host/**`, `packages/plugin-workflows/test/**`)

- [x] 1.1 Reuse a matching task-review PASS/ERROR record at `start-review` without dispatching `delegate`; verify the host-wiring and intake tests cover reuse and the FINDINGS/missing fallback.
- [x] 1.2 Cancel a task-review run whose checked task id is no longer in `tasks.md` as superseded before advancing any pending step, including a run already waiting at `await-review`; suppress a duplicate run for the same change and task while a live-session run for that pair is open; verify both, and that a restored task starts a fresh run because the cancelled run does not suppress it.
- [x] 1.3 Bound failed tool dispatches at three attempts, mark an exhausted run `failed`, and stop only the failed-dispatch refusal; verify the retained completion coverage still refuses a final tick without a portable PASS.
- [x] 1.4 Accept a failed run in `resume` and reopen its failed steps with evidence, reason, failure class, and attempts cleared; verify through the runs test and the engine path.
- [x] 1.5 Allow cancelling a run whose owning session has no live agent, mark that session's `running`/`blocked` runs `interrupted` on `agent/disposed`, refuse a stale advance that would revive an ended run, and scope the active-runs prompt to the requesting session; verify each.
- [x] 1.6 Rename the `workflows list` model-start wording to user-started and keep `model-start allowed` for the allowed case; verify the text.

## 2. Docs and generated tree (serial, owns `docs/workflows.md`, `packages/plugin-workflows/lib/**`, `packages/setup/node_modules/@dsh-setup/**`)

- [x] 2.1 Update `docs/workflows.md` with record reuse, supersession, the bounded retry and failed resume, session liveness, the dead-session cancel, and the session-scoped prompt.
- [x] 2.2 Run `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm gen`, `pnpm gen:check`, and the repository validators; commit the regenerated `lib/**` and setup tree.
