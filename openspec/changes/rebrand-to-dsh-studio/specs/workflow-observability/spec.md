# Spec Delta

## MODIFIED Requirements

### Requirement: Read-only workflow surface

The plugin SHALL contribute one `Workflows` view to the current conversation. The view SHALL present a workflow overview first and the session's runs second: the overview SHALL group the installed definitions by trigger kind and SHALL show the read-only trigger bindings, the session's firing counts, and each workflow's run counts; the view MUST NOT present the editor, the receipts, or any authoring control. When the right-sidebar services are available the plugin SHALL also contribute one `Workflow design` page that presents the workflow rail, the editor canvas, the building blocks, the inspector, and a secondary `Diagnostics` disclosure holding the trigger catalog and the receipts. The observability surface — the view, the workflow evaluation history, the session journal, the shadow trigger catalog, the run projection, the design page's diagnostic sections, and the read health and API — MUST NOT steer, inject context, block a tool, block a turn, or execute a workflow, and MUST write only under `.dsh/workflows/`. The same plugin MAY host the workflow engine: every engine steer, tool call, or turn refusal MUST originate from a stored definition step that is `own` (or a declared `defer` that only reads a legacy record), MUST be recorded in the run store, and MUST NOT be caused by a shadow trigger. Disabling the `dsh-studio-workflows` row removes the view, the design page, the recorder, and the engine together. The view MUST remain usable while the agent is running.

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
