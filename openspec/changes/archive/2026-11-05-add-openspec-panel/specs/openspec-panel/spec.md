# Spec Delta

## Purpose

Gives a workspace's OpenSpec work a native reading surface in the DSH right sidebar: the change list,
each change's planning artifacts, and the accepted capability specs, rendered in place instead of
hunted through a file tree.

## ADDED Requirements

### Requirement: Native right-sidebar tab

The plugin SHALL contribute one tab type to the DSH right sidebar through the host's own tab registry
and SHALL let the host own the whole frame: chips, docking, split panes, floating windows, fullscreen,
close, and refresh. The panel MUST NOT ship its own window, dock, tab strip, or popup, and MUST NOT
define a colour, type size, spacing, or control where the shipped component library already provides
one.

#### Scenario: Contributed as a host tab type

- **WHEN** the Web client loads the plugin and the right-sidebar services exist
- **THEN** the panel opens like a shipped tab, with the host's chip, dock, split, fullscreen, and close

#### Scenario: Inert without the right sidebar

- **WHEN** the host provides no right-sidebar services
- **THEN** no panel is registered, no error reaches the user, and the picker command and the six skills keep working

#### Scenario: House chrome only

- **WHEN** the panel is docked, split, floated, or fullscreened
- **THEN** every frame, control, and focus ring comes from the host, not from the panel

#### Scenario: Discoverable from the Start page

- **WHEN** the right sidebar shows its Start page
- **THEN** an OpenSpec entry there opens the panel in one activation

### Requirement: Change list is the default view

Opening the panel SHALL show, without further navigation, every change `openspec list --json` reports
for the requesting session's workspace. Each row MUST state the change name, its status, its completed
and total task counts, and which artifact kinds the change already contains. Unfinished changes MUST
come before complete ones.

#### Scenario: Default view lists changes

- **WHEN** the workspace reports three changes and the panel opens
- **THEN** three rows appear with no click before them

#### Scenario: Row carries the decision facts

- **WHEN** a change has 4 of 12 tasks done and carries a proposal and a design
- **THEN** its row shows the name, the in-progress status, `4/12`, and those two artifact kinds

#### Scenario: Unfinished first

- **WHEN** the workspace reports one complete and two unfinished changes
- **THEN** the two unfinished rows come first

### Requirement: Capability inventory

A second segment of the root view SHALL list the capability specs `openspec list --specs --json`
reports for the session workspace, each with its requirement count, and choosing one SHALL render that
capability's accepted spec.

#### Scenario: Inventory available from the root view

- **WHEN** the workspace reports nineteen capability specs
- **THEN** the segment lists nineteen entries with requirement counts

#### Scenario: A capability renders

- **WHEN** the user chooses one capability
- **THEN** its spec renders in the panel as Markdown

#### Scenario: No capabilities

- **WHEN** the workspace reports no capability specs
- **THEN** the segment shows an empty state naming the next action

### Requirement: One tab per change

Choosing a change row SHALL open that change in its own right-sidebar tab titled with the change name,
and SHALL focus an already open tab for the same change instead of opening a duplicate. Two different
changes MUST be openable at the same time, including side by side in split panes.

#### Scenario: A change opens

- **WHEN** the user chooses the change `add-auth`
- **THEN** a tab titled `add-auth` opens and shows that change

#### Scenario: No duplicate tab

- **WHEN** the user chooses `add-auth` while its tab is already open
- **THEN** the existing tab is focused and no second tab appears

#### Scenario: Two changes at once

- **WHEN** the user opens a second change beside the first
- **THEN** both tabs stay open with their own artifact selection

### Requirement: Artifact tabs

A change tab SHALL offer one tab per artifact kind — proposal, design, delta specs, and tasks — and
SHALL render the selected artifact as Markdown through the shared renderer. A kind the change does not
contain MUST appear as unavailable with the reason, never as an empty document. A change with several
delta specs MUST let the user choose which capability's spec is shown. The artifact tabs MUST follow
the shipped control's keyboard behaviour.

#### Scenario: Four artifact kinds

- **WHEN** a change carries a proposal, a design, one delta spec, and tasks
- **THEN** the tab offers those four kinds and renders each as Markdown

#### Scenario: Missing artifact is explained

- **WHEN** the change has no design document
- **THEN** the design tab is shown unavailable and states that the document is not written yet

#### Scenario: Several delta specs

- **WHEN** a change carries delta specs for two capabilities
- **THEN** the user can switch between them and the count is visible

#### Scenario: Progress stays visible on the tasks artifact

- **WHEN** the tasks artifact is selected
- **THEN** the file renders as written and the change's completed and total task counts are still shown

#### Scenario: Keyboard operation

- **WHEN** focus is on the artifact tabs and the user presses Left, Right, Home, or End
- **THEN** selection moves within the tabs and only the selected tab is a tab stop

### Requirement: Read-only with one composer handoff

The panel SHALL read only. Its one write action SHALL place `/openspec-apply-change <name>` in the
composer draft without submitting, keep the composer focused, and leave the change untouched. The panel
MUST NOT archive, sync, validate, tick a task, or edit any file.

#### Scenario: Apply fills the draft

- **WHEN** the user activates the apply action on the change `add-auth`
- **THEN** the composer draft becomes `/openspec-apply-change add-auth` and no message is sent

#### Scenario: Empty state offers the next step

- **WHEN** the workspace reports no changes
- **THEN** the empty state offers a propose action that fills the composer draft without submitting

#### Scenario: Nothing else mutates

- **WHEN** the user browses changes, capabilities, and artifacts, and closes the panel
- **THEN** no workspace file changes and no OpenSpec command that writes is run

### Requirement: Workspace-scoped reads

Every panel read SHALL resolve the workspace from the session, and no request MUST carry a filesystem
path. Artifact reads MUST stay inside the session workspace's own `openspec/` root and MUST refuse a
change or capability the CLI did not report for that workspace.

#### Scenario: Sessions stay scoped

- **WHEN** two sessions live in different workspaces
- **THEN** each panel reads only its own workspace's changes, capabilities, and artifacts

#### Scenario: No path from the request

- **WHEN** a request names anything other than a reported change or capability and the session
- **THEN** the plugin reads only that session's workspace

#### Scenario: Unreported item refused

- **WHEN** a request names a change or capability the CLI does not report for that workspace
- **THEN** the plugin refuses it instead of reading a file by that name

#### Scenario: Workspace without a local root

- **WHEN** the workspace has no `openspec/` root of its own
- **THEN** the panel reports that and offers no rows

### Requirement: Designed states and recovery

Every read SHALL have a designed state: loading, empty, unavailable prerequisite, error, and success.
A failure MUST name the cause and the next action and MUST offer retry. A missing CLI, a missing local
root, a timeout, and unreadable CLI output MUST be distinguishable from one another.

#### Scenario: Loading

- **WHEN** a read has not settled
- **THEN** the panel shows a loading state in place of content, without a flash of empty content

#### Scenario: CLI absent

- **WHEN** `openspec` is not on `PATH`
- **THEN** the panel names the prerequisite and how to install it, and the six skills stay available

#### Scenario: Retry after the cause is fixed

- **WHEN** the user retries after installing the CLI or initialising the root
- **THEN** the panel loads content without being reopened

#### Scenario: Narrow panel

- **WHEN** the right sidebar is at its narrowest supported width
- **THEN** rows, tabs, and rendered Markdown remain readable without horizontal scrolling of the panel

### Requirement: Live artifact updates

An open change or capability view SHALL update its rendered artifacts and task progress when one of the
files it shows changes on disk. Updates MUST use the host's shipped file observation — never a polling
timer, a heartbeat, or a plugin-owned filesystem watcher — and MUST stop with the view.

#### Scenario: The change view observes its artifacts

- **WHEN** `proposal.md`, `design.md`, `tasks.md`, or any delta `specs/<capability>/spec.md` of an open change changes on disk
- **THEN** the shown artifact and the completed/total counts update without reopening the tab

#### Scenario: A delta spec edit updates its artifact

- **WHEN** `openspec/changes/<change>/specs/<capability>/spec.md` changes while that change is open
- **THEN** the Specs artifact shows the new body when that capability is selected

#### Scenario: A capability spec edit updates its tab

- **WHEN** `openspec/specs/<capability>/spec.md` changes while its tab is open
- **THEN** the rendered spec body updates

#### Scenario: No timer when nothing changes

- **WHEN** a view is open and no file changes
- **THEN** no polling request runs and no panel-owned watcher is open

#### Scenario: Host without file observation

- **WHEN** the host provides no file resource provider
- **THEN** the view still renders, and the native refresh and the hidden-to-visible re-read still update it

### Requirement: Last-updated fact

Each change and capability view SHALL state when the files it shows were last modified, and that
statement MUST stay consistent with the content it shows.

#### Scenario: Last updated follows the content

- **WHEN** a change or capability view renders, and later its content changes on disk
- **THEN** it states when the shown files were last modified, and that statement advances with the content

### Requirement: Bundle integration

The panel SHALL ship inside the existing `@dsh-setup/plugin-openspec` package and its single bundle
row, with no new package, row, market entry, install script, or runtime dependency. The DSH client
component library MUST be consumed as a host-provided external module. Generated setup files MUST carry
the panel, and browsing MUST add no prompt text or model tokens.

#### Scenario: One row, no new runtime dependency

- **WHEN** the repository is validated
- **THEN** the package still mounts through its single row and declares no new runtime dependency

#### Scenario: Generated setup carries the panel

- **WHEN** the setup bundle is regenerated
- **THEN** the vendored package includes the panel and `pnpm gen:check` passes

#### Scenario: No model surface

- **WHEN** the user browses changes, capabilities, and artifacts
- **THEN** no message, prompt text, or model token is produced
