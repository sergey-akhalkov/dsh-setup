# Spec Delta

## ADDED Requirements

### Requirement: Review run liveness

A review run is live only while the host review executor holds it (admitted, starting, or
retrying) or its admission is in flight from the current advance; its persisted `running` or
`blocked` status is not liveness. A pending run with no executor that waits behind a live
covering review is `waiting on <runId>`; one with no covering live review is `orphaned`.
`workflows status` SHALL name the review step's liveness.

#### Scenario: Live executor is reported

- **WHEN** the review scheduler holds a run's review attempt
- **THEN** `workflows status` reports the review step as `live` with the attempt count, and a start that the run fully covers reuses it

#### Scenario: Waiting run is not live

- **WHEN** a run's review executor returned early because a live review already covers its unit
- **THEN** `workflows status` reports `waiting on <coveringRunId>` and the waiting run is not itself live coverage

#### Scenario: Whole-scope and equal-coverage waiters are reported

- **WHEN** a whole-scope run waits behind a live review of the same change and phase, or a task or section run waits behind a live run with equal coverage
- **THEN** `workflows status` reports `waiting on <runId>` for that predecessor and the waiting run is not itself live coverage

#### Scenario: Orphaned run is reported

- **WHEN** a run is `interrupted` (or `blocked`) with a pending review step and no executor holds it
- **THEN** `workflows status` reports `orphaned` with the run's bounded reason, and no review record is synthesized

#### Scenario: Foreign live review still covers

- **WHEN** the live covering review belongs to another session
- **THEN** it counts as live coverage for the unit and the close treats the unit as waiting, not due

### Requirement: Live review coverage for starts

A `workflows start` for a review SHALL reuse a fully covering run only when that run is live,
and SHALL refuse a partial overlap only when an overlapping run is live; the refusal MUST name
the live run. A stored `running` or `blocked` run with no live executor MUST NOT refuse a start,
and the start SHALL create a fresh run.

#### Scenario: Stale run does not refuse a start

- **WHEN** a review start overlaps only a stored run with no live executor
- **THEN** a fresh run starts instead of the `overlaps ... does not cover it completely` refusal

#### Scenario: Live partial overlap still refuses

- **WHEN** a section start overlaps a live review that covers only part of the section
- **THEN** the start is refused and the message names the live covering run

#### Scenario: Fully covered start reuses the live run

- **WHEN** a review start's coverage is fully covered by a live run
- **THEN** the existing run handle is returned and no second reviewer starts

### Requirement: Duplicate review admission settlement

When the review scheduler rejects an admission because another live run already covers the
same unit (`duplicate` with a different run id), the rejected workflow run SHALL settle
`cancelled` with a reason naming the covering run, and MUST NOT stay `blocked` with an open
step. A run whose executor returns early because a live covering review exists is a waiter, not
a duplicate: it SHALL stay open and be re-advanced at the next close. A duplicate settlement
MUST NOT write a review record.

#### Scenario: Duplicate settles cancelled

- **WHEN** the scheduler returns a duplicate admission with another run id
- **THEN** the rejected run becomes `cancelled` and its reason names the covering run

#### Scenario: Waiter stays open

- **WHEN** the executor waits on a live covering review
- **THEN** the waiting run stays `blocked` with its review step open and is re-advanced at the next close

#### Scenario: Duplicate writes no record

- **WHEN** a duplicate admission is settled
- **THEN** no `PASS` or `ERROR` record is written for the rejected run

## MODIFIED Requirements

### Requirement: Restart reconciliation

On load, a durable review run with a matching authoritative record SHALL be reconciled to the terminal
state for its verdict, and the record MUST NOT be invalidated by the run-file state or recovery.
Approval SHALL be evaluated only through the existing verdict, scope, digest, and reviewer checks: a
`PASS` approves only when those checks accept it; `FINDINGS` and `ERROR` are preserved but never approve
archive or push. A run with no matching record SHALL be marked interrupted, never a `PASS`. When that
run's review step is still pending, the next close that dispatches a fresh round for the same unit SHALL
settle the superseded run `cancelled` with a bounded reason naming the restart; recovery and the
supersede write MUST NOT synthesize a review record.

#### Scenario: Crash after publication

- **WHEN** a run file is left `running` and its authoritative record is a current PASS after a restart
- **THEN** the run is reconciled as completed and the gate treats the task as approved

#### Scenario: Crash before publication

- **WHEN** a run file is left `running` and no authoritative record exists
- **THEN** the run is marked interrupted, no PASS is synthesized, and the gate asks for a fresh review

#### Scenario: Interrupted review run is superseded

- **WHEN** the next close dispatches a fresh review round for the unit of an interrupted run
- **THEN** the interrupted run is settled `cancelled` with the restart reason and the fresh run carries the review

#### Scenario: Recovery writes no record

- **WHEN** recovery marks a review run interrupted or the next close supersedes it
- **THEN** no `PASS` or `ERROR` record is written by either write

### Requirement: Model interface

The `workflows` tool SHALL expose `list`, `start`, `resume`, `status`, `evidence`, `cancel`, and `adopt`. `start` SHALL require `allowModelStart` and user confirmation for `risk: high`. `list` SHALL name a definition whose `allowModelStart` is false as user-started and MUST NOT report it as a refused or failed model start. `resume` SHALL continue an `interrupted`, `blocked`, or `failed` run in the current session and workspace at its pending step without starting a new run. `cancel` SHALL be allowed for a run of the current session or for a run whose owning agent is not executing a turn (absent or idle); while the owning agent is executing a turn the call SHALL be refused. `status` SHALL name a review step's liveness (`live`, `waiting on <runId>`, or `orphaned`). `evidence` SHALL be accepted only when the host verifies it. `adopt` SHALL request adoption of one existing change and MUST write a receipt only after the host asks the user and the user answers yes. The tool MUST NOT accept a raw script or definition, install one, or write a receipt for any other action.

#### Scenario: List definitions

- **WHEN** the model calls `list`
- **THEN** it receives the definitions it may start, their trigger modes, and whether a start is model-allowed or user-started

#### Scenario: Allowed start

- **WHEN** the model starts a definition with `allowModelStart: true`
- **THEN** one run starts and the tool returns its id

#### Scenario: Refused start

- **WHEN** the model starts a definition without `allowModelStart`
- **THEN** the start is refused with the next action

#### Scenario: Interrupted run resumes

- **WHEN** the model calls `resume` with an interrupted run id in its session
- **THEN** the run continues at its pending step and no new run starts

#### Scenario: Failed run resumes

- **WHEN** the model calls `resume` with a failed run id in its session
- **THEN** the failed step is reopened and the run continues at it

#### Scenario: Dead-session run is cancellable

- **WHEN** the model calls `cancel` for a run whose owning agent is absent or idle
- **THEN** the run is cancelled and its open step is recorded as cancelled

#### Scenario: Live foreign run is not cancellable

- **WHEN** the model calls `cancel` or `resume` for a run whose owning agent is executing a turn in another session
- **THEN** the call is refused and the run is left unchanged

#### Scenario: Status reports review liveness

- **WHEN** the model calls `status` for a run with a review step
- **THEN** the line names the review step's liveness as `live`, `waiting on <runId>`, or `orphaned`

#### Scenario: Raw script is refused

- **WHEN** the model submits a script instead of a definition id
- **THEN** the tool rejects the call

#### Scenario: Adoption asks the user

- **WHEN** the model calls `adopt` for an existing adoptable change
- **THEN** the host asks the user to confirm and no receipt is written before a yes answer
