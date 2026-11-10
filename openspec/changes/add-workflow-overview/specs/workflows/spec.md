# workflows Delta

## MODIFIED Requirements

### Requirement: User interface

The plugin SHALL register `/workflows` (names the Workflows tab as the session entry point and the `Workflow design` card as the editor entry point), `/workflows run <id>`, `/workflows resume <runId>`, `/workflows install <path>`, and `/workflows adopt <name>`. `run`/`resume` SHALL activate an `own` pending step by steering the root agent; a `defer` step MUST NOT steer. The session view SHALL present two segments in this order: a `Workflows` overview and the session's `Runs`. The overview SHALL group the installed definitions by their trigger kind and SHALL show each trigger's bound workflows, the session's firing counts summed across the bound definitions' own evaluations, and each workflow's run counts; selecting a workflow SHALL open its page. The runs segment SHALL list every run of the session. The session view MUST NOT present the editor, the receipts, or an authoring control. The design page SHALL show the definition list, the trigger catalog, the receipts, and the editor. A display-only action MUST NOT execute a workflow.

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
- **THEN** a `Workflow design` card is listed there, and picking it opens the design page with the definition list

#### Scenario: Overview groups workflows by trigger

- **WHEN** the session view opens on the `Workflows` segment
- **THEN** the installed definitions are grouped under their trigger kinds and each group lists the workflows bound to that trigger

#### Scenario: Overview counts firings and outcomes

- **WHEN** the bound workflows' definitions have evaluated several events and the workflows have recorded runs
- **THEN** the overview shows the group's firing count as the sum of its workflows' matched/total evaluation counts and, for each workflow, its completed/total runs with separate failed and running counts

#### Scenario: Workflow page opens from the overview

- **WHEN** the user selects a workflow row
- **THEN** its page shows the definition's description, its ordered steps, its trigger binding, its runs, and its evaluation history, and a back control returns to the overview

#### Scenario: Runs segment lists every run

- **WHEN** the user selects the `Runs` segment
- **THEN** every run of the session is listed newest first
