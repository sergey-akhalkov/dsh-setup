# Spec Delta

## ADDED Requirements

### Requirement: Lane-assignment fan-out gate

The engine SHALL implement the `lane-assignment` trigger. For a change attributed to the current session with
at least two non-serial lanes in the plan, it reports unassigned non-serial lanes with unchecked tasks that are
not a lane the session ticked in the turn. A lane is satisfied by a tagged worker start for that lane or by a
matching serial note. A change with exactly one non-serial lane reports nothing, and the trigger MUST fail open
on an unreadable plan.

#### Scenario: Unassigned lane on an implementation turn

- **WHEN** a turn that ticked a task or changed implementation files in a plan with at least two non-serial
  lanes leaves a non-serial lane with unchecked tasks unassigned and outside the lanes ticked that turn
- **THEN** the trigger reports the fan-out rule as unsatisfied with the unassigned lanes and the exact calls

#### Scenario: Completing one lane leaves another

- **WHEN** the turn ticks the last task of lane A, lane B is the only remaining unchecked lane, and the plan
  has two non-serial lanes
- **THEN** the trigger reports lane B

#### Scenario: First implementation turn

- **WHEN** the first task of a change is ticked and other non-serial lanes still have unchecked tasks
- **THEN** the trigger reports those other lanes before the first lane is completed

#### Scenario: Assigned or serial lane

- **WHEN** a non-serial lane with unchecked tasks is assigned to a tagged worker or marked serial
- **THEN** the trigger does not report that lane

#### Scenario: Current lane

- **WHEN** the session ticked a task in a lane this turn
- **THEN** that lane is treated as current and is not reported for fan-out while other lanes remain

#### Scenario: New lane appears

- **WHEN** a lane that was not in the previous plan appears with unchecked tasks and no assignment
- **THEN** the trigger reports it

#### Scenario: Another session owns the work

- **WHEN** a different session completed, assigned, or serialized a lane
- **THEN** that evidence does not settle this session's trigger

#### Scenario: Single lane

- **WHEN** the change has exactly one non-serial lane in the plan
- **THEN** the trigger reports nothing

### Requirement: Lane assignment state

The engine SHALL keep a session-scoped assignment for each lane: `assigned` after a successful tagged worker
start, `serial` after a matching `task_progress` note, and current for a lane the session ticked in the turn.
An assignment for a lane that disappears or becomes complete MUST be ignored; a new or renamed lane is
unassigned. A tagged start MUST carry the exact lane tag in the tool arguments.

#### Scenario: Tagged worker assigns one lane

- **WHEN** a successful `subagent`, `subagent_fork`, `spawn_teammate`, or `workflow` start contains the
  `lane-tag` for one lane
- **THEN** only that lane becomes assigned

#### Scenario: Untagged worker does not count

- **WHEN** a successful worker starts without the lane tag
- **THEN** no lane becomes assigned and the trigger still reports unassigned lanes

#### Scenario: Failed worker does not count

- **WHEN** a worker start with a lane tag reports an error
- **THEN** the lane stays unassigned

#### Scenario: Serial note marks one lane

- **WHEN** a successful `task_progress` note names a task in one unassigned lane and matches the current
  worktree digest
- **THEN** only that lane becomes serial

#### Scenario: Assigned lane is not reissued

- **WHEN** a lane was assigned in an earlier turn and still has unchecked tasks
- **THEN** a later lane completion does not demand a second worker for it

#### Scenario: Completed or removed lane

- **WHEN** an assigned or serial lane becomes complete or disappears from `tasks.md`
- **THEN** its assignment is ignored rather than reported

#### Scenario: Renamed lane

- **WHEN** a lane title changes
- **THEN** the old assignment is ignored and the renamed lane is unassigned

#### Scenario: Session scope

- **WHEN** another session recorded an assignment for a lane
- **THEN** this session's trigger does not treat that lane as assigned

### Requirement: Lane-assignment steer payload

The gate MUST steer with each unassigned lane's title, owned paths, a ready `subagent` call carrying
`lane-tag: <change>#<n>`, and a per-lane `task_progress` call for a serial decision, after a root-anchored
checkpoint commit. The worker call MUST require its own worktree and branch and MUST forbid ticking
`tasks.md`.

#### Scenario: Only unassigned lanes are listed

- **WHEN** the gate steers while some lanes are already assigned, serial, current, or complete
- **THEN** the payload lists only the unassigned lanes

#### Scenario: Tagged calls are ready to paste

- **WHEN** the gate steers at a lane assignment boundary
- **THEN** each worker call contains the lane title, its owned paths, and its exact lane tag

#### Scenario: Checkpoint precedes workers

- **WHEN** the gate renders the payload
- **THEN** a commit command appears before the worker calls

#### Scenario: Ignored change directory

- **WHEN** the change directory matches a Git ignore rule
- **THEN** the checkpoint command force-adds that directory before committing

#### Scenario: Nested session working directory

- **WHEN** the session runs below the repository root
- **THEN** the checkpoint pathspecs and the worker instruction resolve the repository root first

#### Scenario: Payload has no machine path

- **WHEN** the gate renders the payload
- **THEN** the message contains no absolute filesystem path

#### Scenario: Worker isolation

- **WHEN** the worker call is read
- **THEN** it requires a sibling worktree and a branch and forbids ticking `tasks.md`

### Requirement: Lane-assignment fail-open

The `lane-assignment` trigger MUST fail open. An unreadable `tasks.md`, a change without level-2 headings, an
unassigned lane without owned paths, and a turn with no implementation change or tick MUST NOT report the
rule. A lane that disappears or becomes complete MUST NOT keep its assignment.

#### Scenario: Unreadable tasks.md

- **WHEN** the change's `tasks.md` cannot be read
- **THEN** the trigger reports nothing; the separate soft artifact hint is unaffected

#### Scenario: No lane headings

- **WHEN** the change's `tasks.md` has no level-2 headings
- **THEN** the trigger reports nothing

#### Scenario: Lane without owned paths

- **WHEN** an unassigned lane with unchecked tasks declares no owned path in its heading
- **THEN** the trigger reports nothing for the change

#### Scenario: Read-only turn

- **WHEN** a turn neither ticked a task nor changed implementation files
- **THEN** the trigger reports nothing

#### Scenario: Plan changed before turn close

- **WHEN** a lane disappears or becomes complete before the turn closes
- **THEN** its assignment is ignored and does not keep the rule satisfied

### Requirement: Deprecated lane-boundary trigger

The engine SHALL keep `lane-boundary` accepted for existing profiles with its documented completion-boundary
behavior, but MUST mark it deprecated in the skill and documentation. No shipped default rule MAY use it.

#### Scenario: Existing profile still composes

- **WHEN** a profile configures a rule with the `lane-boundary` trigger
- **THEN** the rule is accepted and keeps its documented behavior

#### Scenario: Shipped default uses lane-assignment

- **WHEN** the setup is installed with the shipped defaults
- **THEN** the `lane-fanout` rule uses the `lane-assignment` trigger

#### Scenario: Documentation marks the deprecation

- **WHEN** a user reads the delegation skill or documentation
- **THEN** it names `lane-boundary` as deprecated and directs new rules to `lane-assignment`

## MODIFIED Requirements

### Requirement: Trigger evaluation

The engine SHALL implement the eight deterministic triggers `manual`, `spec-ready`, `spec-task-ready`, `implementation-work`, `lane-assignment`, `lane-boundary` (deprecated), `implementation-complete`, and `failure-streak`. A trigger MUST evaluate only from session/workspace state and tool results, MUST be evaluated at `agent/turn-stopping` for gated rules, and MUST NOT start a target run from the listener. A change-scoped trigger MUST evaluate only for a change attributed to the current session. A new trigger source requires a code extension.

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

- **WHEN** the configured number of consecutive failed tool calls has no intervening success and no consultation attempt
- **THEN** the trigger reports the soft rule as needing a delegation

#### Scenario: Manual trigger

- **WHEN** a rule uses the manual trigger
- **THEN** it has no automatic condition and runs only through the delegate tool

#### Scenario: Unknown trigger

- **WHEN** a rule names a trigger outside the documented vocabulary
- **THEN** configuration validation rejects it

### Requirement: Model-agnostic defaults and documentation

The shipped default rules SHALL be model-agnostic data; the setup MAY default their targets to the Codex provider, but the bundle MUST NOT require Codex, and the documentation MUST show a non-Codex target with another provider/model. The default set SHALL include whole-spec review, task review, task progress, the lane-assignment fan-out gate, blocker, research, advisor, bug fix, and an optional integration review. The deprecated `lane-boundary` trigger MAY remain in a profile but MUST NOT be in the shipped default set. The acceptance MUST exercise at least one non-Codex target.

#### Scenario: Default setup

- **WHEN** the setup is installed with the shipped defaults
- **THEN** the default rules target the configured Codex provider

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
- **THEN** it shows the trigger/contract/gate model, the lane-assignment fan-out gate with its per-lane serial escape, the deprecated lane-boundary trigger, a Codex target, a non-Codex target, the advisor rule, the shipped strong Codex target defaults, and the config/code boundary
