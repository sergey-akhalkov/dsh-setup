# Spec Delta

## MODIFIED Requirements

### Requirement: Model-agnostic defaults and documentation

The shipped default rules SHALL be model-agnostic data; the setup MAY default their review, consult, and patch rules to the Codex provider, and SHALL default the worker rules to the registered in-process DSH subagent provider. The bundle MUST NOT require Codex, and the documentation MUST show a non-Codex target with another provider/model. The default set SHALL include whole-spec review, task review, blocker, research, advisor, bug fix, the worker effort tiers, an optional integration review, and a strict `lane-fanout` rule on the `lane-assignment` trigger. The lane-fanout rule MUST fire only for a readable `tasks.md` with at least two non-`serial` lanes that own paths and have unchecked tasks; it MUST accept a tagged worker start per unassigned lane or a matching `task_progress` serial note, and MUST NOT fire for a single-lane, hot-file, generated-output, or serial-gate plan. The default set MUST NOT include an automatic task-progress rule; the `implementation-work` trigger remains available for profile rules, and the `work-checkpoints` capability owns the pause-time progress and the parallel decision for work without a multi-lane OpenSpec plan. The deprecated `lane-boundary` trigger MAY remain in a profile but MUST NOT be in the shipped default set. The acceptance MUST exercise at least one non-Codex target.

#### Scenario: Default setup

- **WHEN** the setup is installed with the shipped defaults
- **THEN** the review, consult, and patch rules target the configured Codex provider, and the worker rules target the in-process provider

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
- **THEN** it shows the trigger/contract/gate model, the shipped lane-fanout rule with its justify-or-serial decision, the deprecated lane-boundary trigger, a Codex target, a non-Codex target, the worker effort tiers and their selection policy, the advisor rule, the shipped strong Codex target defaults, and the config/code boundary

## ADDED Requirements

### Requirement: Worker-assigned checkpoint lanes

When a task lane is assigned to a tagged worker, a `continue` checkpoint lane covering that work MUST name an owner other than `lead`, and a bottleneck whose targets fall inside that lane MUST use `worker_start` or `user_decision`. The gate SHALL steer when the checkpoint lane is missing or `lead`-owned, or when such a target uses `lead_action`. An unreadable checkpoint or lane plan fails open.

#### Scenario: Worker lane is bound

- **WHEN** a task lane was assigned to a tagged worker and the matching checkpoint lane is owned by a worker
- **THEN** the checkpoint lane passes and the bottleneck owner rule applies to its owner

#### Scenario: Missing assigned lane is refused

- **WHEN** a task lane was assigned to a tagged worker and no checkpoint lane covers it
- **THEN** the turn close is refused and the steer names the missing lane

#### Scenario: Lead-owned worker lane is refused

- **WHEN** a task lane was assigned to a tagged worker and the matching checkpoint lane is owned by `lead`
- **THEN** the turn close is refused and the steer names the lane

#### Scenario: Lead action inside a worker lane is refused

- **WHEN** a `continue` bottleneck target falls inside a worker-assigned lane and the action is `lead_action`
- **THEN** the turn close is refused and the steer names `worker_start` or `user_decision`

#### Scenario: User decision inside a worker lane

- **WHEN** a `continue` bottleneck target falls inside a worker-assigned lane and the action is `user_decision`
- **THEN** the rule passes and the question review still applies

#### Scenario: No worker assignment

- **WHEN** no task lane in the change was assigned to a tagged worker
- **THEN** the rule reports nothing

#### Scenario: Unreadable plan

- **WHEN** the checkpoint lanes or the task lane plan cannot be read
- **THEN** the rule fails open and the other gates still evaluate their own evidence
