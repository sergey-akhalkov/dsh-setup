# Design

## Context

See `proposal.md` - Why. The legacy behavior is not one gate:

- `plugin-goal-continuity` owns the `work_checkpoint` tool and its record, plus the close, parallel, remedy, and bottleneck-age gates and the periodic request.
- `plugin-delegation-rules` owns the `delegate` tool, the review queue, runs, records, `task_progress`, the turn-stopping gate, the task-progress gate, the lane-assignment/lane-boundary gates, and the archive gate.
- `plugin-verification-gate` owns the check-before-close gate and its command list.
- The `workflows` engine already has `gateOwnership: defer|own`, the turn-close gate, the pre-execute archive gate, and the `change-intake` definition. The deferred `task-review` and `retro` definitions are visibility only.

The migration therefore moves **enforcement** while keeping the **tools and records**. Deleting the providers first would remove the checkpoint record, the review records, and the only working guarantees. The parity suite is the proof that the workflow decision equals the legacy decision before a switch is flipped.

## Goals / Non-Goals

**Goals:**

- Flip the three deferred behaviors to `own` only after the release-bound parity report passes.
- Disable the workflow-owned legacy gates with one config switch per provider while keeping the tools and records.
- Keep the task-progress and lane-assignment/lane-boundary gates enabled in the legacy provider; their workflow replacement is a later change.
- Keep a one-flip rollback per gate.
- Leave the goal supervisor, block review, question review, review queue, and learning loop untouched.
- Remove the `verification-gate` capability and later delete the dead code.

**Non-Goals:**

- Changing the review verdict rule, the review prompt, the goal supervisor, or the block/question review.
- A single all-or-nothing switch. Each gate has its own switch and parity entry.
- Deleting the legacy tool providers in the same release as the flip. One release is the rollback window.
- Retiring the task-progress, lane-assignment, or lane-boundary gates. They remain enabled in this change; a later change adds the workflow obligation and its parity report first.
- A new gate behavior not already in the workflows spec.

## Decisions

### 1. Gate-only switches are added to the providers, not to the workflow engine

- `plugin-goal-continuity` config gains `checkpoint.automation: false` (default true). It keeps the `work_checkpoint` tool, the local record, and the lane schema; it stops the periodic request and the close/parallel/remedy/age gates.
- `plugin-delegation-rules` config gains `delegation.gates.workflowOwned: false` (default true). It keeps the `delegate` tool, queue, runs, records, `task_progress` notes, rule data, the whole-spec `spec-review` rule, and the task-progress and lane-assignment/lane-boundary gates; it stops only the `task-review` turn-stopping rule and the archive gate.
- `plugin-verification-gate` keeps its existing row config but is disabled in the setup defaults; the `verify` definition takes its commands and `maxBlocks` as validated profile settings.

The progress and lane gates stay on because the early workflows do not cover their cases: the task-review workflow starts on a checked task, while the progress gate also allows an unchecked task held by a current progress note and rejects a stale note; the checkpoint parallel rule needs two runnable lanes, while the lane-assignment gate also reports the single remaining unchecked lane and an implementation turn below the checkpoint threshold. Their retirement requires a workflow that reproduces those cases and passes parity, so it is a follow-up change.

The workflow engine's load check is the guard against a split state: an `own` definition or step is refused while its matching legacy signal is enabled, and a `defer` definition or step is refused unless that signal is enabled. Ownership is resolved per declared legacy signal, not per provider. The intake definition's `spec-review` step declares `legacy: { plugin: "delegation-rules", signal: "spec-review" }`; that signal stays enabled when `delegation.gates.workflowOwned` is false, so the intake loads with a deferred step, its other steps remain owned, and the legacy `spec-ready` rule still steers a missing spec review. The `task-review` definition declares `signal: "task-review"`, which the switch disables, so a `defer` task-review definition is refused. The verification definition declares `signal: "verification-gate"`. Enabled means the gate would actually steer: the provider row and bundle are loaded, the signal is enabled, and for verification the row has a non-empty `commands` list. An installed but inert source is not enough for a `defer` definition, and installation alone does not block an `own` definition. This refines the install-only check introduced with the workflow engine. The owner flips the switch and the definition in one config change.

### 2. Parity is a shared fixture table and a release-bound artifact

`pnpm workflows:parity` runs a fixture table through both paths and writes one bounded JSON report. The report is tracked at `packages/plugin-workflows/assets/parity/retire-legacy-gates.json`, is packaged with the plugin, and is vendored by the setup:

```json
{
  "v": 1,
  "change": "retire-legacy-gates",
  "at": "2026-11-08T00:00:00.000Z",
  "templates": {
    "retro": "sha256-...",
    "task-review": "sha256-...",
    "verify": "sha256-..."
  },
  "settings": {
    "verify.commands": {
      "type": "non-empty string list",
      "cases": ["pnpm check", "rtk pnpm check", "cargo test"]
    },
    "verify.maxBlocks": { "type": "positive safe integer", "cases": [1, 8, 129] }
  },
  "gates": {
    "checkpoint": { "cases": 12, "mismatches": 0, "status": "pass" },
    "task-review": { "cases": 16, "mismatches": 0, "status": "pass" },
    "verification": { "cases": 12, "mismatches": 0, "status": "pass" }
  },
  "retained": {
    "task-progress": { "cases": 6, "status": "legacy" },
    "lane-assignment": { "cases": 9, "status": "legacy" },
    "spec-review": { "cases": 4, "status": "legacy" }
  },
  "mismatches": []
}
```

- The fixture table is derived from the legacy tests and the spec scenarios: a substantial turn with no checkpoint, a worker/lead bottleneck, an aged bottleneck, a missing review, a PASS record, an ERROR record, a FINDINGS record, a stale digest, a code write with and without a zero-exit check, a non-code turn, a reviewed tick, a fresh progress note, a stale progress note, the first implementation turn, one lane completed leaving a single unchecked lane, an implementation turn below the checkpoint threshold, a final tick with an unapproved foreign task, a final tick with an ERROR foreign task, an intermediate-turn ERROR close, and two profiles with different command lists and `maxBlocks` values, including a legacy cap above 128.
- The legacy path is the existing gate function; the workflow path is the `own` definition run in shadow mode. Both return an allow/refuse decision and a reason code. The retained task-progress, lane-assignment, and spec-review cases are recorded with the legacy decision and a `legacy` status; they do not gate a flip in this change.
- A mismatch fails the command, writes the mismatch case id and the two reasons, and blocks the migration. The report contains no prompts, credentials, or machine paths.
- The template hash covers the trigger, steps, evidence shape, gate ownership, and settings schema. It does not include the validated `verify.commands` or `verify.maxBlocks` values: the settings contract accepts the full positive-safe-integer cap range, the matrix cases cover command and cap variations including a cap above 128, and two profiles with different values load from the same report. A change to the template still requires a new report.
- `pnpm workflows:parity --check` recomputes the table, ignores the informational `at` field, and fails when the tracked report is missing, a gate is not `pass`, or a template hash or settings case result differs. The release gate runs it, so the shipped report cannot go stale after a template edit.
- The workflow loader reads the report from the installed plugin package, not from the workspace: it compares each `own` definition's canonical template hash with the report entry and refuses the definition when the report is missing, the hash differs, or the gate status is not `pass`. It validates the profile's settings against the settings contract, whose matrix covers command and cap variations; it does not hash the values. `.dsh/workflows/parity/` may hold a local diagnostic copy, but it is never evidence.
- Delivery and activation are release-bound. The setup vendors the plugin package including the report, and ships the `own` definitions only in a release whose fresh-workspace migration test passes. That test installs the built setup into a throwaway `DSH_HOME`, asserts the report exists with matching template hashes and the settings matrix, the `own` definitions load, the retired task-review and archive gates do not steer, and the spec-review, task-progress, and lane gates do. It also loads two profile overrides with different `verify.commands` and `maxBlocks` values, including a legacy cap above 128. The setup defaults MUST NOT disable a legacy gate in a release without that passing report. If an installed profile has no valid report, the loader refuses the `own` definition with the report path, the expected and actual hash, and the legacy switch to re-enable.

### 3. The `retro` definition owns the checkpoint gate

`retro` flips to `own` and gains:

1. `checkpoint` (`main`): steer `work_checkpoint` with the lane plan, bottleneck, and remedy; evidence is a fresh checkpoint record for the turn.
2. `verify` (host): apply the lane-plan, remedy, and age rules to the record; evidence is the verdict.
3. `close` (host): the turn-close gate refuses until the verdict is `pass`; `maxBlocks` and the visible `VIOLATION` remain.

The periodic request is retired with the automation; the workflow requests the checkpoint at a substantial turn close. Re-adding a mid-turn trigger to the workflow is a later change if the data shows a need; the parity suite covers the turn-close cases. The checkpoint lane plan's parallel check (the lane plan plus a tagged worker start for independent lanes, read by the `verify` step) is additive, not a replacement: the legacy lane-assignment gate stays enabled and keeps reporting the first implementation turn, the single remaining unchecked lane, and an implementation turn below the checkpoint threshold until a later workflow reproduces those cases and passes parity. The plan-time lane shape stays a whole-spec review criterion.

### 4. The `task-review` definition owns the review gate

`task-review` flips to `own` and gains:

1. `start-review` (`tool`): call the existing `delegate` rule for the checked task; the review queue and records stay in delegation-rules.
2. `await-review` (`record`): a matching PASS or ERROR record is intermediate turn-close evidence; FINDINGS is not. `ERROR` MUST allow an intermediate turn close and MUST NOT approve the task; only a matching PASS approves it.
3. `complete-review` (host): when the session's tick completes the change's task list, require a portable PASS for every checked task in the change, including tasks this session did not attribute; a missing or ERROR record refuses the close.
4. `close`/`archive`: the turn-close gate accepts PASS or ERROR for an intermediate task, the completion branch requires PASS coverage for the completed list, and the archive gate refuses every checked task without a PASS.

This preserves the legacy PASS-only approval boundary: an ERROR may let an intermediate turn close, but the task remains unapproved and the archive stays refused until a re-review returns PASS. It also preserves the completing-session coverage branch: a final tick with an earlier unapproved foreign task cannot close before the archive attempt. The parity suite must compare the PASS, ERROR, and FINDINGS intermediate decisions, the completion case with an unapproved foreign task, the completion case with an ERROR foreign task, and the archive decision separately.

The `task_progress` note remains the evidence for the retained legacy task-progress gate: a code-changing turn still closes only with a newly checked reviewed task or a note whose worktree digest matches, and a stale note reopens the gate. The review learning loop still reads the records.

### 5. The `verify` definition owns the verification gate

`verify` is a new definition:

- Trigger: `turn.stopping` with a filter that the turn wrote a non-`.md` file outside the excluded paths.
- Step `check`: evidence is a foreground shell result for the configured command, exit 0, no signal/timeout/denial, received after the last code write.
- The definition does **not** execute the command; the agent runs it, and the evidence verifier reads the result. This preserves the legacy boundary.
- `commands` and `maxBlocks` are validated profile settings, not template content: a profile copies its legacy values into the definition settings and the parity settings matrix covers the command and cap variations, including a legacy cap above 128. Only a change to the template (trigger, steps, evidence shape, gate ownership) requires a new report.
- `maxBlocks` and the bounded steer come from the workflow turn-close gate.

The verification-gate capability is removed; its eight requirements are replaced by this definition and the workflow's turn-close gate. The row stays installed and disabled for one release as rollback. While the row is enabled, an `own` `verify` definition is refused; while it is disabled, a `defer` `verify` definition is refused.

### 6. Migration order and rollback

```
intake (own) -> task-review shadow parity -> retro shadow parity -> verify shadow parity
-> flip own + disable the matching workflow-owned legacy gate (one change per gate)
-> live check -> fresh-workspace migration test -> one release -> delete dead code
```

- Each flipped gate has its own parity entry, switch, definition flip, and rollback.
- A split state is refused by the workflow loader: an `own` definition or step requires its matching legacy signal disabled; a `defer` definition or step requires it enabled. A `defer` definition or step beside a disabled signal is refused instead of silently leaving no enforcer. Ownership is checked per declared signal, so the delegation switch disables the `task-review` and archive signals without disabling the `spec-review` signal.
- The `spec-review` signal is not in this sequence. It stays enabled, so `change-intake` keeps its deferred spec-review step and the legacy `spec-ready` rule still steers a missing spec review after `delegation.gates.workflowOwned` is false.
- The task-progress and lane-assignment/lane-boundary gates are not in this sequence. They stay enabled in the legacy provider; a later change must reproduce their cases in a workflow, pass the release-bound parity suite, and disable the legacy gate in the same change.
- The completing-session approval coverage is in the `task-review` workflow's completion branch, not only the archive gate: a final tick requires a portable PASS for every checked task, including foreign tasks.
- Rollback: re-enable the legacy switch and flip the definition to `defer`. The workflow stops steering; the legacy gate resumes; the records and tools are untouched.
- The code deletion is a follow-up after the live check; it removes the retired listeners and the verification row, not the shared record readers, the retained progress and lane gates, or the still-enabled spec-review rule.

### 7. Contract and documentation move with the gate

- `assets/working-principles/contract.md` names the active workflow as the checkpoint/review owner and keeps the 1500 estimated-token budget.
- `docs/goal-continuity.md`, `docs/delegation-rules.md`, `docs/review-approval.md`, `docs/plugins.md`, `AGENTS.md`, and `docs/openspec-status.md` name the switch, its per-signal ownership, the tracked parity report and settings matrix, the parity command, the migration order, the retained progress, lane, and spec-review gates, the completion coverage, and the rollback.
- The setup defaults disable only the workflow-owned legacy gates, and only in a release whose tracked report covers the shipped templates and settings matrix; the generated tree carries the switches, the `own` definitions, and the parity asset. The retained progress, lane, and spec-review gates stay enabled.

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| A parity fixture misses a legacy edge case. | The fixture table is derived from the legacy tests and spec scenarios; a live shadow period follows; the old gate stays installed for one release. |
| Both gates steer during the split. | The loader refuses `own` while the matching legacy signal is enabled and `defer` unless it is enabled; the switch and the flip are one config change. |
| A gate is off with no replacement. | Only a workflow-owned signal is switched off, and only with its parity PASS and `own` definition; the retained spec-review, progress, and lane gates are not switched off. The old gate is the rollback. |
| A fresh installation has no parity evidence. | The report is a tracked asset in the same release as the `own` definitions and the disabled switches; `pnpm workflows:parity --check` and the fresh-workspace migration test gate the release. A profile with a missing report refuses the `own` definition and names the switch to re-enable. |
| The tracked report goes stale after a template edit. | `pnpm workflows:parity --check` compares the template hashes and settings case results in the release gate; the release is blocked on a mismatch. |
| The retirement switch removes the intake's deferred spec-review source. | Ownership is resolved per declared signal: the delegation switch disables `task-review` and the archive gate but leaves the `spec-review` signal enabled, so `change-intake` loads and a missing spec review still steers. A test covers this case. |
| A profile's verify settings differ from the shipped template. | `verify.commands` and `maxBlocks` are validated settings outside the template hash; the settings matrix covers command and cap variations including a cap above 128, and the migration test loads two profiles with different values. |
| The completing-session coverage is lost in the split. | The owned task-review completion branch requires a portable PASS for every checked task when the final tick completes the list; parity covers an unapproved foreign task and an ERROR foreign task while keeping the intermediate ERROR close. |
| The progress or lane gate is retired without its cases. | This change keeps both gates enabled; a later change must reproduce the reviewed-tick-or-note, stale-note, single-remaining-lane, and below-threshold cases and pass parity before disabling them. |
| The task-review workflow and the retained progress gate both steer a code-changing turn that ticks an unreviewed task. | The workflow is the only review steer and the progress gate names the same tick-and-review action. The overlap lasts one release, until a later change ports the progress obligation and disables the legacy gate. |
| The workflow's checkpoint steer differs from the tool's expected shape. | The `main` step uses the exact `work_checkpoint` schema; the evidence verifier reads the same record; a shape mismatch is a parity failure. |
| The review queue/records are disabled by the switch. | The switch only disables the task-review rule and the archive gate; the queue, runs, records, tools, and spec-review rule are tested after the switch. |
| The verification command is executed twice. | The `verify` definition never executes it; it reads the shell result, exactly as the legacy boundary requires. |
| The mid-turn `stepInterval` request is retired with the checkpoint automation. | The turn-close checkpoint remains and the workflow is the owning path; a mid-turn trigger is a later change if the observed need returns. |
| The contract grows over its 1500-token budget. | The contract edit is a replacement, not an addition; the asset budget test runs. |
| The old code is deleted too early. | The deletion is a follow-up after one release and a live check; the retired row and listeners stay for rollback, and the retained spec-review, progress, and lane gates stay in place. |
| A profile does not install the new setup. | The migration is config-gated; until the owner installs, the legacy gates remain the enforcing path. The docs state this. |
| The user sees two gates during the shadow period. | The deferred workflow adds no steer; the parity shadow is read-only; the Workflows view shows the would-refuse decision. |

## Migration Plan

1. Add the two gate-only switches and the parity command; keep every legacy gate enabled, including the spec-review, task-progress, and lane gates, and both definitions `defer`.
2. Run the parity suite, commit the tracked report, and run `pnpm workflows:parity --check`; fix any mismatch before flipping.
3. Flip `task-review` to `own` and set `delegation.gates.workflowOwned: false` in one config change; run a live task check and confirm the task-review run is the only task-review steer, the spec-review, task-progress, and lane gates still steer, and the final-tick completion coverage refuses an unapproved foreign task.
4. Flip `retro` to `own` and disable the checkpoint automation in one config change; run a live turn and confirm one checkpoint steer.
5. Add `verify`, move the profile's `commands` and `maxBlocks` into its validated settings, disable the verification-gate row, and confirm one check steer on a code-changing turn.
6. Update the contract, docs, AGENTS, setup defaults, and the generated tree; ship the tracked report; run the fresh-workspace migration test, including two profiles with different `verify` settings; release.
7. After one release and a live profile check, delete the dead legacy listeners and the verification-gate package row. Rollback remains the previous config. The retained spec-review, task-progress, and lane gates stay for the follow-up change.

## Open Questions

None. The mid-turn periodic checkpoint request stays with goal-continuity for this change; moving it into the workflow is a later, separate change if the turn-close request is not enough.
