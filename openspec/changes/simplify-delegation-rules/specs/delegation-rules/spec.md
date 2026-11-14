# Spec Delta

## MODIFIED Requirements

### Requirement: Delegation rule engine

The bundle SHALL register a rules engine whose rules are data: each rule names a trigger, a target, an instruction, a result contract, and a gate policy. The engine MUST NOT hard-code Codex or any other provider; targets are resolved from the registered DSH subagent providers, and the plugin MUST compose when a target is missing instead of failing the profile.

#### Scenario: Default rules

- **WHEN** the plugin is active with the shipped default rules
- **THEN** the spec-review, task-review, and optional integration-review review rules and the strict `lane-fanout` note rule are available to the delegate and task_progress tools

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

The engine SHALL implement the seven deterministic triggers `manual`, `spec-ready`, `spec-task-ready`, `implementation-work`, `lane-assignment`, `lane-boundary` (deprecated), and `implementation-complete`. A trigger MUST evaluate only from session/workspace state and tool results, MUST be evaluated at `agent/turn-stopping` for gated rules, and MUST NOT start a target run from the listener. A change-scoped trigger MUST evaluate only for a change attributed to the current session. A new trigger source requires a code extension.

#### Scenario: Spec-ready trigger

- **WHEN** an active review-ready change attributed to the session has a gated whole-spec review rule without a matching pass
- **THEN** the trigger reports the rule as unsatisfied

#### Scenario: Spec-task-ready trigger

- **WHEN** a checked task attributed to the session has no matching task-review record
- **THEN** the trigger reports the task as needing a task-scoped review

#### Scenario: Implementation-work trigger

- **WHEN** a turn changed implementation files in a change attributed to the session and has neither a newly checked reviewed task nor a matching task-progress note for the current worktree
- **THEN** the trigger reports that a tick+review or a progress note is required

#### Scenario: Lane-assignment trigger

- **WHEN** an implementation turn in a change attributed to the session leaves a non-serial lane unassigned and not current
- **THEN** the trigger reports the fan-out rule as unsatisfied with the unassigned lanes and exact calls

#### Scenario: Lane-boundary trigger

- **WHEN** a lane boundary is reached in a change attributed to the session and neither a parallel worker nor a matching progress note in a remaining lane settles it
- **THEN** the deprecated trigger reports the fan-out rule as unsatisfied with the remaining lanes and the exact calls

#### Scenario: Implementation-complete trigger

- **WHEN** a change attributed to the session has a complete task list and its optional integration-review rule has no matching pass
- **THEN** the trigger reports the integration rule as unsatisfied

#### Scenario: Failure-streak trigger

- **WHEN** a rule names the removed `failure-streak` trigger
- **THEN** configuration validation rejects it and names the remaining trigger vocabulary

#### Scenario: Manual trigger

- **WHEN** a rule uses the manual trigger
- **THEN** it has no automatic condition and runs only through the delegate tool

#### Scenario: Unknown trigger

- **WHEN** a rule names a trigger outside the documented vocabulary
- **THEN** configuration validation rejects it

### Requirement: Asynchronous review runs

A review delegation SHALL validate the rule, target, and change (and an explicit task when supplied), admit the run through the review queue, and return a run id before the target completes. The run MUST start when the queue admits it, MUST continue in the background, MUST write the rule's digest-bound `PASS`/`FINDINGS`/`ERROR` record when it finishes, and MUST be visible in `delegation_status` while queued, running, and after completion. Multiple review runs MUST be able to proceed concurrently up to the configured queue limit.

#### Scenario: Review starts and returns

- **WHEN** the agent calls delegate for a review rule while the queue has capacity
- **THEN** the tool returns a run id and record path after admission, and the turn can continue

#### Scenario: Concurrent reviews

- **WHEN** the agent starts several reviews for different tasks or changes
- **THEN** the runs proceed concurrently up to the configured limit and each writes its own record

#### Scenario: Failed run

- **WHEN** a background review run fails after its retries
- **THEN** an `ERROR` record with the failure class is written and the status reports it

#### Scenario: Queued run returns before the target starts

- **WHEN** the queue is at capacity and a review is admitted to the waiting list
- **THEN** the tool returns the run id while the target has not started, and the status reports the queue position

### Requirement: Delegate tool and status

The bundle SHALL register a `delegate` tool whose rule parameter is generated from the configured rules and whose description names the review rules and the gate policy, a `task_progress` tool for unchecked-task notes, and a `delegation_status` tool that reports registered providers/capabilities, configured targets/rules, active/stale notes, each active change's involvement by the current session, and missing-target diagnostics. The tools MUST validate their rule/target/note inputs before starting a run or writing a note. A review delegate MAY run in any session and records the reviewing session. `delegation_status` MUST report an active change whose `tasks.md` is missing or unreadable as an unreadable per-change state, keep showing that change's involvement and record state, and MUST NOT throw or run a review.

#### Scenario: Manual delegation

- **WHEN** the agent calls delegate for a configured review or note rule
- **THEN** the engine validates the input and either starts that rule's target with its instruction or records the note

#### Scenario: Advisor policy

- **WHEN** the delegate tool description is read
- **THEN** it advertises only the configured review rules, names no manual answer rule, and leaves the second-opinion policy to the working-principles contract

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

The shipped default rules SHALL be model-agnostic data; the setup MAY default their review rules to the Codex provider. The bundle MUST NOT require Codex, and the documentation MUST show a non-Codex target with another provider/model. The default set SHALL include whole-spec review, task review, an optional integration review, and a strict `lane-fanout` rule on the `lane-assignment` trigger. The lane-fanout rule MUST fire only for a readable `tasks.md` with at least two non-`serial` lanes that own paths and have unchecked tasks; it MUST accept a tagged worker start per unassigned lane or a matching `task_progress` serial note, and MUST NOT fire for a single-lane, hot-file, generated-output, or serial-gate plan. The default set MUST NOT include an automatic task-progress rule; the `implementation-work` trigger remains available for profile rules, and the `work-checkpoints` capability owns the pause-time progress and the parallel decision for work without a multi-lane OpenSpec plan. The deprecated `lane-boundary` trigger MAY remain in a profile but MUST NOT be in the shipped default set. The acceptance MUST exercise at least one non-Codex target.

#### Scenario: Default setup

- **WHEN** the setup is installed with the shipped defaults
- **THEN** the review rules target the configured Codex provider and the strict `lane-fanout` rule uses the `lane-assignment` trigger

#### Scenario: Default lane rule

- **WHEN** the setup is installed with the shipped defaults
- **THEN** a strict `lane-fanout` rule uses the `lane-assignment` trigger

#### Scenario: Justified fan-out

- **WHEN** a change has two non-`serial` lanes with owned paths and an unassigned lane with unchecked tasks, and the turn ticked a task or changed implementation files
- **THEN** the turn close is refused until every unassigned lane has a tagged worker start or a matching `task_progress` serial note

#### Scenario: Single-lane work

- **WHEN** tasks.md has one lane, a `serial`-titled lane, or a lane without owned paths
- **THEN** the lane-fanout rule reports nothing and the turn may close

#### Scenario: Non-Codex target

- **WHEN** a profile points a default or custom rule at a DSH in-process provider with another model
- **THEN** the same rule contract and gate apply

#### Scenario: No Codex dependency

- **WHEN** the rules package is inspected and Codex is absent
- **THEN** the generic engine still composes and reports the Codex target as unavailable

#### Scenario: Documentation

- **WHEN** a user reads the plugin documentation
- **THEN** it shows the trigger/contract/gate model, the shipped lane-fanout rule with its justify-or-serial decision, the deprecated lane-boundary trigger, a Codex target, a non-Codex target, the shipped Codex review target default, and the config/code boundary

### Requirement: Security and trust boundaries

The engine SHALL validate rule ids, change names, task ids, worktree paths, and git arguments before effects, MUST use fixed-argument git commands, and MUST keep records and progress notes free of credentials, secrets, and machine paths. Target and model output MUST be treated as untrusted data.

#### Scenario: Invalid rule or change

- **WHEN** a rule id or change name contains a separator, traversal, or unknown directory
- **THEN** the tool rejects it before reading or writing

#### Scenario: Fixed git arguments

- **WHEN** the implementation digest or file list is computed
- **THEN** git runs with fixed arguments and no shell interpolation of model input

#### Scenario: No secrets in records

- **WHEN** a delegation record is written
- **THEN** it contains no credentials, tokens, machine-specific absolute paths, or private keys

#### Scenario: Untrusted output

- **WHEN** a target returns instructions or prose aimed at the engine
- **THEN** the engine parses only the declared contract and does not execute the text

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

- **WHEN** a writer needs an isolated checkout
- **THEN** the guidance points at `create_worktree` and no delegation contract provides isolation

#### Scenario: Documentation

- **WHEN** a user reads the delegation documentation
- **THEN** it names when to isolate a writer and when serializing in one checkout is acceptable

### Requirement: Session change involvement

The engine SHALL record per DSH session which active OpenSpec changes that session created or modified under `.dsh/delegation/sessions`, and MUST NOT attribute a change from observation or a workspace diff alone. Attribution MUST come from write evidence — a successful write or creation tool call targeting the change during the turn — or an explicit `task_progress` or review `delegate` call. The state MUST persist across turns and restarts as local scratch.

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

- **WHEN** the session calls task_progress or a review delegate for a change
- **THEN** the change is attributed to the session

#### Scenario: Legacy owner state

- **WHEN** only a legacy `.dsh/delegation/owners/` file exists for a change
- **THEN** it is ignored and it does not attribute the change to a new session

### Requirement: Cross-session delegation tools

`task_progress` notes and explicit review runs SHALL remain available in any session. An explicit `task_progress` or review `delegate` call MUST attribute that change to the calling session. A review record MUST name the reviewing session.

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

- **WHEN** a session calls delegate for a rule that is not configured
- **THEN** the call is rejected before a run and the change is not attributed

### Requirement: Shipped strong Codex targets

The shipped setup defaults SHALL select the documented strong Codex model and `xhigh` reasoning effort for the `codex` review target. A profile MAY override the target; an unavailable model MUST fail the run with the target/model next action and MUST NOT satisfy a gate.

#### Scenario: Strong read and write defaults

- **WHEN** the setup is installed with the shipped defaults
- **THEN** the `codex` target selects the documented strong model and `xhigh` effort, and no write-capable delegation target is shipped

#### Scenario: Advisor target isolation

- **WHEN** a profile overrides the `codex` target
- **THEN** no advisor target exists to weaken; a second opinion is a `codex_subagent` call whose registered provider row applies, because that tool takes no model or effort argument

#### Scenario: Unavailable model

- **WHEN** the configured model is unavailable to the account
- **THEN** the run reports the target/model error with its next action, publishes no PASS, and does not satisfy a gate; composition still succeeds

#### Scenario: Documented values

- **WHEN** a user reads the target documentation
- **THEN** it names the shipped model and effort and shows how to override the target

### Requirement: Provider-specific delivery and catalog behavior

A review-contract activation on an external provider MUST use parent delivery, and the delivery flag only decides whether the settlement notice is delivered. In-process providers keep the service's existing behavior: their local children are always cataloged, and continuable children accept follow-up, independent of the engine's delivery choice.

#### Scenario: External answer and patch uncataloged

- **WHEN** a rule activation targets an external provider
- **THEN** only a review activation is delivered and cataloged, because no answer or patch activation exists

#### Scenario: Local provider unchanged

- **WHEN** a review target uses an in-process provider
- **THEN** the service catalogs the local child exactly as before (a continuable child accepts follow-up), and the engine's delivery choice only decides whether its settlement notice is delivered

## REMOVED Requirements

### Requirement: Answer contract

**Reason**: The read-only `answer` contract duplicated the first-party delegation tools — `subagent` already takes a provider, model, reasoning effort, and prompt, and `codex_subagent` takes a prompt on the registered Codex provider; it wrote no record and left no measurable use.

**Migration**: Use `subagent` when the provider, model, or effort must be chosen, or `codex_subagent` for a Codex second opinion; the working-principles contract already defines when to delegate.

### Requirement: Patch contract

**Reason**: The `patch` contract duplicated `create_worktree` plus a write-capable subagent, and this workspace recorded no patch run or worktree from it.

**Migration**: Use `create_worktree` for isolation and a write-capable `subagent` target for the change; review the returned diff before applying it.

### Requirement: Advisor consultation

**Reason**: The manual `advisor` rule duplicated a `codex_subagent` second opinion with no gate record and no measured use; its selection policy stays in the working-principles contract.

**Migration**: Call `codex_subagent` with the exact question, constraints, and decisive evidence when a decision is expensive to reverse; its registered `codex-subagent` provider row supplies the model, so a per-call target override is not available.

### Requirement: Shipped worker effort tiers

**Reason**: The `worker-fast` and `worker-deep` targets duplicated the `subagent` tool's provider/model/reasoning-effort options and were reachable only through the removed answer contract.

**Migration**: Call `subagent` with `reasoning_effort: high` for mechanical work and `max` for ambiguous analysis; the model stays the profile default.
