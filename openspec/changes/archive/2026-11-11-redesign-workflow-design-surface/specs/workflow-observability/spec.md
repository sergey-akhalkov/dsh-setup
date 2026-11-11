# Spec Delta

## MODIFIED Requirements

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
