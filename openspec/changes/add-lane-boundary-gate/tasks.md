# Tasks

Lanes: 1 (plugin package and tests) and 2 (documentation) are independent and touch disjoint paths;
3 is the serial tail (generated output and the full repository gate).

## 1. Plugin package and tests (lane 1, owns `packages/plugin-delegation-rules/**`)

- [x] 1.1 Add lane parsing to `packages/plugin-delegation-rules/src/shared/approval.ts`: a `TaskLane` shape and `parseTaskLanes(markdown)` returning, per lane, the level-2 heading title, its backticked owned paths, and its numbered tasks, with tasks before the first heading in an untitled lane and a task-id lookup across lanes. Keep `parseTasksText` unchanged. Verify `pnpm exec vitest run packages/plugin-delegation-rules/test/approval.test.ts` covers several lanes with owned paths, an untitled prefix, a change with no headings, CRLF input, a heading with no backticks, and a lookup by task id.
- [x] 1.2 Add the `lane-boundary` trigger to the engine: the `Trigger` union, the `TRIGGERS` set, and configuration validation for a `note` rule with a strict gate and no target; register the shipped default rule `lane-fanout` in `packages/plugin-delegation-rules/cordis.fragment.yml`. Document the trigger and the default rule in `packages/plugin-delegation-rules/assets/delegation-rules/SKILL.md` (trigger table, default-rules table, and the serial escape). Verify `pnpm exec vitest run packages/plugin-delegation-rules/test/config.test.ts` accepts the rule and rejects a target, a `review` contract, and an unknown trigger, and `pnpm build` emits the widened union.
- [x] 1.3 Record the per-turn worker evidence in `packages/plugin-delegation-rules/src/host/index.ts`: a successful `subagent`, `subagent_fork`, `spawn_teammate`, or `workflow` tool result marks the turn as having started a parallel worker, the mark is cleared at the turn start, and lane completion is derived from this session's own `tasks.md` before/after write pair rather than from the turn baseline, so another session's final tick cannot gate this one. Verify `pnpm exec vitest run packages/plugin-delegation-rules/test/gate.test.ts` shows that a failed worker start does not count, that a worker start from a previous turn does not settle the current boundary, and that a lane completed by another session does not gate the first session.
- [x] 1.4 Implement the `lane-boundary` condition and its steer in `packages/plugin-delegation-rules/src/host/index.ts`: report only when a write in this turn completed a lane, another non-tail lane has an unchecked task, no worker started this turn, and no matching progress note names a task in a remaining lane; compose the message with a checkpoint command that force-adds the change directory, each remaining lane title, its owned paths, a complete `subagent` call that requires the worker to create its own branch and worktree before editing and forbids ticking `tasks.md`, and the `task_progress` call for a serial decision, with no machine path; fail open on an unreadable `tasks.md` or a change without headings. Verify `pnpm exec vitest run packages/plugin-delegation-rules/test/gate.test.ts` covers fan-out required, worker started, escape note, mid-lane tick, single-lane change, serial-tail-only remainder, a lane completed by another session, a renamed completed lane, a reopened lane, a removed completion task, a deleted last unchecked task, a remaining lane without owned paths alongside an owned one, unreadable `tasks.md` leaving only the soft artifact hint, the root-anchored forced-add checkpoint (`git add -A :/` and `:(top)`) and worktree instructions in the payload, the prohibition on ticking `tasks.md`, and the absence of a machine path.

## 2. Documentation (lane 2, owns `docs/delegation-rules.md`, `docs/openspec-status.md`)

- [x] 2.1 Update `docs/delegation-rules.md`: add `lane-boundary` to the trigger list, describe what fires the gate and what does not, the lane and serial-tail definitions, the `subagent` payload, the `task_progress` serial escape, the fail-open limits, and the `lane-fanout` default row in the default-rules table. Verify `pnpm lint` passes and the page names `lane-boundary`, `lane-fanout`, `task_progress`, the level-2 heading rule, and the `serial` heading rule.
- [x] 2.2 Record the change in `docs/openspec-status.md` as a recent change entry naming its capability, its task count, and that it ships inside `@dsh-setup/plugin-delegation-rules` with no composition change. Verify `pnpm lint` passes and the entry names `add-lane-boundary-gate`.

## 3. Serial tail: generated output and the repository gate

- [ ] 3.1 Run `pnpm gen` and `pnpm build`, then confirm `packages/plugin-delegation-rules/cordis.patch.yml` carries the `lane-fanout` row, `packages/setup/cordis.patch.yml` carries it, the vendored `packages/setup/node_modules/@dsh-setup/plugin-delegation-rules` tree matches the package, and `lib/**` is current; verify `pnpm gen:check` exits 0 and `git diff --exit-code` is clean after the generated and built output is committed.
- [ ] 3.2 Run `pnpm check`, `pnpm validate:repo`, and `pnpm validate:composition`; verify they all pass and the repository gate finishes with a clean worktree.

## Workflow follow-up

- Run `pnpm reviews:check --change add-lane-boundary-gate` and confirm every checked task has a
  committed `reviews/<taskId>.json` task-review PASS.
- Sync the `delegation-rules` delta into the main spec with the `openspec-sync-specs` workflow.
- Archive the change after the sync and the approval audit.
- Owner follow-up: the shipped rule reaches a machine only after the next release and install; a
  profile that replaces the whole `rules` config must restate `lane-fanout` to keep it.
