# Spec Delta

## ADDED Requirements

### Requirement: Visual canvas

The plugin SHALL provide a Design mode in the Workflows view with a node canvas, a left palette of trigger and step types, a property panel, and directed edges. The canvas SHALL support pan, zoom, selection, and keyboard focus, and MUST NOT be the only way to inspect or edit a definition.

#### Scenario: Canvas renders a definition

- **WHEN** the user opens a definition in Design mode
- **THEN** its trigger and steps render as connected nodes

#### Scenario: Palette adds a step

- **WHEN** the user chooses a step type from the palette
- **THEN** a new unconnected node appears and can be connected

#### Scenario: Canvas is not the only surface

- **WHEN** the user cannot use the canvas
- **THEN** the same definition is editable through the list and property forms

### Requirement: Definition editing

The editor SHALL create, edit, duplicate, rename, delete, and version-bump local definitions, and SHALL save only after schema validation passes. A shipped definition MUST be read-only; editing one SHALL create a local copy.

#### Scenario: Save a valid definition

- **WHEN** the user saves a valid local definition
- **THEN** the host writes it and the version is current

#### Scenario: Invalid definition is refused

- **WHEN** the graph has a dangling edge, a duplicate id, or an invalid field
- **THEN** the save is refused with the node and field

#### Scenario: Shipped definition is copied

- **WHEN** the user edits a shipped definition
- **THEN** a local copy is created and the shipped asset is unchanged

### Requirement: Revision preconditions

Every definition and layout write SHALL send `expectedRevision`. A create-only save SHALL send `null`, the destination MUST NOT exist, the host SHALL create it atomically, and a collision SHALL return 409 without writing. An update or delete SHALL send the SHA-256 revision returned by the read that loaded the resource, and a mismatch SHALL return 409 with the current revision. Definition and layout revisions SHALL be independent.

#### Scenario: Create-only save

- **WHEN** the user creates a blank definition, installs a draft, or makes a copy
- **THEN** the save sends `expectedRevision: null`, writes atomically when the id is free, and returns 409 without writing when the destination exists

#### Scenario: Colliding copy id

- **WHEN** the user copies a definition to an id that already exists
- **THEN** the host returns 409, no file is written, and the editor offers the next free id

#### Scenario: Update uses the loaded revision

- **WHEN** the editor saves a definition or layout it loaded
- **THEN** it sends the revision returned by that read, and a mismatch returns 409 with the current revision

#### Scenario: Create returns the next revision

- **WHEN** a create-only save succeeds
- **THEN** the response carries the new revision and the next save sends that revision instead of `null`

#### Scenario: First layout save

- **WHEN** a definition has no layout yet
- **THEN** the layout save sends `expectedRevision: null` and does not require the definition revision

#### Scenario: Independent revisions

- **WHEN** the user saves a layout and then saves the definition
- **THEN** each write sends only its own resource's revision and neither save requires the other revision

### Requirement: Templates

The editor SHALL list the shipped templates and create a local definition from one, including the `change-intake`, `task-review`, and `retro` shapes. A template MUST be copied, not mutated.

#### Scenario: Template list

- **WHEN** the user opens the template picker
- **THEN** the shipped templates are listed with their step counts

#### Scenario: Template copy

- **WHEN** the user creates a definition from a template
- **THEN** a local copy is created and the shipped template remains unchanged

### Requirement: Layout sidecar

The editor SHALL persist node positions in `.dsh/workflows/layout/<id>.json`, separate from the definition. The engine MUST ignore layout, and a missing layout SHALL use a deterministic auto-layout.

#### Scenario: Layout survives reload

- **WHEN** the user moves a node and saves the layout
- **THEN** reopening the definition uses the saved positions

#### Scenario: Runtime ignores layout

- **WHEN** the engine loads a definition with a layout sidecar
- **THEN** the run behavior is byte-identical to the same definition without the sidecar

#### Scenario: Missing layout is auto-laid out

- **WHEN** a definition has no layout
- **THEN** the canvas renders a deterministic layout and does not write a file until the user saves

### Requirement: Run overlay

The editor SHALL select the latest run for the current definition by default and let the user choose an earlier run, overlaying each node with its recorded state, structured evidence, failure class, and violations. A run step missing from the definition SHALL be marked orphan and MUST NOT be drawn as a new node. The overlay MUST NOT change the run, start a step, or execute a tool.

#### Scenario: Latest run for the definition

- **WHEN** a run exists for the definition
- **THEN** the latest matching run is selected and each step shows its recorded state and structured evidence

#### Scenario: Failure class and violation

- **WHEN** a run records a blocked step or a violation
- **THEN** the node shows the failure class and the violation

#### Scenario: Another run is selected

- **WHEN** the user chooses an earlier run
- **THEN** the overlay shows that run and the latest run is unchanged; only that definition's runs are offered

#### Scenario: Orphan step

- **WHEN** the run has a step the definition no longer has
- **THEN** the step is marked orphan and no node is invented

#### Scenario: Overlay is read-only

- **WHEN** the user clicks a node in the overlay
- **THEN** the property panel opens and no tool, step, or run is started

### Requirement: Run provenance and history

Every workflow run SHALL record the definition id, name, and version captured at run creation, and the per-step overlay fields it observed: evidence, failure class, and violations. The run API SHALL expose those fields and SHALL filter runs by definition id. A completed run SHALL remain readable with its recorded name and version after the definition is deleted.

#### Scenario: Per-definition latest run

- **WHEN** the editor requests the latest run for a definition
- **THEN** the API returns the newest run whose definition id matches and no other definition's run

#### Scenario: Definition changed after the run starts

- **WHEN** the definition is renamed or version-bumped while a run exists
- **THEN** the run keeps the name and version it recorded at creation

#### Scenario: Deleted definition remains readable

- **WHEN** a definition is deleted after a run completed
- **THEN** the run detail still shows its recorded name, version, step evidence, failure classes, and violations

### Requirement: Accessibility

The editor SHALL support keyboard-only creation and connection, visible focus, accessible names, and a list-based fallback for every canvas operation. A drag-only interaction MUST have a non-drag equivalent.

#### Scenario: Keyboard adds a step

- **WHEN** the user adds a step from the palette with the keyboard
- **THEN** the node appears and can be connected without a pointer

#### Scenario: Focus is visible

- **WHEN** the user tabs through the canvas and property panel
- **THEN** the focused node or control has a visible focus indicator

#### Scenario: List fallback edits

- **WHEN** the user uses the list view
- **THEN** every step field and edge is editable without the canvas

### Requirement: Fallback and inertness

When the canvas cannot render or its container is unavailable, the view SHALL render the list and detail editor and keep definitions editable through forms. A canvas render failure MUST NOT break the Workflows view or the host.

#### Scenario: Canvas fails to render

- **WHEN** the canvas render throws or the container is unavailable
- **THEN** the list editor renders and the definition remains editable

#### Scenario: Host is unaffected

- **WHEN** the canvas fails to render
- **THEN** the host, runs, and gates keep working and no error reaches the agent loop

### Requirement: Editor trust boundary

The editor MUST NOT execute definition code, MUST use JSONLogic for conditions, MUST keep definitions and layout workspace-local, and MUST NOT write an active definition from a model draft without a user confirmation. The host SHALL validate every write.

#### Scenario: No code execution

- **WHEN** a definition contains a condition
- **THEN** it is stored and evaluated as JSONLogic, never executed as code

#### Scenario: Model draft needs confirmation

- **WHEN** a model-written draft is opened in the editor
- **THEN** installing it requires an explicit user save and a create-only write, and the shipped template is not overwritten

#### Scenario: Path is refused

- **WHEN** a write targets a path outside `.dsh/workflows/` or another workspace
- **THEN** the host refuses it and keeps the existing file unchanged
