# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
