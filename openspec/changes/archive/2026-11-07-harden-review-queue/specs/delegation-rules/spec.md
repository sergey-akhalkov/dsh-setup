# Spec Delta

## MODIFIED Requirements

### Requirement: Asynchronous review runs

A review delegation SHALL validate the rule, target, and change (and an explicit task when supplied), admit the run through the review queue, and return a run id before the target completes. The run MUST start when the queue admits it, MUST continue in the background, MUST write the rule's digest-bound `PASS`/`FINDINGS`/`ERROR` record when it finishes, and MUST be visible in `delegation_status` while queued, running, and after completion. Multiple review runs MUST be able to proceed concurrently up to the configured queue limit. The answer and patch contracts MUST remain synchronous.

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

### Requirement: Pending review handling

A duplicate review request MUST be identified by the rule, the change, the task/phase, the prepared digest, and the resolved reviewer. A second request with the same identity while pending MUST return the existing run handle and MUST NOT start a duplicate. A changed digest or reviewer MUST be a distinct run and MUST NOT join the old handle. Distinct rules reviewing the same change/task MUST share the conversation key but queue as separate runs and write each rule's own record. Runs sharing a conversation key MUST be serialized, and a superseded or late completion MUST NOT replace the authoritative record.

#### Scenario: Duplicate pending request

- **WHEN** a review is already pending for the same rule/change/task/digest and delegate is called again
- **THEN** the existing run handle is returned and no second target starts

#### Scenario: Changed digest is distinct

- **WHEN** a review request has the same rule/change/task but a different prepared digest
- **THEN** a new run is created and the old handle is not joined

#### Scenario: Different rules, same task

- **WHEN** two different review rules target the same change/task while one is pending
- **THEN** the second rule runs (queued) and writes its own record instead of returning the first rule's handle

#### Scenario: Late completion

- **WHEN** a run sharing a key completes after the authoritative record was written
- **THEN** its result is reported as discarded and does not replace the record

## ADDED Requirements

### Requirement: Review queue admission

Every review run SHALL pass through one per-profile FIFO queue before its target starts. The queue SHALL enforce a configurable concurrency limit (default 2) and a configurable waiting-list cap (default 16). A run admitted while at capacity waits; a run that cannot be admitted within the wait timeout SHALL settle as a bounded `ERROR` in its run record and settlement observer, with the queue state, and no target SHALL start. The tool has already returned the queued handle.

#### Scenario: Capacity is available

- **WHEN** a review is admitted while the active count is below the concurrency limit
- **THEN** the target starts and the run reports `running`

#### Scenario: Capacity is exhausted

- **WHEN** a review is admitted while the active count is at the limit and the waiting list has room
- **THEN** the run reports `queued` with its position and starts when a slot frees

#### Scenario: Admission timeout

- **WHEN** the waiting list is full or the wait exceeds `waitTimeoutMs`
- **THEN** the run settles as `ERROR` with `queue-full` or `queue-timeout`, the status and observer report it, and no target starts

### Requirement: Review queue identity and dedupe

An admitted review SHALL be identified by rule, change, task id or phase, digest, provider, and model. A same-identity request MUST join the existing run; a different digest or rule MUST be a distinct run. Re-preparation SHALL replace the identity atomically: a free identity keeps the queue position; an occupied one settles the re-preparing run as `discarded` without a target while the incumbent proceeds. A discarded key head SHALL promote its next follower.

#### Scenario: Duplicate identity joins

- **WHEN** a second review request has the same identity as a queued or running run
- **THEN** the existing run handle is returned and no duplicate target starts

#### Scenario: Re-preparation collides

- **WHEN** a queued run re-prepares to an identity that already exists
- **THEN** the re-preparing run settles as `discarded` without starting a target and the incumbent remains authoritative

#### Scenario: D1 converges to an existing D2

- **WHEN** queued run A prepared from D1 re-prepares to D2 while admitted run B already holds D2
- **THEN** only B starts a target and publishes the record, the handles for A and B each settle exactly once, and A's settlement observer fires once

#### Scenario: Changed digest is distinct

- **WHEN** a review request has the same rule and task but a different digest
- **THEN** a new run is queued and the earlier run is not reused

#### Scenario: Different rules stay separate

- **WHEN** two rules review the same change and task
- **THEN** both runs are queued and each writes its own record

### Requirement: Review failure classification and retry

The queue SHALL classify a failed start or run as transient (`child-limit`, `provider-not-started`, `timeout`) or permanent (`invalid-output`, `config`, `permission`, `reviewed-inputs-changed`). Transient classes SHALL retry up to `maxAttempts` (default 3) with bounded exponential backoff and jitter. Before a queued run starts, the queue SHALL re-check its prepared inputs and re-prepare once when they changed. A permanent class MUST NOT retry.

#### Scenario: Child limit retries

- **WHEN** a start fails with the active-child-limit error
- **THEN** the run waits with backoff, retries, and records the attempt and class

#### Scenario: Timeout retries

- **WHEN** a review run times out
- **THEN** it retries within the attempt budget or settles as `ERROR` with `timeout`

#### Scenario: Queued inputs are re-checked

- **WHEN** a queued run's prepared inputs change before a slot frees
- **THEN** the queue re-prepares once before starting and records the new digest

#### Scenario: In-run input change is terminal

- **WHEN** a run reports that its reviewed inputs changed during the run
- **THEN** it settles as `ERROR` with `reviewed-inputs-changed`, no retry starts, and the gate asks to finish the writes and re-run

#### Scenario: Permanent failure is not retried

- **WHEN** the target returns an invalid verdict or the configuration is invalid
- **THEN** the run settles as `ERROR` with the permanent class and no retry starts

### Requirement: Review queue record integrity

A retry MUST NOT create two authoritative records for one identity. Only the settled attempt MAY publish a verdict; an earlier attempt MUST NOT. A never-started queued run SHALL re-inspect the authoritative record once start-eligible after its predecessor settles, and use that snapshot as its publication baseline: a record at that baseline MUST NOT discard its completion, a later record MUST. A superseded or late completion MUST NOT replace the authoritative record.

#### Scenario: Failed attempt writes no verdict

- **WHEN** an attempt fails with a transient class
- **THEN** no `PASS` or `FINDINGS` record is written for that attempt

#### Scenario: Superseded run does not publish

- **WHEN** a new digest supersedes a queued or running predecessor and the predecessor later completes
- **THEN** the predecessor is discarded and the successor's record is unchanged

#### Scenario: One authoritative record

- **WHEN** a retry succeeds after one or more failed attempts
- **THEN** exactly one record is written for the identity and it carries the settled verdict

#### Scenario: Late duplicate is discarded

- **WHEN** a duplicate run completes after the authoritative record exists
- **THEN** its result is reported as discarded and the record is unchanged

#### Scenario: Settled predecessor does not discard successor

- **WHEN** a D1 predecessor publishes a record while a queued D2 successor waits, and the D2 run then starts
- **THEN** the D2 run publishes its own verdict and is not discarded

#### Scenario: Retry does not adopt a later record

- **WHEN** an authoritative record is published while a retry waits
- **THEN** the retry is discarded and the record is unchanged

### Requirement: Review queue settlement

The optional settlement observer SHALL fire exactly once after the run leaves the queue and all retries have settled, with the run id and terminal state. Queue wait and retry delay are not settlement. An admission timeout, a permanent failure, and a cancelled run SHALL settle with a recorded terminal state, and the observer MUST NOT change records, gates, concurrency, or targets.

#### Scenario: Queued run settles once

- **WHEN** an observer is supplied and a queued run reaches a terminal state
- **THEN** the observer is called once after the final attempt settles

#### Scenario: Admission timeout settles

- **WHEN** a run cannot be admitted within the timeout
- **THEN** the observer is called once with the timeout terminal state and no record is published as a PASS

#### Scenario: No observer

- **WHEN** no settlement observer is supplied
- **THEN** queueing, retries, records, gates, and status behave exactly as before

### Requirement: Review queue visibility

`delegation_status` SHALL report queue depth, active runs, queued runs, and each run's queue position, wait time, attempts, and failure class. The run record SHALL carry the same bounded fields. The values MUST be local, MUST NOT contain credentials or machine paths, and MUST be available to the existing observability surface.

#### Scenario: Status shows the queue

- **WHEN** one review runs and two wait
- **THEN** the status reports one active, two queued, and each queued run's position

#### Scenario: Record carries the attempt facts

- **WHEN** a review settles after a retry
- **THEN** its record reports the attempt count and the final failure class when it failed

### Requirement: Review queue configuration and off switch

The review queue SHALL be configured by `reviewQueue` with `enabled` (default true), `concurrency` (default 2), `maxQueued` (default 16), `maxAttempts` (default 3), `baseDelayMs`, `maxDelayMs`, and `waitTimeoutMs`. Invalid values SHALL fail plugin load with the field. `enabled: false` SHALL restore direct target start while keeping the review gate and records unchanged.

#### Scenario: Defaults apply

- **WHEN** the row omits `reviewQueue`
- **THEN** the queue is enabled with concurrency 2 and the documented defaults

#### Scenario: Invalid configuration

- **WHEN** `concurrency` is zero or `maxAttempts` is negative
- **THEN** plugin load fails with the field name and the accepted range

#### Scenario: Off switch

- **WHEN** `reviewQueue.enabled` is false
- **THEN** review runs start directly as before and the gate still evaluates their records

### Requirement: Review queue failure isolation

An internal queue error MUST NOT trap the turn or lose the review. The queue SHALL record a bounded `queue-internal-error`, start the target directly once when direct start is possible, and otherwise return an `ERROR` with the next action. The review gate SHALL still evaluate the resulting record, and a queue error MUST NOT be treated as a PASS.

#### Scenario: Internal error falls back

- **WHEN** the queue throws before admission and direct start is available
- **THEN** the target starts directly, the run records `queue-internal-error`, and the review proceeds

#### Scenario: Internal error without fallback

- **WHEN** the queue throws and no target can start
- **THEN** the tool returns an `ERROR` with the next action and the gate does not treat it as a PASS

#### Scenario: Gate still evaluates

- **WHEN** a queue failure produces an `ERROR` record
- **THEN** the task and archive gates report the task as unapproved, exactly as for any other `ERROR`

### Requirement: Restart reconciliation

On load, a durable review run with a matching authoritative record SHALL be reconciled to the terminal state for its verdict, and the record MUST NOT be invalidated by the run-file state or recovery. Approval SHALL be evaluated only through the existing verdict, scope, digest, and reviewer checks: a PASS approves only when those checks accept it; FINDINGS and ERROR are preserved but never approve archive or push. A run with no matching record SHALL be marked interrupted, never a PASS.

#### Scenario: Crash after publication

- **WHEN** a run file is left `running` and its authoritative record is a current PASS after a restart
- **THEN** the run is reconciled as completed and the gate treats the task as approved

#### Scenario: FINDINGS is not approval

- **WHEN** the authoritative record is FINDINGS
- **THEN** the run is reconciled as completed but the gate still treats the task as unapproved

#### Scenario: ERROR is not approval

- **WHEN** the authoritative record is ERROR
- **THEN** the run is reconciled as failed, the ERROR may close the turn, and the gate refuses archive or push

#### Scenario: Stale PASS is not approval

- **WHEN** the authoritative record is a whole-scope PASS whose digest differs from the current change digest
- **THEN** the run is reconciled as completed but the gate requires a fresh review

#### Scenario: Crash before publication

- **WHEN** a run file is left `running` and no authoritative record exists
- **THEN** the run is marked interrupted, no PASS is synthesized, and the gate asks for a fresh review

#### Scenario: Record is not invalidated

- **WHEN** recovery marks a run interrupted after a record was published
- **THEN** the published record remains readable and authoritative
