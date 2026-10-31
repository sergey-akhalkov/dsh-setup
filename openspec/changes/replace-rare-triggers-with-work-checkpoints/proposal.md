# Proposal

## Why

The setup's automatic decomposition and self-reflection features fire almost exclusively inside
OpenSpec changes or active goals. Five of the six shipped automatic delegation rules are
change-scoped; the goal speed review needs an expensive goal round and a cost threshold; the
verification gate ships inert. In ordinary work the agent works in approaches, writes a status,
and stops with no checkpoint — exactly the moment where a reflection or a parallel/serial decision
would help. The owner asked for a hard trigger that fires at that pause, and for the dead or
redundant triggers to be removed rather than left in place.

## What Changes

- **Remove** the shipped `task-progress` (`implementation-work`) and `lane-fanout` (`lane-assignment`)
  rules from the delegation default set. The trigger vocabulary, the `task_progress` tool, and
  existing-profile rules stay; only the shipped defaults stop using them.
- **Remove** the goal-round speed review from goal-continuity: the review child, round-cost metrics,
  next-round brief, follow-through gate, local retro records, `speedReview` configuration,
  `round-review.md`, and the speed-review tests and documentation. The shared `goal-reviewer`
  preset stays for the block review.
- **Add** a `work-checkpoints` capability delivered by the existing goal-continuity bundle:
  - a substantial-pause trigger at a root agent's turn close (at least `minToolCalls` tool calls
    and a write or worker start, not awaiting a user answer, once per turn);
  - one bounded checkpoint steer carrying the observed evidence and asking whether the work is
    done, what is verified, what remains, and whether the remainder has independent parallel lanes;
  - a `work_checkpoint` tool that records the structured decision under `.dsh/work-checkpoints/`;
  - a close gate that refuses the turn close until the checkpoint exists, bounded by `maxBlocks`,
    and, when the checkpoint declares parallel remaining work, requires a tagged worker start
    before closing;
  - goal rounds use the same turn-close path; no separate goal-round trigger is added.
- **Keep** the review-record pipeline: `spec-review`, `task-review`, `integration-review`, the
  archive approval gate, and the `blocker` failure-streak rule. Removing `task-review` would break
  `openspec/review-approval.json` and the repository's CI; it is not part of this change.
- **Update** the always-on working contract: a multi-step task runs under an active goal, and a
  substantial pause ends with a checkpoint. The clauses must fit the existing 1500-estimated-token
  budget by rewriting, not by appending.
- **Update** the goal-continuity observability row with a `tool: work_checkpoint` match so the new
  decisions are counted. This is data; no new row kind or log.
- **BREAKING (behavior):** the goal speed review no longer runs. A profile that still configures
  `speedReview` keeps loading and the section is ignored with a warning, so an upgrade does not
  trap an existing profile.

Out of scope: compaction or context-percentage triggers, the review-approval rules and the archive
gate, the verification gate, Hindsight, and the manual delegation rules.

## Capabilities

### New Capabilities

- `work-checkpoints`: substantial-pause detection, the checkpoint tool and local record, the
  turn-close gate, the parallel-action gate, configuration, and the off switch.

### Modified Capabilities

- `goal-continuity`: the speed-review requirements are removed; the bundle row keeps continuity
  supervision and the block review, and also delivers the work-checkpoint capability. The shared
  reviewer preset is selected only by the block review.
- `delegation-rules`: the shipped default set no longer includes the automatic task-progress and
  lane-fanout rules; the triggers, the tool, and existing-profile behavior remain.
- `session-guidance`: goal-as-work-unit and checkpoint-at-pause clauses, within the existing
  always-on prompt budget.

## Impact

- `packages/plugin-goal-continuity`: host code, config schema, fragment, assets
  (`round-review.md` removed), tests, and package documentation.
- `packages/plugin-delegation-rules`: fragment default rules, tests, and the references to the
  removed rules in its skill and documentation.
- `packages/plugin-working-principles`: the always-on contract asset and its budget test.
- `packages/setup/defaults.yml` (observability row), then the generated setup patch and vendored
  tree via `pnpm gen`.
- `docs/goal-continuity.md`, `docs/delegation-rules.md`, `docs/principles.md`, `docs/plugins.md`,
  and the root `README.md`.
- No new package, bundle, installer array, market entry, or DSH version change. The existing
  goal-continuity row delivers the new capability.
