# Spec Delta

## MODIFIED Requirements

### Requirement: Visual canvas

The plugin SHALL provide a Design page in the right sidebar, opened from the guide card, as a workbench with a left rail, a center node canvas, and an inspector. The left rail SHALL list the installed workflows and the building blocks (trigger kinds and step executors). The page SHALL open on the canvas of the selected workflow or, when none is selected, the first installed workflow, and SHALL show a blank canvas with the rail and a start affordance when none is installed. In a panel narrower than the shipped narrow-width threshold the page SHALL open in list mode, and the canvas SHALL remain reachable there. The canvas SHALL support pan, zoom, selection, and keyboard focus, and MUST NOT be the only way to inspect or edit a definition. At a pane width of at least 980 px the inspector SHALL render beside the canvas; between the narrow threshold and that width the inspector SHALL open as an overlay drawer. A step block SHALL be addable by choosing it or by dropping it on the canvas, and a dropped step SHALL keep the drop position.

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

#### Scenario: Dropped block keeps its position

- **WHEN** the user drops a step block on the canvas
- **THEN** a new unconnected node appears at the drop position and can be connected

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

#### Scenario: Inspector follows the selection

- **WHEN** the user selects a node in the canvas at a pane width of at least 980 px
- **THEN** the node's fields render in the inspector beside the canvas without the page scrolling

#### Scenario: Inspector becomes a drawer

- **WHEN** the user selects a node in a pane between the narrow threshold and 980 px
- **THEN** the inspector opens as an overlay drawer and closes without changing the selected workflow
