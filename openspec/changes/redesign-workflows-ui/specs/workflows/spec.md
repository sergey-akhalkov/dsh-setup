# Spec Delta

## MODIFIED Requirements

### Requirement: User interface

The plugin SHALL register `/workflows` (names the Workflows tab as the session entry point and the `Workflow design` card as the editor entry point), `/workflows run <id>`, `/workflows resume <runId>`, `/workflows install <path>`, and `/workflows adopt <name>`. `run`/`resume` SHALL activate an `own` pending step by steering the root agent; a `defer` step MUST NOT steer. The session view SHALL show the session's runs, step state, evidence, and the journal, and MUST NOT show definitions, the trigger catalog, receipts, or an authoring control. The design page SHALL show the definition list, the trigger catalog, the receipts, and the editor. A display-only action MUST NOT execute a workflow.

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

- **WHEN** the user clicks a run row, a step, or a journal evaluation
- **THEN** no workflow starts and no tool is called

#### Scenario: Editor entry is the guide card

- **WHEN** the user opens the right sidebar's guide page
- **THEN** a `Workflow design` card is listed there, and picking it opens the design page with the definition list

### Requirement: Visual canvas

The plugin SHALL provide a Design page in the right sidebar, opened from the guide card, with a node canvas, a left palette of trigger and step types, a property panel, and directed edges. In a panel narrower than the shipped narrow-width threshold the page SHALL open in list mode, and the canvas SHALL remain reachable there. The canvas SHALL support pan, zoom, selection, and keyboard focus, and MUST NOT be the only way to inspect or edit a definition.

#### Scenario: Canvas renders a definition

- **WHEN** the user opens a definition in the design page's canvas mode
- **THEN** its trigger and steps render as connected nodes

#### Scenario: Palette adds a step

- **WHEN** the user chooses a step type from the palette
- **THEN** a new unconnected node appears and can be connected

#### Scenario: Canvas is not the only surface

- **WHEN** the user cannot use the canvas
- **THEN** the same definition is editable through the list and property forms

#### Scenario: Narrow panel opens the list

- **WHEN** the design page opens in a panel narrower than the shipped narrow-width threshold
- **THEN** the list surface renders first, and the canvas remains one control away

### Requirement: Fallback and inertness

When the canvas cannot render or its container is unavailable, the design page SHALL render the list and detail editor and keep definitions editable through forms. A canvas render failure MUST NOT break the session view, the design page, or the host. When the right-sidebar services are unavailable the plugin MUST register only the session view and MUST NOT attempt to register the design page.

#### Scenario: Canvas fails to render

- **WHEN** the canvas render throws or the container is unavailable
- **THEN** the list editor renders and the definition remains editable

#### Scenario: Host is unaffected

- **WHEN** the canvas fails to render
- **THEN** the host, runs, and gates keep working and no error reaches the agent loop

#### Scenario: No right sidebar

- **WHEN** the client host exposes no right-sidebar service
- **THEN** the session view still registers and no design page is attempted

### Requirement: Run provenance and history

Every workflow run SHALL record the definition id, name, and version captured at run creation, the trigger that started it, and the per-step overlay fields it observed: evidence, failure class, and violations. The run API SHALL expose those fields, the recorded trigger, and a terminal time when the run has one, SHALL filter runs by definition id, SHALL order runs newest first on request, and SHALL resolve one attributed run by id within the requesting session. The terminal time SHALL be the latest settlement time of the run's recorded steps; it MUST NOT be derived from a field that changes after completion, such as the record's last-update time, and it SHALL be absent when no step settled. The displayed run title SHALL be composed from the recorded definition name and the recorded subject when one exists (the change name, the checkpoint turn, and the task for a task review), and MUST NOT substitute a fixed suffix for them. A completed run SHALL remain readable with its recorded name and version after the definition is deleted.

#### Scenario: Per-definition latest run

- **WHEN** the editor requests the latest run for a definition
- **THEN** the API returns the newest run whose definition id matches and no other definition's run

#### Scenario: Definition changed after the run starts

- **WHEN** the definition is renamed or version-bumped while a run exists
- **THEN** the run keeps the name and version it recorded at creation

#### Scenario: Deleted definition remains readable

- **WHEN** a definition is deleted after a run completed
- **THEN** the run detail still shows its recorded name, version, step evidence, failure classes, and violations

#### Scenario: Engine run carries its trigger and end time

- **WHEN** a run created by a stored definition is projected
- **THEN** the run exposes the trigger kind that started it and, once terminal, the latest settlement time of its recorded steps as its terminal time

#### Scenario: A completed run keeps its terminal time

- **WHEN** a completed retro run later records a turn block or a violation
- **THEN** its reported terminal time and duration do not change

#### Scenario: A terminal run without a settled step omits its terminal time

- **WHEN** a terminal run has no recorded step settlement time
- **THEN** the projection omits the terminal time and the view shows no duration for it

#### Scenario: Title names the definition and subject

- **WHEN** a retro run records the definition `retro`/`Work checkpoint` and a checkpoint path for turn 6
- **THEN** its title is composed from the recorded definition name and the parsed subject `turn 6`, and no fixed `intake` suffix replaces either

#### Scenario: Run lookup is session-scoped

- **WHEN** one session looks up a run id that belongs to another session
- **THEN** the lookup returns no run and no record from the other session is exposed
