# delegation-rules Specification

## Purpose
Defines the model-agnostic delegation rule engine: configurable triggers, targets, instructions, contracts, and gates, with model-agnostic default rules, incremental task-scoped review, task progress notes, and a turn-stopping gate that binds a handoff to a digest-bound result.

## Requirements

### Requirement: Delegation rule engine

The bundle SHALL register a rules engine whose rules are data: each rule names a trigger, a target, an instruction, a result contract, and a gate policy. The engine MUST NOT hard-code Codex or any other provider; targets are resolved from the registered DSH subagent providers, and the plugin MUST compose when a target is missing instead of failing the profile.

#### Scenario: Default rules

- **WHEN** the plugin is active with the shipped default rules
- **THEN** the spec-review, task-review, task-progress, blocker, research, bug-fix, and optional integration-review rules are available to the delegate/task_progress tools

#### Scenario: Custom rule

- **WHEN** the profile adds a rule on an existing trigger and contract
- **THEN** the engine accepts it without a code change and exposes it to the delegate tool

#### Scenario: No rules

- **WHEN** the configuration contains no rules
- **THEN** the plugin composes and the delegate tool reports that no delegation rules are configured

#### Scenario: Invalid rule

- **WHEN** a rule has an unknown trigger, contract, gate, missing target, or duplicate id
- **THEN** the plugin reports the configuration error with the rule id and next action

### Requirement: Trigger evaluation

The engine SHALL implement the six deterministic triggers `manual`, `spec-ready`, `spec-task-ready`, `implementation-work`, `implementation-complete`, and `failure-streak`. A trigger MUST evaluate only from session/workspace state and tool results, MUST be evaluated at `agent/turn-stopping` for gated rules, and MUST NOT start a target run from the listener. A new trigger source requires a code extension.

#### Scenario: Spec-ready trigger

- **WHEN** an active review-ready change has a gated whole-spec review rule without a matching pass
- **THEN** the trigger reports the rule as unsatisfied

#### Scenario: Spec-task-ready trigger

- **WHEN** a task in `tasks.md` is checked and has no matching task-review record
- **THEN** the trigger reports the task as needing a task-scoped review

#### Scenario: Implementation-work trigger

- **WHEN** a turn changed implementation files and has neither a newly checked reviewed task nor a matching task-progress note for the current worktree
- **THEN** the trigger reports that a tick+review or a progress note is required

#### Scenario: Implementation-complete trigger

- **WHEN** a change's task list is complete and its optional integration-review rule has no matching pass
- **THEN** the trigger reports the integration rule as unsatisfied

#### Scenario: Failure-streak trigger

- **WHEN** the configured number of consecutive failed tool calls has no intervening success and no consultation attempt
- **THEN** the trigger reports the soft rule as needing a delegation

#### Scenario: Manual trigger

- **WHEN** a rule uses the manual trigger
- **THEN** it has no automatic condition and runs only through the delegate tool

#### Scenario: Unknown trigger

- **WHEN** a rule names a trigger outside the documented vocabulary
- **THEN** configuration validation rejects it

### Requirement: Target resolution and model options

A target SHALL name a registered DSH subagent provider and MAY add a `model`, a `reasoningEffort`,
or provider-supported agent options. The engine MUST resolve the provider at use time, pass these
options in the subagent start request, validate them against provider capabilities, and report a
missing or incompatible target with the target id, provider name, and next action. The engine MUST
NOT silently escalate a target's permissions.

#### Scenario: Codex target with model and effort

- **WHEN** a rule targets the registered `codex-subagent` provider with `model: astra` and `reasoningEffort: xhigh`
- **THEN** the engine starts that provider with those options and the rule's instruction and context

#### Scenario: Effort-only target

- **WHEN** a target sets only `reasoningEffort` and leaves the model to the provider default
- **THEN** the engine passes the effort and the provider applies its configured/default model

#### Scenario: Codex target

- **WHEN** a rule targets the registered `codex-subagent` provider without options
- **THEN** the engine starts that provider with the rule's instruction and context

#### Scenario: Non-Codex target

- **WHEN** a rule targets a registered DSH in-process provider with another model
- **THEN** the engine uses that provider/model and the same rule contract

#### Scenario: Missing target

- **WHEN** a rule references a target whose provider is not registered
- **THEN** the tool reports the missing provider and the exact target configuration key

#### Scenario: Unsupported option

- **WHEN** a target requests a model, effort, or option the provider does not support
- **THEN** the engine rejects the target with the unsupported capability instead of ignoring it

### Requirement: Review contract

The review contract SHALL compute the rule's scope digest, run the target with the bundled P0/P1 prompt, accept exactly one matching JSON verdict, and write an atomic record with the rule, scope, task id when task-scoped, digest, verdict, findings, target identity, time, and the owning thread. A `PASS` MUST require zero P0/P1 findings; a matching `PASS`/`FINDINGS` record MUST be reused without another run; a stale whole-scope digest MUST be ignored. A review run for a change whose owner is another thread MUST be refused before the target starts.

#### Scenario: Passing review

- **WHEN** the target returns zero P0/P1 findings with the matching digest in the owning thread
- **THEN** the engine writes a `PASS` record carrying the owning thread and returns the verdict

#### Scenario: Findings

- **WHEN** the target returns at least one P0 or P1 finding
- **THEN** the engine writes a `FINDINGS` record and returns every blocking finding with evidence and fix

#### Scenario: Stale whole-scope record

- **WHEN** the reviewed artifact or worktree changes after a whole-scope pass
- **THEN** the stored record is ignored and a new review is required

#### Scenario: Malformed verdict

- **WHEN** the target returns no single matching verdict, an invalid severity, or prose only
- **THEN** no `PASS` is written and the failure is reported

### Requirement: Task-scoped review

A task-scoped review SHALL be driven by a checked task, key the record by a stable hash of the normalized task text, include the change artifact digest and the current worktree snapshot, and treat the record as a historical task snapshot. Later tasks MUST NOT invalidate an earlier task record; the optional integration review MUST use the current whole-worktree digest.

#### Scenario: Checked task reviewed

- **WHEN** a checked task has no matching task-review record
- **THEN** the engine requires a task-scoped review and writes its PASS/ERROR/FINDINGS record

#### Scenario: Task text changed

- **WHEN** a task's normalized text changes after its review
- **THEN** the task id changes and a new task review is required

#### Scenario: Later task does not invalidate

- **WHEN** a later task changes the worktree after an earlier task pass
- **THEN** the earlier task record remains historical and the optional integration review covers the current whole worktree

#### Scenario: Task review staleness

- **WHEN** the same task's worktree snapshot changes before its review
- **THEN** the review uses the current snapshot and records it

### Requirement: Task progress note

The `task_progress` tool SHALL write a task id, status (`in-progress` or `blocked`), reason, worktree digest, and time without running a target or writing a `PASS`. The note MUST be the only non-tick way to close a code-changing turn and MUST become stale when the worktree digest changes.

#### Scenario: In-progress task

- **WHEN** a task spans the turn and the agent records `task_progress(task, in-progress, reason)`
- **THEN** the engine writes the note with the current worktree digest and runs no model

#### Scenario: Blocked task

- **WHEN** the agent records `task_progress(task, blocked, reason)`
- **THEN** the note is reported and the task remains unchecked

#### Scenario: Stale note

- **WHEN** the worktree changes after a progress note
- **THEN** the note no longer authorizes a close and a fresh note or tick+review is required

#### Scenario: No pass from a note

- **WHEN** a progress note exists for a task
- **THEN** it never counts as a task-review `PASS`

### Requirement: Task progress gate

The gate SHALL refuse a code-changing turn close unless every checked task has a matching task-review `PASS`/`ERROR` and the turn has a newly checked reviewed task or a matching task-progress note for the current worktree. A note MUST NOT authorize a completed task, and the status tool MUST report active and stale notes.

#### Scenario: Code change without a tick or note

- **WHEN** a turn changes implementation files and has no checked reviewed task and no progress note
- **THEN** the gate steers to tick+review or `task_progress`

#### Scenario: Progress note allows the close

- **WHEN** a code-changing turn has a matching progress note for the current worktree
- **THEN** the gate allows the close with the task still unchecked

#### Scenario: Checked task without its review

- **WHEN** a task is checked but has no task-review PASS/ERROR
- **THEN** the gate refuses the close even if a progress note exists

#### Scenario: Stale progress note

- **WHEN** the worktree changes after a progress note
- **THEN** the stale note no longer authorizes a close

### Requirement: Answer contract

The answer contract SHALL run the target in read-only mode, return a bounded answer with evidence and, for research, sources and dates, and write no gate record. A successful answer MUST be usable by the agent while a failed answer MUST be reported without trapping the turn.

#### Scenario: Research

- **WHEN** a research rule runs
- **THEN** the answer includes evidence and sources and does not authorize a gate

#### Scenario: Blocker

- **WHEN** a blocker rule runs
- **THEN** the answer names a recommendation, evidence, and the next action

#### Scenario: Failed answer

- **WHEN** the target is unavailable or the run fails
- **THEN** the tool reports the cause and the turn is not trapped by that attempt

### Requirement: Patch contract

The patch contract SHALL run a write-capable target in an isolated git worktree, return the changed files, diff, and test results, and MUST NOT apply the diff to the session worktree or treat the patch as a review pass. A patch rule whose target is not write-capable MUST fail validation before any run.

#### Scenario: Patch produced

- **WHEN** a write-capable target completes a bug-fix rule
- **THEN** the tool returns the worktree path, diff, and test results for review

#### Scenario: No write target

- **WHEN** a patch rule targets a read-only provider
- **THEN** the engine rejects the rule before starting a run

#### Scenario: No auto-merge

- **WHEN** a patch completes
- **THEN** the session worktree is unchanged and the owner/agent decides whether to apply it

#### Scenario: Failed patch

- **WHEN** the target fails or its tests fail
- **THEN** the tool reports the failure and leaves the worktree for inspection

### Requirement: Turn-stopping gate

For every gated rule, the engine SHALL refuse a turn close unless a matching `PASS` or `ERROR` record exists for the rule and digest; it MUST steer with the rule id, digest, record path, and exact delegate call and MUST NOT accept a text claim. A soft rule MUST steer once per failure streak; a failed delegation MUST be reported and MUST NOT trap the turn. A stale record MUST never authorize a handoff. A change-scoped review rule MUST apply only in the change's owning thread.

#### Scenario: Strict rule unsatisfied

- **WHEN** a turn is about to close and a strict rule has no matching record
- **THEN** the engine refuses the close and steers to the delegate call

#### Scenario: Strict rule error

- **WHEN** the target is unavailable and the tool writes a matching `ERROR` record
- **THEN** the turn may close with the error visible and no pass is reported

#### Scenario: Stale record

- **WHEN** the digest changes after a pass
- **THEN** the stale pass is ignored and the gate requires a new run

#### Scenario: Foreign thread not steered

- **WHEN** a turn in a foreign thread is about to close and the change's review is missing or stale
- **THEN** the gate does not steer that change's review and does not refuse the close for it

#### Scenario: Soft rule

- **WHEN** a soft rule's failure streak has no consultation attempt
- **THEN** the gate steers once and a reported failure does not loop it

#### Scenario: Text claim

- **WHEN** the agent claims a review passed without a matching record
- **THEN** the gate still refuses the close

### Requirement: Delegate tool and status

The bundle SHALL register a `delegate` tool whose rule parameter is generated from the configured rules and whose description names the manual tasks, a `task_progress` tool for unchecked-task notes, and a `delegation_status` tool that reports registered providers/capabilities, configured targets/rules, active/stale notes, each active change's owning thread and whether it is the current thread, and missing-target diagnostics. The tools MUST validate their rule/target/note inputs before starting a run or writing a note. A review delegate for a foreign change MUST be refused with the owning thread and next action.

#### Scenario: Manual delegation

- **WHEN** the agent calls delegate for a configured manual rule
- **THEN** the engine validates the input and runs that rule's target/instruction

#### Scenario: Progress tool

- **WHEN** the agent calls task_progress for an unchecked task
- **THEN** the tool writes the note and runs no model

#### Scenario: Unknown rule

- **WHEN** the agent names a rule that is not configured
- **THEN** the tool rejects the call with the allowed rule ids

#### Scenario: Status

- **WHEN** the agent or user asks for delegation status
- **THEN** the tool reports the available providers, targets, rules, active/stale notes, and missing-target diagnostics

#### Scenario: Foreign change status

- **WHEN** delegation_status runs in a thread that does not own a change
- **THEN** it reports the change's owning thread and the current thread, without a review run

### Requirement: Model-agnostic defaults and documentation

The shipped default rules SHALL be model-agnostic data; the setup MAY default their targets to the Codex provider, but the bundle MUST NOT require Codex, and the documentation MUST show a non-Codex target with another provider/model. The default set SHALL include whole-spec review, task review, task progress, blocker, research, bug fix, and an optional integration review. The acceptance MUST exercise at least one non-Codex target.

#### Scenario: Default setup

- **WHEN** the setup is installed with the shipped defaults
- **THEN** the default rules target the configured Codex provider

#### Scenario: Non-Codex target

- **WHEN** a profile points a default or custom rule at a DSH in-process provider with another model
- **THEN** the same rule contract and gate apply

#### Scenario: No Codex dependency

- **WHEN** the rules package is inspected and Codex is absent
- **THEN** the generic engine still composes and reports the Codex target as unavailable

#### Scenario: Documentation

- **WHEN** a user reads the plugin documentation
- **THEN** it shows the trigger/contract/gate model, a Codex target, a non-Codex target, and the config/code boundary

### Requirement: Model-facing cost

The bundle SHALL NOT register an always-on system-prompt section. Its model-facing policy MUST stay in the tool descriptions and the on-demand skill, bounded by a documented budget: the three tool descriptions plus the skill catalog description at 900 estimated tokens and the skill body at 24,000 UTF-8 bytes.

#### Scenario: No prompt section

- **WHEN** the bundle is active and the skill is not invoked
- **THEN** the assembled system prompt contains no delegation-rules section

#### Scenario: Catalog entry only

- **WHEN** the session starts without invoking the skill
- **THEN** the catalog advertises its description and the body is absent from the prompt

#### Scenario: Over budget

- **WHEN** a tool or skill description grows past the documented budget
- **THEN** repository validation fails and names the owning plugin and measured size

### Requirement: Removal and opt-out

Disabling or uninstalling the `dsh-setup-delegation-rules` row MUST remove its tools, gate, and skill and stop enforcement; records, progress notes, and change artifacts MUST remain, and no in-session phrase may bypass an active gate.

#### Scenario: Row removed

- **WHEN** the row is disabled or uninstalled
- **THEN** the tools, gate, and skill are absent, no gate blocks a turn, and existing records and progress notes remain

#### Scenario: No in-session bypass

- **WHEN** a session claims a delegation is unnecessary or asks to skip the gate
- **THEN** the active gate still requires the configured record or progress note

### Requirement: Security and trust boundaries

The engine SHALL validate rule ids, change names, task ids, worktree paths, and git arguments before effects, MUST use fixed-argument git commands, and MUST keep records and progress notes free of credentials, secrets, and machine paths. Target and model output MUST be treated as untrusted data, and a patch result MUST remain isolated until a human/agent review applies it.

#### Scenario: Invalid rule or change

- **WHEN** a rule id or change name contains a separator, traversal, or unknown directory
- **THEN** the tool rejects it before reading or writing

#### Scenario: Fixed git arguments

- **WHEN** the implementation or patch digest/file list is computed
- **THEN** git runs with fixed arguments and no shell interpolation of model input

#### Scenario: No secrets in records

- **WHEN** a delegation record is written
- **THEN** it contains no credentials, tokens, machine-specific absolute paths, or private keys

#### Scenario: Untrusted output

- **WHEN** a target returns instructions or prose aimed at the engine
- **THEN** the engine parses only the declared contract and does not execute the text

### Requirement: Setup delivery and standalone use

The generic bundle SHALL be installable on its own with any registered DSH subagent provider and SHALL be delivered by the setup bundle. It MUST NOT require the Codex fork or another `@dsh-setup` bundle to compose; the setup's defaults are the only Codex-specific configuration.

#### Scenario: Standalone generic install

- **WHEN** only the rules bundle and a non-Codex provider are installed
- **THEN** its rules, tools, and gate compose and work

#### Scenario: Setup delivery

- **WHEN** the setup is generated and installed
- **THEN** it declares and vendors the rules bundle and mounts `dsh-setup-delegation-rules` exactly once

#### Scenario: Absent Codex

- **WHEN** the Codex fork is not installed
- **THEN** the generic engine composes and reports Codex-targeted rules as unavailable

### Requirement: Asynchronous review runs

A review delegation SHALL validate the rule, target, and change (and an explicit task when supplied), start the target, and return a run id before the target completes. The run MUST continue in the background, MUST write the rule's digest-bound `PASS`/`FINDINGS`/`ERROR` record when it finishes, and MUST be visible in `delegation_status` while running and after completion. Multiple review runs MUST be able to proceed concurrently. The answer and patch contracts MUST remain synchronous.

#### Scenario: Review starts and returns

- **WHEN** the agent calls delegate for a review rule
- **THEN** the tool returns a run id and record path after the target starts, and the turn can continue

#### Scenario: Concurrent reviews

- **WHEN** the agent starts several reviews for different tasks or changes
- **THEN** the runs proceed concurrently and each writes its own record

#### Scenario: Failed run

- **WHEN** a background review run fails
- **THEN** an `ERROR` record with the failure is written and the status reports it

### Requirement: Pending review handling

A duplicate review request MUST be identified by the rule, the change, and the task/phase. A second request for the same identity while pending MUST return the existing run handle and MUST NOT start a duplicate. Distinct rules reviewing the same change/task MUST share the conversation key but queue as separate runs and write each rule's own record. Runs sharing a conversation key MUST be serialized, and a superseded or late completion MUST NOT replace the authoritative record.

#### Scenario: Duplicate pending request

- **WHEN** a review is already pending for the same rule/change/task and delegate is called again
- **THEN** the existing run handle is returned and no second target starts

#### Scenario: Different rules, same task

- **WHEN** two different review rules target the same change/task while one is pending
- **THEN** the second rule runs (queued) and writes its own record instead of returning the first rule's handle

#### Scenario: Late completion

- **WHEN** a run sharing a key completes after the authoritative record was written
- **THEN** its result is reported as discarded and does not replace the record

### Requirement: Stable review inputs

A background review MUST review immutable inputs bound to its digest. It MUST NOT publish a `PASS` when any reviewed input changed at any time during the run, including when the content is later restored. A digest re-check alone is not sufficient; the engine must use a snapshot or equivalent mutation tracking that makes the reviewed contents immutable for the run.

#### Scenario: Inputs change during a review

- **WHEN** a reviewed file is edited while a background review is still running
- **THEN** no `PASS` is published for that digest and the run reports that the inputs changed

#### Scenario: Edit-read-restore

- **WHEN** a reviewed file is edited, read by the target, and restored to its original content before the run completes
- **THEN** no `PASS` is published, because the target did not review the digest's contents

#### Scenario: Stable inputs

- **WHEN** the inputs stay unchanged for the run
- **THEN** the verdict is accepted for the digest computed at start

### Requirement: Explicit task review selection

A task-scoped review `delegate` call SHALL accept an explicit task id; when present, the engine MUST review that checked task after validating that it is checked and matches the task-review rule, instead of selecting the next checked task. Parallel task-review calls for different tasks MUST NOT collapse onto one task. When the task id is absent, the existing next-checked-task selection applies.

#### Scenario: Explicit task

- **WHEN** delegate names a checked task for task-review
- **THEN** that task is reviewed even when another task is next

#### Scenario: Parallel task reviews

- **WHEN** two task-review calls name different checked tasks at the same time
- **THEN** both tasks are reviewed independently

#### Scenario: Unknown or unchecked task

- **WHEN** the named task is missing or unchecked
- **THEN** the tool rejects the call before starting a target and names the allowed checked tasks

### Requirement: Change ownership

The engine SHALL record the first thread that observes an active OpenSpec change as its owner under `.dsh/delegation` and MUST reuse that owner across turns, threads, and engine restarts. The owner MUST be the DSH thread/session id, and the owner state MUST stay local scratch and MUST NOT be committed.

#### Scenario: Owner persists

- **WHEN** a change's owner is recorded and the engine restarts
- **THEN** the same thread remains the owner and the status reports it

#### Scenario: No owner yet

- **WHEN** no thread has observed a newly created change
- **THEN** the first thread to observe it becomes the owner

### Requirement: Thread-scoped review triggers

The gated automatic triggers for a change (`spec-ready`, `spec-task-ready`, `implementation-work`, `implementation-complete`, and the integration review) SHALL evaluate only in the change's owning thread. Another thread MUST NOT be steered to review a change it does not own. A review `delegate` call for a foreign change MUST fail with the owner and the next action before starting a target. `task_progress` notes, answer runs, and patch runs MUST remain available in any thread.

#### Scenario: Owning thread reviews

- **WHEN** the owning thread checks a task or edits the spec of its change
- **THEN** its gate steers the spec/task/integration review as before

#### Scenario: Foreign thread not steered

- **WHEN** another thread opens the same workspace with the change's review missing or stale
- **THEN** its gate does not steer a review of that change and its turn closes without a foreign review obligation

#### Scenario: Foreign thread review refused

- **WHEN** a foreign thread calls delegate for a review rule on the change
- **THEN** the engine refuses before starting a target and names the owning thread and next action

### Requirement: Deterministic review-run settlement signal

The bundle SHALL accept an optional settlement observer in its apply options. When supplied, it MUST be called exactly once per background review run, after the run is no longer pending, with the run id and terminal state (`completed`, `failed`, or `discarded`), allowing callers to await settlement without polling or timeouts. The observer MUST NOT change records, gates, concurrency, or targets, and omitting it MUST change nothing.

#### Scenario: Terminal state observed

- **WHEN** an observer is supplied and a background review run reaches a terminal state
- **THEN** the observer is called once with the run id and that terminal state, and the run is no longer reported as pending

#### Scenario: Early settlement

- **WHEN** a run settles before its caller starts awaiting that run id
- **THEN** the observer has already delivered the terminal state, so the caller can resolve the run without reading the durable run file

#### Scenario: Non-terminal transitions

- **WHEN** a run is queued or running
- **THEN** the observer is not called

#### Scenario: No observer

- **WHEN** no observer is supplied
- **THEN** review runs, records, gates, and status behave exactly as before
