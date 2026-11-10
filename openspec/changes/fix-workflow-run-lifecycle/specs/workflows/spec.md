# Spec Delta

## MODIFIED Requirements

### Requirement: Run lifecycle

A run SHALL be persisted atomically under `.dsh/workflows/runs/<runId>.json` with definition, trigger, session, workspace, status, steps, and evidence. Status SHALL be `running`, `blocked`, `completed`, `failed`, `cancelled`, or `interrupted`. On startup, a run left `running` or `blocked` by a previous process SHALL be marked `interrupted` and MUST NOT be auto-completed. When the session that owns a run ends (its agent is disposed), its `running` or `blocked` runs SHALL be marked `interrupted` with a bounded reason; that path MUST NOT complete a run and MUST NOT change its step states. An advancement that was in flight when the session ended MUST NOT persist a non-interrupted state for that run: the engine records the ended run identity and re-checks it before and after persisting, replacing a stale advance with the interrupted state.

#### Scenario: Run is durable

- **WHEN** a step settles
- **THEN** the run file is atomically replaced with the new state and remains readable after a restart

#### Scenario: Restart marks unfinished runs

- **WHEN** the plugin loads and finds a run left `running` by an earlier process
- **THEN** it is marked `interrupted` with a bounded reason and is not completed automatically

#### Scenario: Session end marks its runs interrupted

- **WHEN** the session owning a `running` or `blocked` run is disposed
- **THEN** the run is marked `interrupted` and stays resumable by id

#### Scenario: Cancellation is recorded

- **WHEN** the user cancels a run
- **THEN** its status becomes `cancelled` and the open step is recorded as cancelled

### Requirement: Run resume

An `interrupted`, `blocked`, or `failed` run SHALL be resumable by run id at its pending step. Resuming MUST NOT recreate a change directory, restart a resolved step, or start a second run; it SHALL re-evaluate only the pending step from durable state. A failed step SHALL be reopened with its failure evidence, reason, failure class, and attempt count cleared.

#### Scenario: Interrupted run resumes at its pending step

- **WHEN** an interrupted run is resumed by id
- **THEN** it continues at its pending step, its status returns to `running`, and no second run starts

#### Scenario: Failed run reopens its failed step

- **WHEN** a failed run is resumed by id
- **THEN** its failed step becomes open with no evidence or reason, its attempts reset, and the status returns to `running`

#### Scenario: Resume does not recreate a change

- **WHEN** an interrupted intake is resumed after `create-change`
- **THEN** the existing change directory is left in place and the pending `spec` step is re-evaluated

### Requirement: Model interface

The `workflows` tool SHALL expose `list`, `start`, `resume`, `status`, `evidence`, and `cancel`. `start` SHALL require `allowModelStart` and user confirmation for `risk: high`. `list` SHALL name a definition whose `allowModelStart` is false as user-started and MUST NOT report it as a refused or failed model start. `resume` SHALL continue an `interrupted`, `blocked`, or `failed` run in the current session and workspace at its pending step without starting a new run. `cancel` SHALL be allowed for a run of the current session or for a run whose owning session has no live agent. `evidence` SHALL be accepted only when the host verifies it. The tool MUST NOT accept a raw script or definition, install one, start an adoption, or write an adoption receipt.

#### Scenario: List definitions

- **WHEN** the model calls `list`
- **THEN** it receives the definitions it may start, their trigger modes, and whether a start is model-allowed or user-started

#### Scenario: Allowed start

- **WHEN** the model starts a definition with `allowModelStart: true`
- **THEN** one run starts and the tool returns its id

#### Scenario: Refused start

- **WHEN** the model starts a definition without `allowModelStart`
- **THEN** the start is refused with the next action

#### Scenario: Interrupted run resumes

- **WHEN** the model calls `resume` with an interrupted run id in its session
- **THEN** the run continues at its pending step and no new run starts

#### Scenario: Failed run resumes

- **WHEN** the model calls `resume` with a failed run id in its session
- **THEN** the failed step is reopened and the run continues at it

#### Scenario: Dead-session run is cancellable

- **WHEN** the model calls `cancel` for a run whose owning session has no live agent
- **THEN** the run is cancelled and its open step is recorded as cancelled

#### Scenario: Live foreign run is not cancellable

- **WHEN** the model calls `cancel` or `resume` for a run whose owning session is live and different from the caller
- **THEN** the call is refused and the run is left unchanged

#### Scenario: Raw script is refused

- **WHEN** the model submits a script instead of a definition id
- **THEN** the tool rejects the call

### Requirement: System prompt context

The engine SHALL add at most one bounded line per active run of the requesting session to the system prompt, naming the definition and the current step, and SHALL add no section when no run is active. It MUST NOT present a run of another session as this session's obligation; an assembly scope without a session keeps the workspace-scoped list. The line MUST NOT include a full prompt or definition.

#### Scenario: Active run is named

- **WHEN** one run is active
- **THEN** the system prompt carries one line with the definition and current step

#### Scenario: No run adds no section

- **WHEN** no run is active
- **THEN** the system prompt is byte-identical without the workflow section

#### Scenario: Line is bounded

- **WHEN** many runs are active
- **THEN** the section is capped and no full prompt is included

#### Scenario: Another session's run is not listed

- **WHEN** the assembly scope names a session and another session has an active run in the same workspace
- **THEN** the section lists only the requesting session's runs

### Requirement: Owned task-review gate

When `task-review` is `own`, the workflow SHALL start the review through `delegate` only when no matching PASS or ERROR record exists for the run's change and checked task; a matching record SHALL settle the `start-review` step from that record without dispatching `delegate`. It SHALL accept a matching PASS or ERROR record as intermediate turn-close evidence and refuse the close while the record is FINDINGS or missing. Before advancing any nonterminal task-review run it SHALL compare the run's checked task id with `openspec/changes/<change>/tasks.md` and cancel the run as `superseded` when the id is absent, regardless of which step is pending, and MUST NOT start a second run for the same change and task while a live-session run for that pair is open. A failed tool dispatch SHALL be retried at most three times across turn closes; after the cap the step SHALL remain failed and the run SHALL become `failed` (terminal), and the turn-close gate MUST NOT refuse for that run's failed dispatch. That terminal exemption SHALL apply only to the failed dispatch: the retained completion-coverage and task-progress checks SHALL still refuse a final tick without a portable PASS, and the archive gate SHALL still require a PASS for every checked task. `ERROR` MUST allow an intermediate turn close and MUST NOT approve. The queue, records, and learning loop MUST remain, and the legacy task-review rule and archive gate MUST be off.

#### Scenario: Review is started

- **WHEN** a task is checked, the workflow is `own`, and no matching review record exists
- **THEN** the workflow starts the existing review rule for that task

#### Scenario: Matching record settles the start step

- **WHEN** a checked task already has a matching PASS or ERROR record
- **THEN** `start-review` settles from that record without dispatching `delegate` and the run advances to its record and coverage steps

#### Scenario: Removed task is superseded

- **WHEN** a task-review run's checked task id is no longer present in `tasks.md`
- **THEN** the run is cancelled as superseded before the next advance, regardless of which step is pending, and names the missing task

#### Scenario: Restored task starts a fresh run

- **WHEN** a superseded run's task text is restored and checked again
- **THEN** the cancelled run is not resumed and a fresh task-review run starts for the restored task

#### Scenario: Duplicate run is suppressed

- **WHEN** a task-review run for the same change and task is open in a live session
- **THEN** no second run starts for that pair

#### Scenario: Dispatch failure is bounded

- **WHEN** a `start-review` dispatch fails and the run has fewer than three attempts
- **THEN** the step stays failed and the next advance retries it

#### Scenario: Exhausted dispatch is terminal

- **WHEN** the third `start-review` dispatch fails
- **THEN** the step remains failed, the run becomes `failed`, and the failed-dispatch refusal stops, while the completion-coverage check still refuses a final tick without a portable PASS

#### Scenario: Failed step resumes

- **WHEN** a failed task-review run is resumed
- **THEN** its `start-review` step reopens and a later advance dispatches it again

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
