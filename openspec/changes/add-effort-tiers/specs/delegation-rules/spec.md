# Spec Delta

## MODIFIED Requirements

### Requirement: Model-agnostic defaults and documentation

The shipped default rules SHALL be model-agnostic data; the setup MAY default their review, consult,
and patch rules to the Codex provider, and SHALL default the worker rules to the registered in-process
DSH subagent provider. The bundle MUST NOT require Codex, and the documentation MUST show a non-Codex
target with another provider/model. The default set SHALL include whole-spec review, task review,
task progress, the lane-assignment fan-out gate, blocker, research, advisor, bug fix, the worker effort
tiers, and an optional integration review. The deprecated `lane-boundary` trigger MAY remain in a
profile but MUST NOT be in the shipped default set. The acceptance MUST exercise at least one non-Codex
target.

#### Scenario: Default setup

- **WHEN** the setup is installed with the shipped defaults
- **THEN** the review, consult, and patch rules target the configured Codex provider, and the worker
  rules target the in-process provider

#### Scenario: Default lane rule

- **WHEN** the setup is installed with the shipped defaults
- **THEN** the `lane-fanout` rule uses the `lane-assignment` trigger

#### Scenario: Non-Codex target

- **WHEN** a profile points a default or custom rule at a DSH in-process provider with another model
- **THEN** the same rule contract and gate apply

#### Scenario: No Codex dependency

- **WHEN** the rules package is inspected and Codex is absent
- **THEN** the generic engine still composes and reports the Codex target as unavailable

#### Scenario: Documentation

- **WHEN** a user reads the plugin documentation
- **THEN** it shows the trigger/contract/gate model, the lane-assignment fan-out gate with its per-lane
  serial escape, the deprecated lane-boundary trigger, a Codex target, a non-Codex target, the worker
  effort tiers and their selection policy, the advisor rule, the shipped strong Codex target defaults,
  and the config/code boundary

## ADDED Requirements

### Requirement: Shipped worker effort tiers

The shipped defaults SHALL include two worker targets on the registered in-process DSH subagent
provider: `worker-fast` at `high` reasoning effort and `worker-deep` at `max`. Each target MUST be
reachable through a manual `answer` rule. The bundled delegation skill SHALL state when to choose
each target. A profile MAY override either target. An unavailable provider, model, or unsupported
option MUST fail the run with the target next action and MUST NOT satisfy a gate.

#### Scenario: Shipped worker targets

- **WHEN** the setup is installed with the shipped defaults
- **THEN** `worker-fast` and `worker-deep` name the in-process provider with `high` and `max` effort
  respectively, and the `delegate` tool offers both worker rules

#### Scenario: Effort selection policy

- **WHEN** the bundled delegation skill is loaded
- **THEN** it directs mechanical inspection and routine sweeps to `worker-fast`, and ambiguous
  analysis or root-cause work to `worker-deep`, while the main loop keeps its own effort

#### Scenario: Profile override

- **WHEN** a profile patch redefines `worker-fast` with another effort or provider
- **THEN** the shipped worker rule uses the overridden target and the engine reports the target it ran

#### Scenario: Unavailable worker target

- **WHEN** the in-process provider is not registered or does not accept agent options
- **THEN** the worker rule reports the unavailable target and next action, publishes no result, and
  does not satisfy a gate
