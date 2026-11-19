# Spec Delta

## ADDED Requirements

### Requirement: Review state on a change row

An active change row SHALL carry the review state beside its completion facts: the whole-spec
record as a current PASS, an outdated PASS, findings, an error, or absent, and the number of
checked tasks with a valid portable task-review PASS record in the change's working tree out of all
checked tasks. The state MUST be derived from the workflows review records and the current
change-artifact digest, and a missing local record MUST read as unreviewed, never as a failed
review.

#### Scenario: Current whole-spec PASS

- **WHEN** the whole-spec record is a PASS whose digest matches the current change artifacts
- **THEN** the row shows the spec as PASS and reports the checked tasks with a portable PASS out of the checked tasks

#### Scenario: Plan edited after the PASS

- **WHEN** the whole-spec record is a PASS whose digest differs from the current change artifacts
- **THEN** the row shows the spec as outdated and does not present the change as reviewed

#### Scenario: Missing task approvals

- **WHEN** a change has 16 checked tasks and 14 carry a portable task-review PASS
- **THEN** the row shows 14 of 16 reviewed tasks and names the two missing task numbers

#### Scenario: Uncommitted approval

- **WHEN** a checked task carries a valid portable PASS that is present in the working tree but not committed
- **THEN** the row counts it exactly as the archive gate does, and the commit-backed audit remains the separate `pnpm reviews:check` run

#### Scenario: Findings or error

- **WHEN** the last whole-spec record is findings or an engine error at the current digest
- **THEN** the row shows that verdict with its finding count instead of PASS

#### Scenario: No local record

- **WHEN** the change has no local whole-spec record, for example in a fresh clone
- **THEN** the row shows the spec as not reviewed and does not claim a failure

### Requirement: Live review on a change row

When a review of the row's change is running, starting, or waiting on a live covering review,
including one owned by another session in the same workspace, the row SHALL show that review unit
as live or waiting and MUST NOT render it as settled. The state MUST end when the verdict record
lands. An open review run with no executor MUST NOT be shown as running.

#### Scenario: Spec review running

- **WHEN** a spec review of the change is starting or running
- **THEN** the row shows the spec unit as a live review with its attempt count and a spinner

#### Scenario: Task review running

- **WHEN** a task review of the change is starting or running
- **THEN** the row shows the task unit as a live review naming the section or task being reviewed

#### Scenario: Waiting for a covering review

- **WHEN** the change's run waits on a live covering review of another unit
- **THEN** the row shows the review as waiting and keeps the spinner off

#### Scenario: Orphaned run

- **WHEN** the change has an open review run with no executor
- **THEN** the row shows no live indicator and keeps the settled or unreviewed state

#### Scenario: Verdict settles

- **WHEN** the running review writes its verdict record and no change artifact changed
- **THEN** the live state ends with one debounced change-list re-read and the row shows the settled state without a manual refresh

#### Scenario: Review owned by another session

- **WHEN** the panel's session is idle and another session in the same workspace runs the change's review
- **THEN** the row still shows the live state and does not require the review to belong to the panel's session

### Requirement: Review state is additive to the row

Without the workflows engine, or for a row that carries no review state, the change row SHALL
render exactly as before. An archived row MUST NOT show review state. A client that does not
understand the review field MUST keep rendering the row.

#### Scenario: Engine absent

- **WHEN** the workflows plugin is not installed
- **THEN** the change list omits the review field and the row renders with its current facts only

#### Scenario: Archived row

- **WHEN** a row in the Archive segment renders
- **THEN** no review state is requested or shown for it

#### Scenario: Older client

- **WHEN** a client that predates the review field reads the change list
- **THEN** it renders the row unchanged and ignores the field

## MODIFIED Requirements

### Requirement: Live change list

The root view's Changes segment SHALL re-read the change list when a file shown by any active row it
renders changes on disk: the row's proposal, design, tasks file, or any delta spec. Archived rows
SHALL NOT be observed. Updates to the change list MUST use the host's shipped file observation —
never a polling timer, a heartbeat, or a plugin-owned filesystem watcher — and MUST stop when the
segment is left or the body unmounts. The separate review-liveness read MAY use a timer while the
segment or one of its change views is visible; the timer itself MUST NOT re-read the change list,
and it MUST stop when its view is hidden or unmounted. When a previously observed live review
settles, the panel MAY perform one debounced change-list re-read to show the settled verdict; that
transition refresh is not periodic polling.

#### Scenario: The change list observes its rows

- **WHEN** `proposal.md`, `design.md`, `tasks.md`, or any delta `specs/<capability>/spec.md` of an active change changes on disk while the Changes segment is shown
- **THEN** that row's status, completed and total task counts, purpose, requirement count, and last-modified fact update without reopening the tab

#### Scenario: A delta spec edit reaches its row

- **WHEN** a delta spec of an active change changes while the Changes segment is shown
- **THEN** the row's delta and requirement facts update after one debounced re-read of the list

#### Scenario: Archived rows are not observed

- **WHEN** any file of an archived change changes on disk
- **THEN** the Changes segment opens no watch for that row and schedules no re-read from it

#### Scenario: An archived change leaves the list

- **WHEN** an active change is moved into the archive
- **THEN** the next re-read no longer shows it in the Changes segment

#### Scenario: A new change needs a refresh

- **WHEN** a change is created while the Changes segment is shown
- **THEN** it appears after the native refresh or a hidden-to-visible re-read, not from file observation alone

#### Scenario: No timer while the list is idle

- **WHEN** the Changes segment is open and no observed file changes
- **THEN** no change-list polling request runs and no panel-owned watcher is open; the separate review-liveness read is not a change-list request

#### Scenario: Review liveness may poll

- **WHEN** the Changes segment or a change view is open and a review of one of its changes is live
- **THEN** the review-liveness read runs on its timer while visible, and the change list is not re-read by that timer

#### Scenario: A settled verdict refreshes once

- **WHEN** a previously observed live review settles and no artifact file changed
- **THEN** the panel performs one debounced change-list re-read and shows the settled verdict without a manual refresh

#### Scenario: Host without file observation

- **WHEN** the host provides no file resource provider
- **THEN** the list still renders, and the native refresh and the hidden-to-visible re-read still update it
