# Proposal

## Why

The setup installs two plugins that both enforce process gates. `@dsh-setup/plugin-delegation-rules`
is 8,359 source lines and 13,741 test lines with 70 requirements; `@dsh-setup/plugin-workflows` owns
the run model, the definition registry, the archive gate, and the checkpoint, task-review, and
verification closes. Both install an `agent/turn-stopping` gate, both can refuse an archive, and both
keep a record store.

The split is transitional, not designed. `delegation.gates.workflowOwned: false`,
`checkpoint.automation: false`, and the disabled verification row already moved three of the four
delegation gates into workflow definitions. What remains is the review runtime plus the retained
`spec-review`, task-progress, and lane gates, and the `retire-legacy-gates` contract already
describes the conditions for retiring them. Workflows also re-implements delegation's record
parsing for evidence and for the UI, and its `task-review` definition dispatches `delegate` only
because no native review executor exists.

The owner's decision recorded here: one plugin and one gate system; the review runtime moves into
workflows and the delegation plugin is deleted. This change is the first of two releases, because
the same contract requires the replacement to run in a live profile before the legacy code is
deleted.

## What Changes

- **ADD** a native `review` executor: it resolves a reviewer, renders a bundled instruction with the
  change, task, and digest context, takes a frozen snapshot for task scope, enforces the fenced
  verdict contract, writes the record, publishes the portable approval, and settles the step from
  its own evidence.
- **ADD** a trigger `condition`: a bounded JSONLogic predicate over the event, the change's tasks and
  lanes, the current records and digests, and the session's involvement, evaluated at every turn
  close, so the review triggers stay conditions rather than events.
- **ADD** reviewer routing (`reviewers`) and review queue/timeout settings on the workflows row; the
  shipped `codex` target moves from the delegation row into `reviewers.codex`.
- **ADD** the local review record store under `.dsh/workflows/records/**`. The committed approval
  keeps its path and field set, so `pnpm reviews:check`, the archive marker, and archived changes
  are unchanged.
- **ADD** owned work-progress and lane-assignment gates, and a `workflows` tool action `note` that
  replaces `task_progress`; the goal-complete guard moves to the workflows gate listener.
- **ADD** per-signal legacy switches
  (`workflowOwned`, `specReview`, `integrationReview`, `taskProgress`, `laneFanout`) beside the
  existing switch, disable every legacy signal in the same change, and extend the parity report;
  the shipped definitions resolve their effective ownership from these switches, so rollback is one
  flip and needs no definition edit.
- **ADD** owner-aware compatibility tools: `delegate` and `task_progress` route to the workflows
  runtime and its state while the signal is owned, and to the retained legacy runtime and its state
  while the signal is enabled, so a rolled-back gate is satisfied by the call the legacy steer
  prints.
- **MODIFY** the shipped definition set: engine-shipped `spec-review`, `task-review`, and
  `integration-review` built on the review executor, and the contributed `change-intake` step
  becomes owned instead of deferred.
- **MODIFY** the Workflows UI: a review step renders its contract (prompt, digest scope, verdict
  schema, reuse policy) in the inspector, and each engine-owned gate renders as a read-only
  contract card rather than a fake definition.
- **ADD** copies of the bundled review instructions (`review-spec`, `review-task`,
  `review-integration`) in the workflows assets and keep the delegation copies until Release B, so a
  rolled-back legacy configuration still resolves its `bundled:` instruction.
- **KEEP** the delegation row installed for exactly one release with its rules — including a dormant
  `implementation-work` note rule for the progress gate — and its target still configured and every
  gate switch off: no legacy steer runs, the rules data stays available, and rollback is one switch
  flip. The review prompt assets are copied, not moved.
- **BREAKING (next change)**: [`retire-delegation-rules`](../retire-delegation-rules/proposal.md)
  deletes the plugin, folds its remaining requirements into `workflows` and `review-approval`, and
  removes the row, docs, skill, observability row, legacy prompt copies, and bundle entries. It starts
  only after this change is archived and its live profile confirmation is recorded; its design records
  that the per-signal rollback flips below apply only before that release ships. Its creation is the
  last task of this change and is not part of this implementation.

## Capabilities

### Modified Capabilities

- `workflows`: new review executor, trigger condition, reviewer routing, review record store,
  owned progress and lane gates, per-signal legacy switches, shipped review definitions, contract
  surfaces, and the retirement of the retained gates.
- `delegation-rules`: the shipped target moves to `reviewers`; the gate-only switch becomes a
  per-signal map; the row ships no rules.
- `review-approval`: the approval is written by the review executor, with the same committed format
  and ordering guarantees.

## Impact

- `packages/plugin-workflows/src/host/**`, `src/client/**`, `assets/**`, `test/**`.
- `packages/plugin-delegation-rules/cordis.fragment.yml`, `src/host/**` (switches), `test/**`,
  `assets/**` (the review prompts move out).
- `packages/plugin-openspec/assets/workflows/change-intake.json` and its tests.
- `packages/setup/defaults.yml` and the generated setup patch, manifest, and vendored tree
  (`pnpm gen`).
- `docs/workflows.md`, `docs/delegation-rules.md`, `docs/plugins.md`, `docs/openspec-status.md`,
  `openspec/specs/workflows/spec.md`, `openspec/specs/delegation-rules/spec.md`,
  `openspec/specs/review-approval/spec.md`.
- The observability signal map gains the workflows-owned review signals and keeps the
  `delegation-rules` row until Release B.

Out of scope: deleting the delegation plugin; ad-hoc delegation (`subagent`, `codex_subagent`,
`create_worktree`); new review scopes; changing the committed approval format or the audit
commands.
