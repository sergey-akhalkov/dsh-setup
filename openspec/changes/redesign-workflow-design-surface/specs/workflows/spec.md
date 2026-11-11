# Spec Delta

## ADDED Requirements

### Requirement: Workflow description

A workflow definition MAY carry an optional human-readable `description` of at most 500 characters. The description SHALL be definition data, SHALL pass the same closed-schema validation as every other field, and MUST NOT change the trigger, steps, or evidence. The editor SHALL let the user edit it, and the workflow list, the inspector, and the session workflow page SHALL show it; a definition without one SHALL show an explicit empty state rather than borrowed text.

#### Scenario: Description is shown

- **WHEN** a definition carries a description
- **THEN** the workflow list, the inspector, and the session workflow page show it, and the graph and runs are unchanged

#### Scenario: Description is optional

- **WHEN** a definition has no description
- **THEN** it loads and runs unchanged and the surfaces show the documented empty state

#### Scenario: Description is bounded and validated

- **WHEN** a description is longer than the bound or is not a string
- **THEN** the definition fails validation with the definition and the field

#### Scenario: Description is data only

- **WHEN** a description contains JSON, a command, or a path
- **THEN** it is stored and displayed as text and MUST NOT be executed or used as evidence

## MODIFIED Requirements

### Requirement: Visual canvas

The plugin SHALL provide a Design page in the right sidebar, opened from the guide card, as a workbench with a left rail, a center node canvas, and an inspector. The left rail SHALL list the installed workflows and the building blocks (trigger kinds and step executors). The page SHALL open on the canvas of the selected workflow or, when none is selected, the first installed workflow, and SHALL show a blank canvas with the rail and a start affordance when none is installed. In a panel narrower than the shipped narrow-width threshold the page SHALL open in list mode, and the canvas SHALL remain reachable there. The canvas SHALL support pan, zoom, selection, and keyboard focus, and MUST NOT be the only way to inspect or edit a definition.

#### Scenario: Canvas renders a definition

- **WHEN** the user opens a definition in the design page's canvas mode
- **THEN** its trigger and steps render as connected nodes

#### Scenario: Workbench opens on the canvas

- **WHEN** the design page opens and an installed workflow is selected or none is selected
- **THEN** the selected workflow, or the first installed workflow when none is selected, renders as connected nodes and the left rail lists the installed workflows and the building blocks

#### Scenario: Empty workbench

- **WHEN** the design page opens and no workflow is selected or installed
- **THEN** a blank canvas with the left rail and a start affordance renders, and the page does not fall back to a read-only definition table

#### Scenario: Palette adds a step

- **WHEN** the user chooses a step type from the building blocks
- **THEN** a new unconnected node appears and can be connected

#### Scenario: Trigger block sets the trigger

- **WHEN** the user chooses a trigger kind from the building blocks
- **THEN** the workflow trigger changes and no step is added

#### Scenario: Workflow rail replaces the canvas

- **WHEN** the user chooses another workflow from the left rail
- **THEN** the canvas shows that definition's trigger and steps without leaving the design page

#### Scenario: Canvas is not the only surface

- **WHEN** the user cannot use the canvas
- **THEN** the same definition is editable through the list and property forms

#### Scenario: Narrow panel opens the list

- **WHEN** the design page opens in a panel narrower than the shipped narrow-width threshold
- **THEN** the list surface renders first, and the canvas remains one control away

### Requirement: User interface

The plugin SHALL register `/workflows` (names the Workflows tab as the session entry point and the `Workflow design` card as the editor entry point), `/workflows run <id>`, `/workflows resume <runId>`, `/workflows install <path>`, and `/workflows adopt <name>`. `run`/`resume` SHALL activate an `own` pending step by steering the root agent; a `defer` step MUST NOT steer. The session view SHALL present two segments in this order: a `Workflows` overview and the session's `Runs`. The overview SHALL group the installed definitions by their trigger kind and SHALL show each trigger's bound workflows, the session's firing counts summed across the bound definitions' own evaluations, and each workflow's run counts; selecting a workflow SHALL open its page. The runs segment SHALL list every run of the session. The session view MUST NOT present the editor, the receipts, or an authoring control. The design page SHALL present the workflow rail, the editor canvas, the building blocks, the inspector, and a secondary `Diagnostics` disclosure that holds the trigger catalog and the receipts; it MUST NOT open on a read-only definition list and MUST NOT duplicate the workflow list as a table. A display-only action MUST NOT execute a workflow.

#### Scenario: Command names the tab

- **WHEN** the user runs `/workflows`
- **THEN** the response identifies the Workflows tab as the session entry and the `Workflow design` card as the editor entry, and no client view opens from the command

#### Scenario: Resume command continues a run

- **WHEN** the user runs `/workflows resume <runId>` for an interrupted run and the pending step is `own`
- **THEN** the run continues at its pending step and no new run starts

#### Scenario: Deferred step is not steered

- **WHEN** the user runs `/workflows resume <runId>` for an interrupted intake whose pending step is the deferred spec-review
- **THEN** the command does not steer, the step awaits the legacy record, and only the legacy spec-review gate steers

#### Scenario: Install command is user-started

- **WHEN** the user runs `/workflows install <path>`
- **THEN** the definition installation starts only after the user confirms

#### Scenario: Adoption command is user-started

- **WHEN** the user runs `/workflows adopt auth`
- **THEN** the adoption verification starts for `auth` and no change directory is created

#### Scenario: Run detail is visible

- **WHEN** the user opens a run
- **THEN** its detail page shows the step state, evidence, and failure class, and a back control returns to the run list

#### Scenario: Display does not execute

- **WHEN** the user clicks a workflow row, a run row, a step, or an evaluation
- **THEN** no workflow starts and no tool is called

#### Scenario: Editor entry is the guide card

- **WHEN** the user opens the right sidebar's guide page
- **THEN** a `Workflow design` card is listed there, and picking it opens the design page on the workbench: the selected workflow, or the first installed workflow when none is selected, or a blank canvas with the rail when none is installed

#### Scenario: Diagnostics is secondary

- **WHEN** the design page opens
- **THEN** the trigger catalog and the receipts are not on the default surface and are reachable from the `Diagnostics` disclosure

#### Scenario: Overview groups workflows by trigger

- **WHEN** the session view opens on the `Workflows` segment
- **THEN** the installed definitions are grouped under their trigger kinds and each group lists the workflows bound to that trigger

#### Scenario: Overview counts firings and outcomes

- **WHEN** the bound workflows' definitions have evaluated several events and the workflows have recorded runs
- **THEN** the overview shows the group's firing count as the sum of its workflows' matched/total evaluation counts and, for each workflow, its completed/total runs with separate failed and running counts

#### Scenario: Workflow page opens from the overview

- **WHEN** the user selects a workflow row
- **THEN** its page shows the definition's description, a read-only node canvas of its ordered steps with the selected run overlay, the ordered steps as a table fallback, its trigger binding, its runs, and its evaluation history, and a back control returns to the overview

#### Scenario: Runs segment lists every run

- **WHEN** the user selects the `Runs` segment
- **THEN** every run of the session is listed newest first
