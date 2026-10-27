# Spec Delta

## ADDED Requirements

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
