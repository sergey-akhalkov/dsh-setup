# workflows Specification

## Purpose
Defines stored workflow definitions, event and optional intent triggers, durable obligation runs, step executors, evidence verification, and the gates that refuse a turn close or a creation/archive command while a required step is open.

## Requirements

### Requirement: Workflow definition

The plugin SHALL load workflow definitions from `.dsh/workflows/definitions/*.json` plus shipped defaults. A definition SHALL carry an id, name, version, trigger, an ordered step list, and settings; it MUST be data, not executable code. An unknown field, a missing step id, a duplicate step, or an invalid edge SHALL fail load with the definition and field.

#### Scenario: Valid definition loads

- **WHEN** a definition has a known schema, unique step ids, and valid edges
- **THEN** it is listed and can be started

#### Scenario: Invalid definition is refused

- **WHEN** a definition has a duplicate step id or an unknown field
- **THEN** plugin load fails with the definition id and the field

#### Scenario: Shipped defaults are read-only

- **WHEN** the user has not created a local definition
- **THEN** the shipped definitions are available and cannot be edited in place

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

A whole-spec review record SHALL be read from `.dsh/delegation/spec-review/<change>/spec.json` and MUST match `rule: spec-review`, the change name, `phase: spec`, `scope: whole`, `verdict: PASS`, and a digest equal to the current change spec digest. A task-scoped record MUST NOT satisfy a whole-spec step.

#### Scenario: Whole-spec record completes the review step

- **WHEN** `.dsh/delegation/spec-review/auth/spec.json` has rule `spec-review`, change `auth`, phase `spec`, scope `whole`, verdict `PASS`, and the current spec digest
- **THEN** the review step is marked done with the record path and digest

#### Scenario: Stale whole-spec record blocks

- **WHEN** a whole-spec `PASS` record's digest does not match the current change artifacts
- **THEN** the step is blocked with `record-mismatch`

#### Scenario: Task-scoped record is not whole-spec evidence

- **WHEN** only a task-scoped record exists under the change's `reviews/` directory
- **THEN** the review step stays blocked with `record-mismatch`

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

The engine SHALL refuse `openspec archive <change>` while a required review or spec-review step is open, no authenticated completed `change-intake` run or authenticated receipt exists, or the current whole-spec `PASS` record is missing or stale. A receipt MUST verify its host HMAC; a forged or unsigned receipt MUST NOT satisfy the gate. The refusal SHALL name the run, step, and missing evidence. It MUST allow the archive when the evidence is present and MUST NOT treat a text claim as evidence.

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

### Requirement: Shipped definitions

The plugin SHALL ship `change-intake` (active: requirements, architecture, interface, create-change, spec, spec-review, approval), `task-review` (active, `gateOwnership: defer`: the existing review record is the evidence), and `retro` (active, `gateOwnership: defer`, applicability-gated: the existing checkpoint is the evidence). Each deferred definition SHALL create observational runs only for applicable events and MUST NOT steer.

#### Scenario: Deferred workflows create runs

- **WHEN** an active `task-review` or applicable `retro` trigger matches while its legacy source is installed
- **THEN** one observational run is created, its evidence is read, and no steer is added

#### Scenario: Task review is deferred

- **WHEN** a task is checked while the legacy review gate is installed
- **THEN** the task-review workflow reads the review record and does not add a second gate

#### Scenario: Retro is deferred

- **WHEN** an applicable turn stops while the legacy checkpoint gate is installed
- **THEN** the retro workflow reads the checkpoint and does not add a second gate

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

The shipped `spec-review` step SHALL remain evidence-only while deferred: it SHALL read the current whole-spec PASS record from the legacy gate and MUST NOT dispatch `delegate` or add a steer. Its declared `delegate` tool is dispatched only when ownership moves to `own` in `retire-legacy-gates`.

#### Scenario: Deferred spec-review does not dispatch

- **WHEN** the intake reaches the deferred `spec-review` step and the whole-spec record is absent
- **THEN** the engine dispatches no `delegate` call and the step stays open for the legacy gate

#### Scenario: Legacy gate supplies the review

- **WHEN** the legacy gate writes a current whole-spec PASS record
- **THEN** the deferred step completes from that record without an intake-engine delegate call

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
- **THEN** it overrides the shipped default and can be listed

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

The engine SHALL be configured by `enabled`, `maxBlocks`, `maxRuns`, `definitionsDir`, `runRetentionDays`, `allowIntent`, and `checkpointApplicability` (`minToolCalls` default 4, `requireWrite` default true), validated fail-loud. `checkpointApplicability` MUST mirror the installed goal-continuity checkpoint settings; docs state this. `enabled: false` SHALL stop new runs and steers while keeping existing run records readable. A configuration error MUST fail plugin load with the field.

#### Scenario: Defaults apply

- **WHEN** the row omits the workflow config
- **THEN** the engine is enabled with the documented defaults

#### Scenario: Applicability defaults and override

- **WHEN** the row omits `checkpointApplicability`
- **THEN** `minToolCalls` is 4 and `requireWrite` is true; an explicit value replaces the default and an out-of-range value fails load with the field

#### Scenario: Invalid configuration

- **WHEN** `maxBlocks` is zero or `runRetentionDays` is negative
- **THEN** plugin load fails with the field and accepted range

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

The plugin SHALL provide a Design page in the right sidebar, opened from the guide card, as a workbench with a left rail, a center node canvas, and an inspector. The left rail SHALL list the installed workflows and the building blocks (trigger kinds and step executors). The page SHALL open on the canvas of the selected workflow or, when none is selected, the first installed workflow, and SHALL show a blank canvas with the rail and a start affordance when none is installed. In a panel narrower than the shipped narrow-width threshold the page SHALL open in list mode, and the canvas SHALL remain reachable there. The canvas SHALL support pan, zoom, selection, and keyboard focus, and MUST NOT be the only way to inspect or edit a definition.

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

### Requirement: Definition editing

The editor SHALL create, edit, duplicate, rename, delete, and version-bump local definitions, and SHALL save only after schema validation passes and only through the host's shared install/approve function. A successful save MUST persist both the definition and its matching host-signed approval record; a failed definition or approval write MUST leave both unchanged. A shipped definition MUST be read-only; editing one SHALL create a local copy.

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

The editor SHALL list the shipped templates and create a local definition from one, including the `change-intake`, `task-review`, and `retro` shapes. A template MUST be copied, not mutated.

#### Scenario: Template list

- **WHEN** the user opens the template picker
- **THEN** the shipped templates are listed with their step counts

#### Scenario: Template copy

- **WHEN** the user creates a definition from a template
- **THEN** a local copy is created and the shipped template remains unchanged

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
