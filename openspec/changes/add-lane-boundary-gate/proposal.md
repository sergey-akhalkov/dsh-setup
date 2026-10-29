# Proposal

## Why

In a long goal the agent parallelizes once, while it is still cutting the spec, and then stops
forever. Measured on the longest retained goal session (6.5 hours, 8 turns, 431 tool calls): two
teammates were started in turn 1 and no worker was started in any later turn, while the session
kept doing all remaining implementation work itself. The plan already knows better — `tasks.md`
carries lane headings with owned paths — but nothing reads a lane after the change is authored: the
task parser is a flat list and the gate only ever asks for "the next unchecked task".

The only mechanism that held for the whole session was the turn-stopping gate: task reviews kept
running for six hours because the gate refuses to close a turn without one. Prompt-level guidance
did not hold: the task-lane addendum tells the implementer to fan lanes out and was still not
followed, because during apply the model is never shown the remaining work as lanes at a moment
when the choice is still open.

## What Changes

- Add `parseTaskLanes` to the shared task parser: a lane is the tasks under the nearest preceding
  level-2 heading, and its owned paths are the backticked segments of that heading.
- Add a seventh engine trigger, `lane-boundary`: it fires when a task this session ticked completed
  the last unchecked task of its lane while another non-tail lane still has unchecked tasks and the
  turn started no parallel worker.
- Add the shipped default rule `lane-fanout` (`contract: note`, `gate: strict`, no target, no model
  call) so the behavior needs no configuration.
- The steer names every remaining lane with its owned paths and prints the exact `subagent` call
  that takes the lane, so fanning out is one paste rather than a planning exercise.
- Use the existing `task_progress` note as the serial escape: the turn may also close when a note
  for a task in a remaining lane matches the current worktree. No new tool, record, or artifact.
- Record per-turn worker evidence from successful `subagent`, `subagent_fork`, `spawn_teammate`,
  and `workflow` tool results.
- Document the trigger, the payload, the escape, and the fail-open limits.

No new plugin, no new row, no new tool, no always-on prompt text, and no new dependency.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `delegation-rules`: the trigger vocabulary grows from six triggers to seven, and the shipped
  default rule set gains a lane-boundary fan-out gate satisfied by a fan-out or a recorded serial
  decision.

## Impact

- `packages/plugin-delegation-rules/src/shared/approval.ts` — lane parsing next to the existing
  numbered-task parser.
- `packages/plugin-delegation-rules/src/host/index.ts` — trigger vocabulary and validation,
  per-turn tick and worker evidence, the gate condition, and the steer payload.
- `packages/plugin-delegation-rules/cordis.fragment.yml` — the default `lane-fanout` rule.
- Tests in `packages/plugin-delegation-rules/test/` and documentation in `docs/delegation-rules.md`
  and `docs/openspec-status.md`.
- Generated and committed afterwards: the plugin patch, `lib/**`, and the vendored setup tree.
- Model-facing cost: no new tool description and no new system-prompt section; the rule is
  configuration and the steer text exists only while it fires. The on-demand skill body grows by a
  few lines inside its existing byte budget.
- Opt-out stays the plugin row; no in-session bypass is added.
