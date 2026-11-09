# Spec Delta

## MODIFIED Requirements

### Requirement: Read-only workflow surface

The plugin SHALL contribute one `Workflows` view to the current conversation. The observability surface — the view, the session journal, the shadow trigger catalog, the run projection, and the read health and API — MUST NOT steer, inject context, block a tool, block a turn, or execute a workflow, and MUST write only under `.dsh/workflows/`. The same plugin MAY host the workflow engine: every engine steer, tool call, or turn refusal MUST originate from a stored definition step that is `own` (or a declared `defer` that only reads a legacy record), MUST be recorded in the run store, and MUST NOT be caused by a shadow trigger. Disabling the `dsh-setup-workflows` row removes the view, the recorder, and the engine together. The view MUST remain usable while the agent is running.

#### Scenario: A turn closes unchanged

- **WHEN** only shadow triggers are active, no owned definition has an open step for the turn, and a root turn runs and closes
- **THEN** no new steering, injection, tool decision, or turn refusal is attributable to the plugin

#### Scenario: The view is available during work

- **WHEN** the agent is running a turn in the session
- **THEN** the Workflows view opens and shows the events already observed in that session

#### Scenario: Owned definition may refuse a close

- **WHEN** an active stored definition owns a `blockTurnClose` step for a root agent and its evidence is missing
- **THEN** the workflow engine may refuse the close, records the refusal in the run, and steers the open step

#### Scenario: Shadow trigger never acts

- **WHEN** a shadow trigger matches an event
- **THEN** no action, tool call, steer, or refusal follows, and the Why-not row records `would-fire`
### Requirement: Shadow trigger catalog

The plugin SHALL declare triggers as data, each with an id, an event kind, a filter, and a mode (`shadow` or `active`). The observability shadow catalog SHALL support agent turn start, agent turn stop, tool result, subagent start, subagent end, and workspace file change. The workflow engine MAY additionally evaluate `turn.stopping`, `tool.pre-execute`, and `review.record`, and the optional intent trigger; the intent classifier is not a shadow event kind. A trigger with an unknown event kind, an empty id, or an invalid filter MUST fail load with a diagnostic naming the trigger and the field, and no partial catalog may be served.

#### Scenario: Catalog loads

- **WHEN** the plugin loads with the shipped trigger definitions
- **THEN** the Triggers section lists each trigger with its event kind, filter summary, and last evaluation time

#### Scenario: Invalid trigger is refused

- **WHEN** a trigger has an unknown event kind, an empty id, or an invalid filter
- **THEN** plugin load fails with a diagnostic naming the trigger and the field, and no partial catalog is served

#### Scenario: Active trigger creates a run

- **WHEN** an active trigger in an owned definition matches its event
- **THEN** the engine creates one run and the Why-not table names the run
### Requirement: Trigger evaluation reason

For every observed event the plugin SHALL evaluate each trigger and record `matched: true` or `matched: false` with one reason. A shadow evaluation MUST use the fixed vocabulary `would-fire` for a match and `event-mismatch`, `filter-mismatch`, `dedupe`, `disabled`, `not-ready`, or `error` for a non-match, and a matched shadow trigger MUST NOT execute an action. A workflow-engine evaluation MAY additionally record `run-created`, `run-suppressed`, and `not-applicable` in the same Why-not table; those outcomes describe an active trigger’s run and never turn a shadow trigger into an action.

#### Scenario: Matched shadow trigger records would-fire

- **WHEN** a shadow trigger matches an event
- **THEN** the evaluation says `would-fire` and no action, tool, or steer executes

#### Scenario: Filter mismatch is explained

- **WHEN** a file event for a path outside the OpenSpec change tree reaches the trigger
- **THEN** the Why-not entry says `filter-mismatch` and names the rejected path and the filter

#### Scenario: Duplicate is explained

- **WHEN** the same file event is observed twice inside the debounce window
- **THEN** the second evaluation says `dedupe` and does not add a second timeline row

#### Scenario: Active trigger records its run

- **WHEN** an active trigger in an owned definition matches an event
- **THEN** the row records `run-created` and the run id

#### Scenario: Inapplicable trigger records not-applicable

- **WHEN** an applicability predicate rejects an active trigger for a session or turn
- **THEN** the row records `not-applicable` and the engine creates no run

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
