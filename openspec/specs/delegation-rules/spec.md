# delegation-rules Specification

## Purpose
Defines the model-agnostic delegation rule engine: configurable triggers, targets, instructions, contracts, and gates, with model-agnostic default rules, incremental task-scoped review, task progress notes, and a turn-stopping gate that binds a handoff to a digest-bound result.

## Requirements

### Requirement: Delegation rule engine

The bundle SHALL register a rules engine whose rules are data: each rule names a trigger, a target, an instruction, a result contract, and a gate policy. The engine MUST NOT hard-code Codex or any other provider; targets are resolved from the registered DSH subagent providers, and the plugin MUST compose when a target is missing instead of failing the profile.

#### Scenario: Default rules

- **WHEN** the plugin is active with the shipped default rules
- **THEN** the spec-review, task-review, task-progress, blocker, research, advisor, bug-fix, and optional integration-review rules are available to the delegate/task_progress tools

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

The engine SHALL implement the six deterministic triggers `manual`, `spec-ready`, `spec-task-ready`, `implementation-work`, `implementation-complete`, and `failure-streak`. A trigger MUST evaluate only from session/workspace state and tool results, MUST be evaluated at `agent/turn-stopping` for gated rules, and MUST NOT start a target run from the listener. A change-scoped trigger MUST evaluate only for a change attributed to the current session. A new trigger source requires a code extension.

#### Scenario: Spec-ready trigger

- **WHEN** an active review-ready change attributed to the session has a gated whole-spec review rule without a matching pass
- **THEN** the trigger reports the rule as unsatisfied

#### Scenario: Spec-task-ready trigger

- **WHEN** a checked task attributed to the session has no matching task-review record
- **THEN** the trigger reports the task as needing a task-scoped review

#### Scenario: Implementation-work trigger

- **WHEN** a turn changed implementation files in a change attributed to the session and has neither a newly checked reviewed task nor a matching task-progress note for the current worktree
- **THEN** the trigger reports that a tick+review or a progress note is required

#### Scenario: Implementation-complete trigger

- **WHEN** a change attributed to the session has a complete task list and its optional integration-review rule has no matching pass
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

The review contract SHALL compute the rule's scope digest, run the target with the bundled P0/P1 prompt, accept exactly one matching JSON verdict, and write an atomic record with the rule, scope, task id when task-scoped, digest, verdict, findings, target identity, time, and the reviewing session. A `PASS` MUST require zero P0/P1 findings; a matching `PASS`/`FINDINGS` record MUST be reused without another run; a stale whole-scope digest MUST be ignored. A review MAY run in any session, and the record MUST name the session that ran it.

#### Scenario: Passing review

- **WHEN** the target returns zero P0/P1 findings with the matching digest in the reviewing session
- **THEN** the engine writes a `PASS` record carrying the reviewing session and returns the verdict

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

The `task_progress` tool SHALL write a task id, status (`in-progress` or `blocked`), reason, worktree digest, and time without running a target or writing a `PASS`. The note MUST be the only non-tick way to close a code-changing turn and MUST become stale when the worktree digest changes. Task lookup MUST skip unreadable unrelated changes and validate the selected readable task.

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

#### Scenario: Unreadable foreign change

- **WHEN** the requested task is readable and another active change has no readable tasks.md
- **THEN** the note is written for the requested task

### Requirement: Task progress gate

The gate SHALL refuse a code-changing turn close unless every checked task the current session attributed has a matching task-review `PASS`/`ERROR` and the turn has a newly checked reviewed task or a matching task-progress note for the current worktree. A note MUST NOT authorize a completed task, and the status tool MUST report active and stale notes.

#### Scenario: Code change without a tick or note

- **WHEN** a turn changes implementation files and has no checked reviewed task and no progress note
- **THEN** the gate steers to tick+review or `task_progress`

#### Scenario: Progress note allows the close

- **WHEN** a code-changing turn has a matching progress note for the current worktree
- **THEN** the gate allows the close with the task still unchecked

#### Scenario: Checked task without its review

- **WHEN** a task the session checked has no task-review PASS/ERROR
- **THEN** the gate refuses the close even if a progress note exists

#### Scenario: Stale progress note

- **WHEN** the worktree changes after a progress note
- **THEN** the stale note no longer authorizes a close

### Requirement: Answer contract

The answer contract SHALL run the target in read-only mode, return a bounded answer with evidence and, for research, sources and dates, and, for an advisor rule, a recommendation, the strongest counterargument, risks, a next action, and confidence, and write no gate record. A successful answer MUST be usable by the agent while a failed answer MUST be reported without trapping the turn.

#### Scenario: Research

- **WHEN** a research rule runs
- **THEN** the answer includes evidence and sources and does not authorize a gate

#### Scenario: Blocker

- **WHEN** a blocker rule runs
- **THEN** the answer names a recommendation, evidence, and the next action

#### Scenario: Advisor

- **WHEN** an advisor rule runs
- **THEN** the answer names a recommendation, the strongest counterargument, risks, a next action, and confidence, and does not authorize a gate

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

For every gated rule, the engine SHALL refuse a turn close unless a matching `PASS` or `ERROR` record exists for the rule and digest; it MUST steer with the rule id, digest, record path, and exact delegate call and MUST NOT accept a text claim. A soft rule MUST steer once per failure streak; a failed delegation MUST be reported and MUST NOT trap the turn. A stale record MUST never authorize a handoff. A change-scoped review rule MUST apply only in a session that created or modified the change. The engine MUST separate a worktree-level git failure from a per-change artifact problem: a missing or unreadable planning file in a change attributed to the current session (for example `tasks.md`) MUST NOT be reported as a worktree digest failure and MUST instead produce a distinct issue that names the change and the session, or treat the change as not review-ready.

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

- **WHEN** a turn in a session that did not create or modify the change is about to close and the change's review is missing or stale
- **THEN** the gate does not steer that change's review and does not refuse the close for it

#### Scenario: Soft rule

- **WHEN** a soft rule's failure streak has no consultation attempt
- **THEN** the gate steers once and a reported failure does not loop it

#### Scenario: Text claim

- **WHEN** the agent claims a review passed without a matching record
- **THEN** the gate still refuses the close

#### Scenario: Missing tasks.md in an owned change

- **WHEN** a turn is about to close in a session that created or modified a change and the change has no readable `tasks.md`
- **THEN** the gate names the change and the session as a per-change artifact problem and does not report a worktree digest failure

#### Scenario: Worktree git failure

- **WHEN** the git status or diff command needed for the worktree digest fails
- **THEN** the gate reports the worktree digest failure and the git command to re-run

### Requirement: Delegate tool and status

The bundle SHALL register a `delegate` tool whose rule parameter is generated from the configured rules and whose description names the manual tasks, including the advisor policy and its soft three-call ceiling, a `task_progress` tool for unchecked-task notes, and a `delegation_status` tool that reports registered providers/capabilities, configured targets/rules, active/stale notes, each active change's involvement by the current session, and missing-target diagnostics. The tools MUST validate their rule/target/note inputs before starting a run or writing a note. A review delegate MAY run in any session and records the reviewing session. `delegation_status` MUST report an active change whose `tasks.md` is missing or unreadable as an unreadable per-change state, keep showing that change's involvement and record state, and MUST NOT throw or run a review.

#### Scenario: Manual delegation

- **WHEN** the agent calls delegate for a configured manual rule
- **THEN** the engine validates the input and runs that rule's target/instruction

#### Scenario: Advisor policy

- **WHEN** the delegate tool description is read
- **THEN** it names the advisor as a manual strong-target second opinion for expensive-to-reverse, cross-module, security/data-integrity, or repeated-failure decisions, excludes routine edits, syntax, lookups, and locally verifiable facts, and states the soft three-call ceiling

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

- **WHEN** delegation_status runs in a session that did not create or modify a change
- **THEN** it reports that the session is not involved and shows the change's record and task state, without a review run

#### Scenario: Unreadable tasks in status

- **WHEN** delegation_status runs while an active change has no readable `tasks.md`
- **THEN** it reports that change's tasks as unreadable and returns normally

#### Scenario: Explicit review

- **WHEN** a session calls delegate for a review of a change it did not create or modify
- **THEN** the engine starts the run, records the reviewing session, and attributes the change to that session

### Requirement: Model-agnostic defaults and documentation

The shipped default rules SHALL be model-agnostic data; the setup MAY default their targets to the Codex provider, but the bundle MUST NOT require Codex, and the documentation MUST show a non-Codex target with another provider/model. The default set SHALL include whole-spec review, task review, task progress, blocker, research, advisor, bug fix, and an optional integration review. The acceptance MUST exercise at least one non-Codex target.

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
- **THEN** it shows the trigger/contract/gate model, a Codex target, a non-Codex target, the advisor rule, the shipped strong Codex target defaults, and the config/code boundary

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

### Requirement: Reviewed worktree input set

A code-scoped review MUST take its reviewed worktree inputs from git: tracked files plus untracked files that are not ignored. Only `.dsh/` and `.tmp/` stay excluded, the same two the worktree digest skips; VCS-ignored paths MUST NOT be reviewed inputs, and every Git-visible path the digest covers MUST also be guarded.

#### Scenario: Ignored build output changes during a review

- **WHEN** a build, test, or editor process writes under a VCS-ignored path in the worktree while a code review runs
- **THEN** the review publishes its verdict, because no reviewed input changed

#### Scenario: Reviewed file changes during a review

- **WHEN** a tracked or untracked-not-ignored file is edited while the review runs, even when its content is restored before the run completes
- **THEN** no `PASS` is published for that digest and the run reports that the reviewed inputs changed

#### Scenario: A previously excluded directory is reviewed

- **WHEN** a Git-visible file under a directory the engine used to skip (`node_modules`, `market`, `coverage`, `.serena`) is edited while a code review runs
- **THEN** no `PASS` is published, because the digest covers that file

#### Scenario: A tracked file disappears or appears

- **WHEN** a tracked file is deleted, or a new untracked non-ignored file is created, while the review runs
- **THEN** the change is reported as a changed reviewed input instead of failing the run to read the workspace

#### Scenario: Digest and mutation check agree

- **WHEN** the worktree contains ignored build output and an implementation-complete review is requested twice without a source change
- **THEN** both runs bind to the same worktree digest and the second request reuses the first `PASS` record, while a visible source change in between requires a new run

### Requirement: Reviewed change-artifact inputs

A review whose digest includes the change-artifact digest MUST also track the reviewed change's artifacts as inputs, regardless of Git ignore rules, excluding `.openspec.yaml` and the `reviews/` approval directory; a whole-spec review tracks exactly those artifacts. A task-scoped review therefore tracks the union of the Git-visible worktree files and the change artifacts.

#### Scenario: Ignored change artifact changes during a task review

- **WHEN** a change artifact excluded by `.gitignore` is edited while a task review runs
- **THEN** no `PASS` is published, because that artifact is part of the task digest

#### Scenario: Change artifact changes during a whole-spec review

- **WHEN** a change artifact is edited while a whole-spec review runs
- **THEN** no `PASS` is published and the run reports the changed artifacts

#### Scenario: Task approval does not invalidate the spec review

- **WHEN** a portable `reviews/<taskId>.json` record is written while a whole-spec review runs
- **THEN** the review publishes, because the approval directory is excluded from the reviewed inputs

### Requirement: Reviewed-input change report

When a review is discarded because a reviewed input changed, the reported error MUST name how many inputs changed, list their paths, state that a write inside the reviewed scope happened during the run, and give the next action: finish the writes, then re-run the review.

#### Scenario: Discarded verdict explains the change

- **WHEN** a reviewed input changes during a run and the verdict is discarded
- **THEN** the error names the count and paths of the changed inputs and tells the caller to re-run after the writes finish

### Requirement: Parallel writer isolation

The delegation skill body and the plugin documentation SHALL state that two writers which may touch the same files are isolated in separate worktrees or serialized, and that each writer is told which files it owns. The guidance MUST NOT change any trigger, record, digest, or gate, and MUST NOT require a worktree when a single writer runs.

#### Scenario: Conflicting writers

- **WHEN** two agents will edit the same repository at the same time
- **THEN** the skill body directs the agent to give each an isolated worktree or to serialize the writes and name the owned files

#### Scenario: Single writer

- **WHEN** one agent performs the work sequentially
- **THEN** the guidance does not require a worktree

#### Scenario: Engine unchanged

- **WHEN** the guidance is added
- **THEN** the triggers, records, digests, and turn-stopping gate behave exactly as before

#### Scenario: Patch contract already isolated

- **WHEN** a patch contract runs a write-capable target
- **THEN** the existing isolated-worktree behaviour applies and the new guidance does not duplicate it

#### Scenario: Documentation

- **WHEN** a user reads the delegation documentation
- **THEN** it names when to isolate a writer and when serializing in one checkout is acceptable

### Requirement: Explicit task review selection

A task-scoped review `delegate` call SHALL accept an explicit task id; when present, the engine MUST review that checked task after validating that it is checked and matches the task-review rule, instead of selecting the next checked task. Parallel task-review calls for different tasks MUST NOT collapse onto one task. When the task id is absent, the existing next-checked-task selection applies. A gate-suggested task-review call MUST name the explicit task id of the session's checked task.

#### Scenario: Explicit task

- **WHEN** delegate names a checked task for task-review
- **THEN** that task is reviewed even when another task is next

#### Scenario: Parallel task reviews

- **WHEN** two task-review calls name different checked tasks at the same time
- **THEN** both tasks are reviewed independently

#### Scenario: Unknown or unchecked task

- **WHEN** the named task is missing or unchecked
- **THEN** the tool rejects the call before starting a target and names the allowed checked tasks

#### Scenario: Gate names the task

- **WHEN** the gate steers to review a task the session checked and an earlier checked task from another session has no review record
- **THEN** the suggested delegate call names the session's task id, and following it reviews that task instead of the earlier foreign task

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

### Requirement: Session change involvement

The engine SHALL record per DSH session which active OpenSpec changes that session created or modified under `.dsh/delegation/sessions`, and MUST NOT attribute a change from observation or a workspace diff alone. Attribution MUST come from write evidence — a successful write or creation tool call targeting the change during the turn — or an explicit `task_progress` or review/patch `delegate` call. The state MUST persist across turns and restarts as local scratch.

#### Scenario: No attribution on observation

- **WHEN** a new session opens an active change with checked tasks and no session attribution
- **THEN** it records no involvement and the gate does not steer that change

#### Scenario: Concurrent session does not attribute

- **WHEN** another session creates or edits a change during a turn and the evaluating session made no write or explicit change-scoped call
- **THEN** the evaluating session records no involvement, even though its workspace snapshot changed

#### Scenario: Write evidence attributes a change

- **WHEN** a session successfully writes a file under an active change directory during a turn
- **THEN** the next gate records the change as that session's work

#### Scenario: Creation command attributes a change

- **WHEN** a session runs a successful creation command for a change during a turn
- **THEN** the next gate records the change as created and spec-changed by that session

#### Scenario: Creation does not import foreign ticks

- **WHEN** a session creates a change and another session checks a task before the creator's gate
- **THEN** the creator records created and spec-changed but not the other session's task id

#### Scenario: Persistence

- **WHEN** the engine restarts and the same session id resumes
- **THEN** the recorded involvement is reused

#### Scenario: Explicit tool use

- **WHEN** the session calls task_progress or a review/patch delegate for a change
- **THEN** the change is attributed to the session

#### Scenario: Legacy owner state

- **WHEN** only a legacy `.dsh/delegation/owners/` file exists for a change
- **THEN** it is ignored and it does not attribute the change to a new session

### Requirement: Per-write task attribution

A successful `tasks.md` write SHALL attribute only the checkbox transitions caused by that write, captured from the successful write's canonical before/after contents. It MUST set `specChanged` when that write's checkbox-normalized before/after contents differ (a substantive task-plan edit or a newly supplied `tasks.md`); a checkbox-only edit MUST NOT set `specChanged`. The whole-change artifact digest MUST NOT be used to decide whether a `tasks.md` write was substantive.

#### Scenario: Concurrent task writers

- **WHEN** two sessions check different tasks in the same change during overlapping turns
- **THEN** each session attributes only the task it checked and each gate requires only that task

#### Scenario: Substantive task-plan edit

- **WHEN** a session rewrites an unchecked task line or adds a task
- **THEN** the session's change is marked spec-changed and the whole-spec review applies

#### Scenario: Checkbox-only edit

- **WHEN** the only write is changing a task from unchecked to checked
- **THEN** the task is attributed but the change is not marked spec-changed

#### Scenario: Foreign spec edit does not change a checkbox writer

- **WHEN** another session edits `proposal.md` during a session's checkbox-only `tasks.md` write
- **THEN** the checkbox writer is not marked spec-changed

#### Scenario: New tasks.md for a partial change

- **WHEN** a session writes the first `tasks.md` for an existing change
- **THEN** the write is attributed, its before/after differs beyond checkboxes, and the change is marked spec-changed

#### Scenario: Unobservable task write

- **WHEN** a shell write changes `tasks.md` and the engine cannot capture the before/after checkbox state
- **THEN** the change is attributed but no task id is attributed, and explicit `task_progress` or a task-review `delegate` supplies task-level attribution

### Requirement: Session-scoped review triggers

The gated automatic triggers for a change SHALL evaluate only in a session that created or modified that change. `spec-ready` MUST apply only when the session created the change or changed its spec artifacts; `spec-task-ready` MUST apply only to tasks the session checked; `implementation-work` MUST apply only to an involved change; `implementation-complete` MUST apply only when the session's work completed the task list. When the session's checked task makes the change's task list fully checked, `spec-task-ready` MUST require an approved task-review PASS for every checked task in that change, not only the tasks the session checked.

#### Scenario: Foreign session not steered

- **WHEN** a session that did not create or modify a change closes a turn while the change has checked tasks without review records
- **THEN** its gate does not steer a review for that change

#### Scenario: Own checked task is gated

- **WHEN** a session checks a task in a change it did not create and the task list is not complete
- **THEN** its gate requires a review for that task and not for checked tasks from other sessions

#### Scenario: Continuation does not inherit old ticks

- **WHEN** a second session checks a new task in a change started by a first session and the task list is not complete
- **THEN** only the second session's task is in its review scope

#### Scenario: Concurrent task writers keep separate scopes

- **WHEN** two sessions check different tasks in the same change during overlapping turns and the task list is not complete
- **THEN** each gate requires only the task that session checked

#### Scenario: Completion requires all checked tasks

- **WHEN** a session's checked task makes the task list fully checked and another checked task has no PASS record
- **THEN** the completing session's gate requires approval for that task too

#### Scenario: Spec review only from spec work

- **WHEN** a session only changes task checkboxes and does not make a substantive task-plan or spec edit
- **THEN** its gate does not require the whole-spec review

#### Scenario: Integration review needs the completing session

- **WHEN** a session's checked task makes the change's task list complete
- **THEN** its gate may require the integration review for the current worktree

### Requirement: Cross-session delegation tools

`task_progress` notes, answer runs, patch runs, and explicit review runs SHALL remain available in any session. An explicit `task_progress` or review/patch `delegate` call MUST attribute that change to the calling session; an `answer` delegate MUST NOT attribute. A review record MUST name the reviewing session.

#### Scenario: Progress note in a foreign session

- **WHEN** a session that did not create or modify a change calls task_progress for its unchecked task
- **THEN** the note is written and the change is attributed to that session

#### Scenario: Unreadable foreign change does not block a note

- **WHEN** task_progress targets a task in a readable change while another active change has no readable tasks.md
- **THEN** the note is written for the readable task and the unreadable change is skipped

#### Scenario: Review from any session

- **WHEN** a session runs a review for a change it did not create or modify
- **THEN** the run starts, the record names the reviewing session, and the change is attributed to that session

#### Scenario: Answer does not attribute

- **WHEN** a session runs an answer delegate with a valid change argument
- **THEN** the change is not attributed to that session and no involvement is recorded

### Requirement: Portable task-review approval

A task-scope review that returns PASS SHALL publish a sanitized portable record under the change's `reviews/<taskId>.json` in addition to the local `.dsh` record. The record MUST identify the rule, change, task id, verdict, target, time, and digests, MUST NOT include the reviewing session, run id, or machine paths, and MUST be committed with the change. A failed portable write MUST NOT publish a PASS.

#### Scenario: PASS writes the portable record

- **WHEN** a task review returns PASS
- **THEN** the change directory contains `reviews/<taskId>.json` with the rule, change, task id, verdict, target, time, and digests, and no session, run id, or machine path

#### Scenario: ERROR or FINDINGS is not approval

- **WHEN** a task review returns `ERROR` or `FINDINGS`
- **THEN** no portable PASS record is written for that task

#### Scenario: Failed portable write

- **WHEN** the portable record cannot be written
- **THEN** no PASS is published and the run reports the write failure

#### Scenario: The record travels with the branch

- **WHEN** a task review runs in a worktree and the branch containing the change is merged
- **THEN** the portable record is present in the merged change and can approve the task there

#### Scenario: The local record remains

- **WHEN** a task review returns PASS
- **THEN** the local `.dsh` record and the portable record both exist

### Requirement: Change-level review coverage

The engine SHALL compute approval over every checked task in `tasks.md`, independent of session attribution. A checked task is approved only by a matching portable task-review PASS; `ERROR`, `FINDINGS`, a missing or malformed record, and a checked line that does not parse as a numbered task are not approved. Unchecked tasks are reported but not required.

#### Scenario: A shell tick

- **WHEN** a session changes `tasks.md` through a shell command and no task id is attributed
- **THEN** the checked task still requires a portable PASS before archive

#### Scenario: A foreign session PASS

- **WHEN** another session wrote the portable PASS for a checked task
- **THEN** the coverage accepts that task

#### Scenario: ERROR is not approval

- **WHEN** the only record for a checked task is an `ERROR` record
- **THEN** the task is unapproved

#### Scenario: Malformed record

- **WHEN** a portable record for a checked task is unreadable or malformed
- **THEN** the task is unapproved and the status names the malformed record

#### Scenario: Unparseable checked line

- **WHEN** `tasks.md` contains a checked line that is not a numbered task
- **THEN** the coverage fails closed and names the line

#### Scenario: Unchecked task

- **WHEN** a task is unchecked and every checked task is approved
- **THEN** the unchecked task is reported as an open follow-up, not required for approval

### Requirement: Archive approval gate

In a workspace whose tracked `openspec/review-approval.json` sets `archiveGate: true`, the engine SHALL refuse the archive operation before it runs unless every checked task has a portable task-review PASS. The refusal MUST name the change, the missing tasks, and the exact review calls, and MUST leave the change active. The guard MUST fail closed on an unreadable change, record, or task rule. A workspace without the marker MUST be unchanged.

#### Scenario: Missing approval

- **WHEN** the archive command runs for a change with a checked task that has no portable PASS
- **THEN** the command is refused before the move and the change remains active

#### Scenario: Complete approval

- **WHEN** every checked task in the change has a portable PASS
- **THEN** the archive operation proceeds

#### Scenario: A subagent archives

- **WHEN** a subagent session runs the archive command for a change with a missing approval
- **THEN** the guard refuses it like a root session

#### Scenario: Marker absent

- **WHEN** the workspace has no `openspec/review-approval.json` marker or `archiveGate` is false
- **THEN** the archive operation is unchanged

#### Scenario: Invalid task rule

- **WHEN** the marker names a task rule that is missing, not task-scoped, or not strict
- **THEN** the archive is refused with the rule and the configuration error

#### Scenario: Unreadable evidence

- **WHEN** `tasks.md` or a required portable record cannot be read
- **THEN** the archive is refused with the path and the failure

### Requirement: PASS-only approval boundary

An `ERROR` review record MAY let a turn close but MUST NOT approve a task for archive or push. The status and audit MUST report PASS, ERROR, and missing separately, and an archive is ready only when every checked task has a PASS.

#### Scenario: ERROR closes a turn

- **WHEN** the only task review record is `ERROR`
- **THEN** the turn may close and the status reports the change as not archive-ready

#### Scenario: Re-review produces approval

- **WHEN** the task is reviewed again with its explicit task id and returns PASS
- **THEN** the task is approved for archive

#### Scenario: Status separates verdicts

- **WHEN** the status or audit runs
- **THEN** it reports the PASS, ERROR, and missing counts separately and names the missing tasks

### Requirement: Advisor consultation

The default rule set SHALL include a manual `advisor` answer rule. It MUST start only from an explicit `delegate` call, run read-only, and write no gate record, steer, wake, or inject a chat message. The tool description and skill SHALL state when it is appropriate, exclude routine work, and set a soft three-call ceiling.

#### Scenario: Manual only

- **WHEN** a turn is about to close and no advisor delegate call was made
- **THEN** the advisor starts no target and does not steer the turn

#### Scenario: Bounded advice

- **WHEN** the agent calls delegate for the advisor rule with a question and context
- **THEN** the target returns a recommendation, the strongest counterargument, risks, a next action, and confidence, and writes no gate record

#### Scenario: No authority

- **WHEN** an advisor answer exists
- **THEN** it does not satisfy a strict review, authorize a block or completion, steer, or wake the session

#### Scenario: Routine work excluded

- **WHEN** the delegate tool description and skill are read
- **THEN** they name the allowed decision classes, exclude routine edits, syntax, lookups, and locally verifiable facts, and state the three-call soft ceiling

### Requirement: Shipped strong Codex targets

The shipped setup defaults SHALL select the documented strong Codex model and `xhigh` reasoning effort for both `codex` and `codex-write`. The `advisor` rule MUST target the explicit `codex-astra` target so a profile can override `codex` without weakening the advisor. A profile MAY override any target; an unavailable model MUST fail the run with the target/model next action and MUST NOT satisfy a gate.

#### Scenario: Strong read and write defaults

- **WHEN** the setup is installed with the shipped defaults
- **THEN** `codex` and `codex-write` select the documented strong model and `xhigh` effort

#### Scenario: Advisor target isolation

- **WHEN** a profile overrides `codex` or `codex-write`
- **THEN** the advisor still runs on `codex-astra` with the strong model

#### Scenario: Unavailable model

- **WHEN** the configured model is unavailable to the account
- **THEN** the run reports the target/model error with its next action, publishes no PASS, and does not satisfy a gate; composition still succeeds

#### Scenario: Documented values

- **WHEN** a user reads the target documentation
- **THEN** it names the shipped model and effort and shows how to override either target
