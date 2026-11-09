# Proposal

## Why

The obligation engine now owns the change-intake pipeline and can read the legacy checkpoint, task-review, and verification records, but the legacy gates still enforce the same behaviors. Two owners means two steers, two sets of config, and two places to reason about a refusal. The owner asked to remove the old gates and move fully to workflows once the engine is ready.

The migration cannot be a blind flip. The legacy gates carry the only working guarantees, the review records, and the checkpoint tool; a missed parity case would remove a guarantee instead of moving it. This change adds the gate-only switches and a release-bound parity report, flips the deferred definitions to `own` only after parity passes, then disables the workflow-owned legacy gates and removes the verification-gate row with a rollback.

## What Changes

- Add gate-only retirement switches: `checkpoint.automation: false` keeps the `work_checkpoint` tool and records but stops the close/parallel/remedy/bottleneck-age gates and the periodic request; `delegation.gates.workflowOwned: false` keeps the delegate tool, review queue, runs, records, `task_progress` notes, and rule data and stops only the `task-review` turn-stopping rule and the archive gate. The whole-spec `spec-review` rule, the task-progress gate, and the lane-assignment/lane-boundary gates stay enabled, so `change-intake` keeps its deferred `spec-review` source.
- Keep the task-progress, lane-assignment, and lane-boundary gates enabled in the legacy review engine. Their workflow replacement and parity are a follow-up change; this change MUST NOT disable them because no workflow yet preserves the unchecked-task progress note, the stale-note rejection, the single-remaining-lane case, or an implementation turn below the checkpoint threshold.
- Flip `task-review` and `retro` from `gateOwnership: defer` to `own` and add their missing steps:
  - `task-review`: start the existing review (`delegate`), accept a matching PASS or ERROR record as intermediate turn-close evidence, require PASS for archive, and require a portable PASS for every checked task when the session's tick completes the change's task list, including tasks this session did not attribute.
  - `retro`: request the `work_checkpoint` tool, verify the lane plan, the bottleneck remedy, and the age rule, and gate the turn close. The decomposition decision moves into this checkpoint contract.
- Add a `verify` definition that reproduces the verification gate: after a code-writing turn, require a foreground zero-exit result for the configured command after the last write, and refuse the close; the agent runs the command, never the definition. Disable and later remove the verification-gate row.
- Add a parity harness and a tracked, release-bound parity report shipped with the workflows bundle under `packages/plugin-workflows/assets/parity/retire-legacy-gates.json`. A legacy behavior MUST NOT move to `own` until the harness passes the legacy gate's scenarios against the workflow gate in shadow and the report covers the shipped definition template hashes and the parity-covered settings matrix. Profile-specific `verify` settings (commands and `maxBlocks`) are validated settings, not part of the template hash, so two profiles with different values load from the same report. `pnpm workflows:parity --check` MUST fail when the report is missing, mismatched, or stale. A fresh installation loads the shipped report and the `own` definitions; a missing or mismatched report MUST refuse the `own` definition and name the legacy switch to re-enable.
- Disable the workflow-owned legacy gate listeners and remove the verification-gate row; keep the legacy task-progress and lane gates enabled, keep the legacy tool/record providers for one release, then delete the dead code. Rollback is a single config flip per gate.
- Update the working contract, docs, AGENTS.md, setup defaults, and the generated tree.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflows`: adds per-signal gate-only migration, the owned checkpoint, task-review, completion-coverage, and verification gates, the retained spec-review, progress, and lane gates, and the release-bound parity report with a settings matrix.
- `work-checkpoints`: adds the gate-only retirement switch that keeps the tool and record while the workflow owns the close gate.
- `delegation-rules`: adds the gate-only retirement switch that keeps the review runtime, the spec-review, progress, and lane gates while the workflow owns the task-review and archive gates.
- `verification-gate`: removes the capability; its behavior becomes the `verify` workflow definition.

## Impact

- `packages/plugin-goal-continuity/src/host/index.ts` and config (automation switch), `packages/plugin-delegation-rules/src/host/index.ts` and config (gate switch), `packages/plugin-verification-gate/**` (row disabled, then removed), `packages/plugin-workflows` definitions, gates, and the tracked parity asset, tests, docs, the working contract asset, `packages/setup/defaults.yml`, the generated setup tree, and `AGENTS.md`.
- The `work_checkpoint`, `task_progress`, `delegate`, review records, queue, and learning store remain; the task-review and archive gates move, the record providers, the spec-review rule, and the retained progress and lane gates do not.
- No new package, DSH version, or review prompt change. The changes are gated by parity and reversible per signal.
- Out of scope: changing the review verdict rule, the goal supervisor/block review/question review, the learning loop, the visual editor, and retiring the task-progress and lane-assignment/lane-boundary gates.
