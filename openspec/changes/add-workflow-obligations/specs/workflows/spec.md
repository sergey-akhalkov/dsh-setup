# Spec Delta

## Purpose

Defines stored workflow definitions, event and optional intent triggers, durable obligation runs, step executors, evidence verification, and the gates that refuse a turn close or a creation/archive command while a required step is open.

## ADDED Requirements

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

A run SHALL be persisted atomically under `.dsh/workflows/runs/<runId>.json` with definition, trigger, session, workspace, status, steps, and evidence. Status SHALL be `running`, `blocked`, `completed`, `failed`, `cancelled`, or `interrupted`. On startup, a run left `running` or `blocked` by a previous process SHALL be marked `interrupted` and MUST NOT be auto-completed.

#### Scenario: Run is durable

- **WHEN** a step settles
- **THEN** the run file is atomically replaced with the new state and remains readable after a restart

#### Scenario: Restart marks unfinished runs

- **WHEN** the plugin loads and finds a run left `running` by an earlier process
- **THEN** it is marked `interrupted` with a bounded reason and is not completed automatically

#### Scenario: Cancellation is recorded

- **WHEN** the user cancels a run
- **THEN** its status becomes `cancelled` and the open step is recorded as cancelled

### Requirement: Run resume

An `interrupted` or `blocked` run SHALL be resumable by run id at its pending step. Resuming MUST NOT recreate a change directory, restart a completed step, or start a second run; it SHALL re-evaluate only the pending step from durable state.

#### Scenario: Interrupted run resumes at its pending step

- **WHEN** an interrupted run is resumed by id
- **THEN** it continues at its pending step, its status returns to `running`, and no second run starts

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

The `/workflows adopt <name>` command SHALL verify the existing `proposal.md`, `design.md`, `tasks.md`, at least one `specs/*/spec.md`, and the current whole-spec `PASS` record, ask the user to confirm, and write a host-authenticated `.dsh/workflows/receipts/<name>.json` without calling `openspec new change`. A non-affirmative answer MUST NOT write the receipt. The model MUST NOT invoke the adoption path.

#### Scenario: Existing change is adopted

- **WHEN** the user runs `/workflows adopt auth` for a change with all artifacts and a current whole-spec `PASS` record and answers yes
- **THEN** the host-authenticated adoption receipt is written and the change directory is not recreated

#### Scenario: Missing artifact blocks adoption

- **WHEN** one required artifact is missing
- **THEN** no receipt is written and the missing artifact is named

#### Scenario: Rejected confirmation writes nothing

- **WHEN** the user answers no to the adoption confirmation
- **THEN** no receipt is written and the archive gate stays refused

#### Scenario: Model cannot adopt

- **WHEN** the model tries to invoke the adoption path
- **THEN** it is refused and no receipt is written

### Requirement: Model interface

The `workflows` tool SHALL expose `list`, `start`, `resume`, `status`, `evidence`, and `cancel`. `start` SHALL require `allowModelStart` and user confirmation for `risk: high`. `resume` SHALL continue an interrupted or blocked run in the current session and workspace at its pending step without starting a new run. `evidence` SHALL be accepted only when the host verifies it. The tool MUST NOT accept a raw script or definition, install one, start an adoption, or write an adoption receipt.

#### Scenario: List definitions

- **WHEN** the model calls `list`
- **THEN** it receives the definitions it may start and their trigger modes

#### Scenario: Allowed start

- **WHEN** the model starts a definition with `allowModelStart: true`
- **THEN** one run starts and the tool returns its id

#### Scenario: Refused start

- **WHEN** the model starts a definition without `allowModelStart`
- **THEN** the start is refused with the next action

#### Scenario: Interrupted run resumes

- **WHEN** the model calls `resume` with an interrupted run id in its session
- **THEN** the run continues at its pending step and no new run starts

#### Scenario: Raw script is refused

- **WHEN** the model submits a script instead of a definition id
- **THEN** the tool rejects the call

### Requirement: User interface

The plugin SHALL register `/workflows` (opens the Workflows view in the current session), `/workflows resume <runId>` (resumes an interrupted run), `/workflows install <path>` (installs and approves a definition), and `/workflows adopt <name>` (adopts an existing change). The view SHALL show definitions, triggers, runs, step state, evidence, receipts, and the trigger evaluation log. It MUST NOT require a separate main panel and MUST NOT execute a workflow from a display-only action.

#### Scenario: Command opens the view

- **WHEN** the user runs `/workflows`
- **THEN** the Workflows view opens for the current session

#### Scenario: Resume command continues a run

- **WHEN** the user runs `/workflows resume <runId>` for an interrupted run
- **THEN** the run continues at its pending step and no new run starts

#### Scenario: Install command is user-started

- **WHEN** the user runs `/workflows install <path>`
- **THEN** the definition installation starts only after the user confirms

#### Scenario: Adoption command is user-started

- **WHEN** the user runs `/workflows adopt auth`
- **THEN** the adoption verification starts for `auth` and no change directory is created

#### Scenario: Run detail is visible

- **WHEN** the user opens a run
- **THEN** the step state, evidence, and failure class are shown

#### Scenario: Display does not execute

- **WHEN** the user clicks a run row or a step
- **THEN** no workflow starts and no tool is called

### Requirement: System prompt context

The engine SHALL add at most one bounded line per active run to the system prompt, naming the definition and the current step, and SHALL add no section when no run is active. The line MUST NOT include a full prompt or definition.

#### Scenario: Active run is named

- **WHEN** one run is active
- **THEN** the system prompt carries one line with the definition and current step

#### Scenario: No run adds no section

- **WHEN** no run is active
- **THEN** the system prompt is byte-identical without the workflow section

#### Scenario: Line is bounded

- **WHEN** many runs are active
- **THEN** the section is capped and no full prompt is included

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

Tool steps SHALL use an allowlist, paths SHALL stay inside the workspace, prompts and outputs SHALL be bounded and redacted, and no definition SHALL carry a credential. Approvals, receipts, and authoritative run state SHALL be authenticated with a host key held outside `.dsh`; the model MUST NOT forge them. The write guard SHALL cover the definitions, approvals, receipts, and runs directories. Adoption SHALL remain user-started; the model MUST NOT create a valid adoption receipt.

#### Scenario: Path escape is refused

- **WHEN** a step's evidence or draft path resolves outside the workspace
- **THEN** the step is refused and the run records the reason

#### Scenario: Secret is refused

- **WHEN** a definition contains a credential-shaped value
- **THEN** load fails with the field and no secret is stored

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
