# Spec Delta

## ADDED Requirements

### Requirement: Retirement parity

A legacy gate behavior SHALL move to a workflow `own` definition only after a release-bound parity report passes. The report SHALL be a tracked asset at `assets/parity/retire-legacy-gates.json`, replay legacy scenarios in shadow, and include the covered template hashes. `pnpm workflows:parity --check` MUST fail on a missing, stale, or mismatched report; a fresh installation SHALL load the shipped report and `own` definitions; the release MUST NOT disable a legacy gate without a passing report.

#### Scenario: Parity passes

- **WHEN** every legacy scenario produces the same allow/refuse decision in the workflow shadow run
- **THEN** the tracked report covers the template hashes and the migration may flip the ownership

#### Scenario: Fresh installation

- **WHEN** the setup is installed on a workspace with no history
- **THEN** the shipped parity report, the settings matrix, and the matching `own` definitions are present, their template hashes match, and all load successfully

#### Scenario: Parity fails

- **WHEN** one scenario differs, the report is missing, a template hash changed, or a gate status is not `pass`
- **THEN** the `own` definition is refused at load and the release does not ship defaults that disable the matching legacy signal

#### Scenario: Report is release-bound

- **WHEN** a definition template changes after the report was generated
- **THEN** `pnpm workflows:parity --check` fails with the definition id and the expected and actual template hash, and the release is blocked

#### Scenario: Missing report at runtime

- **WHEN** an installed profile has no readable or matching report
- **THEN** the loader refuses the `own` definition with the report path, the expected and actual hash, and the legacy switch to re-enable

### Requirement: Gate-only switches

The migration SHALL use the gate-only switches: `checkpoint.automation: false`, `delegation.gates.workflowOwned: false`, and the disabled verification-gate row. The delegation switch SHALL stop only the `task-review` turn-stopping rule and the archive gate and MUST leave the `spec-review` whole-spec rule, the task-progress gate, and the lane-assignment and lane-boundary gates enabled.

#### Scenario: One config flip

- **WHEN** the owner disables the legacy task-review gate and flips the definition to `own` in the same config change
- **THEN** the workflow loads and the legacy task-review gate no longer steers

#### Scenario: Spec-review signal is retained

- **WHEN** `delegation.gates.workflowOwned` is false
- **THEN** the whole-spec `spec-review` rule still steers a missing spec review

### Requirement: Per-signal legacy ownership

Legacy ownership SHALL be resolved per declared signal, not per provider. An `own` definition or step MUST be refused while its matching legacy signal is enabled; a `defer` definition or step MUST be refused unless that signal is enabled. The `spec-review` signal remains enabled after `delegation.gates.workflowOwned: false`; the `task-review` and archive signals follow that switch; `work_checkpoint` follows `checkpoint.automation`; verification follows its row configuration.

#### Scenario: Intake own steps load beside the retained spec-review signal

- **WHEN** `change-intake` is `own` for its other steps and its `spec-review` step is `defer` while the `spec-review` signal is enabled
- **THEN** the intake loads, the other steps are owned, and the spec-review step reads the legacy record

#### Scenario: Intake spec-review defer loads after the switch

- **WHEN** `change-intake` has its `spec-review` step `defer`, the `spec-review` signal is enabled, and `delegation.gates.workflowOwned` is false
- **THEN** the intake loads, the step reads the legacy spec-review record without adding a second steer, and it does not dispatch its executor

#### Scenario: Missing spec review still steers

- **WHEN** the intake's `spec-review` step is `defer` and a change has no matching spec-review PASS after the switch is false
- **THEN** the legacy `spec-ready` rule steers the spec review and the intake step remains open

#### Scenario: Task-review defer with the switch off is refused

- **WHEN** `task-review` is `defer` and `delegation.gates.workflowOwned` is false
- **THEN** the definition is refused because its matching signal is disabled

#### Scenario: Defer with the checkpoint switch off is refused

- **WHEN** `retro` is `defer` and `checkpoint.automation` is false
- **THEN** the definition is refused and neither owner is silently left enforcing the checkpoint

#### Scenario: Defer with the verification row disabled is refused

- **WHEN** a `verify` definition is `defer` and the verification-gate row is disabled
- **THEN** the definition is refused and neither owner is silently left enforcing verification

#### Scenario: Defer with an inert verification row is refused

- **WHEN** a `verify` definition is `defer` and the verification-gate row is active but has no configured command
- **THEN** the definition is refused because the row would not steer

#### Scenario: Enabled defer loads

- **WHEN** the definition is `defer` and its matching legacy signal is enabled
- **THEN** the definition loads and reads the legacy record without adding a second steer

#### Scenario: Installed but inert source does not block own

- **WHEN** the definition is `own` and the matching legacy source is installed but its signal is disabled
- **THEN** the definition loads and the disabled source does not steer

#### Scenario: Split state is refused

- **WHEN** the definition is `own` while the matching legacy signal is still enabled
- **THEN** the definition is refused with the split-state diagnostic and the switch that MUST be turned off

#### Scenario: Rollback

- **WHEN** the owner re-enables the legacy signal and flips the definition back to `defer`
- **THEN** the legacy signal steers again and the workflow adds no second steer

### Requirement: Owned checkpoint gate

When `retro` is `own`, the workflow SHALL request `work_checkpoint` at a substantial turn close, SHALL verify the lane plan, including the tagged worker start for independent lanes, the bottleneck remedy, and the age rule, and SHALL refuse the close until the evidence is present. The `work_checkpoint` tool and record MUST remain available, and the legacy checkpoint automation MUST be off.

#### Scenario: Checkpoint is requested

- **WHEN** a substantial turn stops with `retro` in `own` mode
- **THEN** the workflow steers the checkpoint request and the turn does not close without a fresh record

#### Scenario: Remedy is verified

- **WHEN** a checkpoint names a bottleneck remedy
- **THEN** the workflow verifies the remedy evidence before the close

#### Scenario: Aged bottleneck

- **WHEN** the same bottleneck survives the configured age
- **THEN** the workflow refuses the close until the owner, the blocking lane, or the user decision changes

#### Scenario: Tool remains

- **WHEN** the checkpoint automation is off
- **THEN** the `work_checkpoint` tool still writes its record and the workflow reads it as evidence

### Requirement: Owned task-review gate

When `task-review` is `own`, the workflow SHALL start the review through `delegate`, accept a matching PASS or ERROR record as intermediate turn-close evidence, and refuse the close while the record is FINDINGS or missing. `ERROR` MUST allow an intermediate turn close and MUST NOT approve; the archive gate MUST require a PASS for every checked task. The queue, records, and learning loop MUST remain, and the legacy task-review rule and archive gate MUST be off.

#### Scenario: Review is started

- **WHEN** a task is checked and the workflow is `own`
- **THEN** the workflow starts the existing review rule for that task

#### Scenario: FINDINGS is refused

- **WHEN** the review returns FINDINGS
- **THEN** the workflow refuses the close and names the next review action

#### Scenario: ERROR closes an intermediate turn but does not approve

- **WHEN** the review returns ERROR, the turn does not complete the task list, and no other obligation is open
- **THEN** the turn may close, the task remains unapproved, and the archive still requires a PASS

#### Scenario: PASS approves

- **WHEN** every checked task has a matching PASS record
- **THEN** the turn may close and the archive gate allows the archive

#### Scenario: Archive is gated

- **WHEN** a change has a checked task without a PASS
- **THEN** the archive gate refuses and names the run and the missing task

#### Scenario: Review runtime remains

- **WHEN** the legacy task-review rule and archive gate are off
- **THEN** the delegate tool, queue, records, and lesson store still work

### Requirement: Owned completion coverage

When the session's tick completes the change's task list, the owned task-review gate SHALL require a portable PASS for every checked task in the change, including tasks this session did not attribute. A missing or ERROR record MUST refuse the turn close; only an intermediate turn that does not complete the list MAY close on ERROR.

#### Scenario: Final tick with an unapproved foreign task is refused

- **WHEN** the session's tick completes the task list and an earlier checked task from another session has no portable PASS
- **THEN** the turn close is refused and the steer names that task and its review call

#### Scenario: Final tick with an ERROR foreign task is refused

- **WHEN** the session's tick completes the task list and an earlier checked foreign task has only an ERROR record
- **THEN** the turn close is refused because ERROR is not a portable PASS

#### Scenario: Completed list with PASS coverage closes

- **WHEN** the session's tick completes the task list and every checked task has a portable PASS
- **THEN** the turn close is allowed and the archive is ready

### Requirement: Owned verification

The `verify` definition SHALL reproduce the verification gate: after a code-writing turn, it SHALL require a foreground zero-exit result for the configured commands after the last write, and refuse the close until that result exists. The definition MUST NOT execute the command; the agent runs it. In the migrated setup, the legacy `verification-gate` row MUST be disabled and MUST NOT steer.

#### Scenario: Check is required

- **WHEN** a turn wrote code and the verify definition is active
- **THEN** the close is refused until the configured command exits zero after the last write

#### Scenario: Command is not executed by the gate

- **WHEN** the definition names a command
- **THEN** the definition does not execute it; the agent runs it and the workflow reads the result

#### Scenario: Legacy row is silent

- **WHEN** the verification-gate row is disabled
- **THEN** it produces no steer and the workflow is the only gate

### Requirement: Profile settings parity

The `verify` definition's `commands` and `maxBlocks` SHALL be validated profile settings outside the parity-bound template hash. The report's settings matrix SHALL cover the accepted command shape and the positive-safe-integer cap range, including a case above 128, with parity cases for at least two command lists; any setting the contract accepts SHALL load with the shipped report. A change to the template still requires a new report.

#### Scenario: Two profiles load with different settings

- **WHEN** two profiles set different `verify.commands` and `maxBlocks` values
- **THEN** both load from the same shipped report, their settings are validated, and neither changes the template hash

#### Scenario: Legacy cap above 128 is preserved

- **WHEN** a profile sets `verify.maxBlocks` to 129
- **THEN** it loads, the settings matrix includes that case, and the turn-close gate uses 129 refusals

#### Scenario: Invalid setting is refused

- **WHEN** a profile sets an empty command, or a non-positive, fractional, or unsafe `maxBlocks`
- **THEN** plugin load fails with the field and the accepted positive-safe-integer shape

#### Scenario: Template change is refused

- **WHEN** the definition's trigger, steps, evidence shape, or gate ownership changes
- **THEN** the template hash no longer matches and the definition is refused until a new report is shipped

### Requirement: Retained task-progress gate

The retirement switch MUST NOT disable the delegation-rules task-progress gate. It SHALL keep refusing a code-changing turn close unless every checked task the session attributed has a matching PASS or ERROR record and the turn has a newly checked reviewed task or a `task_progress` note whose worktree digest matches. A stale note MUST NOT authorize the close or count as a PASS.

#### Scenario: Unchecked task still needs a note

- **WHEN** a code-changing turn leaves its task unchecked and has no matching `task_progress` note
- **THEN** the retained progress gate steers to a note or a reviewed tick and the turn does not close for that gate

#### Scenario: Current note allows the close

- **WHEN** a code-changing turn carries a `task_progress` note whose worktree digest matches the current worktree
- **THEN** the retained progress gate allows the close with the task still unchecked

#### Scenario: Stale note is rejected

- **WHEN** the worktree digest changes after the note
- **THEN** the retained progress gate refuses the close and requires a fresh note or a reviewed tick

### Requirement: Retained lane-assignment gate

The retirement switch MUST NOT disable the delegation-rules lane-assignment or lane-boundary triggers. The lane-assignment gate SHALL keep requiring a tagged worker start per unassigned non-serial lane or a matching serial note, and SHALL keep reporting the first implementation turn, the single remaining unchecked lane after another lane completes, and an implementation turn below the checkpoint substantial threshold.

#### Scenario: Single remaining lane is reported

- **WHEN** the turn ticks the last task of lane A and lane B is the only remaining unchecked lane in a plan with two non-serial lanes
- **THEN** the retained lane-assignment gate reports lane B and names the exact worker or serial-note call

#### Scenario: Below the checkpoint threshold

- **WHEN** an implementation turn ticks a task but does not reach the checkpoint substantial threshold and leaves an unassigned non-serial lane
- **THEN** the retained lane-assignment gate reports that lane; it does not depend on a checkpoint request

#### Scenario: Retained gates survive the switch

- **WHEN** `delegation.gates.workflowOwned` is false
- **THEN** the progress, lane-assignment, and lane-boundary gates still load and steer with the old review engine

### Requirement: Retained gate retirement

A later change MUST NOT retire a retained spec-review, progress, or lane gate before a workflow reproduces every retained case, the release-bound parity report covers it, and the legacy switch is disabled in the same change.

#### Scenario: Later retirement is parity-gated

- **WHEN** a later change proposes to retire a retained gate
- **THEN** the workflow reproduces every retained case, the release-bound report covers it, and the legacy gate is disabled in the same change

### Requirement: Migration completion

The migration SHALL be complete only when every retired gate has a passing parity entry, the matching gate-only switches are off, the `own` workflow is the only steer for that behavior, the retained spec-review, progress, and lane gates are still enabled, and the setup defaults and docs name the workflow owner and the retained legacy gates. The legacy code MAY be deleted after one release; the tool and record providers MUST remain until the replacement has run in a live profile.

#### Scenario: Migration completes

- **WHEN** every retired parity entry passes and the matching switches are off
- **THEN** the setup defaults disable only those legacy gates, keep the retained spec-review, progress, and lane gates enabled, and the docs name the workflow definitions

#### Scenario: Replacement is proven

- **WHEN** the owner reads the Workflows view after a live run
- **THEN** the checkpoint, task-review, and verification obligations appear as workflow runs with evidence

#### Scenario: Code is not deleted early

- **WHEN** the replacement has not completed a live profile run
- **THEN** the legacy code and tool providers remain available for rollback
