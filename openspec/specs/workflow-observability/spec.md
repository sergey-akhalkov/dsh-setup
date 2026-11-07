# workflow-observability Specification

## Purpose
Gives one read-only surface for the process: which triggers exist, what fired, which step is open, what evidence exists, and why a trigger did not fire, without changing how any turn runs.

## Requirements

### Requirement: Read-only workflow surface

The plugin SHALL contribute one `Workflows` view to the current conversation and MUST NOT steer, inject context, block a tool, block a turn, execute a workflow, or write outside `.dsh/workflows/`. The view MUST remain usable while the agent is running.

#### Scenario: A turn closes unchanged

- **WHEN** the plugin is active and a root turn runs and closes
- **THEN** no new steering, injection, tool decision, or turn refusal is attributable to the plugin

#### Scenario: The view is available during work

- **WHEN** the agent is running a turn in the session
- **THEN** the Workflows view opens and shows the events already observed in that session

### Requirement: Shadow trigger catalog

The plugin SHALL declare triggers as data, each with an id, an event kind, a filter, and a `shadow` mode. The supported event kinds SHALL be agent turn start, agent turn stop, tool result, subagent start, subagent end, and workspace file change. Intent classification is not an event kind in this change.

#### Scenario: Catalog loads

- **WHEN** the plugin loads with the shipped trigger definitions
- **THEN** the Triggers section lists each trigger with its event kind, filter summary, and last evaluation time

#### Scenario: Invalid trigger is refused

- **WHEN** a trigger has an unknown event kind, an empty id, or an invalid filter
- **THEN** plugin load fails with a diagnostic naming the trigger and the field, and no partial catalog is served

### Requirement: Trigger evaluation reason

For every observed event the plugin SHALL evaluate each trigger and record `matched: true` or `matched: false` with one reason from a fixed vocabulary: `would-fire` for a matched shadow trigger, and `event-mismatch`, `filter-mismatch`, `dedupe`, `disabled`, `not-ready`, or `error` for a non-match. A matched shadow trigger MUST NOT execute an action.

#### Scenario: Matched shadow trigger records would-fire

- **WHEN** a shadow trigger matches an event
- **THEN** the evaluation says `would-fire` and no action, tool, or steer executes

#### Scenario: Filter mismatch is explained

- **WHEN** a file event for a path outside the OpenSpec change tree reaches the trigger
- **THEN** the Why-not entry says `filter-mismatch` and names the rejected path and the filter

#### Scenario: Duplicate is explained

- **WHEN** the same file event is observed twice inside the debounce window
- **THEN** the second evaluation says `dedupe` and does not add a second timeline row

### Requirement: Session event journal

The plugin SHALL append one bounded record per observed event to `.dsh/workflows/events/<sessionId>.jsonl` with the time, session, turn, event kind, a short subject, and a redacted bounded payload. The journal MUST cap each record, rotate per session, and retain at most 30 days or 50 MB per workspace; pruning MUST happen on write without blocking the turn.

#### Scenario: An event is recorded

- **WHEN** a tool result settles in a session
- **THEN** one JSONL line carries the tool name, call id, success state, and a truncated payload summary

#### Scenario: Retention prunes old data

- **WHEN** the workspace journal exceeds the configured age or size limit
- **THEN** the oldest session files are removed before the new record is acknowledged

### Requirement: Read-only run projection

The plugin SHALL project work-checkpoint, delegation run, and portable review records as read-only runs, and SHALL read settled local review records only to attribute and enrich those runs, without rewriting, repairing, or re-running any record. A missing directory SHALL be an empty state, and a malformed record MUST appear as an error row naming the file.

#### Scenario: A checkpoint, a delegate run, and a review appear as runs

- **WHEN** the session wrote a checkpoint, started a delegation run, and received a task-review PASS record
- **THEN** the Runs section shows all three with their times, subjects, and evidence links

#### Scenario: A malformed record is visible

- **WHEN** a review record is not valid JSON
- **THEN** the Runs section shows an error row naming the file and the parse failure

### Requirement: Run session attribution

Every projected run SHALL carry an attribution of `local`, `portable`, or `unattributed`, and only an attributed run MUST appear in the session timeline. A portable review record MUST be attributed only through a matching local record with the same change, task, and digest.

#### Scenario: Portable record is unattributed

- **WHEN** a portable review record has no local record with a matching session
- **THEN** it is labeled `unattributed` and is excluded from the session timeline

### Requirement: Checkpoint run attribution

A checkpoint run MUST be located by hashing the requesting session id with the producer's algorithm (`sha256`, first 16 hex characters) and MUST be attributed to that requesting session. The hashed directory name and the record's redacted `session` field MUST NOT be treated as the session id.

#### Scenario: Producer checkpoint appears in its session

- **WHEN** the producer wrote a checkpoint for the requesting session
- **THEN** the checkpoint appears in that session's timeline and run list, attributed to the requesting session

#### Scenario: Another session's hash is excluded

- **WHEN** the workspace has a checkpoint directory for a different session
- **THEN** the requesting session's timeline lists none of its records

### Requirement: Delegation run attribution

A delegation run MUST be attributed only by a `delegate` tool result that reports starting or queueing it, or by a settled review record whose `runId` equals the run id. A result that reports an already pending run MUST NOT establish or transfer ownership, and the run's `record` path MUST NOT attribute a run. A run with no starting observation and no `runId`-matching record SHALL be labeled `unattributed`.

#### Scenario: Pending run has no inferred data

- **WHEN** a delegation run is queued or running and no `runId`-matching record exists
- **THEN** it shows its run state and no target, verdict, or attempt step

#### Scenario: Duplicate response does not take ownership

- **WHEN** session B receives an already pending response naming a run that session A started
- **THEN** session B does not become the owner and the run stays attributed to session A

#### Scenario: Cross-session record reuse keeps attribution

- **WHEN** a run observed in session A has a record path that another session's run rewrote
- **THEN** the run stays attributed to session A and the other run's record contributes no step data

#### Scenario: Unobserved delegation run is unattributed

- **WHEN** a delegation run file has no observed starting `delegate` call and no matching `runId` record
- **THEN** it is labeled `unattributed` and is excluded from the session timeline

### Requirement: Session timeline and run detail

The view SHALL show the current session's events and projected runs in timestamp order, with a filter for the session and links to the originating tool call, child session, or record. A run detail SHALL show each step's state, time, decision summary, and evidence. A `turn.stopping` observation is a stop attempt; a refused attempt SHALL be recorded and the turn continues.

#### Scenario: A refused stop attempt is recorded

- **WHEN** an existing gate refuses the stop attempt and the turn continues
- **THEN** the attempt appears in the timeline and no close is reported

#### Scenario: A delegate and its review stay in order

- **WHEN** the session starts a delegate and later receives the review record
- **THEN** the delegate row precedes the review row and the review links to the record file

#### Scenario: Evidence is inspectable

- **WHEN** the user opens a projected run
- **THEN** the detail shows the evidence path or call id that satisfied the step, not only a label

### Requirement: Listener health

The plugin SHALL report, for the requesting session, listener count, last observed event time, journal writability, trigger count, and the last listener error. The view MUST distinguish "no event yet", "trigger did not match", and "listener is down" as separate states.

#### Scenario: Disabled listener is unhealthy

- **WHEN** the event listener is disabled or throws during registration
- **THEN** the health strip reports `listener-down` with the error, and no section claims the session is quiet

#### Scenario: Quiet session is not a failure

- **WHEN** the listener is healthy but no trigger-matched event has occurred
- **THEN** the health strip reports `waiting` and the Why-not table explains the non-matches

### Requirement: Workspace scoping and privacy

The plugin SHALL read only the requesting session's workspace, MUST NOT merge records from another workspace, and MUST NOT write tracked files. Journal and run payloads MUST be redacted, MUST NOT contain credentials, and MUST NOT include full file contents.

#### Scenario: Two workspaces stay separate

- **WHEN** two sessions in different workspaces both have checkpoints
- **THEN** each session's view lists only its own workspace records

#### Scenario: Secret-shaped keys are redacted

- **WHEN** a tool payload contains a token, password, or authorization field
- **THEN** the journal stores a redaction marker instead of the value

### Requirement: Inert without host services

When the conversation view, slot, locale, resources, or filesystem services are unavailable, the plugin MUST register nothing it cannot serve and MUST leave the rest of the host working. It MUST NOT throw into the host boot path.

#### Scenario: Missing client services

- **WHEN** the client host does not expose the conversation view or resources service
- **THEN** no Workflows tab is registered, no error reaches the user, and the existing views keep working

#### Scenario: Missing host recorder

- **WHEN** the host cannot resolve its required services
- **THEN** the plugin stays inert, logs one bounded diagnostic, and the agent loop is unaffected

### Requirement: Bounded client data

The client SHALL receive paginated event and run summaries, must request no whole session log, and MUST bound every rendered payload. The host MUST return a `next` cursor when more data exists and MUST reject an unbounded request.

#### Scenario: Long session is paged

- **WHEN** a session has more events than one page
- **THEN** the first response contains a bounded page and a `next` cursor, and the view loads the next page on demand

#### Scenario: Oversized payload is truncated

- **WHEN** an observed event payload exceeds the configured cap
- **THEN** the journal and the client summary carry a truncation marker and the original size, not the full payload
