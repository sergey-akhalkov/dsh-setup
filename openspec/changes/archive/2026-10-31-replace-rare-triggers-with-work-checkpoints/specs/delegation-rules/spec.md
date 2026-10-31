# Spec Delta

## MODIFIED Requirements

### Requirement: Delegation rule engine

The bundle SHALL register a rules engine whose rules are data: each rule names a trigger, a target, an instruction, a result contract, and a gate policy. The engine MUST NOT hard-code Codex or any other provider; targets are resolved from the registered DSH subagent providers, and the plugin MUST compose when a target is missing instead of failing the profile.

#### Scenario: Default rules

- **WHEN** the plugin is active with the shipped default rules
- **THEN** the spec-review, task-review, blocker, research, advisor, bug-fix, and optional integration-review rules are available to the delegate and task_progress tools

#### Scenario: Custom rule

- **WHEN** the profile adds a rule on an existing trigger and contract
- **THEN** the engine accepts it without a code change and exposes it to the delegate tool

#### Scenario: No rules

- **WHEN** the configuration contains no rules
- **THEN** the plugin composes and the delegate tool reports that no delegation rules are configured

#### Scenario: Invalid rule

- **WHEN** a rule has an unknown trigger, contract, gate, missing target, or duplicate id
- **THEN** the plugin reports the configuration error with the rule id and next action

### Requirement: Model-agnostic defaults and documentation

The shipped default rules SHALL be model-agnostic data; the setup MAY default their review, consult, and patch rules to the Codex provider, and SHALL default the worker rules to the registered in-process DSH subagent provider. The bundle MUST NOT require Codex, and the documentation MUST show a non-Codex target with another provider/model. The default set SHALL include whole-spec review, task review, blocker, research, advisor, bug fix, the worker effort tiers, and an optional integration review. It MUST NOT include an automatic task-progress or lane-fanout rule; the `implementation-work` and `lane-assignment` triggers remain available for profile rules, and the `work-checkpoints` capability owns the pause-time progress and parallel decision. The deprecated `lane-boundary` trigger MAY remain in a profile but MUST NOT be in the shipped default set. The acceptance MUST exercise at least one non-Codex target.

#### Scenario: Default setup

- **WHEN** the setup is installed with the shipped defaults
- **THEN** the review, consult, and patch rules target the configured Codex provider, and the worker rules target the in-process provider

#### Scenario: Default lane rule

- **WHEN** the setup is installed with the shipped defaults
- **THEN** no shipped rule uses the `implementation-work` or `lane-assignment` trigger

#### Scenario: Non-Codex target

- **WHEN** a profile points a default or custom rule at a DSH in-process provider with another model
- **THEN** the same rule contract and gate apply

#### Scenario: No Codex dependency

- **WHEN** the rules package is inspected and Codex is absent
- **THEN** the generic engine still composes and reports the Codex target as unavailable

#### Scenario: Documentation

- **WHEN** a user reads the plugin documentation
- **THEN** it shows the trigger/contract/gate model, the lane-assignment trigger with its per-lane serial escape as a profile rule, the deprecated lane-boundary trigger, a Codex target, a non-Codex target, the worker effort tiers and their selection policy, the advisor rule, the shipped strong Codex target defaults, and the config/code boundary

### Requirement: Deprecated lane-boundary trigger

The engine SHALL keep `lane-boundary` accepted for existing profiles with its documented completion-boundary behavior, but MUST mark it deprecated in the skill and documentation. No shipped default rule MAY use it.

#### Scenario: Existing profile still composes

- **WHEN** a profile configures a rule with the `lane-boundary` trigger
- **THEN** the rule is accepted and keeps its documented behavior

#### Scenario: Shipped default uses lane-assignment

- **WHEN** the setup is installed with the shipped defaults
- **THEN** no shipped rule uses the `lane-boundary` trigger, and the `lane-assignment` trigger remains available to a profile rule

#### Scenario: Documentation marks the deprecation

- **WHEN** a user reads the delegation skill or documentation
- **THEN** it names `lane-boundary` as deprecated and directs new rules to `lane-assignment`
