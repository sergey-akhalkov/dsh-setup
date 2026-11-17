# workflows Specification

## Purpose
Defines stored workflow definitions, event and optional intent triggers, durable obligation runs, step executors, evidence verification, and the gates that refuse a turn close or a creation/archive command while a required step is open.

## Requirements

### Requirement: Workflow definition

The plugin SHALL load workflow definitions from `.dsh/workflows/definitions/*.json`, the approved local overrides, the engine's own shipped definitions, and the definitions registered by installed plugins through the host registry service. A definition SHALL carry an id, name, version, trigger, an ordered step list, and settings; it MUST be data, not executable code. A plugin-contributed definition SHALL be read-only and SHALL name its contributing plugin as its source. The engine MUST NOT read a plugin's package files, scan package directories, or accept a config path list. An unknown field, a missing step id, a duplicate step, or an invalid edge SHALL fail load with the definition and field.

#### Scenario: Valid definition loads

- **WHEN** a definition has a known schema, unique step ids, and valid edges
- **THEN** it is listed and can be started

#### Scenario: Invalid definition is refused

- **WHEN** a definition has a duplicate step id or an unknown field
- **THEN** plugin load fails with the definition id and the field

#### Scenario: Shipped defaults are read-only

- **WHEN** the user has not created a local definition
- **THEN** the installed definitions (engine-shipped or plugin-contributed) are available and cannot be edited in place

#### Scenario: Contributed definition loads

- **WHEN** an installed plugin registers a valid definition while the registry service is available
- **THEN** the definition is listed with the plugin as its source and can start under the same rules as an engine-shipped definition

### Requirement: Workflow description

A workflow definition MAY carry an optional human-readable `description` of at most 500 characters. The description SHALL be definition data, SHALL pass the same closed-schema validation as every other field, and MUST NOT change the trigger, steps, or evidence. The editor SHALL let the user edit it, and the workflow list, the inspector, and the session workflow page SHALL show it; a definition without one SHALL show an explicit empty state rather than borrowed text.

#### Scenario: Description is shown

- **WHEN** a definition carries a description
- **THEN** the workflow list, the inspector, and the session workflow page show it, and the graph and runs are unchanged

#### Scenario: Description is optional

- **WHEN** a definition has no description
- **THEN** it loads and runs unchanged and the surfaces show the documented empty state

#### Scenario: Description is bounded and validated

- **WHEN** a description is longer than the bound or is not a string
- **THEN** the definition fails validation with the definition and the field

#### Scenario: Description is data only

- **WHEN** a description contains JSON, a command, or a path
- **THEN** it is stored and displayed as text and MUST NOT be executed or used as evidence

### Requirement: Deterministic triggers

A deterministic trigger SHALL match one of `turn.stopping`, `tool.pre-execute`, `tool.result`, `fs.change`, `subagent.end`, or `review.record`, with an optional workspace, session, tool, path, or subject filter. It SHALL be `shadow` or `active`; a shadow trigger records without creating a run. A matched active trigger SHALL create at most one run per dedupe key.

#### Scenario: Shadow trigger records only

- **WHEN** a shadow trigger matches a turn stop
- **THEN** the evaluation is recorded and no run is created

#### Scenario: Active trigger creates a run

- **WHEN** an active trigger matches an event with no existing run for its key
- **THEN** one run is created and its first step is requested

#### Scenario: Filter mismatch

- **WHEN** a file event is outside the trigger's path filter
- **THEN** the evaluation records `filter-mismatch` and no run starts

### Requirement: Intent trigger

An intent trigger MAY classify a user message with a model and create a run only when `allowIntent` is true. It MUST be labeled `intent`, MUST record the classifier, confidence, and reason, and MUST default to shadow. An active intent trigger MUST require a user-confirmed definition and MUST NOT be presented as a deterministic event.

#### Scenario: Intent is shadow by default

- **WHEN** an intent trigger matches a message and `allowIntent` is false
- **THEN** the evaluation records the classifier and confidence and no run starts

#### Scenario: Active intent needs opt-in

- **WHEN** a definition marks an intent trigger active without `allowIntent`
- **THEN** its runs are refused and the trigger stays shadow

#### Scenario: Classification is visible

- **WHEN** an intent evaluation is recorded
- **THEN** the Why-not entry names the classifier, confidence, and reason

### Requirement: Trigger evaluation and dedupe

Each observed event SHALL be evaluated against every trigger and SHALL record matched or not matched with one reason: `event-mismatch`, `filter-mismatch`, `not-applicable`, `dedupe`, `disabled`, `not-ready`, or `error`. A dedupe key SHALL include the trigger, session, and the event's turn or path/tool subject; a repeated key MUST NOT create a second run unless the definition sets `repeat: true`.

#### Scenario: Reason is recorded

- **WHEN** an event does not match a trigger's subject filter
- **THEN** the evaluation says `filter-mismatch` and names the rejected subject

#### Scenario: Non-applicable observation is suppressed

- **WHEN** a trigger's legacy applicability decision returns false
- **THEN** the evaluation records `not-applicable` and no run is created

#### Scenario: Duplicate is suppressed

- **WHEN** the same trigger and subject are observed twice in one turn
- **THEN** the second evaluation says `dedupe` and no second run starts

#### Scenario: Repeat is explicit

- **WHEN** a definition sets `repeat: true` and the same subject recurs
- **THEN** a new run is created and the previous run is not modified

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

### Requirement: Step model and evidence

A step SHALL carry an id, a title, an executor, a prompt, a completion contract, and a next step or condition. The completion contract SHALL be `file`, `record`, `tool`, `check`, `human`, or `all`; an `all` contract SHALL be a non-empty recursive list satisfied only when every item passes, and its failure SHALL name the first failing item. A `declaration` MAY be used only for a step marked `nonCritical`. A critical step MUST NOT complete on a model claim.

#### Scenario: All contract requires every item

- **WHEN** an `all` contract has a present file and a missing record
- **THEN** the step stays open and the missing record is named

#### Scenario: All partial failure

- **WHEN** one item of an `all` contract fails and the others pass
- **THEN** the step is blocked with the first failing item

#### Scenario: Nested all requires every item

- **WHEN** an `all` contract contains a nested `all` whose check fails
- **THEN** the step stays open and the nested failing item is named

#### Scenario: File evidence completes a step

- **WHEN** the declared artifact exists and is non-empty
- **THEN** the step is marked done with the path as evidence

#### Scenario: Declaration on a critical step is refused

- **WHEN** the model says a critical step is done without matching evidence
- **THEN** the step stays open and the run records the refusal

#### Scenario: Non-critical declaration is allowed

- **WHEN** a step is marked `nonCritical` and the model declares completion
- **THEN** the step is marked done as `self-declared`

### Requirement: Whole-spec review evidence

A whole-spec review record SHALL be read from `.dsh/workflows/records/spec-review/<change>/spec.json`.
The legacy `.dsh/delegation/spec-review/<change>/spec.json` path and the `defer` ownership path are
removed with the delegation plugin, so no enabled legacy switch can select a legacy record. The
record MUST match `rule: spec-review`, the change name, `phase: spec`, `scope: whole`, and a digest
equal to the current change spec digest; only `PASS` completes the step, while an `ERROR` allows an
intermediate close with the failure visible and MUST NOT approve. A task-scoped record MUST NOT
satisfy a whole-spec step.

#### Scenario: Whole-spec record completes the review step

- **WHEN** `.dsh/workflows/records/spec-review/auth/spec.json` has rule `spec-review`, change `auth`, phase `spec`, scope `whole`, verdict `PASS`, and the current spec digest
- **THEN** the review step is marked done with the record path and digest

#### Scenario: ERROR allows an intermediate close

- **WHEN** the whole-spec record is `ERROR` with the current digest and the turn has no other open obligation
- **THEN** the turn may close with the failure visible, no `PASS` exists, and the next close starts a new review

#### Scenario: Legacy record is not consulted

- **WHEN** only `.dsh/delegation/spec-review/auth/spec.json` exists
- **THEN** the step reads no record and its ownership cannot select a legacy path

#### Scenario: Stale whole-spec record blocks

- **WHEN** the record's digest differs from the current change spec digest
- **THEN** the step is not done and the close steers a fresh whole-spec review

#### Scenario: Task-scoped record is not whole-spec evidence

- **WHEN** only a task-scoped `PASS` exists for the change
- **THEN** the whole-spec step remains open

### Requirement: Host-authenticated authorization

Approval and receipt files SHALL be authenticated: each SHALL carry an HMAC-SHA256 signature made with a host key held outside `.dsh` and never exposed through a tool or output. The loader and archive gate SHALL verify it and MUST refuse a forged, unsigned, or modified record, including after reload. Without the key, an arbitrary shell or `run_code` write MUST NOT fabricate a valid record; a same-user program that can read the key path is outside this threat model (design §11).

#### Scenario: Forged approval is refused

- **WHEN** the model writes a definition file and a matching `.dsh/workflows/approved.json` entry without a valid host signature and the plugin reloads
- **THEN** the definition is not loaded and no run starts

#### Scenario: Forged receipt is refused

- **WHEN** a model-written `.dsh/workflows/receipts/auth.json` has a matching name and digest but no valid host signature and the archive gate reloads
- **THEN** the receipt is refused and the archive remains blocked

#### Scenario: Alternate write path cannot authorize

- **WHEN** a model uses a shell or `run_code` path outside the file-write guard to write a definition and approval pair or a receipt without access to the host key
- **THEN** the missing host signature still refuses the pair or receipt

### Requirement: Main-agent obligation

For a `main` step, the engine SHALL steer the root agent with the step prompt, the exact evidence contract, and the workspace-relative path the verifier checks, and SHALL repeat the steer while the step is open, bounded by `maxBlocks`. It MUST NOT mark the step done from the model's text and MUST NOT start a child instead.

#### Scenario: Step is steered

- **WHEN** a run reaches a `main` step
- **THEN** the root agent receives the step prompt and the evidence contract

#### Scenario: Steer shows the checked path

- **WHEN** a main step's evidence is a draft file
- **THEN** the steer shows the same `.dsh/workflows/drafts/<name>/<artifact>.md` path the verifier checks

#### Scenario: Repetition is bounded

- **WHEN** the step stays open across `maxBlocks` closes
- **THEN** the gate allows the close with a visible violation and no further steer

#### Scenario: Text claim is not evidence

- **WHEN** the model writes that the step is complete without the required artifact
- **THEN** the step remains open

### Requirement: Subagent and tool executors

A `subagent` step SHALL start a registered provider with a prompt and a JSON result schema, record the child id and result, and fail the step on a non-completion or invalid result. A `tool` step SHALL call only a tool on the definition's allowlist, record the call id and outcome, and MUST NOT construct a shell command from model output.

#### Scenario: Child result satisfies the step

- **WHEN** a child completes with a schema-valid result
- **THEN** the step is marked done with the child id and result

#### Scenario: Invalid child result fails

- **WHEN** a child returns a result that does not match the schema
- **THEN** the step is marked failed with the validation error

#### Scenario: Tool is not allowlisted

- **WHEN** a definition names a tool outside its allowlist
- **THEN** the step is refused before dispatch and the run records the refusal

### Requirement: Branch and loop

A `branch` step SHALL evaluate a JSONLogic predicate over the run context and choose one declared next step. A `loop` step SHALL declare a max iteration count and a stop predicate; reaching the cap SHALL mark the loop `blocked` or `failed` according to the definition and MUST NOT spin.

#### Scenario: Branch chooses a path

- **WHEN** the predicate is true
- **THEN** the true next step is requested and the false step is skipped

#### Scenario: Loop stops on the predicate

- **WHEN** the stop predicate becomes true
- **THEN** the loop exits to its declared next step

#### Scenario: Loop cap is reached

- **WHEN** the iteration count reaches the declared maximum
- **THEN** the loop stops in the declared capped state

#### Scenario: Invalid predicate fails the run

- **WHEN** the predicate is not valid JSONLogic
- **THEN** the run becomes `failed` and the turn is not trapped by a spin

### Requirement: Human step

A `human` step SHALL ask the user through the user-questions service with a bounded prompt, wait for an answer, and record it. The step SHALL declare the accepted answer or answers; only a matching answer completes it, and a non-matching answer leaves the step open or blocked as declared. A timeout or cancellation SHALL leave the step open or cancel the run as declared; it MUST NOT be answered by the model.

#### Scenario: User answers

- **WHEN** the user gives the declared accepted answer
- **THEN** the step is marked done with the answer as evidence

#### Scenario: Rejected answer does not complete

- **WHEN** the user answers no or anything other than the accepted answer
- **THEN** the step remains open or blocked and the run does not complete

#### Scenario: Timeout

- **WHEN** the question times out and the step declares a timeout action
- **THEN** the step becomes blocked or the run is cancelled as declared

#### Scenario: Model cannot answer

- **WHEN** the model tries to complete a human step without a user answer
- **THEN** the step remains open

### Requirement: Turn-close gate

When a root turn stops and an active run has an open `blockTurnClose` step that is owned and not deferred, the engine SHALL steer and refuse the close up to `maxBlocks`. After the cap it SHALL allow the close once and record a visible `VIOLATION` that is not a pass. It MUST fail open on an internal error and MUST NOT evaluate a subagent turn.

#### Scenario: Close is refused

- **WHEN** a required owned step is open at the turn stop
- **THEN** the close is refused and the steer names the step and evidence

#### Scenario: Cap allows a marked close

- **WHEN** the run reaches `maxBlocks` refusals
- **THEN** the turn closes once with a visible `VIOLATION` and is not reported as a pass

#### Scenario: Internal error fails open

- **WHEN** the gate throws while evaluating a run
- **THEN** the turn closes and the error is recorded in the run

#### Scenario: Subagent turn is exempt

- **WHEN** a subagent turn stops
- **THEN** the gate does not evaluate it

### Requirement: Pre-execute intake gate

The engine SHALL allow `openspec new change <name>` without starting or resuming a run when an authenticated completed `change-intake` run or authenticated adoption receipt exists for the name, and when the owning run's `create-change` step issues the call. Otherwise it SHALL refuse the call and create or resume the intake run, naming its next step.

#### Scenario: Creation is refused

- **WHEN** the model calls `openspec new change auth` with no completed intake run
- **THEN** the call is refused, the intake run starts, and the model sees the next step

#### Scenario: Owned creation is allowed

- **WHEN** the intake run's `create-change` step calls the same command
- **THEN** the call is allowed and the run records the created change

#### Scenario: Completed intake allows creation

- **WHEN** the run for `auth` is completed and the model calls the command
- **THEN** the call is allowed and no second run starts

### Requirement: Resumable intake before adoption

Before an existing change directory is redirected to adoption, the engine SHALL resolve a resumable `change-intake` run for the same name in the same session and workspace and resume it at its pending step. Only when no resumable run exists SHALL an existing directory without an authenticated receipt be redirected to `/workflows adopt <name>`. Resuming MUST NOT recreate the directory or start a second run.

#### Scenario: Restart after create-change resumes at spec

- **WHEN** a restart finds `openspec/changes/auth/` created and the interrupted intake's pending step is `spec`
- **THEN** resume re-evaluates `spec` without calling `openspec new change`, recreating the directory, or starting adoption

#### Scenario: Existing change without a run redirects to adoption

- **WHEN** the model calls `openspec new change auth` while `openspec/changes/auth/` exists and no resumable intake exists
- **THEN** the call is refused, the message names `/workflows adopt auth`, and no intake run starts

### Requirement: Pre-execute archive gate

The engine SHALL refuse `openspec archive <change>` while a required review or spec-review step is open, no authenticated completed `change-intake` run or authenticated receipt exists, or the current whole-spec `PASS` record is missing or stale. A receipt MUST verify its host HMAC; a forged or unsigned receipt MUST NOT satisfy the gate. The refusal SHALL name the run, step, and missing evidence. It MUST allow the archive when the evidence is present and MUST NOT treat a text claim as evidence. When a shell command carries a shell separator and contains an archive invocation or archive move that the parser cannot understand, the engine SHALL refuse the call with the existing "could not be parsed safely" reason instead of allowing it; a compound command that names no archive SHALL NOT be refused by this rule.

#### Scenario: Archive is refused

- **WHEN** a required review step is open for the change
- **THEN** the archive is refused with the run, step, and missing evidence

#### Scenario: No intake run

- **WHEN** no completed `change-intake` run or authenticated receipt exists for the change
- **THEN** the archive is refused with the missing intake run and its next step

#### Scenario: Stale review blocks archive

- **WHEN** the whole-spec record's digest does not match the current change artifacts
- **THEN** the archive is refused with the stale record and the next review action

#### Scenario: Adopted change archives

- **WHEN** a pre-existing change has a valid host-authenticated adoption receipt
- **THEN** the archive gate accepts the receipt and does not require a recreated directory

#### Scenario: Receipt survives pruning

- **WHEN** the run history is pruned after a successful intake and the current whole-spec `PASS` record exists
- **THEN** the valid authenticated receipt still lets the archive gate accept the completed intake

#### Scenario: Archive is allowed

- **WHEN** every required step has verified evidence
- **THEN** the archive is allowed

#### Scenario: Text claim is refused

- **WHEN** the model claims the review passed without a PASS record
- **THEN** the archive remains refused

#### Scenario: Separator cannot hide an unparsed archive

- **WHEN** a shell command contains `openspec archive <change>` after a `;`, `&&`, `||`, newline, or `cd` compound command and the parser cannot read it as one documented invocation
- **THEN** the call is refused with the "could not be parsed safely" reason and the command does not run

#### Scenario: Quoted or compound archive move is refused

- **WHEN** a command moves a change into the archive with a quoted destination or another command after the destination, such as `git status; git mv openspec/changes/auth "openspec/changes/archive"` or `cd .; mv openspec/changes/auth openspec/changes/archive; pwd`
- **THEN** the call is refused with the "could not be parsed safely" reason and the move does not run

#### Scenario: A quoted or commented mention is refused

- **WHEN** a compound command contains an archive invocation or archive move only inside quoted text or a comment
- **THEN** the call is refused with the "could not be parsed safely" reason rather than interpreted

#### Scenario: Benign compound command is not an archive

- **WHEN** a compound shell command names no archive invocation or archive move
- **THEN** the archive gate does not refuse it and the call proceeds

### Requirement: Completion receipt

An authenticated completed `change-intake` run and a successful adoption SHALL write a host-authenticated durable receipt at `.dsh/workflows/receipts/<name>.json` binding the change name and the verified spec digest. The receipt SHALL be written atomically, carry an HMAC signature, and MUST NOT be removed by run-history pruning while the change remains active. A receipt MUST NOT be issued from an unsigned or modified run. It MUST NOT be treated as a whole-spec review record.

#### Scenario: Completed intake writes a receipt

- **WHEN** a `change-intake` run completes for `auth`
- **THEN** `.dsh/workflows/receipts/auth.json` records the name, verified spec digest, and a valid host signature

#### Scenario: Receipt is not review evidence

- **WHEN** only a completion receipt exists and the whole-spec `PASS` record is missing
- **THEN** the archive gate still refuses and names the missing review

### Requirement: Adoption of existing changes

The `/workflows adopt <name>` command and the model-facing `workflows` tool action `adopt` SHALL verify the existing `proposal.md`, `design.md`, `tasks.md`, at least one `specs/*/spec.md`, and the current whole-spec `PASS` record, ask the user to confirm through the host user-questions service, and write a host-authenticated `.dsh/workflows/receipts/<name>.json` without calling `openspec new change`. A non-affirmative answer, a timeout, or an unavailable question service MUST NOT write the receipt. The model MAY request adoption, but it MUST NOT supply the confirmation answer; the receipt is written only after the host asks the user and the user answers yes. The change and its verified digest MUST be re-verified after the answer, and a change that moved MUST NOT write the receipt.

#### Scenario: Existing change is adopted

- **WHEN** the user runs `/workflows adopt auth` for a change with all artifacts and a current whole-spec `PASS` record and answers yes
- **THEN** the host-authenticated adoption receipt is written and the change directory is not recreated

#### Scenario: Model requests adoption with a user confirmation

- **WHEN** the model calls the `workflows` tool `adopt` for an existing adoptable change and the user answers yes in the host question
- **THEN** the host-authenticated adoption receipt is written, the change directory is not recreated, and the archive gate accepts the later archive

#### Scenario: Missing artifact blocks adoption

- **WHEN** one required artifact is missing
- **THEN** no receipt is written and the missing artifact is named

#### Scenario: Rejected confirmation writes nothing

- **WHEN** the user answers no to the adoption confirmation
- **THEN** no receipt is written and the archive gate stays refused

#### Scenario: Change that moves during the question is refused

- **WHEN** the change artifacts or the whole-spec `PASS` digest change while the adoption question is open
- **THEN** no receipt is written and the refusal names the changed verification

#### Scenario: Model cannot adopt

- **WHEN** the model requests adoption and the question service is unavailable, the question times out, or the user does not answer yes
- **THEN** no receipt is written and the tool returns the named reason

### Requirement: Model interface

The `workflows` tool SHALL expose `list`, `start`, `resume`, `status`, `evidence`, `cancel`, and `adopt`. `start` SHALL require `allowModelStart` and user confirmation for `risk: high`. `list` SHALL name a definition whose `allowModelStart` is false as user-started and MUST NOT report it as a refused or failed model start. `resume` SHALL continue an `interrupted`, `blocked`, or `failed` run in the current session and workspace at its pending step without starting a new run. `cancel` SHALL be allowed for a run of the current session or for a run whose owning session has no live agent. `evidence` SHALL be accepted only when the host verifies it. `adopt` SHALL request adoption of one existing change and MUST write a receipt only after the host asks the user and the user answers yes. The tool MUST NOT accept a raw script or definition, install one, or write a receipt for any other action.

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

#### Scenario: Adoption asks the user

- **WHEN** the model calls `adopt` for an existing adoptable change
- **THEN** the host asks the user to confirm and no receipt is written before a yes answer

### Requirement: User interface

The plugin SHALL register `/workflows` (names the Workflows tab as the session entry point and the `Workflow design` card as the editor entry point), `/workflows run <id>`, `/workflows resume <runId>`, `/workflows install <path>`, and `/workflows adopt <name>`. `run`/`resume` SHALL activate an `own` pending step by steering the root agent; a `defer` step MUST NOT steer. The session view SHALL present two segments in this order: a `Workflows` overview and the session's `Runs`. The overview SHALL group the installed definitions by their trigger kind and SHALL show each trigger's bound workflows, the session's firing counts summed across the bound definitions' own evaluations, and each workflow's run counts; selecting a workflow SHALL open its page. The runs segment SHALL list every run of the session. The session view MUST NOT present the editor, the receipts, or an authoring control. The design page SHALL present the workflow rail, the editor canvas, the building blocks, the inspector, and a secondary `Diagnostics` disclosure that holds the trigger catalog and the receipts; it MUST NOT open on a read-only definition list and MUST NOT duplicate the workflow list as a table. A display-only action MUST NOT execute a workflow.

#### Scenario: Command names the tab

- **WHEN** the user runs `/workflows`
- **THEN** the response identifies the Workflows tab as the session entry and the `Workflow design` card as the editor entry, and no client view opens from the command

#### Scenario: Resume command continues a run

- **WHEN** the user runs `/workflows resume <runId>` for an interrupted run and the pending step is `own`
- **THEN** the run continues at its pending step and no new run starts

#### Scenario: Deferred step is not steered

- **WHEN** the user runs `/workflows resume <runId>` for an interrupted intake whose pending step is the deferred spec-review
- **THEN** the command does not steer, the step awaits the legacy record, and only the legacy spec-review gate steers

#### Scenario: Install command is user-started

- **WHEN** the user runs `/workflows install <path>`
- **THEN** the definition installation starts only after the user confirms

#### Scenario: Adoption command is user-started

- **WHEN** the user runs `/workflows adopt auth`
- **THEN** the adoption verification starts for `auth` and no change directory is created

#### Scenario: Run detail is visible

- **WHEN** the user opens a run
- **THEN** its detail page shows the step state, evidence, and failure class, and a back control returns to the run list

#### Scenario: Display does not execute

- **WHEN** the user clicks a workflow row, a run row, a step, or an evaluation
- **THEN** no workflow starts and no tool is called

#### Scenario: Editor entry is the guide card

- **WHEN** the user opens the right sidebar's guide page
- **THEN** a `Workflow design` card is listed there, and picking it opens the design page on the workbench: the selected workflow, or the first installed workflow when none is selected, or a blank canvas with the rail when none is installed

#### Scenario: Diagnostics is secondary

- **WHEN** the design page opens
- **THEN** the trigger catalog and the receipts are not on the default surface and are reachable from the `Diagnostics` disclosure

#### Scenario: Overview groups workflows by trigger

- **WHEN** the session view opens on the `Workflows` segment
- **THEN** the installed definitions are grouped under their trigger kinds and each group lists the workflows bound to that trigger

#### Scenario: Overview counts firings and outcomes

- **WHEN** the bound workflows' definitions have evaluated several events and the workflows have recorded runs
- **THEN** the overview shows the group's firing count as the sum of its workflows' matched/total evaluation counts and, for each workflow, its completed/total runs with separate failed and running counts

#### Scenario: Workflow page opens from the overview

- **WHEN** the user selects a workflow row
- **THEN** its page shows the definition's description, a read-only node canvas of its ordered steps with the selected run overlay, the ordered steps as a table fallback, its trigger binding, its runs, and its evaluation history, and a back control returns to the overview

#### Scenario: Runs segment lists every run

- **WHEN** the user selects the `Runs` segment
- **THEN** every run of the session is listed newest first

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

### Requirement: Legacy gate composition

While an installed legacy plugin owns a behavior, a step that covers it SHALL declare `legacy` with the plugin and signal, set `ownership: defer`, read the legacy record as evidence, and MUST NOT steer or dispatch its executor. Ownership MAY be per definition or per step: a `defer` definition declares its source once and defers every step; a deferred step leaves the other steps in its definition `own`. The engine gate SHALL apply only to `own` steps.

#### Scenario: Deferred workflow reads the legacy record

- **WHEN** the legacy checkpoint gate is installed and the retro workflow is deferred
- **THEN** the workflow reads the checkpoint record and does not add a second steer

#### Scenario: Step-level defer

- **WHEN** a definition is `own` but its `spec-review` step is `defer` to the legacy spec-review gate
- **THEN** the workflow reads that gate's record and the legacy gate is the only steer for the review

#### Scenario: Shipped intake composes with the strict review rule

- **WHEN** the shipped `change-intake` loads with the installed strict `spec-review` rule
- **THEN** it loads with only the `spec-review` step deferred, the legacy gate is the only steer for that review, the engine dispatches no executor for that step, and the other intake steps remain owned

#### Scenario: No double steer

- **WHEN** a deferred workflow step and a legacy gate cover the same obligation
- **THEN** only the legacy gate refuses the close

### Requirement: Ownership retirement

A `defer` definition or step SHALL be refused at load when its declared legacy source is not installed, naming `retire-legacy-gates`. A step marked `own` SHALL be refused at load while its declared legacy source for the same behavior is installed. Ownership MAY move from `defer` to `own` only in `retire-legacy-gates`.

#### Scenario: Defer needs the installed source

- **WHEN** a deferred definition or step names a legacy source that the profile does not install
- **THEN** load fails and names `retire-legacy-gates`

#### Scenario: Own requires retirement

- **WHEN** a step declares a legacy source and `ownership: own` while that source is installed
- **THEN** the engine refuses to load it and names the retirement change

### Requirement: Retro applicability

The `retro` trigger SHALL apply the workflow row's `checkpointApplicability` (`minToolCalls` default 4, `requireWrite` default true) before creating a run; the operator MUST mirror the goal-continuity row. A turn below `minToolCalls`, ending in `ask_user_question`, or, when `requireWrite` is set, with no writes or workers SHALL record `not-applicable` and create no run. A retro run that later evaluates non-applicable SHALL be completed and pruned.

#### Scenario: Short turn creates no retro run

- **WHEN** a turn stops below the configured `minToolCalls`
- **THEN** the evaluation records `not-applicable` and no retro run is created

#### Scenario: Question-ending turn creates no retro run

- **WHEN** a turn's last tool is `ask_user_question`
- **THEN** no retro run is created

#### Scenario: Read-only turn creates no retro run

- **WHEN** `requireWrite` is set and the turn has no writes or workers
- **THEN** no retro run is created

#### Scenario: Mirrored config applies

- **WHEN** the workflow row sets `checkpointApplicability.minToolCalls` to a value different from goal-continuity's default
- **THEN** retro applicability uses the workflow row's value and the docs state that the goal-continuity row must mirror it

#### Scenario: Repeated non-applicable turns consume no capacity

- **WHEN** repeated short, read-only, or question-ending turns stop
- **THEN** no blocked retro runs accumulate and no run-capacity slot is consumed

#### Scenario: Non-applicable run is terminal

- **WHEN** an existing retro run later evaluates as non-applicable
- **THEN** it is marked `completed` with reason `not-applicable` and is prunable

### Requirement: Change-intake ordering

The `change-intake` run SHALL write drafts under `.dsh/workflows/drafts/<name>/`, complete `create-change` only from its owned call and the created `.openspec.yaml`, and run `openspec validate <name> --strict` only in `spec`, after `create-change`. It MUST NOT create the change directory before `create-change` and MUST NOT create a change outside its own creation step.

#### Scenario: Intake order is enforced

- **WHEN** a `change-intake` run starts
- **THEN** requirements precedes architecture, architecture precedes interface, and interface precedes create-change

#### Scenario: Create-change does not validate

- **WHEN** `create-change` completes
- **THEN** it does not run strict validation; the spec step runs it after the four artifacts exist

#### Scenario: Strict validation fails the spec step

- **WHEN** `openspec validate auth --strict` exits non-zero in the `spec` step
- **THEN** the step stays open and the exit code is reported

#### Scenario: Drafts stay out of the change

- **WHEN** the intake run has not reached `create-change`
- **THEN** its drafts live under `.dsh/workflows/drafts/<name>/` and no `openspec/changes/<name>/` directory exists

### Requirement: Deferred spec-review

The contributed `spec-review` step SHALL be owned and SHALL start the whole-spec review through the
review executor only when no current whole-spec PASS or ERROR record exists for the change. A matching
PASS SHALL complete the step; a matching ERROR SHALL allow an intermediate close with the failure
visible, MUST NOT approve, and SHALL let the next close start a new review.

#### Scenario: Deferred spec-review does not dispatch

- **WHEN** the intake reaches the `spec-review` step and a current whole-spec PASS record already exists
- **THEN** the engine settles the step from that record and starts no review

#### Scenario: Legacy gate supplies the review

- **WHEN** the review executor writes a current whole-spec PASS record for the change
- **THEN** the step completes from that record without a second review run

### Requirement: Definition activation

A local definition or override SHALL be activated only when its content hash matches a valid host-authenticated approval record. A modification after approval SHALL change the hash and refuse the definition until re-approved. The model MUST NOT create or activate a definition; it MAY propose a draft that a user confirms, and a model write directly to the definitions directory MUST NOT be active.

#### Scenario: Model cannot activate a definition

- **WHEN** the model submits a new definition through the tool
- **THEN** it is stored only as a draft and no run can start until a user confirms it

#### Scenario: Unapproved local definition is refused

- **WHEN** a definition file appears in the definitions directory without a valid authenticated approval
- **THEN** it is not loaded and the load reports the unapproved definition

#### Scenario: Approved override loads

- **WHEN** a local definition's content hash and HMAC signature match its approval
- **THEN** it overrides the installed definition and can be listed

#### Scenario: Modification after approval is refused

- **WHEN** an approved definition file is modified
- **THEN** its hash no longer matches or its signature is invalid and the loader refuses it

### Requirement: Definition installation

The `/workflows install <path>` command SHALL validate the definition, ask the user to confirm, copy it atomically into `.dsh/workflows/definitions/<id>.json`, and record its content hash and host HMAC signature in `.dsh/workflows/approved.json`. The pre-execute gate SHALL refuse a model-originated write to the definitions directory, the approval store, or the receipts directory; only the host install and receipt paths may write them. The model MUST NOT invoke installation.

#### Scenario: User installs a draft

- **WHEN** the user runs `/workflows install .dsh/workflows/drafts/mine.json` and confirms
- **THEN** the definition is copied into the definitions directory, its hash and signature are recorded, and it can be listed

#### Scenario: Model cannot install

- **WHEN** the model tries to install a definition or write an approval
- **THEN** the definition stays a draft and no run starts

#### Scenario: Direct model write is refused

- **WHEN** the model calls a file-write tool for a definition, `.dsh/workflows/approved.json`, or `.dsh/workflows/receipts/auth.json`
- **THEN** the write is refused and no definition, approval, or receipt becomes authoritative

### Requirement: Security and trust

Tool steps SHALL use an allowlist, paths SHALL stay inside the workspace, prompts and outputs SHALL be bounded and redacted, and no definition SHALL carry a credential. Approvals, receipts, and authoritative run state SHALL be authenticated with a host key held outside `.dsh`; the model MUST NOT forge them. The write guard SHALL cover the definitions, approvals, receipts, and runs directories. Adoption SHALL remain user-authorized: the model MAY request it through the `workflows` tool, but a valid adoption receipt SHALL be written only after the host asks the user and the user answers yes; the model MUST NOT forge a receipt or supply the confirmation answer.

#### Scenario: Path escape is refused

- **WHEN** a step's evidence or draft path resolves outside the workspace
- **THEN** the step is refused and the run records the reason

#### Scenario: Secret is refused

- **WHEN** a definition contains a credential-shaped value
- **THEN** load fails with the field and no secret is stored

#### Scenario: Model cannot forge an adoption receipt

- **WHEN** the model requests adoption without a host-mediated user yes or writes a receipt file directly
- **THEN** no valid adoption receipt exists and the archive gate stays refused

### Requirement: Configuration and off switch

The engine SHALL be configured by `enabled`, `maxBlocks`, `maxRuns`, `definitionsDir`,
`runRetentionDays`, `allowIntent`, `checkpointApplicability` (`minToolCalls` default 4,
`requireWrite` default true), `reviewers`, `reviewQueue`, and `timeouts.review` (default 600000),
validated fail-loud. `checkpointApplicability` MUST mirror the installed goal-continuity checkpoint
settings; docs state this. `enabled: false` SHALL stop new runs and steers while keeping existing
run records readable. A configuration error MUST fail plugin load with the field.

#### Scenario: Defaults apply

- **WHEN** the row omits the workflow config
- **THEN** the engine is enabled with the documented defaults, an empty `reviewers` map, and the default review queue

#### Scenario: Applicability defaults and override

- **WHEN** the row omits `checkpointApplicability`
- **THEN** `minToolCalls` is 4 and `requireWrite` is true; an explicit value replaces the default and an out-of-range value fails load with the field

#### Scenario: Invalid configuration

- **WHEN** `maxBlocks` is zero, `runRetentionDays` is negative, `reviewQueue.concurrency` is outside 1 to 4, or a reviewer sets `model` for a provider without `agentOptions` support
- **THEN** plugin load fails with the field and accepted range or capability

#### Scenario: Disabled engine

- **WHEN** `enabled` is false
- **THEN** no new run or steer starts and existing run records remain readable

### Requirement: Failure semantics and observability

A run that cannot verify its evidence SHALL become `blocked` or `failed`, never `completed`; every step transition and evidence check SHALL be in the run record and the Workflows view. A run terminally classified `not-applicable` is completed before evidence and is not a pass. The engine MUST NOT add a second event log; it uses the run records and the observability journal.

#### Scenario: Unverified step blocks

- **WHEN** a required evidence check fails
- **THEN** the step becomes blocked or failed and the run is not completed

#### Scenario: Transition is visible

- **WHEN** a step changes state
- **THEN** the run record and the Workflows view show the time, state, and evidence

#### Scenario: No second log

- **WHEN** the engine records a run
- **THEN** it writes under `.dsh/workflows/` and does not duplicate the session event log

### Requirement: Run authentication

An authoritative run file SHALL carry a host HMAC signature over its persisted state. The loader SHALL refuse an unsigned or modified run and MUST NOT trust its status, steps, or completion for resume, gate admission, or receipt issuance. A fabricated completed run MUST NOT authorize creation or archive and MUST NOT issue a receipt.

#### Scenario: Fabricated completed run is refused

- **WHEN** a model writes a completed intake run without a valid host signature and the gate reloads
- **THEN** the run is refused and creation or archive remains blocked

#### Scenario: Modified completed step is refused

- **WHEN** a completed step in an authenticated run is edited after signing
- **THEN** the run is refused and is not used for resume, admission, or a receipt

#### Scenario: Authenticated run resumes

- **WHEN** a validly signed interrupted run resumes
- **THEN** it continues at its pending step

### Requirement: Visual canvas

The plugin SHALL provide a Design page in the right sidebar, opened from the guide card, as a workbench with a left rail, a center node canvas, and an inspector. The left rail SHALL list the installed workflows and the building blocks (trigger kinds and step executors). The page SHALL open on the canvas of the selected workflow or, when none is selected, the first installed workflow, and SHALL show a blank canvas with the rail and a start affordance when none is installed. In a panel narrower than the shipped narrow-width threshold the page SHALL open in list mode, and the canvas SHALL remain reachable there. The canvas SHALL support pan, zoom, selection, and keyboard focus, and MUST NOT be the only way to inspect or edit a definition. At a pane width of at least 980 px the inspector SHALL render beside the canvas; between the narrow threshold and that width the inspector SHALL open as an overlay drawer. A step block SHALL be addable by choosing it or by dropping it on the canvas, and a dropped step SHALL keep the drop position.

#### Scenario: Canvas renders a definition

- **WHEN** the user opens a definition in the design page's canvas mode
- **THEN** its trigger and steps render as connected nodes

#### Scenario: Workbench opens on the canvas

- **WHEN** the design page opens and an installed workflow is selected or none is selected
- **THEN** the selected workflow, or the first installed workflow when none is selected, renders as connected nodes and the left rail lists the installed workflows and the building blocks

#### Scenario: Empty workbench

- **WHEN** the design page opens and no workflow is selected or installed
- **THEN** a blank canvas with the left rail and a start affordance renders, and the page does not fall back to a read-only definition table

#### Scenario: Palette adds a step

- **WHEN** the user chooses a step type from the building blocks
- **THEN** a new unconnected node appears and can be connected

#### Scenario: Dropped block keeps its position

- **WHEN** the user drops a step block on the canvas
- **THEN** a new unconnected node appears at the drop position and can be connected

#### Scenario: Trigger block sets the trigger

- **WHEN** the user chooses a trigger kind from the building blocks
- **THEN** the workflow trigger changes and no step is added

#### Scenario: Workflow rail replaces the canvas

- **WHEN** the user chooses another workflow from the left rail
- **THEN** the canvas shows that definition's trigger and steps without leaving the design page

#### Scenario: Canvas is not the only surface

- **WHEN** the user cannot use the canvas
- **THEN** the same definition is editable through the list and property forms

#### Scenario: Narrow panel opens the list

- **WHEN** the design page opens in a panel narrower than the shipped narrow-width threshold
- **THEN** the list surface renders first, and the canvas remains one control away

#### Scenario: Inspector follows the selection

- **WHEN** the user selects a node in the canvas at a pane width of at least 980 px
- **THEN** the node's fields render in the inspector beside the canvas without the page scrolling

#### Scenario: Inspector becomes a drawer

- **WHEN** the user selects a node in a pane between the narrow threshold and 980 px
- **THEN** the inspector opens as an overlay drawer and closes without changing the selected workflow

### Requirement: Definition editing

The editor SHALL create, edit, duplicate, rename, delete, and version-bump local definitions, and SHALL save only after schema validation passes and only through the host's shared install/approve function. A successful save MUST persist both the definition and its matching host-signed approval record; a failed definition or approval write MUST leave both unchanged. An engine-shipped or plugin-contributed definition MUST be read-only; editing one SHALL create a local copy.

#### Scenario: Save a valid definition

- **WHEN** the user saves a valid local definition
- **THEN** the host writes it, persists the matching host-signed approval, and the version is current; the definition loads after a restart

#### Scenario: Approval failure leaves no save

- **WHEN** the definition write succeeds but the approval write fails
- **THEN** neither the definition nor the approval changes and the save reports failure

#### Scenario: Draft install is authorized

- **WHEN** the user installs a model draft through a create-only save
- **THEN** it uses the same install/approve function and loads after a restart; a colliding id leaves both files unchanged

#### Scenario: Invalid definition is refused

- **WHEN** the graph has a dangling edge, a duplicate id, or an invalid field
- **THEN** the save is refused with the node and field

#### Scenario: Shipped definition is copied

- **WHEN** the user edits a shipped definition
- **THEN** a local copy is created and the shipped asset is unchanged

#### Scenario: Contributed definition is copied

- **WHEN** the user edits a plugin-contributed definition
- **THEN** a local copy is created, the contributed asset is unchanged, and the local copy shadows it by id

### Requirement: Revision preconditions

Every definition and layout write SHALL send `expectedRevision`. A create-only save SHALL send `null`, the destination MUST NOT exist, the host SHALL create it atomically, and a collision SHALL return 409 without writing. An update or delete SHALL send the SHA-256 revision returned by the read that loaded the resource, and a mismatch SHALL return 409 with the current revision. Definition and layout revisions SHALL be independent.

#### Scenario: Create-only save

- **WHEN** the user creates a blank definition, installs a draft, or makes a copy
- **THEN** the save sends `expectedRevision: null`, writes atomically when the id is free, and returns 409 without writing when the destination exists

#### Scenario: Colliding copy id

- **WHEN** the user copies a definition to an id that already exists
- **THEN** the host returns 409, no file is written, and the editor offers the next free id

#### Scenario: Update uses the loaded revision

- **WHEN** the editor saves a definition or layout it loaded
- **THEN** it sends the revision returned by that read, and a mismatch returns 409 with the current revision

#### Scenario: Create returns the next revision

- **WHEN** a create-only save succeeds
- **THEN** the response carries the new revision and the next save sends that revision instead of `null`

#### Scenario: First layout save

- **WHEN** a definition has no layout yet
- **THEN** the layout save sends `expectedRevision: null` and does not require the definition revision

#### Scenario: Independent revisions

- **WHEN** the user saves a layout and then saves the definition
- **THEN** each write sends only its own resource's revision and neither save requires the other revision

### Requirement: Templates

The editor SHALL list the installed templates — the plugin-contributed definitions and any engine-shipped definition — and create a local definition from one, including the `change-intake`, `task-review`, and `retro` shapes while they are installed. A template MUST be copied, not mutated, and a contributed template MUST keep its source label.

#### Scenario: Template list

- **WHEN** the user opens the template picker
- **THEN** the installed templates are listed with their step counts and sources

#### Scenario: Template copy

- **WHEN** the user creates a definition from a template
- **THEN** a local copy is created and the template remains unchanged

#### Scenario: Contributed template is labeled

- **WHEN** the template picker lists `change-intake`
- **THEN** it names the OpenSpec plugin as the source

#### Scenario: Contributor removed

- **WHEN** a contributing plugin is disabled
- **THEN** its template is absent and an existing local copy remains listed

### Requirement: Layout sidecar

The editor SHALL persist node positions in `.dsh/workflows/layout/<id>.json`, separate from the definition. The engine MUST ignore layout, and a missing layout SHALL use a deterministic auto-layout.

#### Scenario: Layout survives reload

- **WHEN** the user moves a node and saves the layout
- **THEN** reopening the definition uses the saved positions

#### Scenario: Runtime ignores layout

- **WHEN** the engine loads a definition with a layout sidecar
- **THEN** the run behavior is byte-identical to the same definition without the sidecar

#### Scenario: Missing layout is auto-laid out

- **WHEN** a definition has no layout
- **THEN** the canvas renders a deterministic layout and does not write a file until the user saves

### Requirement: Run overlay

The editor SHALL select the latest run for the current definition by default and let the user choose an earlier run, overlaying each node with its recorded state, structured evidence, failure class, and violations. A run step missing from the definition SHALL be marked orphan and MUST NOT be drawn as a new node. The overlay MUST NOT change the run, start a step, or execute a tool.

#### Scenario: Latest run for the definition

- **WHEN** a run exists for the definition
- **THEN** the latest matching run is selected and each step shows its recorded state and structured evidence

#### Scenario: Failure class and violation

- **WHEN** a run records a blocked step or a violation
- **THEN** the node shows the failure class and the violation

#### Scenario: Another run is selected

- **WHEN** the user chooses an earlier run
- **THEN** the overlay shows that run and the latest run is unchanged; only that definition's runs are offered

#### Scenario: Orphan step

- **WHEN** the run has a step the definition no longer has
- **THEN** the step is marked orphan and no node is invented

#### Scenario: Overlay is read-only

- **WHEN** the user clicks a node in the overlay
- **THEN** the property panel opens and no tool, step, or run is started

### Requirement: Run provenance and history

Every workflow run SHALL record the definition id, name, and version captured at run creation, the trigger that started it, and the per-step overlay fields it observed: evidence, failure class, and violations. The run API SHALL expose those fields, the recorded trigger, and a terminal time when the run has one, SHALL filter runs by definition id, SHALL order runs newest first on request, and SHALL resolve one attributed run by id within the requesting session. The terminal time SHALL be the latest settlement time of the run's recorded steps; it MUST NOT be derived from a field that changes after completion, such as the record's last-update time, and it SHALL be absent when no step settled. The displayed run title SHALL be composed from the recorded definition name and the recorded subject when one exists (the change name, the checkpoint turn, and the task for a task review), and MUST NOT substitute a fixed suffix for them. A completed run SHALL remain readable with its recorded name and version after the definition is deleted.

#### Scenario: Per-definition latest run

- **WHEN** the editor requests the latest run for a definition
- **THEN** the API returns the newest run whose definition id matches and no other definition's run

#### Scenario: Definition changed after the run starts

- **WHEN** the definition is renamed or version-bumped while a run exists
- **THEN** the run keeps the name and version it recorded at creation

#### Scenario: Deleted definition remains readable

- **WHEN** a definition is deleted after a run completed
- **THEN** the run detail still shows its recorded name, version, step evidence, failure classes, and violations

#### Scenario: Engine run carries its trigger and end time

- **WHEN** a run created by a stored definition is projected
- **THEN** the run exposes the trigger kind that started it and, once terminal, the latest settlement time of its recorded steps as its terminal time

#### Scenario: A completed run keeps its terminal time

- **WHEN** a completed retro run later records a turn block or a violation
- **THEN** its reported terminal time and duration do not change

#### Scenario: A terminal run without a settled step omits its terminal time

- **WHEN** a terminal run has no recorded step settlement time
- **THEN** the projection omits the terminal time and the view shows no duration for it

#### Scenario: Title names the definition and subject

- **WHEN** a retro run records the definition `retro`/`Work checkpoint` and a checkpoint path for turn 6
- **THEN** its title is composed from the recorded definition name and the parsed subject `turn 6`, and no fixed `intake` suffix replaces either

#### Scenario: Run lookup is session-scoped

- **WHEN** one session looks up a run id that belongs to another session
- **THEN** the lookup returns no run and no record from the other session is exposed

### Requirement: Accessibility

The editor SHALL support keyboard-only creation and connection, visible focus, accessible names, and a list-based fallback for every canvas operation. A drag-only interaction MUST have a non-drag equivalent.

#### Scenario: Keyboard adds a step

- **WHEN** the user adds a step from the palette with the keyboard
- **THEN** the node appears and can be connected without a pointer

#### Scenario: Focus is visible

- **WHEN** the user tabs through the canvas and property panel
- **THEN** the focused node or control has a visible focus indicator

#### Scenario: List fallback edits

- **WHEN** the user uses the list view
- **THEN** every step field and edge is editable without the canvas

### Requirement: Fallback and inertness

When the canvas cannot render or its container is unavailable, the design page SHALL render the list and detail editor and keep definitions editable through forms. A canvas render failure MUST NOT break the session view, the design page, or the host. When the right-sidebar services are unavailable the plugin MUST register only the session view and MUST NOT attempt to register the design page.

#### Scenario: Canvas fails to render

- **WHEN** the canvas render throws or the container is unavailable
- **THEN** the list editor renders and the definition remains editable

#### Scenario: Host is unaffected

- **WHEN** the canvas fails to render
- **THEN** the host, runs, and gates keep working and no error reaches the agent loop

#### Scenario: No right sidebar

- **WHEN** the client host exposes no right-sidebar service
- **THEN** the session view still registers and no design page is attempted

### Requirement: Editor trust boundary

The editor MUST NOT execute definition code, MUST use JSONLogic for conditions, MUST keep definitions and layout workspace-local, and MUST NOT write an active definition from a model draft without a user confirmation. The host SHALL validate every write.

#### Scenario: No code execution

- **WHEN** a definition contains a condition
- **THEN** it is stored and evaluated as JSONLogic, never executed as code

#### Scenario: Model draft needs confirmation

- **WHEN** a model-written draft is opened in the editor
- **THEN** installing it requires an explicit user save and a create-only write, and the shipped template is not overwritten

#### Scenario: Path is refused

- **WHEN** a write targets a path outside `.dsh/workflows/` or another workspace
- **THEN** the host refuses it and keeps the existing file unchanged

### Requirement: Retirement parity

A legacy gate behavior SHALL move to a workflow `own` definition only after a release-bound parity
report passes. The report SHALL be a tracked asset at `assets/parity/retire-legacy-gates.json`, replay
legacy scenarios in shadow, and include the covered template hashes. The replay SHALL run from a retained
executable baseline in the workflows test package that imports no deleted plugin code; a baseline change
MUST regenerate the report before `--check` passes again. `pnpm workflows:parity --check` MUST fail on a
missing, stale, or mismatched report or a missing baseline evaluator; a fresh installation SHALL load the
shipped report and `own` definitions. For a `soft` legacy signal the compared decision SHALL be the
per-turn sequence, and the shipped integration definition SHALL reproduce the legacy once-only
refusal with `maxBlocks: 1`; the visible violation recorded after an exhausted soft budget is the
declared, documented difference and MUST NOT count as a parity mismatch. An exhausted soft budget
SHALL settle that step as `completed-soft`, never as a pass, so the run keeps no open required step
and MUST NOT block an otherwise authorized archive. After the delegation plugin is removed, a
failing parity report is remedied by fixing the report, the retained baseline, or the definition; no
legacy switch is available to re-enable.

#### Scenario: Parity passes

- **WHEN** every legacy scenario produces the same allow/refuse decision in the workflow shadow run
- **THEN** the workflow definition may be `own`

#### Scenario: Soft signal keeps its refusal sequence

- **WHEN** the legacy soft integration rule refuses one close and allows the next
- **THEN** the workflow definition refuses the first close and allows the next with a recorded violation, and its parity entry passes

#### Scenario: Exhausted soft run does not block archive

- **WHEN** the integration run closed on its exhausted soft budget, every checked task has a PASS, and the intake receipt exists
- **THEN** the archive gate allows the archive and the integration run is reported as closed without a pass, never as an approval

#### Scenario: Parity mismatch has no legacy fallback

- **WHEN** a retained scenario mismatches after the plugin is removed
- **THEN** `pnpm workflows:parity --check` fails and the remedy names the report, the retained baseline, or the definition, not a legacy switch

#### Scenario: Fresh installation

- **WHEN** a fresh installation loads the shipped report and `own` definitions
- **THEN** the parity report is present and every bound definition loads

#### Scenario: Parity fails

- **WHEN** a retained scenario produces a different allow/refuse decision in shadow
- **THEN** `pnpm workflows:parity --check` fails with the scenario and the owned definition is refused

#### Scenario: Report is release-bound

- **WHEN** the release changes the tracked report without the matching template hashes
- **THEN** `--check` fails and the release is blocked

#### Scenario: Missing report at runtime

- **WHEN** a definition is `own` and the report is missing
- **THEN** the definition is refused and the remedy names `pnpm workflows:parity`

#### Scenario: Baseline outlives the runtime

- **WHEN** the delegation plugin is absent and every retained scenario still matches the retained executable baseline
- **THEN** `pnpm workflows:parity --check` passes and the `own` definitions load

#### Scenario: Edited baseline is stale

- **WHEN** a retained baseline decision changes without regenerating the tracked report
- **THEN** `--check` fails and names the stale report instead of certifying the edited baseline

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

### Requirement: Focused re-review context

After a prior `FINDINGS` record for the same task or section at a different digest, and only while that record covered the same set of checked tasks, the next review prompt SHALL carry the prior findings and a bounded diff between the previously reviewed tree and the current one. When the prior reviewed tree is unavailable, the prompt SHALL carry the findings alone and name the missing input. A section whose covered task set changed SHALL be a full review. Whole-spec reviews are unchanged.

#### Scenario: Previous findings and diff are rendered

- **WHEN** a task or section review has a prior `FINDINGS` record at a different digest
- **THEN** the next prompt names every prior finding by its stable per-record id and includes the diff between the prior reviewed tree and the current tree, bounded with the changed-path list

#### Scenario: Unavailable tree falls back to findings-only

- **WHEN** the prior record has no reviewed tree or its object is no longer in the repository
- **THEN** the prompt carries the prior findings, states that the diff is unavailable, and starts the review

#### Scenario: Expanded section coverage is a full review

- **WHEN** a section review re-runs after a prior `FINDINGS` record that covered a different set of tasks
- **THEN** the review is a full review, because a newly covered task may have existed before the prior reviewed tree

#### Scenario: Whole-spec review is unchanged

- **WHEN** a whole-spec review re-runs after a prior whole-spec `FINDINGS`
- **THEN** its prompt receives no focused sections

### Requirement: Complete prior-finding inventory

A focused re-review prompt SHALL name every prior finding by its stable per-record id, severity, title, evidence, and fix; the prior-finding inventory MUST NOT be count- or byte-truncated. Only the diff is bounded. If the complete inventory cannot be rendered within the prompt's hard safety limit, the attempt SHALL settle as an `ERROR` naming the cause and MUST write no `PASS`.

#### Scenario: Every prior finding is named

- **WHEN** the prior `FINDINGS` record has N findings
- **THEN** the prompt names all N ids with their severity, title, evidence, and fix

#### Scenario: Overflow fails loud

- **WHEN** the complete prior-finding inventory exceeds the prompt's hard safety limit
- **THEN** the attempt settles as an `ERROR` naming the cause and writes no `PASS`

### Requirement: Previous-finding confirmation

On a focused re-review, the verdict SHALL confirm every prior finding by its stable per-record id as `closed` or `open`. `PASS` SHALL require every prior id `closed` with zero new findings. An `open` prior id SHALL be repeated by exactly one finding that names that id; a `closed` id MUST NOT be named by a finding. A missing, duplicate, or unknown confirmation SHALL fail the review as invalid output and MUST write no `PASS`.

#### Scenario: PASS closes every prior finding

- **WHEN** the verdict confirms each prior id `closed` and reports no new P0/P1
- **THEN** the review writes a `PASS` and its committed approval

#### Scenario: Open prior finding stays actionable

- **WHEN** one prior id is `open`
- **THEN** the verdict is `FINDINGS` and exactly one finding names that id with its severity, evidence, and fix

#### Scenario: Missing confirmation is invalid

- **WHEN** the verdict omits one prior id or names an unknown or duplicate id
- **THEN** the review settles as an `ERROR` with invalid output and writes no `PASS`

#### Scenario: Closed finding is not reported again

- **WHEN** the verdict marks a prior id `closed` and a finding still names that id
- **THEN** the verdict is invalid output

### Requirement: Owned task-review gate

When `task-review` is `own`, the workflow SHALL start the review through the review executor only when
no matching PASS or ERROR record exists for the run's change and checked task; a matching record SHALL
settle the review step from that record without starting a review. It SHALL accept a matching PASS or
ERROR record as intermediate turn-close evidence and refuse the close while the record is FINDINGS or
missing. Before advancing any nonterminal task-review run it SHALL compare the run's checked task id
with `openspec/changes/<change>/tasks.md` and cancel the run as `superseded` when the id is absent,
regardless of which step is pending, and MUST NOT start a second run for the same change and task while
a live-session run for that pair is open. A failed review start SHALL be retried at most three times
across turn closes; after the cap the step SHALL remain failed and the run SHALL become `failed`
(terminal), and the turn-close gate MUST NOT refuse for that run's failed start. That terminal
exemption SHALL apply only to the failed start: the completion-coverage and work-progress checks SHALL
still refuse a final tick without a portable PASS, and the archive gate SHALL still require a PASS for
every checked task. `ERROR` MUST allow an intermediate turn close and MUST NOT approve.

#### Scenario: Review is started

- **WHEN** a task is checked, the workflow is `own`, and no matching review record exists
- **THEN** the workflow starts the review through the review executor and records the run

#### Scenario: Matching record settles the start step

- **WHEN** a checked task already has a matching PASS or ERROR record
- **THEN** the review step settles from that record without starting a review and the run advances to its coverage step

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

- **WHEN** a review start fails and the run has fewer than three attempts
- **THEN** the step stays failed and the next advance retries it

#### Scenario: Exhausted dispatch is terminal

- **WHEN** the third review start fails
- **THEN** the step remains failed, the run becomes `failed`, and the failed-start refusal stops, while the completion-coverage check still refuses a final tick without a portable PASS

#### Scenario: Failed step resumes

- **WHEN** a failed task-review run is resumed
- **THEN** its review step reopens and a later advance starts the review again

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

#### Scenario: Section with two missing tasks is one unit

- **WHEN** section 1 has two or more checked tasks without a matching PASS or ERROR record and no other missing task
- **THEN** the workflow selects one section unit for section 1 and starts no per-task review for its missing tasks

#### Scenario: Single missing task keeps the task unit

- **WHEN** a section has exactly one checked task without a matching PASS or ERROR record
- **THEN** the workflow selects that task's unit and the per-task start

#### Scenario: Section unit covers approved tasks

- **WHEN** a section contains an approved checked task and two missing tasks
- **THEN** the one section run covers every checked task in the section, preserves a matching per-task approval byte-identically, and publishes only the missing or nonmatching approvals

#### Scenario: Pending section run suppresses a duplicate

- **WHEN** a section run for the change's section is queued or running
- **THEN** the gate points at that run and starts no per-task or second section run for its covered tasks

#### Scenario: Steer names the section

- **WHEN** the turn-close gate refuses for missing records in a section
- **THEN** the steer names the section key, the missing tasks, and the start action that covers them

#### Scenario: Review runtime remains

- **WHEN** no legacy task-review rule exists
- **THEN** the review executor, its queue, and its records still work

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

The `verify` definition SHALL reproduce the verification gate: after a code-writing turn,
it SHALL require a foreground zero-exit result for the configured commands after the last
write, and refuse the close until that result exists. The definition MUST NOT execute the
command; the agent runs it. In the migrated setup, the legacy `verification-gate` row MUST
be disabled and MUST NOT steer. A profile that configures an empty `commands` list SHALL keep
the definition inert: the step records `no-command` evidence and the turn close is allowed
without a verification steer.

#### Scenario: Check is required

- **WHEN** a turn wrote code and the verify definition is active
- **THEN** the close is refused until the configured command exits zero after the last write

#### Scenario: Command is not executed by the gate

- **WHEN** the definition names a command
- **THEN** the definition does not execute it; the agent runs it and the workflow reads the result

#### Scenario: Legacy row is silent

- **WHEN** the verification-gate row is disabled
- **THEN** it produces no steer and the workflow is the only gate

#### Scenario: No configured command keeps it inert

- **WHEN** a profile configures `verify.commands` as an empty list and a turn writes code
- **THEN** the step records `no-command` evidence, the close is allowed, and no verification
  steer is added

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

### Requirement: Retained gate retirement

This change SHALL retire the retained `spec-review`, work-progress, and lane gates with a workflow
replacement for every retained case, a passing release-bound parity entry, and the matching legacy
switch disabled in the same change. A future change that makes a legacy gate retained again MUST use
the same path: reproduce every case in a workflow, cover it in the parity report, and disable the
legacy switch in the same change.

#### Scenario: Later retirement is parity-gated

- **WHEN** a later change proposes to retire a retained gate
- **THEN** the workflow reproduces every retained case, the release-bound report covers it, and the legacy gate is disabled in the same change

### Requirement: Migration completion

The migration SHALL be complete: every retired gate has a passing parity entry, no retained legacy gate
remains, the `own` workflow is the only steer for that behavior, the legacy code and its tool and record
providers are deleted, and the setup defaults and docs name the workflow owner. Deleting the legacy code
is allowed only after the replacement has run in a live profile.

#### Scenario: Migration completes

- **WHEN** every retired parity entry passes and the replacement has run in a live profile
- **THEN** the setup defaults configure only the workflow engine, the docs name the workflow definitions, and no legacy gate or tool remains

#### Scenario: Replacement is proven

- **WHEN** the owner reads the Workflows view after a live run
- **THEN** the review, work-progress, lane, checkpoint, and verification obligations appear as workflow runs or engine gate cards with evidence

#### Scenario: Code is not deleted early

- **WHEN** the replacement has not completed a live profile run
- **THEN** the legacy code and tool providers remain available for rollback in the same change

### Requirement: Definition registry

The workflows plugin SHALL provide a host registry service that an installed plugin uses to contribute read-only definitions and shadow triggers. The engine SHALL validate every contribution with the closed definition and trigger schemas, refuse a duplicate definition or trigger id naming both sources, and expose the contributing plugin as the source. The engine MUST NOT discover contributions by reading plugin package files, scanning package directories, or accepting a profile path list.

#### Scenario: Valid contribution loads

- **WHEN** an installed plugin registers a valid definition and trigger while the registry service is available
- **THEN** the engine lists them, the definition can start, and the client shows the plugin as the source

#### Scenario: Duplicate id is refused

- **WHEN** two sources register the same definition id or trigger id
- **THEN** the later contribution is refused naming both sources and no duplicate is active

#### Scenario: Invalid contribution is refused

- **WHEN** a contribution has an unknown field, a duplicate step id, an invalid edge, or an invalid trigger filter
- **THEN** the contribution is refused with the definition or trigger and the field, and no part of it is registered

#### Scenario: No package scan

- **WHEN** the engine loads a workspace without a registry contribution
- **THEN** it does not discover a definition from a plugin package directory or a profile path list

### Requirement: Optional contribution

The contribution SHALL be optional on both sides. A feature plugin MUST remain functional and register nothing when the engine or registry service is absent; an engine without a contributor MUST load the remaining definitions and the generic trigger catalog unchanged. A contribution SHALL be removed when its plugin is disposed; its existing runs MUST remain readable.

#### Scenario: Plugin without the engine

- **WHEN** a feature plugin loads in a profile that does not install the workflows engine
- **THEN** it registers nothing and its own surfaces keep working without an error

#### Scenario: Engine without a contributor

- **WHEN** the engine loads a profile in which no installed plugin contributes definitions or triggers
- **THEN** the remaining definitions and the generic trigger catalog load unchanged

#### Scenario: Contribution is removed on dispose

- **WHEN** a contributing plugin is disposed
- **THEN** its definitions and triggers are no longer listed and the runs it recorded remain readable

### Requirement: Trigger captures

A deterministic trigger MAY declare one named `{name}` capture in a `match.command` template or in an `fs.change` `match.path` glob. The engine SHALL validate the placeholder, extract the captured value into the run context as `name`, and MUST NOT require a product-specific allowlist or path regex for trigger matching. A trigger without a capture SHALL behave as before.

#### Scenario: Command template captures the name

- **WHEN** a shell command matches a declared template such as `openspec new change {name}`
- **THEN** the run context carries the captured name and no engine command allowlist is consulted

#### Scenario: Path glob captures the name

- **WHEN** a file change matches a declared path such as `openspec/changes/{name}/**`
- **THEN** the run context carries the captured name and the engine does not use a product path regex

#### Scenario: Non-product template works

- **WHEN** a contributed definition declares `acme deploy {name}` as its command template
- **THEN** it matches and captures the name without an engine change

#### Scenario: Invalid capture is refused

- **WHEN** a template contains an empty, repeated, or unclosed capture
- **THEN** the definition fails validation with the definition and the field

### Requirement: Command normalization

Before a `match.command` template match the engine SHALL normalize the documented `rtk` and `pnpm exec` invocation prefixes, whitespace, and one symmetric quote pair around the captured name, and MUST reject a compound command. A normalized command that matches the template SHALL yield the unquoted, validated name; the gate behavior SHALL be unchanged for the supported invocation forms.

#### Scenario: Prefixed command captures the name

- **WHEN** the shell command is `rtk openspec new change auth` or `pnpm exec openspec new change auth` and the template is `openspec new change {name}`
- **THEN** the capture is `auth` and the intake gate applies as it does for the bare form

#### Scenario: Quoted name captures the name

- **WHEN** the matched command quotes the name such as `openspec new change "auth"`
- **THEN** the capture is the unquoted, validated `auth`

#### Scenario: Compound command does not match

- **WHEN** the command carries a shell control, substitution, or a second command
- **THEN** the template does not match and no run or gate decision is made for it

### Requirement: Gate declaration

The engine SHALL select a pre-execute gate from a definition's declared gate policy rather than from the definition id. A contributed or locally approved definition that declares the intake gate SHALL receive the intake gate, and the gate's running, resumable, and completed-run lookups SHALL use the selected definition id; a definition without the declaration MUST NOT receive it. The engine MUST NOT key a pre-execute gate on a definition id.

#### Scenario: Declared gate runs

- **WHEN** a contributed definition declares the intake gate and its trigger matches the create command
- **THEN** the intake gate runs with the captured name under the existing refusal and run rules

#### Scenario: No declaration means no gate

- **WHEN** a definition does not declare the intake gate
- **THEN** the intake gate does not run for it, even when its trigger matches the create command

#### Scenario: Gate survives an id change

- **WHEN** the definition is renamed or a local copy of it has another id
- **THEN** the declared intake gate still applies, and the running, resumable, and completed-run checks use the new id instead of a fixed id

#### Scenario: Repeated calls use the selected id

- **WHEN** a definition with another id has started an intake run and the create command is called again, resumed, or completed
- **THEN** the gate finds the run by the selected id and does not create a duplicate or redirect to adoption

### Requirement: Gate-preserving override

A local definition that shadows an installed definition MUST NOT remove or weaken a declared pre-execute gate. The engine SHALL refuse such an override with a reapproval remedy, and the installed definition SHALL remain the effective one. An override that preserves the gate SHALL load through the normal approval flow.

#### Scenario: Old intake override is refused

- **WHEN** a previously approved local override of the installed intake lacks the gate declaration and uses the retired `<name>` token
- **THEN** the engine refuses it with the reapproval remedy and the installed intake stays effective

#### Scenario: No silent bypass

- **WHEN** the refused override is present and the create command is called
- **THEN** the installed gate still refuses the command until a completed intake run exists

#### Scenario: Reapproved override loads

- **WHEN** the user saves a local copy from the installed template with the gate declaration and approves it
- **THEN** the override loads and the intake gate applies

#### Scenario: Non-shadowing local definition is unaffected

- **WHEN** a local definition does not shadow an installed gated definition
- **THEN** it loads without a gate declaration

### Requirement: Installed definitions

The engine SHALL ship the built-in process definitions: `task-review`, `spec-review`,
`integration-review`, `retro`, and `verify`. The three review definitions declare `own` and carry no
legacy source. `retro` and `verify` keep their surviving legacy source references (`goal-continuity`
`work_checkpoint` and `verification-gate`) and the per-signal ownership check that refuses them while
that source is enabled. `change-intake` SHALL be contributed by `@dsh-setup/plugin-openspec`. The review
definitions are the built-in process, not product-specific content: a new product-specific definition
MUST NOT be added without its own delta, and a contributed definition MUST run from the generic schema
and MUST NOT require a new id-specific engine behavior.

#### Scenario: Engine-shipped exceptions

- **WHEN** a fresh installation loads the engine definitions
- **THEN** `task-review`, `spec-review`, `integration-review`, `retro`, and `verify` load with their `own` ownership, and `retro` and `verify` keep their surviving legacy source references

#### Scenario: Contributed intake loads

- **WHEN** the OpenSpec plugin registers `change-intake` while the engine is available
- **THEN** it loads with the requirements, architecture, interface, create-change, spec, spec-review, and approval steps, and the spec-review step is owned by the review executor

#### Scenario: No new engine content

- **WHEN** a plugin contributes a definition
- **THEN** the engine lists and runs it without an engine release that names or hard-codes that definition id

### Requirement: User-clicked archive authorization

The workflows plugin SHALL provide `workflowsArchiveGate.authorizeAndCheck(workspace, change)`. It SHALL ensure the host key, verify the change artifacts and the current whole-spec `PASS`, and write the host-signed adoption receipt. The click is the final authorization: it MUST NOT apply the agent path's run/approval/marker checks, run the archive, or accept a text claim; the agent path keeps the full gate.

#### Scenario: Verified click is authorized

- **WHEN** the click service runs for a change with all four artifacts and a current whole-spec `PASS` record
- **THEN** the host-signed adoption receipt is written and the service returns `ok`

#### Scenario: Missing PASS record is refused

- **WHEN** the current whole-spec `PASS` record is missing or stale
- **THEN** no archive is authorized, the service returns the missing or stale reason, and the change stays active

#### Scenario: Open run step does not block the click

- **WHEN** a related run has an open required step but the artifacts and whole-spec `PASS` are current
- **THEN** the click is authorized and the receipt is written

#### Scenario: Missing portable approvals do not block the click

- **WHEN** a checked task has no portable task-review PASS, whether the shipped rule is `own` or `defer`
- **THEN** the click is authorized and the receipt is written

#### Scenario: Malformed legacy marker does not block the click

- **WHEN** `openspec/review-approval.json` exists but cannot be read as a valid marker
- **THEN** the click is authorized; the marker only affects the agent command path

#### Scenario: Engine absent means no engine checks

- **WHEN** a profile does not install the workflows engine
- **THEN** no archive gate service exists, and the OpenSpec plugin's own complete-task check still applies

### Requirement: Review executor

A step MAY use the `review` executor with a `target`, an `instruction`, a `scope` (`whole` or
`task`), and an optional `phase`. The engine SHALL resolve the target from `reviewers`, run the
reviewer with the configured model and effort, accept exactly one fenced JSON verdict that echoes the
prepared digest, write the record, and settle the step from a matching record. A malformed verdict, a
digest mismatch, a target failure, or a timeout SHALL write an `ERROR` record and publish no `PASS`.

#### Scenario: Task review reads a frozen snapshot

- **WHEN** a task-scope review starts
- **THEN** it reads a frozen worktree snapshot taken at the start, so a later write neither enters nor invalidates its evidence

#### Scenario: Task review settles from its record

- **WHEN** a task-scope review returns PASS for the prepared snapshot digest
- **THEN** the local record and the committed approval are written and the step is marked done with the record path

#### Scenario: Malformed verdict writes an error

- **WHEN** the reviewer returns prose, two fenced blocks, an invalid severity, or a digest that does not match
- **THEN** an `ERROR` record is written, no `PASS` exists, and the run names the failure and the next action

#### Scenario: Changed whole-scope inputs discard the verdict

- **WHEN** a git-visible reviewed input changes while a whole-scope review runs
- **THEN** the verdict is discarded, no `PASS` is published, and the error names the changed paths

#### Scenario: Disabled queue fails loud

- **WHEN** the row sets `reviewQueue.enabled` to false
- **THEN** the review step publishes one `config` `ERROR` explaining that Release A runs reviews only through the queue, starts no reviewer, and discards any prepared snapshot

### Requirement: Review condition

A trigger MAY declare a `condition`: a bounded JSONLogic predicate over the event, the change's
checked and unchecked tasks and lanes, the current whole-spec and task records with their digests,
the current spec and worktree digests, and the session's involvement. The engine SHALL evaluate it at
every turn close and MUST refuse a predicate that is not JSONLogic or names an unknown context field.
A false condition SHALL produce no run and no steer.

#### Scenario: Condition gates the run

- **WHEN** the trigger fires and its condition is false
- **THEN** no run starts and no steer is emitted

#### Scenario: Condition sees the records and digests

- **WHEN** a condition references `records.spec.pass` and `digests.spec`
- **THEN** it evaluates against the current whole-spec record and the current change artifact digest

#### Scenario: Involvement sources are bounded

- **WHEN** a condition reads `session.involved`
- **THEN** it is true for the session's own write/edit, change creation, persisted involvement, or a supported shell write (Set-Content, Add-Content, Out-File, New-Item, Copy-Item, Move-Item, Rename-Item, Remove-Item, cp, mv, rm, touch, tee, redirection, or pipeline; copy/move use their destination and rename its source path); a shell form outside that set does not establish involvement in Release A

#### Scenario: Invalid condition fails load

- **WHEN** a definition's `condition` is not JSONLogic or names an unknown context field
- **THEN** the definition is refused at load with the definition and field

### Requirement: Reviewer configuration

The row SHALL accept `reviewers` as a map of reviewer ids to `provider`, optional `model`, optional
`reasoningEffort`, and optional provider-supported `agentOptions`. A review step SHALL name a
reviewer id and never a provider. A target whose provider is missing MUST be reported by the status
surface and by the run with the target id and provider name, and MUST NOT fail plugin load. Options
MUST be forwarded only to a provider that declares `agentOptions` support.

#### Scenario: Reviewer selection

- **WHEN** a review step names `reviewers.codex`
- **THEN** the engine starts the provider with the configured model and effort and records the reviewer id

#### Scenario: Missing provider is reported

- **WHEN** a configured reviewer names a provider that is not registered
- **THEN** the run fails with the target id, the provider name, and the next action, and composition still succeeds

#### Scenario: Unsupported option is refused

- **WHEN** a reviewer sets `model` and the provider does not declare `agentOptions` support
- **THEN** the run is refused before starting with the target, the provider, and the unsupported capability

### Requirement: Review record store

Review records SHALL live under `.dsh/workflows/records/<definition>/<change>/` as `<phase>.json` for
whole scope and `tasks/<taskId>.json` for task scope. A task-scope `PASS` SHALL also write
`openspec/changes/<change>/reviews/<taskId>.json` atomically and before the local record; a failed
write SHALL publish an `ERROR` and no `PASS`. The committed approval MUST keep its unchanged field
set and stay portable: no session id, run id, machine path, or error text.

#### Scenario: Local and committed records are written

- **WHEN** a task review returns PASS
- **THEN** the committed approval is written first and the local record second, and both carry the same digest and verdict

#### Scenario: Failed approval publication publishes nothing

- **WHEN** the committed approval cannot be written
- **THEN** the local record becomes `ERROR`, no `PASS` exists, and the run names the failed path

#### Scenario: Committed approval is portable

- **WHEN** a fresh clone runs the approval audit for a change with committed approvals and no `.dsh` state
- **THEN** every approval is readable and the audit result is unchanged

### Requirement: Owned work-progress gate

The work-progress gate SHALL be owned by the engine: a code-changing turn SHALL be refused unless it
has a newly checked and reviewed task or a `note` action whose worktree digest matches the current
worktree. A stale note MUST NOT authorize the close and MUST NOT count as a `PASS`. The note SHALL be
written by the `note` action to `.dsh/workflows/notes/<change>.json` and SHALL be readable by any
session. The `note` action MUST require the change and the task id and MUST record a bounded reason
and a timestamp; it SHALL accept only `in-progress` or `blocked` and MUST reject an unknown or
checked task.

#### Scenario: Progress note fields and validation

- **WHEN** a `note` call names an unchecked task with status `in-progress` and a reason
- **THEN** the note records the change, task id, status, reason, timestamp, and current digest
- **AND WHEN** the same call names an unknown or checked task
- **THEN** the note is refused and nothing is written

#### Scenario: Unchecked task still needs a note

- **WHEN** a code-changing turn leaves its task unchecked and has no matching note
- **THEN** the gate steers to a note or a reviewed tick and the turn does not close for that gate

#### Scenario: Current note allows the close

- **WHEN** a code-changing turn carries a note whose worktree digest matches the current worktree
- **THEN** the gate allows the close with the task still unchecked

#### Scenario: Stale note is rejected

- **WHEN** the worktree digest changes after the note
- **THEN** the gate refuses the close and requires a fresh note or a reviewed tick

### Requirement: Owned lane-assignment gate

The engine SHALL own the lane-assignment gate: a plan with at least two non-serial lanes and an
unassigned lane with owned paths and an unchecked task SHALL require, per reported lane, a tagged
worker start or a serial note on an implementation turn. A `serial` heading is the tail. The gate SHALL
fail open on an unreadable `tasks.md`, a plan without level-2 headings, and a lane without owned paths.

#### Scenario: Gate fires on an implementation turn

- **WHEN** a turn ticks a task or changes implementation files and leaves an unassigned non-serial lane with owned paths
- **THEN** the gate reports that lane with its owned paths and the exact worker or serial-note call

#### Scenario: Lane is reported

- **WHEN** the turn ticks the last task of lane A and lane B is the only remaining unchecked lane in a plan with two non-serial lanes
- **THEN** the gate reports lane B with its owned paths and the exact worker or serial-note call

#### Scenario: Tagged worker assigns the lane

- **WHEN** a successful subagent, subagent_fork, spawn_teammate, or workflow start carries the printed `lane-tag: <change>#<n>`
- **THEN** that lane is assigned for this session and is not reported again

#### Scenario: Serial note assigns the lane

- **WHEN** a `note` action with a serial reason names a task in the lane
- **THEN** that lane is serial for this session and leaves the other lanes gated

### Requirement: Review contract surface

The Workflows surface SHALL render a review step's contract and each engine-owned gate as separate
card kinds. A review step's inspector SHALL show the instruction id and prompt summary, the scope and
phase, the digest scope, the verdict schema, the reuse policy, and the record path. An engine-owned
gate SHALL render as a read-only contract card with its trigger condition, evidence, record path, and
steer payload, and MUST NOT render as an editable definition node or in the definition rail.

#### Scenario: Review contract is visible

- **WHEN** the owner opens a review step
- **THEN** the inspector shows the prompt, the digest scope, the verdict schema, the reuse policy, and the record path

#### Scenario: Engine gate is a card, not a definition

- **WHEN** the owner opens the Workflows overview
- **THEN** each engine-owned gate appears as a read-only contract card and no gate appears in the definition rail

### Requirement: Review verdict contract

A review SHALL compute the scope digest, run the resolved reviewer with the bundled instruction and the
change, task, and digest context, accept one fenced JSON verdict echoing the digest, and write an atomic
record with the definition, scope, task id when task-scoped, digest, verdict, findings, reviewer
identity, time, and reviewing session. `PASS` MUST require zero P0/P1 findings; a matching
`PASS`/`FINDINGS` record MUST be reused; a stale whole-scope record MUST be ignored.

#### Scenario: Passing review

- **WHEN** the reviewer returns zero P0/P1 findings with the matching digest in the reviewing session
- **THEN** the engine writes a `PASS` record carrying the reviewing session and settles the step from it

#### Scenario: Findings

- **WHEN** the reviewer returns at least one P0 or P1 finding
- **THEN** the engine writes a `FINDINGS` record and reports every blocking finding with evidence and fix

#### Scenario: Malformed verdict

- **WHEN** the reviewer returns no single matching verdict, an invalid severity, or prose only
- **THEN** an `ERROR` record is written, no `PASS` exists, and the run names the failure and the next action

### Requirement: Task-scoped review

A task-scoped review SHALL be driven by a checked task, key the record by a stable hash of the
normalized task text, and review an immutable snapshot taken when the run starts, including the frozen
change artifacts. The record MUST remain a historical task snapshot: a write after the run starts and
later tasks MUST NOT invalidate it, and the optional integration review MUST use the current
whole-worktree digest. Fallback to the live worktree MUST keep the mutation guard.

#### Scenario: Checked task reviewed

- **WHEN** a checked task has no matching task-review record
- **THEN** the engine requires a task-scoped review of a snapshot of the task's completion and writes its PASS/ERROR/FINDINGS record

#### Scenario: Later task does not invalidate

- **WHEN** a later task changes the worktree after an earlier task pass
- **THEN** the earlier task record remains historical and the optional integration review covers the current whole worktree

#### Scenario: Write during a task review

- **WHEN** a reviewed file is edited while a task review runs
- **THEN** the run is not discarded, because it reviews a frozen snapshot taken at its start

### Requirement: Explicit task review selection

A task-scoped review call SHALL accept an explicit task id; when present, the engine MUST review that
checked task after validating that it is checked and matches the review definition, instead of
selecting the next checked task. Parallel runs for different tasks MUST NOT collapse onto one task.
When the task id is absent, next-checked-task selection applies. A gate-suggested review MUST name the
explicit task id of the session's checked task.

#### Scenario: Explicit task

- **WHEN** a review names a checked task for task-review
- **THEN** that task is reviewed even when another task is next

#### Scenario: Parallel task reviews

- **WHEN** two task-review runs name different checked tasks at the same time
- **THEN** both tasks are reviewed independently

#### Scenario: Unknown or unchecked task

- **WHEN** the named task is missing or unchecked
- **THEN** the call is rejected before a reviewer starts and names the allowed checked tasks

### Requirement: Asynchronous review runs

A review SHALL validate its definition, reviewer, and change (and an explicit task when supplied),
admit the run through the review queue, and return a run id before the reviewer completes. The run MUST
start when the queue admits it, MUST continue in the background, MUST write the digest-bound
`PASS`/`FINDINGS`/`ERROR` record when it finishes, and MUST stay visible in the status surface.
Multiple runs MUST proceed concurrently up to the configured queue limit.

#### Scenario: Review starts and returns

- **WHEN** a review is requested while the queue has capacity
- **THEN** the call returns a run id and record path after admission, and the turn can continue

#### Scenario: Concurrent reviews

- **WHEN** several reviews start for different tasks or changes
- **THEN** the runs proceed concurrently up to the configured limit and each writes its own record

#### Scenario: Failed run

- **WHEN** a background review run fails after its retries
- **THEN** an `ERROR` record with the failure class is written and the status reports it

### Requirement: Pending review handling

A duplicate review request MUST be identified by the definition, change, task or phase, prepared
digest, and resolved reviewer. A second request with the same identity while pending MUST return the
existing run handle and MUST NOT start a duplicate; a changed digest or reviewer MUST be a distinct
run.

#### Scenario: Duplicate pending request

- **WHEN** a review is already pending for the same identity and is requested again
- **THEN** the existing run handle is returned and no second reviewer starts

#### Scenario: Changed digest is distinct

- **WHEN** a review request has the same definition and task but a different prepared digest
- **THEN** a new run is created and the old handle is not joined

#### Scenario: Late completion

- **WHEN** a run completes after the authoritative record was written
- **THEN** its result is reported as discarded and does not replace the record

### Requirement: Shared review conversation key

Distinct rules reviewing the same change or task SHALL share one conversation key and execute
serially: a second definition MUST wait for the first even when queue capacity remains. Distinct
definitions MUST queue as separate runs and write their own records, and a late completion MUST NOT
replace the authoritative record.

#### Scenario: Shared conversation key serializes

- **WHEN** two rules review the same task with queue capacity remaining
- **THEN** the second waits for the first and both keep their own records

#### Scenario: Changed digest is distinct

- **WHEN** a review request has the same definition and task but a different prepared digest
- **THEN** a new run is created and the old handle is not joined

#### Scenario: Late completion

- **WHEN** a run completes after the authoritative record was written
- **THEN** its result is reported as discarded and does not replace the record

### Requirement: Review queue admission

Every review run SHALL pass through one per-profile FIFO queue before its reviewer starts. The queue
SHALL enforce a configurable concurrency limit (default 2) and a configurable waiting-list cap (default
16). A run admitted while at capacity waits; a run that cannot be admitted within the wait timeout
SHALL settle as a bounded `ERROR` in its run record and settlement observer, with the queue state, and
no reviewer SHALL start.

#### Scenario: Capacity is available

- **WHEN** a review is admitted while the active count is below the concurrency limit
- **THEN** the reviewer starts and the run reports `running`

#### Scenario: Capacity is exhausted

- **WHEN** a review is admitted while the active count is at the limit and the waiting list has room
- **THEN** the run reports `queued` with its position and starts when a slot frees

#### Scenario: Admission timeout

- **WHEN** the waiting list is full or the wait exceeds `waitTimeoutMs`
- **THEN** the run settles as `ERROR` with `queue-full` or `queue-timeout`, the status and observer report it, and no reviewer starts

### Requirement: Review queue identity and dedupe

An admitted review SHALL be identified by definition, change, task id or phase, digest, provider, and
model. A same-identity request MUST join the existing run; a different digest or definition MUST be a
distinct run. Re-preparation SHALL replace the identity atomically: a free identity keeps the queue
position, an occupied one settles the re-preparing run as `discarded` without a reviewer, and a
discarded key head SHALL promote its next follower.

#### Scenario: Duplicate identity joins

- **WHEN** a second review request has the same identity as a queued or running run
- **THEN** the existing run handle is returned and no duplicate reviewer starts

#### Scenario: Re-preparation collides

- **WHEN** a queued run re-prepares to an identity that already exists
- **THEN** the re-preparing run settles as `discarded` without starting a reviewer and the incumbent remains authoritative

#### Scenario: Different rules stay separate

- **WHEN** two definitions review the same change and task
- **THEN** both runs are queued and each writes its own record

### Requirement: Review failure classification and retry

The queue SHALL classify a failed start or run as transient (`child-limit`, `provider-not-started`,
`timeout`) or permanent (`invalid-output`, `config`, `permission`, `reviewed-inputs-changed`). Transient
classes SHALL retry up to `maxAttempts` (default 3) with bounded exponential backoff and jitter, and a
queued run SHALL re-check its prepared inputs and re-prepare once before starting when they changed. A
permanent class MUST NOT retry.

#### Scenario: Child limit retries

- **WHEN** a start fails with the active-child-limit error
- **THEN** the run waits with backoff, retries, and records the attempt and class

#### Scenario: Queued inputs are re-checked

- **WHEN** a queued run's prepared inputs change before a slot frees
- **THEN** the queue re-prepares once before starting and records the new digest

#### Scenario: In-run input change is terminal

- **WHEN** a run reports that its reviewed inputs changed during the run
- **THEN** it settles as `ERROR` with `reviewed-inputs-changed`, no retry starts, and the gate asks to finish the writes and re-run

### Requirement: Review queue record integrity

A retry MUST NOT create two authoritative records for one identity. Only the settled attempt MAY publish
a verdict; an earlier attempt MUST NOT. A never-started queued run SHALL re-inspect the authoritative
record once start-eligible after its predecessor settles, and use that snapshot as its publication
baseline: a record at that baseline MUST NOT discard its completion, a later record MUST. A superseded
or late completion MUST NOT replace the authoritative record.

#### Scenario: Failed attempt writes no verdict

- **WHEN** an attempt fails with a transient class
- **THEN** no `PASS` or `FINDINGS` record is written for that attempt

#### Scenario: One authoritative record

- **WHEN** a retry succeeds after one or more failed attempts
- **THEN** exactly one record is written for the identity and it carries the settled verdict

#### Scenario: Late duplicate is discarded

- **WHEN** a duplicate run completes after the authoritative record exists
- **THEN** its result is reported as discarded and the record is unchanged

### Requirement: Review queue settlement

The settlement observer SHALL fire exactly once after the run leaves the queue and all retries have
settled, with the run id and terminal state. Queue wait and retry delay are not settlement. An admission
timeout, a permanent failure, and a cancelled run SHALL settle with a recorded terminal state, and the
observer MUST NOT change records, gates, concurrency, or reviewers.

#### Scenario: Queued run settles once

- **WHEN** an observer is supplied and a queued run reaches a terminal state
- **THEN** the observer is called once after the final attempt settles

#### Scenario: Admission timeout settles

- **WHEN** a run cannot be admitted within the timeout
- **THEN** the observer is called once with the timeout terminal state and no record is published as a PASS

#### Scenario: No observer

- **WHEN** no settlement observer is supplied
- **THEN** queueing, retries, records, gates, and status behave exactly as before

### Requirement: Review queue visibility

The status surface SHALL report queue depth, active runs, queued runs, and each run's queue position,
wait time, attempts, and failure class. The run record SHALL carry the same bounded fields. The values
MUST be local, MUST NOT contain credentials or machine paths, and MUST be available to the existing
observability surface.

#### Scenario: Status shows the queue

- **WHEN** one review runs and two wait
- **THEN** the status reports one active, two queued, and each queued run's position

#### Scenario: Record carries the attempt facts

- **WHEN** a review settles after a retry
- **THEN** its record reports the attempt count and the final failure class when it failed

### Requirement: Review queue configuration and off switch

The review queue SHALL be configured by `reviewQueue` with `enabled` (default true), `concurrency`
(default 2), `maxQueued` (default 16), `maxAttempts` (default 3), `baseDelayMs`, `maxDelayMs`, and
`waitTimeoutMs`. Invalid values MUST fail plugin load with the field. The engine runs reviews only
through the queue, so `enabled: false` SHALL fail the review step with a `config` `ERROR` and start no
reviewer.

#### Scenario: Defaults apply

- **WHEN** the row omits `reviewQueue`
- **THEN** the queue is enabled with concurrency 2 and the documented defaults

#### Scenario: Invalid configuration

- **WHEN** `concurrency` is zero or `maxAttempts` is negative
- **THEN** plugin load fails with the field name and the accepted range

#### Scenario: Off switch fails loud

- **WHEN** `reviewQueue.enabled` is false
- **THEN** the review step publishes one `config` `ERROR`, starts no reviewer, and discards any prepared snapshot

### Requirement: Review queue failure isolation

An internal queue error MUST NOT trap the turn or lose the review. The queue SHALL record a bounded
`queue-internal-error`, start the reviewer directly once when a direct start is possible, and otherwise
return an `ERROR` with the next action. The review gate SHALL still evaluate the resulting record, and a
queue error MUST NOT be treated as a `PASS`.

#### Scenario: Internal error falls back

- **WHEN** the queue throws before admission and a direct start is available
- **THEN** the reviewer starts directly, the run records `queue-internal-error`, and the review proceeds

#### Scenario: Gate still evaluates

- **WHEN** a queue failure produces an `ERROR` record
- **THEN** the task and archive gates report the task as unapproved, exactly as for any other `ERROR`

### Requirement: Restart reconciliation

On load, a durable review run with a matching authoritative record SHALL be reconciled to the terminal
state for its verdict, and the record MUST NOT be invalidated by the run-file state or recovery.
Approval SHALL be evaluated only through the existing verdict, scope, digest, and reviewer checks: a
`PASS` approves only when those checks accept it; `FINDINGS` and `ERROR` are preserved but never approve
archive or push. A run with no matching record SHALL be marked interrupted, never a `PASS`.

#### Scenario: Crash after publication

- **WHEN** a run file is left `running` and its authoritative record is a current PASS after a restart
- **THEN** the run is reconciled as completed and the gate treats the task as approved

#### Scenario: Crash before publication

- **WHEN** a run file is left `running` and no authoritative record exists
- **THEN** the run is marked interrupted, no PASS is synthesized, and the gate asks for a fresh review

### Requirement: Stable review inputs

A review MUST review immutable inputs bound to its digest. A task-scoped review SHALL satisfy this with
a detached worktree snapshot taken when the run starts, and its change-artifact digest MUST be computed
from the snapshot's frozen copy. A whole-scope review MUST track mutations over its live inputs and MUST
NOT publish a `PASS` when any reviewed input changed at any time during the run, including when the
content is later restored; a digest re-check alone is not sufficient.

#### Scenario: Inputs change during a review

- **WHEN** a live reviewed input is edited while a whole-scope review runs
- **THEN** no `PASS` is published for that digest and the run reports that the inputs changed

#### Scenario: Edit-read-restore

- **WHEN** a live reviewed file is edited, read by the reviewer, and restored to its original content before the run completes
- **THEN** no `PASS` is published, because the reviewer did not review the digest's contents

#### Scenario: Frozen copy is the digest source

- **WHEN** a change artifact is edited while a task review runs
- **THEN** the run is not discarded and its digest still describes the frozen copy the reviewer read

### Requirement: Reviewed worktree input set

A whole-scope code review MUST take its reviewed worktree inputs from git: tracked files plus untracked
files that are not ignored. Only `.dsh/` and `.tmp/` stay excluded, the same two the worktree digest
skips; VCS-ignored paths MUST NOT be reviewed inputs, and every Git-visible path the digest covers MUST
also be guarded, except the change's `reviews/` approval directory. A task-scoped review MUST review
exactly that set in its snapshot, so later writes MUST NOT invalidate it.

#### Scenario: Ignored build output changes during a review

- **WHEN** a build, test, or editor process writes under a VCS-ignored path while a whole-scope review runs
- **THEN** the review publishes its verdict, because no reviewed input changed

#### Scenario: A tracked file disappears or appears

- **WHEN** a tracked file is deleted, or a new untracked non-ignored file is created, while a whole-scope review runs
- **THEN** the change is reported as a changed reviewed input instead of failing the run to read the workspace

#### Scenario: Task snapshot carries the same set

- **WHEN** a task review starts with a tracked change, a tracked file matching an ignore rule, an untracked non-ignored file, and ignored output in the worktree
- **THEN** the snapshot contains the tracked change, the tracked-but-ignored file, and the untracked file, not the ignored output

### Requirement: Reviewed change-artifact inputs

A whole-scope review whose digest includes the change-artifact digest MUST also track the reviewed
change's artifacts as inputs, regardless of Git ignore rules, excluding `.openspec.yaml` and the
`reviews/` approval directory; a whole-spec review tracks exactly those artifacts. A task-scoped review
MUST freeze the change directory in its snapshot and compute the digest from that copy; the live
fallback tracks the union.

#### Scenario: Change artifact changes during a whole-spec review

- **WHEN** a change artifact is edited while a whole-spec review runs
- **THEN** no `PASS` is published and the run reports the changed artifacts

#### Scenario: Task approval does not invalidate the spec review

- **WHEN** a portable `reviews/<taskId>.json` record is written while a whole-spec review runs
- **THEN** the review publishes, because the approval directory is excluded from the reviewed inputs

#### Scenario: Fallback tracks the union

- **WHEN** the snapshot was unavailable and a change artifact is edited while the fallback task review runs
- **THEN** no `PASS` is published, because the fallback tracks the union of the Git-visible worktree and the change artifacts

### Requirement: Reviewed-input change report

When a review is discarded because a reviewed input changed, the reported error MUST name how many
inputs changed, list their paths, state that a write inside the reviewed scope happened during the run,
and give the next action: finish the writes, then re-run the review.

#### Scenario: Discarded verdict explains the change

- **WHEN** a reviewed input changes during a run and the verdict is discarded
- **THEN** the error names the count and paths of the changed inputs and tells the caller to re-run after the writes finish

### Requirement: Task review snapshot

A task-scoped review SHALL review a detached worktree snapshot built from the repository root whose
temporary Git index holds exactly the review input set: tracked paths from the real index (including a
path staged with `git add -f`), plus untracked non-ignored files. The snapshot commit MUST be parented to
`HEAD` when one exists, and building it MUST NOT modify the real index or working tree. When it cannot be
produced, the review MUST fall back to the live worktree under the mutation guard.

#### Scenario: Tracked path matching an ignore rule

- **WHEN** a tracked file matches an ignore rule at the time of a task review
- **THEN** the snapshot contains that file, because tracked membership comes from the real index

#### Scenario: Real index untouched

- **WHEN** the worktree has staged and unstaged changes and a snapshot is built
- **THEN** the real index and working tree are unchanged and the snapshot contains the working-tree content

#### Scenario: Snapshot unavailable

- **WHEN** the repository root, the ignored `.dsh/` scratch directory, or the snapshot commit cannot be used, or the repository has unmerged index entries
- **THEN** the task review reviews the live worktree under the mutation guard instead

### Requirement: Snapshot exclusions

Before the source tree is written, `.dsh/`, `.tmp/`, and the change directory MUST be excluded from the
review input set, so a committed version of any of them cannot enter the snapshot. The change directory
is supplied by the frozen copy.

#### Scenario: Ignored scratch excluded

- **WHEN** the worktree contains ignored files such as `.dsh/`, `node_modules/`, or build output, or an unignored `.tmp/`
- **THEN** the snapshot does not contain those paths

#### Scenario: Committed scratch files excluded

- **WHEN** `.dsh/` or `.tmp/` paths are tracked in the repository
- **THEN** those paths are absent from the input set and from the snapshot

### Requirement: Frozen change artifacts

The change directory MUST be removed from the source tree and copied from the live workspace into the
snapshot after checkout, onto a destination that does not exist in the checkout. That copy MUST be the
source of the task lookup and of the change-artifact digest, so the record describes exactly the
artifacts the reviewer reads. An artifact that matches an ignore rule MUST still be present. When the
change directory lies outside the repository root, the snapshot MUST NOT be used.

#### Scenario: Artifact digest from the frozen copy

- **WHEN** a live artifact is edited after the copy is made and before the digest is computed
- **THEN** the digest describes the captured version, which is what the reviewer reads

#### Scenario: Task lookup in the frozen copy

- **WHEN** the reviewed task is not checked in the frozen `tasks.md`
- **THEN** the run fails with a message naming the change and the task instead of reviewing an inconsistent state

#### Scenario: Change directory outside the repository

- **WHEN** the change directory does not lie inside the repository root
- **THEN** no snapshot is used and the live review runs

### Requirement: Snapshot cleanup on settle

A task review's snapshot worktree, lease, and temporary index MUST be removed when the run settles on
every path, including PASS, FINDINGS, ERROR, timeout, a discarded verdict, and reusing an existing
record. A failed removal MUST NOT change the verdict or record, and the expired lease lets a later sweep
retry it.

#### Scenario: Settle removes the checkout

- **WHEN** a task review publishes a verdict
- **THEN** its snapshot directory, lease, and temporary index are gone

#### Scenario: Reused record removes the checkout

- **WHEN** an existing matching record makes the review return without starting a reviewer
- **THEN** the snapshot and lease created for that attempt are removed

#### Scenario: Removal failure does not change the record

- **WHEN** removing a snapshot fails, for example because a file is locked on Windows
- **THEN** the verdict and record are unchanged, the lease expires, and a later sweep retries the removal

### Requirement: Stale snapshot sweep

A per-workspace sweep MUST run before a snapshot, throttled in time. It MUST remove a snapshot whose
lease has expired, and a snapshot with no lease older than a grace period, and MUST prune stale worktree
metadata. It MUST NOT remove a snapshot with a valid lease, MUST be best-effort, and MUST NOT run a
repository-wide `gc` or `prune`.

#### Scenario: Crash leftover swept

- **WHEN** a snapshot's lease has expired, for example after a crashed or failed Host
- **THEN** a later throttled sweep in that workspace removes it and prunes its stale worktree metadata

#### Scenario: Long review preserved

- **WHEN** a review runs longer than the default timeout and its lease is valid
- **THEN** the sweep leaves its snapshot in place, because ownership is the lease and not a timeout

#### Scenario: No repository-wide prune

- **WHEN** snapshots are cleaned up
- **THEN** the engine runs no `git gc` or `git prune`, because unreachable snapshot objects are content-addressed and collected by the repository's own garbage collection

### Requirement: Review fallback visibility

When a task-scoped review cannot use its frozen snapshot and falls back to the live worktree, the engine
SHALL record a bounded reason on the run while it runs and after it settles, alongside any verdict or
error. When the cause is the missing Git ignore rule for the `.dsh/` scratch directory, the reason MUST
name that cause and the next action.

#### Scenario: Snapshot skipped because `.dsh` is not ignored

- **WHEN** a task review cannot build its snapshot because `.dsh/` is not Git-ignored
- **THEN** the run detail says the review is on the live worktree and names the missing `.dsh/` ignore rule and its fix, both while the run is live and after it settles

#### Scenario: Snapshot skipped for another reason

- **WHEN** a task review cannot build its snapshot because the repository or change path cannot be resolved, the change lies outside the repository, or the index has unmerged entries
- **THEN** the run detail names that cause in a bounded form and still reports the live-worktree review, including after settlement

### Requirement: Section-scoped review

A task review MAY name a section selector: the `tasks.md` level-2 heading number (`1`, `1.x`) or its
normalized title. One run SHALL review all checked tasks in that section in one frozen worktree snapshot
with one prompt and one verdict; unchecked tasks MUST be excluded and never covered. The section selector
and an explicit task id are mutually exclusive.

#### Scenario: Section review covers checked tasks

- **WHEN** a review names section `1` and it has several checked tasks
- **THEN** one run reviews all of them against one snapshot and writes one section verdict

#### Scenario: Unchecked tasks are not covered

- **WHEN** a section contains an unchecked task
- **THEN** the review excludes it and the task remains unapproved and unrecorded

#### Scenario: Task and section are exclusive

- **WHEN** a task-review call names both a task id and a section
- **THEN** the call is rejected before a reviewer starts and names the accepted selectors

### Requirement: Section run identity

The section run identity SHALL include the definition, change, section key, the sorted checked task ids
and texts, the frozen change-artifact digest, and the snapshot content tree; unchanged content MUST
reuse a FINDINGS record. Checking or unchecking a task, or changing a covered task's text, MUST change
the digest and require a new section or task review.

#### Scenario: Unchanged section reuses FINDINGS

- **WHEN** the same section is delegated again with unchanged content and a FINDINGS record exists
- **THEN** that record is reused without another paid run

#### Scenario: Newly checked task needs a new review

- **WHEN** a task is checked after the section PASS
- **THEN** the section digest changes and the task is covered only by a new section or task review

#### Scenario: Changed task text needs a new review

- **WHEN** a covered task's normalized text changes after the section PASS
- **THEN** the digest changes and the task is covered only by a new review

### Requirement: Section gate and status behavior

A section `PASS` SHALL satisfy the turn-stopping and archive checks exactly like a per-task review. While
a section run is queued or running, the gate MUST suggest waiting for its record instead of starting
per-task runs, and the status and review audit MUST count the covered tasks from their portable records.
Section runs MUST respect the review queue identity, dedupe, retry, and settlement rules.

#### Scenario: Gate accepts the covered task

- **WHEN** a section PASS wrote the task's portable approval
- **THEN** the turn gate accepts that checked task and the archive gate reports it approved

#### Scenario: Status reports coverage

- **WHEN** status or the review audit runs after a section PASS
- **THEN** the PASS count includes the covered tasks and the missing list names none of them

### Requirement: Section approval publication

A section `PASS` SHALL publish the existing per-task portable `reviews/<taskId>.json` PASS for every
covered checked task whose current record does not satisfy the approval checks, with the same rule,
verdict, target, time, and digests. A record that satisfies the current approval checks MUST stay
byte-identical; a nonmatching record SHALL be replaced only by the publication transaction, and
unchecked tasks MUST NOT receive a record.

#### Scenario: Missing approvals are published

- **WHEN** a section review returns PASS and its checked tasks have no portable PASS
- **THEN** each covered task gets its per-task portable PASS with the section evidence

#### Scenario: Matching approval is preserved

- **WHEN** a covered task already has a PASS that satisfies the current approval checks
- **THEN** that record stays byte-identical and the section publishes only the remaining records

#### Scenario: Unchecked task is not approved

- **WHEN** a covered unchecked task has no record
- **THEN** the section publishes no record for it

### Requirement: Section publication transaction

A section publication SHALL write all covered records under the existing publication lock, creating
temporaries before any rename. On failure it MUST restore every replaced or removed destination
byte-identically and remove only destinations it created; no approval survives. Overlapping section and
per-task runs MUST serialize: the later discards when an authoritative PASS exists and MUST NOT
overwrite it; a superseded section identity discards the whole publication.

#### Scenario: Partial replacement is rolled back

- **WHEN** a publication fails after replacing one destination that already had a record
- **THEN** the original record is restored byte-identically and no new approval survives

#### Scenario: Section run wins the race

- **WHEN** the section run publishes before an overlapping per-task review
- **THEN** the per-task review discards because an authoritative PASS exists

### Requirement: Section failure visibility

A settled section `ERROR` SHALL be visible to each covered checked task's turn-gate evaluation as an
`ERROR` record with the section's failure class preserved, so an eligible section `ERROR` MAY close the
turn like a task `ERROR`. It MUST publish no new approval: existing valid approvals remain, and the
archive gate reports as missing only covered tasks that lack a valid prior approval.

#### Scenario: Section ERROR closes the turn

- **WHEN** a section review settles ERROR with an eligible failure class
- **THEN** the turn may close with the error visible and no new task approval is granted

#### Scenario: Mixed coverage after ERROR

- **WHEN** one covered task had a valid approval before the section ERROR and another did not
- **THEN** the archive gate keeps the first approved and reports only the second as missing

### Requirement: Session change involvement

The engine SHALL record per DSH session which active OpenSpec changes that session created or modified
under `.dsh/workflows/sessions`, and MUST NOT attribute a change from observation or a workspace diff
alone. Attribution MUST come from write evidence — a successful write or creation tool call targeting
the change during the turn — a successful change-creation command, or an explicit note or review call,
and the state MUST persist across turns and restarts as local scratch.

#### Scenario: No attribution on observation

- **WHEN** a new session opens an active change with checked tasks and no session attribution
- **THEN** it records no involvement and the gate does not steer that change

#### Scenario: Write evidence attributes a change

- **WHEN** a session successfully writes a file under an active change directory during a turn
- **THEN** the next gate records the change as that session's work

#### Scenario: Persistence

- **WHEN** the engine restarts and the same session id resumes
- **THEN** the recorded involvement is reused

### Requirement: Per-write task attribution

A successful `tasks.md` write SHALL attribute only the checkbox transitions caused by that write,
captured from the successful write's canonical before/after contents. It MUST set `specChanged` when
that write's checkbox-normalized before/after contents differ (a substantive task-plan edit or a newly
supplied `tasks.md`); a checkbox-only edit MUST NOT set `specChanged`. The whole-change artifact digest
MUST NOT be used to decide whether a `tasks.md` write was substantive.

#### Scenario: Concurrent task writers

- **WHEN** two sessions check different tasks in the same change during overlapping turns
- **THEN** each session attributes only the task it checked and each gate requires only that task

#### Scenario: Checkbox-only edit

- **WHEN** the only write is changing a task from unchecked to checked
- **THEN** the task is attributed but the change is not marked spec-changed

#### Scenario: Unobservable task write

- **WHEN** a shell write changes `tasks.md` and the engine cannot capture the before/after checkbox state
- **THEN** the change is attributed but no task id is attributed, and an explicit note or a task-review supplies task-level attribution

### Requirement: Session-scoped review triggers

The gated automatic triggers for a change SHALL evaluate only in a session that created or modified that
change. The whole-spec trigger applies only when the session created the change or changed its spec
artifacts; task scope only to tasks the session checked; progress and lane triggers only to an involved
change; the integration trigger only when the session's work completed the list. When the session's tick
completes the list, every checked task MUST have an approved PASS.

#### Scenario: Foreign session not steered

- **WHEN** a session that did not create or modify a change closes a turn while the change has checked tasks without review records
- **THEN** its gate does not steer a review for that change

#### Scenario: Own checked task is gated

- **WHEN** a session checks a task in a change it did not create and the task list is not complete
- **THEN** its gate requires a review for that task and not for checked tasks from other sessions

#### Scenario: Completion requires all checked tasks

- **WHEN** a session's checked task makes the task list fully checked and another checked task has no PASS record
- **THEN** the completing session's gate requires approval for that task too

### Requirement: Cross-session review evidence

Notes and explicit review runs SHALL remain available in any session. An explicit note or review call
MUST attribute that change to the calling session, and a review record MUST name the reviewing session.
A progress note MUST be written for a readable task even when another active change has no readable
`tasks.md`.

#### Scenario: Review from any session

- **WHEN** a session runs a review for a change it did not create or modify
- **THEN** the run starts, the record names the reviewing session, and the change is attributed to that session

#### Scenario: Unreadable foreign change does not block a note

- **WHEN** a note targets a task in a readable change while another active change has no readable tasks.md
- **THEN** the note is written for the readable task and the unreadable change is skipped

### Requirement: Review finding classification

Every review finding SHALL carry a class from the fixed vocabulary `spec-ambiguity`, `missing-test`,
`path-boundary`, `state-persistence`, `stale-input`, `api-contract`, `plan-shape`, `docs-drift`,
`security`, and `other`. The bundled review instructions SHALL request it, and the verdict parser SHALL
store a valid class, normalize an absent or unknown class to `other`, and MUST NOT reject a verdict for
a malformed class.

#### Scenario: Class is stored

- **WHEN** a review returns a finding with class `path-boundary`
- **THEN** the local review record carries that class with the finding

#### Scenario: Unknown class is normalized

- **WHEN** a finding names a class outside the vocabulary
- **THEN** the record stores `other` and the verdict is still accepted

### Requirement: Task lanes and the serial tail

The engine SHALL read lanes from `tasks.md`: a lane MUST be the numbered tasks under the nearest
preceding level-2 heading, a task before the first heading MUST belong to an untitled lane, a lane's
owned paths MUST be the backticked segments of its heading, a lane whose heading contains `serial`
(case-insensitive) MUST NOT count as remaining parallel work, and when no heading contains `serial`
every remaining lane MUST count.

#### Scenario: Serial tail excluded

- **WHEN** the only remaining unchecked tasks are under a heading containing `serial`
- **THEN** the trigger reports nothing

#### Scenario: Change without lane headings

- **WHEN** the change's `tasks.md` has no level-2 headings
- **THEN** the trigger reports nothing

### Requirement: Lane-assignment fan-out gate

For a change attributed to the current session with at least two non-serial lanes in the plan, the gate
SHALL report unassigned non-serial lanes with unchecked tasks that are not a lane the session ticked in
the turn. A lane is satisfied by a tagged worker start for that lane or by a matching serial note. A
change with exactly one non-serial lane reports nothing, and the gate MUST fail open on an unreadable
plan.

#### Scenario: Unassigned lane on an implementation turn

- **WHEN** a turn that ticked a task or changed implementation files leaves a non-serial lane with unchecked tasks unassigned and outside the lanes ticked that turn
- **THEN** the gate reports the lane with the exact calls

#### Scenario: Completing one lane leaves another

- **WHEN** the turn ticks the last task of lane A, lane B is the only remaining unchecked lane, and the plan has two non-serial lanes
- **THEN** the gate reports lane B

#### Scenario: Another session owns the work

- **WHEN** a different session completed, assigned, or serialized a lane
- **THEN** that evidence does not settle this session's gate

### Requirement: Lane assignment state

The engine SHALL keep a session-scoped assignment for each lane: `assigned` after a successful tagged
worker start, `serial` after a matching note, and current for a lane the session ticked in the turn. An
assignment for a lane that disappears or becomes complete MUST be ignored; a new or renamed lane is
unassigned. A tagged start MUST carry the exact lane tag in the tool arguments.

#### Scenario: Tagged worker assigns one lane

- **WHEN** a successful start contains the `lane-tag` for one lane
- **THEN** only that lane becomes assigned

#### Scenario: Untagged worker does not count

- **WHEN** a successful worker starts without the lane tag
- **THEN** no lane becomes assigned and the gate still reports unassigned lanes

#### Scenario: Renamed lane

- **WHEN** a lane title changes
- **THEN** the old assignment is ignored and the renamed lane is unassigned

### Requirement: Lane-assignment steer payload

The gate MUST steer with each unassigned lane's title, owned paths, a ready worker call carrying
`lane-tag: <change>#<n>`, and a per-lane note call for a serial decision, after a root-anchored
checkpoint commit. The worker call MUST require its own sibling worktree and branch, MUST forbid ticking
`tasks.md`, and the payload MUST NOT contain a machine path.

#### Scenario: Only unassigned lanes are listed

- **WHEN** the gate steers while some lanes are already assigned, serial, current, or complete
- **THEN** the payload lists only the unassigned lanes

#### Scenario: Checkpoint precedes workers

- **WHEN** the gate renders the payload
- **THEN** a commit command appears before the worker calls

#### Scenario: Ignored change directory

- **WHEN** the change directory matches a Git ignore rule
- **THEN** the checkpoint command force-adds that directory before committing

### Requirement: Lane-assignment fail-open

The lane-assignment gate MUST fail open. An unreadable `tasks.md`, a change without level-2 headings, an
unassigned lane without owned paths, and a turn with no implementation change or tick MUST NOT report
the rule. A lane that disappears or becomes complete MUST NOT keep its assignment.

#### Scenario: No lane headings

- **WHEN** the change's `tasks.md` has no level-2 headings
- **THEN** the gate reports nothing

#### Scenario: Read-only turn

- **WHEN** a turn neither ticked a task nor changed implementation files
- **THEN** the gate reports nothing

### Requirement: Worker-assigned checkpoint lanes

When a task lane is assigned to a tagged worker, a `continue` checkpoint lane covering that work MUST
name an owner other than `lead`, and a bottleneck whose targets fall inside that lane MUST use
`worker_start` or `user_decision`. The gate SHALL steer when the checkpoint lane is missing or
`lead`-owned, or when such a target uses `lead_action`. An unreadable checkpoint or lane plan fails open.

#### Scenario: Worker lane is bound

- **WHEN** a task lane was assigned to a tagged worker and the matching checkpoint lane is owned by a worker
- **THEN** the checkpoint lane passes and the bottleneck owner rule applies to its owner

#### Scenario: Missing assigned lane is refused

- **WHEN** a task lane was assigned to a tagged worker and no checkpoint lane covers it
- **THEN** the turn close is refused and the steer names the missing lane

#### Scenario: Lead action inside a worker lane is refused

- **WHEN** a `continue` bottleneck target falls inside a worker-assigned lane and the action is `lead_action`
- **THEN** the turn close is refused and the steer names `worker_start` or `user_decision`

### Requirement: Plan lane shape in whole-spec review

The bundled whole-spec review instruction SHALL check the plan's work lanes before implementation. It
MUST report a P1 finding when `tasks.md` has more than one level-2 task group and no heading names owned
paths, or when the stated single-lane reason is the review or archive process instead of a work
constraint. The finding MUST name the groups or the reason to change.

#### Scenario: Several groups without owned paths

- **WHEN** a change's `tasks.md` has two or more level-2 task groups and no heading contains a backticked owned path
- **THEN** the whole-spec review reports a P1 finding that names the groups and asks for owned paths or one work-constraint single-lane reason

#### Scenario: Process used as the single-lane reason

- **WHEN** the only stated single-lane reason is the task-review or archive process
- **THEN** the whole-spec review reports a P1 finding and names the work-level reason it needs

### Requirement: Review overlap in the apply loop

The documented apply loop SHALL start a task review as soon as the task is checked. It SHALL allow the
next independent task only when the review runs on a frozen snapshot; when the run falls back to live
worktree inputs, a write invalidates the verdict, so the guidance MUST require restoring snapshot
support and re-running or deferring writes until settlement without a blocking sleep. The record MUST
still be collected before the turn closes and before archive.

#### Scenario: Next task proceeds during a snapshot review

- **WHEN** the run reports a frozen snapshot and another task in the change does not depend on its verdict
- **THEN** the apply guidance permits implementing that task while the review runs

#### Scenario: Live-worktree fallback

- **WHEN** the run falls back to the live worktree because a review snapshot cannot be built
- **THEN** the apply guidance requires restoring snapshot support and re-running or deferring writes until the run settles, and does not prescribe a blocking sleep

#### Scenario: Guidance ships with the surviving skills

- **WHEN** the apply, propose, or update skill loads the shipped task-lane guidance
- **THEN** the guidance carries the review-at-tick and snapshot/fallback paragraphs and names the `workflows` `note` action for a serial decision, not the removed `task_progress` tool

### Requirement: Review trust boundaries

The engine SHALL validate review definition ids, change names, task ids, worktree paths, and git
arguments before effects, MUST use fixed-argument git commands, and MUST keep records and notes free of
credentials, secrets, and machine paths. Reviewer output MUST be treated as untrusted data.

#### Scenario: Invalid rule or change

- **WHEN** a definition id or change name contains a separator, traversal, or unknown directory
- **THEN** the tool rejects it before reading or writing

#### Scenario: Fixed git arguments

- **WHEN** the implementation digest or file list is computed
- **THEN** git runs with fixed arguments and no shell interpolation of model input

#### Scenario: No secrets in records

- **WHEN** a review record is written
- **THEN** it contains no credentials, tokens, machine-specific absolute paths, or private keys

### Requirement: Cataloged external review runs

A review activation on an external provider SHALL start with parent delivery and no explicit child name,
so the subagent service catalogs it as an external child of the delegating Session under the
`delegation:<rule>` label. The child MUST accept no follow-up input, and the parent MUST receive the
settlement notice with the review answer when the run completes.

#### Scenario: External review entry

- **WHEN** a review targets an external provider and the provider publishes the run
- **THEN** the Session's subagent list shows an external entry labelled `delegation:<rule>` with the service-assigned child name, and the entry closes as a leaf when the run settles

#### Scenario: External review notice

- **WHEN** the external review completes
- **THEN** the parent receives the settlement notice with the review answer, while the verdict parser, the record, and every gate behave as before

### Requirement: Provider-specific delivery and catalog behavior

A review activation on an external provider MUST use parent delivery, and the delivery flag only
decides whether the settlement notice is delivered. In-process providers keep the service's existing
behavior: their local children are always cataloged, and continuable children accept follow-up,
independent of the engine's delivery choice.

#### Scenario: Local provider unchanged

- **WHEN** a review target uses an in-process provider
- **THEN** the service catalogs the local child exactly as before (a continuable child accepts follow-up), and the engine's delivery choice only decides whether its settlement notice is delivered

### Requirement: Shipped strong reviewer defaults

The `reviewers.codex` entry SHALL select the shipped strong Codex model with `xhigh` reasoning
effort, and a review step naming `codex` SHALL forward that model and effort; a profile may override
the entry but the shipped default MUST NOT be the weaker model.

#### Scenario: Shipped reviewer defaults

- **WHEN** a review step names the `codex` reviewer with the shipped setup
- **THEN** the provider starts with the strong model and `xhigh` effort

### Requirement: Surviving legacy ownership

Legacy ownership SHALL be resolved per declared signal, not per provider. An `own` definition or step
MUST be refused while its matching legacy signal is enabled; a `defer` definition or step MUST be refused
unless that signal is enabled. The surviving sources are the checkpoint signal (`retro` to
`goal-continuity` `work_checkpoint`, following `checkpoint.automation`) and verification (`verify` to the
`verification-gate` row, following its row configuration and command).

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
- **THEN** the definition is refused with the split-state diagnostic and the setting that MUST be turned off

#### Scenario: Rollback

- **WHEN** the owner re-enables the surviving legacy signal and flips the definition back to `defer`
- **THEN** the legacy signal steers again and the workflow adds no second steer
