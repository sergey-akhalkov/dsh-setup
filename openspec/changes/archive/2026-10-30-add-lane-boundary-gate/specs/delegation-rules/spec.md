# Spec Delta

## ADDED Requirements

### Requirement: Lane-boundary fan-out gate

The engine SHALL implement the `lane-boundary` trigger. It reports an unsatisfied rule for a change
attributed to the current session only when one of this session's own `tasks.md` writes checked off
a task that completed its lane, at least one other non-tail lane still has an unchecked task, and
the turn started no parallel worker. The rule MUST be satisfied by a parallel worker started in the
turn or by a progress note whose task belongs to a remaining lane and whose digest matches.

#### Scenario: Fan-out required at a lane boundary

- **WHEN** this session's write completed the last unchecked task of a lane, another non-tail lane has an unchecked task, and the turn started no parallel worker
- **THEN** the engine refuses the turn close and steers with the remaining lane and the exact calls

#### Scenario: Worker started in the turn

- **WHEN** the same lane boundary is reached and the turn started a `subagent`, `subagent_fork`, `spawn_teammate`, or `workflow` run successfully
- **THEN** the trigger reports nothing and the turn may close for this rule

#### Scenario: Serial decision recorded

- **WHEN** the same lane boundary is reached and a `task_progress` note names a task in a remaining lane and matches the current worktree digest
- **THEN** the trigger reports nothing and the serial decision stays visible in the note record

#### Scenario: Another session performs the final tick

- **WHEN** this session's write left a lane unfinished and a different session's write completed it
- **THEN** the trigger reports nothing for this session

#### Scenario: Deletion is not completion

- **WHEN** this session's write deletes the last unchecked task of a lane instead of checking it off
- **THEN** the trigger reports nothing

#### Scenario: Mid-lane tick

- **WHEN** this session's write leaves an unchecked task in the lane it touched
- **THEN** the trigger reports nothing

#### Scenario: No other lane remains

- **WHEN** every unchecked task belongs to the lane that just completed, or the only other lane is the serial tail
- **THEN** the trigger reports nothing

### Requirement: Task lanes and the serial tail

The engine SHALL read lanes from `tasks.md`. A lane MUST be the numbered tasks under the nearest
preceding level-2 heading, and a task before the first heading MUST belong to an untitled lane. A
lane's owned paths MUST be the backticked segments of its heading. A lane whose heading contains
`serial` (case-insensitive) MUST NOT count as remaining parallel work, and when no heading contains
`serial` every remaining lane MUST count.

#### Scenario: Serial tail excluded

- **WHEN** the only remaining unchecked tasks are under a heading containing `serial`
- **THEN** the trigger reports nothing

#### Scenario: Tail not labelled

- **WHEN** no heading contains `serial` and a non-empty lane other than the completed one remains
- **THEN** that lane counts as remaining parallel work

#### Scenario: Change without lane headings

- **WHEN** the change's `tasks.md` has no level-2 headings
- **THEN** the trigger reports nothing

### Requirement: Lane-boundary steer payload

The gate MUST steer with each remaining lane title, its owned paths, a complete `subagent` call, and
the exact `task_progress` call that records a serial decision. The `subagent` call MUST require the
worker to resolve the repository root and create its own git worktree there, so the worktree is a
sibling of the repository and never inside the parent checkout; it MUST also forbid ticking
`tasks.md` and ask for the branch and the changed files back.

#### Scenario: Payload is executable

- **WHEN** the gate steers at a lane boundary
- **THEN** the message contains the lane title, its owned paths, the complete `subagent` call with its worktree and branch instruction, and the `task_progress` call

### Requirement: Lane-boundary payload preconditions

The payload MUST contain a checkpoint commit before the worker calls, because a new checkout
contains only commits. The commit MUST include the change directory even when it matches a Git
ignore rule, and MUST be anchored to the repository root rather than the session working directory,
because a session may run in a nested directory. The payload MUST NOT contain a machine path,
because the started child inherits the session working directory.

#### Scenario: Checkpoint precedes the workers

- **WHEN** the gate renders the payload
- **THEN** the message contains a commit command ordered before the `subagent` calls

#### Scenario: Ignored change directory

- **WHEN** the change directory matches a Git ignore rule
- **THEN** the checkpoint command force-adds that directory before committing

#### Scenario: Nested session working directory

- **WHEN** the session runs in a directory below the repository root
- **THEN** the checkpoint commands are root-anchored, and the worker instruction resolves the repository root first, so the worktree is a sibling of the repository and never inside the parent checkout

#### Scenario: Payload has no machine path

- **WHEN** the gate renders the payload
- **THEN** the message contains no absolute filesystem path

### Requirement: Lane-boundary fail-open

The `lane-boundary` trigger MUST fail open. An unreadable `tasks.md`, a change without level-2
headings, a lane without owned paths, a lane reopened before the turn closes, and a completion task
that no longer appears in `tasks.md` MUST NOT report the rule. The trigger MUST NOT make a turn
close impossible.

#### Scenario: Unreadable tasks.md

- **WHEN** the change's `tasks.md` cannot be read at a lane boundary
- **THEN** the trigger reports nothing; the separate soft per-change artifact hint is unaffected and neither satisfies nor blocks this rule

#### Scenario: Completion task removed

- **WHEN** a task that carried the lane completion disappears from the plan before the turn closes
- **THEN** the trigger reports nothing

#### Scenario: Lane reopened before turn close

- **WHEN** a later write in the same turn adds an unchecked task to the lane that just completed
- **THEN** the trigger reports nothing

#### Scenario: Lane without owned paths

- **WHEN** any remaining lane with unchecked tasks declares no owned path in its heading
- **THEN** the trigger reports nothing, even when another remaining lane does declare owned paths

## MODIFIED Requirements

### Requirement: Trigger evaluation

The engine SHALL implement the seven deterministic triggers `manual`, `spec-ready`,
`spec-task-ready`, `implementation-work`, `lane-boundary`, `implementation-complete`, and
`failure-streak`. A trigger MUST evaluate only from session/workspace state and tool results, MUST
be evaluated at `agent/turn-stopping` for gated rules, and MUST NOT start a target run from the
listener. A change-scoped trigger MUST evaluate only for a change attributed to the current session.
A new trigger source requires a code extension.

#### Scenario: Spec-ready trigger

- **WHEN** an active review-ready change attributed to the session has a gated whole-spec review rule without a matching pass
- **THEN** the trigger reports the rule as unsatisfied

#### Scenario: Spec-task-ready trigger

- **WHEN** a checked task attributed to the session has no matching task-review record
- **THEN** the trigger reports the task as needing a task-scoped review

#### Scenario: Implementation-work trigger

- **WHEN** a turn changed implementation files in a change attributed to the session and has neither a newly checked reviewed task nor a matching task-progress note for the current worktree
- **THEN** the trigger reports that a tick+review or a progress note is required

#### Scenario: Lane-boundary trigger

- **WHEN** a lane boundary is reached in a change attributed to the session and neither a parallel worker nor a matching progress note in a remaining lane settles it
- **THEN** the trigger reports the fan-out rule as unsatisfied with the remaining lanes and the exact calls

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

### Requirement: Model-agnostic defaults and documentation

The shipped default rules SHALL be model-agnostic data; the setup MAY default their targets to the
Codex provider, but the bundle MUST NOT require Codex, and the documentation MUST show a non-Codex
target with another provider/model. The default set SHALL include whole-spec review, task review,
task progress, the lane-boundary fan-out gate, blocker, research, advisor, bug fix, and an optional
integration review. The acceptance MUST exercise at least one non-Codex target.

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
- **THEN** it shows the trigger/contract/gate model, the lane-boundary fan-out gate and its serial escape, a Codex target, a non-Codex target, the advisor rule, the shipped strong Codex target defaults, and the config/code boundary
