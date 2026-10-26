# Spec Delta

## Purpose

Defines the model-agnostic delegation rule engine: configurable triggers, targets, instructions, contracts, and gates, with model-agnostic default rules and a turn-stopping gate that binds a handoff to a digest-bound result.

## ADDED Requirements

### Requirement: Delegation rule engine

The bundle SHALL register a rules engine whose rules are data: each rule names a trigger, a target, an instruction, a result contract, and a gate policy. The engine MUST NOT hard-code Codex or any other provider; targets are resolved from the registered DSH subagent providers, and the plugin MUST compose when a target is missing instead of failing the profile.

#### Scenario: Default rules

- **WHEN** the plugin is active with the shipped default rules
- **THEN** the spec-review, implementation-review, blocker, research, and bug-fix rules are available to the delegate tool

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

The engine SHALL implement the four deterministic triggers `manual`, `spec-ready`, `implementation-complete`, and `failure-streak`. A trigger MUST evaluate only from session/workspace state and tool results, MUST be evaluated at `agent/turn-stopping` for gated rules, and MUST NOT start a target run from the listener. A new trigger source requires a code extension.

#### Scenario: Spec-ready trigger

- **WHEN** an active review-ready change has a gated spec-review rule without a matching pass
- **THEN** the trigger reports the rule as unsatisfied

#### Scenario: Implementation-complete trigger

- **WHEN** a change's task list is complete and its gated implementation-review rule has no matching pass
- **THEN** the trigger reports the rule as unsatisfied

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

A target SHALL name a registered DSH subagent provider and MAY add a model or agent options supported by that provider. The engine MUST resolve the provider at use time, MUST validate requested options against the provider capabilities, and MUST report a missing or incompatible target with the target id, provider name, and next action. The engine MUST NOT silently escalate a target's permissions.

#### Scenario: Codex target

- **WHEN** a rule targets the registered `codex-subagent` provider
- **THEN** the engine starts that provider with the rule's instruction and context

#### Scenario: Non-Codex target

- **WHEN** a rule targets a registered DSH in-process provider with another model
- **THEN** the engine uses that provider/model and the same rule contract

#### Scenario: Missing target

- **WHEN** a rule references a target whose provider is not registered
- **THEN** the tool reports the missing provider and the exact target configuration key

#### Scenario: Unsupported option

- **WHEN** a target requests a model or option the provider does not support
- **THEN** the engine rejects the target with the unsupported capability instead of ignoring it

### Requirement: Review contract

The review contract SHALL compute the rule's phase digest, run the target with the bundled P0/P1 prompt, accept exactly one matching JSON verdict, and write an atomic record with the rule, phase, digest, verdict, findings, target identity, and time. A `PASS` MUST require zero P0/P1 findings; a matching `PASS`/`FINDINGS` record MUST be reused without another run; a stale digest MUST be ignored.

#### Scenario: Passing review

- **WHEN** the target returns zero P0/P1 findings with the matching digest
- **THEN** the engine writes a `PASS` record and returns the verdict

#### Scenario: Findings

- **WHEN** the target returns at least one P0 or P1 finding
- **THEN** the engine writes a `FINDINGS` record and returns every blocking finding with evidence and fix

#### Scenario: Stale record

- **WHEN** the reviewed artifact or worktree changes after a pass
- **THEN** the stored record is ignored and a new review is required

#### Scenario: Malformed verdict

- **WHEN** the target returns no single matching verdict, an invalid severity, or prose only
- **THEN** no `PASS` is written and the failure is reported

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

For every gated rule, the engine SHALL refuse a turn close unless a matching `PASS` or `ERROR` record exists for the rule and digest; it MUST steer with the rule id, digest, record path, and exact delegate call and MUST NOT accept a text claim. A soft rule MUST steer once per failure streak; a failed delegation MUST be reported and MUST NOT trap the turn. A stale record MUST never authorize a handoff.

#### Scenario: Strict rule unsatisfied

- **WHEN** a turn is about to close and a strict rule has no matching record
- **THEN** the engine refuses the close and steers to the delegate call

#### Scenario: Strict rule error

- **WHEN** the target is unavailable and the tool writes a matching `ERROR` record
- **THEN** the turn may close with the error visible and no pass is reported

#### Scenario: Stale record

- **WHEN** the digest changes after a pass
- **THEN** the stale pass is ignored and the gate requires a new run

#### Scenario: Soft rule

- **WHEN** a soft rule's failure streak has no consultation attempt
- **THEN** the gate steers once and a reported failure does not loop it

#### Scenario: Text claim

- **WHEN** the agent claims a review passed without a matching record
- **THEN** the gate still refuses the close

### Requirement: Delegate tool and status

The bundle SHALL register a `delegate` tool whose rule parameter is generated from the configured rules and whose description names the manual tasks, and a `delegation_status` tool that reports registered providers/capabilities, configured targets/rules, and missing-target diagnostics. The tools MUST validate their rule/target inputs before starting a run.

#### Scenario: Manual delegation

- **WHEN** the agent calls delegate for a configured manual rule
- **THEN** the engine validates the input and runs that rule's target/instruction

#### Scenario: Unknown rule

- **WHEN** the agent names a rule that is not configured
- **THEN** the tool rejects the call with the allowed rule ids

#### Scenario: Status

- **WHEN** the agent or user asks for delegation status
- **THEN** the tool reports the available providers, targets, rules, and missing-target diagnostics

### Requirement: Model-agnostic defaults and documentation

The shipped default rules SHALL be model-agnostic data; the setup MAY default their targets to the Codex provider, but the bundle MUST NOT require Codex, and the documentation MUST show a non-Codex target with another provider/model. The acceptance MUST exercise at least one non-Codex target.

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

### Requirement: Model-facing cost and removal

The bundle SHALL NOT register an always-on system-prompt section. Its model-facing policy MUST stay in the tool descriptions and the on-demand skill, bounded by a documented budget. Disabling or uninstalling the `dsh-setup-delegation-rules` row MUST remove its tools, gate, and skill and stop enforcement; records and change artifacts MUST remain, and no in-session phrase may bypass an active gate.

#### Scenario: No prompt section

- **WHEN** the bundle is active and the skill is not invoked
- **THEN** the assembled system prompt contains no delegation-rules section

#### Scenario: Catalog entry only

- **WHEN** the session starts without invoking the skill
- **THEN** the catalog advertises its description and the body is absent from the prompt

#### Scenario: Over budget

- **WHEN** a tool or skill description grows past the documented budget
- **THEN** repository validation fails and names the owning plugin and measured size

#### Scenario: Row removed

- **WHEN** the row is disabled or uninstalled
- **THEN** the tools, gate, and skill are absent, no gate blocks a turn, and existing records remain

### Requirement: Security and trust boundaries

The engine SHALL validate rule ids, change names, worktree paths, and git arguments before effects, MUST use fixed-argument git commands, and MUST keep records free of credentials, secrets, and machine paths. Target and model output MUST be treated as untrusted data, and a patch result MUST remain isolated until a human/agent review applies it.

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
