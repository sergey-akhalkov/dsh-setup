# workflow-observability Specification

## Purpose
Gives one read-only surface for the process: which triggers exist, what fired, which step is open, what evidence exists, and why a trigger did not fire, without changing how any turn runs.

## Requirements

### Requirement: Read-only workflow surface

The plugin SHALL contribute one `Workflows` view to the current conversation. The view SHALL present a workflow overview first and the session's runs second: the overview SHALL group the installed definitions by trigger kind and SHALL show the read-only trigger bindings, the session's firing counts, and each workflow's run counts; the view MUST NOT present the editor, the receipts, or any authoring control. When the right-sidebar services are available the plugin SHALL also contribute one `Workflow design` page that presents the workflow rail, the editor canvas, the building blocks, the inspector, and a secondary `Diagnostics` disclosure holding the trigger catalog and the receipts. The observability surface — the view, the workflow evaluation history, the session journal, the shadow trigger catalog, the run projection, the design page's diagnostic sections, and the read health and API — MUST NOT steer, inject context, block a tool, block a turn, or execute a workflow, and MUST write only under `.dsh/workflows/`. The same plugin MAY host the workflow engine: every engine steer, tool call, or turn refusal MUST originate from a stored definition step that is `own` (or a declared `defer` that only reads a legacy record), MUST be recorded in the run store, and MUST NOT be caused by a shadow trigger. Disabling the `dsh-setup-workflows` row removes the view, the design page, the recorder, and the engine together. The view MUST remain usable while the agent is running.

#### Scenario: A turn closes unchanged

- **WHEN** only shadow triggers are active, no owned definition has an open step for the turn, and a root turn runs and closes
- **THEN** no new steering, injection, tool decision, or turn refusal is attributable to the plugin

#### Scenario: The view is available during work

- **WHEN** the agent is running a turn in the session
- **THEN** the Workflows view opens and shows the overview and the runs already observed in that session

#### Scenario: Owned definition may refuse a close

- **WHEN** an active stored definition owns a `blockTurnClose` step for a root agent and its evidence is missing
- **THEN** the workflow engine may refuse the close, records the refusal in the run, and steers the open step

#### Scenario: Shadow trigger never acts

- **WHEN** a shadow trigger matches an event
- **THEN** no action, tool call, steer, or refusal follows, and the evaluation recorded beside that event says `would-fire`

#### Scenario: Runs lead the view

- **WHEN** the session has recorded runs and trigger evaluations
- **THEN** the workflow overview is rendered before the run list, and no editor, receipt, or authoring control appears in the session view

#### Scenario: Authoring lives on the design page

- **WHEN** the user wants to view or edit a definition, the trigger catalog, or the receipts
- **THEN** the workflow rail, the editor, and the `Diagnostics` disclosure are available on the `Workflow design` page and not in the session view

#### Scenario: Diagnostics is not the default surface

- **WHEN** the design page opens
- **THEN** the trigger catalog and the receipts are reachable from the `Diagnostics` disclosure and the default surface is the workbench

### Requirement: Shadow trigger catalog

The plugin SHALL declare triggers as data, each with an id, an event kind, a filter, and a mode (`shadow` or `active`). The observability shadow catalog SHALL support agent turn start, agent turn stop, tool result, subagent start, subagent end, and workspace file change. The workflow engine MAY additionally evaluate `turn.stopping`, `tool.pre-execute`, and `review.record`, and the optional intent trigger; the intent classifier is not a shadow event kind. A trigger with an unknown event kind, an empty id, or an invalid filter MUST fail load with a diagnostic naming the trigger and the field, and no partial catalog may be served.

#### Scenario: Catalog loads

- **WHEN** the plugin loads with the shipped trigger definitions
- **THEN** the trigger catalog on the `Workflow design` page lists each trigger with its event kind, filter summary, and last evaluation time

#### Scenario: Invalid trigger is refused

- **WHEN** a trigger has an unknown event kind, an empty id, or an invalid filter
- **THEN** plugin load fails with a diagnostic naming the trigger and the field, and no partial catalog is served

#### Scenario: Active trigger creates a run

- **WHEN** an active trigger in an owned definition matches its event
- **THEN** the engine creates one run and the evaluation beside that event names the run

### Requirement: Trigger evaluation reason

For every observed event the plugin SHALL evaluate each trigger and record `matched: true` or `matched: false` with one reason. A shadow evaluation MUST use the fixed vocabulary `would-fire` for a match and `event-mismatch`, `filter-mismatch`, `dedupe`, `disabled`, `not-ready`, or `error` for a non-match, and a matched shadow trigger MUST NOT execute an action. A workflow-engine evaluation MAY additionally record `run-created`, `run-suppressed`, and `not-applicable`; those outcomes describe an active trigger's run and never turn a shadow trigger into an action. The workflow page SHALL render every evaluation recorded for that definition (`definition:<id>`) with its event time, matched state, and reason, SHALL exclude evaluations recorded under other trigger ids, and MUST NOT duplicate an evaluation in a second table. Only an evaluation carrying a run id SHALL render a run link; a matched evaluation without a run (`would-fire`, `run-suppressed`) and `not-applicable` MUST render their recorded reason and detail without one.

#### Scenario: Matched shadow trigger records would-fire

- **WHEN** a shadow trigger matches an event
- **THEN** the evaluation says `would-fire` and no action, tool, or steer executes

#### Scenario: Filter mismatch is explained

- **WHEN** a file event for a path outside the OpenSpec change tree reaches the trigger
- **THEN** the evaluation says `filter-mismatch`, the journal names the rejected path, and the filter is shown with it

#### Scenario: Duplicate is explained

- **WHEN** the same file event is observed twice inside the debounce window
- **THEN** the second evaluation says `dedupe` and the journal adds no second row for it

#### Scenario: Active trigger records its run

- **WHEN** an active trigger in an owned definition matches an event
- **THEN** the evaluation records `run-created` and the run id, and the journal links that evaluation to the run

#### Scenario: Inapplicable trigger records not-applicable

- **WHEN** an applicability predicate rejects an active trigger for a session or turn
- **THEN** the evaluation records `not-applicable` and the engine creates no run

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

The view SHALL list the session's attributed runs newest first and MUST NOT list another session's runs. Selecting a run SHALL open a detail page showing the run's source or definition identity, trigger, start time, end time when terminal, status, each step's state and time, the decision summary, the evidence path or call id, and the record link; a back control SHALL return to the list and restore its scroll position. Selecting a workflow in the overview SHALL open a page showing the definition's description, version, risk, gate ownership, a read-only node canvas of its ordered steps with the selected run overlay, the ordered steps as a table fallback with executor and next step, its trigger binding with firing counts, its runs newest first, and its evaluation history; the evaluation history SHALL show only the evaluations recorded for that definition (`definition:<id>` entries) beside their events and SHALL exclude evaluations recorded under other trigger ids; only an evaluation carrying a run id SHALL link to the run; a back control SHALL return to the overview and restore its scroll position. The read-only canvas MUST NOT change the run, start a step, or execute a tool, and the table SHALL remain complete when the canvas cannot render. A `turn.stopping` observation is a stop attempt; a refused attempt SHALL be recorded and the turn continues. A refresh SHALL re-read the pages already loaded and resolve the open run by id; only a lookup that reports no matching run SHALL render that the run is no longer recorded. A refresh of the workflow page SHALL re-read the definition document, its runs, and its evaluation history.

#### Scenario: Workflow page renders the read-only canvas

- **WHEN** the user opens a workflow whose definition has several steps
- **THEN** the page renders the trigger and steps as connected nodes with the selected run overlay and the ordered steps as a table

#### Scenario: Read-only canvas changes nothing

- **WHEN** the user clicks a node in the workflow page's canvas
- **THEN** no step starts, no tool is called, and the run is unchanged

#### Scenario: Canvas failure falls back to the table

- **WHEN** the workflow page's canvas cannot render
- **THEN** the ordered step table still renders and the rest of the page stays usable

#### Scenario: A refused stop attempt is recorded

- **WHEN** an existing gate refuses the stop attempt and the turn continues
- **THEN** the attempt appears in the workflow page's evaluation history and no close is reported

#### Scenario: A delegate and its review stay in order

- **WHEN** the session starts a delegate and later receives the review record
- **THEN** the review run is listed before the delegate run in the newest-first runs list and the review links to the record file

#### Scenario: Evidence is inspectable

- **WHEN** the user opens a projected run
- **THEN** the detail shows the evidence path or call id that satisfied the step, not only a label

#### Scenario: Run detail replaces the list

- **WHEN** the user selects a run and then uses the back control
- **THEN** the list returns at its previous scroll position and focus returns to the selected row

#### Scenario: Journal evaluation is inline

- **WHEN** an event carries a `run-created` evaluation for the selected definition and another event carries a `would-fire` evaluation for a shadow trigger of the same kind
- **THEN** the workflow page's evaluation history shows the definition's `run-created` evaluation beside its event and links it to its run, excludes the `would-fire` evaluation recorded under the other trigger id, and shows no evaluation twice

#### Scenario: Refresh keeps the open run

- **WHEN** a run arrives after a selection opened from a later page and the view refreshes
- **THEN** the pages already loaded are re-read, the selected run is resolved by id, and it stays selected even though it no longer falls inside the re-read page window

#### Scenario: Selected run is confirmed absent

- **WHEN** the run-id lookup reports no matching attributed run
- **THEN** the detail states that the run is no longer recorded and the back control returns to the list

#### Scenario: Workflow page lists its runs

- **WHEN** a workflow has several runs in the session
- **THEN** its page lists them newest first, opening one shows the run page, and the run page's back control returns to the workflow page

#### Scenario: Back restores the overview

- **WHEN** the user opens a workflow and then uses the back control
- **THEN** the overview returns at its previous scroll position and focus returns to the selected workflow row

#### Scenario: Overview shows an unbound trigger

- **WHEN** a trigger kind has no bound workflow in the session
- **THEN** the overview lists that kind and states that no workflow is bound to it

#### Scenario: Workflow page describes the architecture

- **WHEN** the user opens a workflow whose definition has several steps
- **THEN** the page renders the ordered steps with each step's executor and next step

### Requirement: Listener health

The plugin SHALL report, for the requesting session, listener count, last observed event time, journal writability, trigger count, and the last listener error. The view SHALL show those facts on one status line whose details are available on demand, and MUST distinguish "no event yet", "trigger did not match", and "listener is down" as separate states.

#### Scenario: Disabled listener is unhealthy

- **WHEN** the event listener is disabled or throws during registration
- **THEN** the status line reports `listener-down` with the error available, and no section claims the session is quiet

#### Scenario: Quiet session is not a failure

- **WHEN** the listener is healthy but no trigger-matched event has occurred
- **THEN** the status line reports `waiting` and the workflow page's evaluation history explains the non-matches

### Requirement: Workspace scoping and privacy

The plugin SHALL read only the requesting session's workspace and MUST NOT merge observed records from another workspace. The workflow engine MAY read its host key store at `<host home>/.dsh-setup/workflows-host.key` to verify approvals, runs, and receipts even though that file is outside the workspace; the key MUST NOT be copied into journals, run records, projections, or client responses. Journal and run payloads MUST be redacted, MUST NOT contain credentials, and MUST NOT include full file contents. The observability surface MUST NOT write tracked files.

#### Scenario: Two workspaces stay separate

- **WHEN** two sessions in different workspaces both have checkpoints
- **THEN** each session's view lists only its own workspace records

#### Scenario: Secret-shaped keys are redacted

- **WHEN** a tool payload contains a token, password, or authorization field
- **THEN** the journal stores a redaction marker instead of the value

#### Scenario: Host key is not exposed

- **WHEN** the engine verifies an approval, run, or receipt
- **THEN** the host key is read from its host-owned path and never appears in the journal, a run record, the projection, or an API response

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
