# openspec-panel Specification

## Purpose
Gives a workspace's OpenSpec work a native reading surface in the DSH right sidebar: the change list,
each change's planning artifacts, and the accepted capability specs, rendered in place instead of
hunted through a file tree.

## Requirements

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

Opening the panel SHALL show the root view for the requesting session's workspace without further
navigation: a workspace header with Explore and Propose actions and counted Changes, Specs and Archive
segments, with Changes selected on the first open. The Changes segment SHALL list every active change
`openspec list` reports, unfinished changes before complete ones.

#### Scenario: Default view lists changes

- **WHEN** the workspace reports three active changes and the panel opens
- **THEN** three rows appear in the Changes segment with no click before them

#### Scenario: Header offers the next step

- **WHEN** the root view renders
- **THEN** the header shows Explore and Propose actions beside the workspace summary, and each one fills the composer draft without submitting

#### Scenario: Row carries the decision facts

- **WHEN** an active change has 4 of 12 tasks done and carries a proposal and a design
- **THEN** its row shows the name, the in-progress status, the task progress bar with `4/12`, the artifact facts, a one-line purpose, when it was last modified, and its last commit when available

#### Scenario: Unfinished first

- **WHEN** the workspace reports one complete and two unfinished changes
- **THEN** the two unfinished rows come first

#### Scenario: Empty change list still answers

- **WHEN** the workspace reports no active changes
- **THEN** the segment shows the workspace's archived-change and capability totals, both next-step actions, and the three most recently archived changes

#### Scenario: Counted segments

- **WHEN** the workspace reports two active changes, nineteen capabilities and thirty-four archived changes
- **THEN** the segments read Changes 2, Specs 19 and Archive 34

#### Scenario: Totals arrive with the first list

- **WHEN** the panel opens on Changes and Specs has never been opened
- **THEN** all three segment counts and the workspace summary are visible without first opening Specs

### Requirement: Capability inventory

A Specs segment of the root view SHALL list the capability specs `openspec list --specs` reports for
the session workspace, each with its requirement count, and choosing one SHALL render that capability's
accepted spec.

#### Scenario: Inventory available from the root view

- **WHEN** the workspace reports nineteen capability specs
- **THEN** the segment lists nineteen entries with requirement counts

#### Scenario: A capability renders

- **WHEN** the user chooses one capability
- **THEN** its accepted spec renders in a capability tab

#### Scenario: No capabilities

- **WHEN** the workspace reports no capability specs
- **THEN** the segment shows an empty state naming the next action

#### Scenario: Rows state purpose and provenance

- **WHEN** a capability row renders and an archived change last touched that capability
- **THEN** the row shows the capability name, its purpose in one line, its requirement count, the archived change name with its archive date and task completion, and the spec file's last commit when available

#### Scenario: Inventory is filterable

- **WHEN** the user types into the Specs filter
- **THEN** only capabilities whose name or purpose contains the text remain, and an empty match states that

### Requirement: One tab per change

Choosing a change row SHALL open that change in its own right-sidebar tab titled with the change name,
and SHALL focus an already open tab for the same change instead of opening a duplicate. Two different
changes MUST be openable at the same time, including side by side in split panes. An archived change
SHALL open the same way from the Archive segment or a capability's History.

#### Scenario: A change opens

- **WHEN** the user chooses the change `add-auth`
- **THEN** a tab titled `add-auth` opens and shows that change

#### Scenario: No duplicate tab

- **WHEN** the user chooses `add-auth` while its tab is already open
- **THEN** the existing tab is focused and no second tab appears

#### Scenario: Two changes at once

- **WHEN** the user opens a second change beside the first
- **THEN** both tabs stay open with their own artifact selection

#### Scenario: An archived change opens

- **WHEN** the user chooses `2026-10-27-add-admin-indicator` from Archive or from a capability's History
- **THEN** one tab titled with that archived name opens read-only, and choosing it again focuses that tab

#### Scenario: Same name in both places

- **WHEN** an active change and an archived change report the same name
- **THEN** each opens its own tab with its own content and neither focuses the other

### Requirement: Artifact tabs

A change tab SHALL offer one tab per artifact kind — proposal, design, delta specs, and tasks — and
SHALL render the selected artifact in its readable form. A kind the change does not contain MUST appear
as unavailable with the reason, never as an empty document. A change with several delta specs MUST let
the user choose which capability's spec is shown. The artifact tabs MUST follow the shipped control's
keyboard behaviour.

#### Scenario: Four artifact kinds

- **WHEN** a change carries a proposal, a design, one delta spec, and tasks
- **THEN** the tab offers those four kinds and renders each in its readable form

#### Scenario: Missing artifact is explained

- **WHEN** the change has no design document
- **THEN** the design tab is shown unavailable and states that the document is not written yet

#### Scenario: Several delta specs

- **WHEN** a change carries delta specs for two capabilities
- **THEN** the user can switch between them and the count is visible

#### Scenario: Progress stays visible on the tasks artifact

- **WHEN** the tasks artifact is selected
- **THEN** the grouped checklist renders while the change's completed and total task counts and progress bar stay visible

#### Scenario: Keyboard operation

- **WHEN** focus is on the artifact tabs and the user presses Left, Right, Home, or End
- **THEN** selection moves within the tabs and only the selected tab is a tab stop

#### Scenario: Delta maps to the accepted capability

- **WHEN** a delta spec for `openspec-panel` renders and that capability is accepted
- **THEN** the delta carries its `ADDED`, `MODIFIED`, `REMOVED`, or `RENAMED` operation and an action that opens the accepted `openspec-panel` capability tab

#### Scenario: Renamed delta keeps its pair

- **WHEN** a delta renames a requirement from `Old name` to `New name` in a file that also carries added requirements
- **THEN** the delta shows the `RENAMED` operation with both names as a from/to pair and still renders the other requirements

### Requirement: Read-only with one composer handoff

The panel SHALL read only, with one exception: the `Archive` action on a completed change is an
authorized write that archives that change after the Host verifies the user-clicked authorization and
the change's artifacts and current whole-spec PASS; the click is the final authorization, and the
agent's archive command keeps the archive gate. Every other outward action SHALL place a command draft in the composer without
submitting: `/openspec-apply-change <name>` for a change that is not complete, `/openspec-explore `
for exploration, and `/openspec-propose ` for a new proposal. The panel MUST NOT sync, validate, tick
a task, edit any file, or archive a change that is not complete.

#### Scenario: Apply fills the draft

- **WHEN** the user activates the apply action on a change that is not complete, named `add-auth`
- **THEN** the composer draft becomes `/openspec-apply-change add-auth` and no message is sent

#### Scenario: Explore fills the draft

- **WHEN** the user activates Explore
- **THEN** the composer draft becomes `/openspec-explore ` and no message is sent

#### Scenario: Propose fills the draft

- **WHEN** the user activates Propose, including from the empty change list
- **THEN** the composer draft becomes `/openspec-propose ` and no message is sent

#### Scenario: Empty state offers the next step

- **WHEN** the workspace reports no changes
- **THEN** the empty state offers the Explore and Propose actions, both of which fill their composer draft without submitting

#### Scenario: Nothing else mutates

- **WHEN** the user browses changes, archived changes, capabilities, and history, and closes the panel
- **THEN** no workspace file changes and no OpenSpec command that writes is run

### Requirement: Workspace-scoped reads

Every panel read SHALL resolve the workspace from the session, and no request MUST carry a filesystem
path. Artifact reads MUST stay inside the session workspace's own `openspec/` root and MUST refuse an
active or archived change, a capability, or a history entry the CLI did not report for that workspace.

#### Scenario: Sessions stay scoped

- **WHEN** two sessions live in different workspaces
- **THEN** each panel reads only its own workspace's changes, archived changes, capabilities, and history

#### Scenario: No path from the request

- **WHEN** a request names anything other than a reported change, archived change, or capability and the session
- **THEN** the plugin reads only that session's workspace

#### Scenario: Unreported item refused

- **WHEN** a request names a change or capability the CLI does not report for that workspace
- **THEN** the plugin refuses it instead of reading a file by that name

#### Scenario: Archived and history reads stay inside the root

- **WHEN** the panel reads an archived change or scans archived delta specs for a capability's history
- **THEN** every resolved path stays under the workspace's own `openspec/` root and a symlink escape is refused

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

### Requirement: Remembered root segment

After the user views a root segment other than Changes, leaving a change or capability tab and
returning to the OpenSpec root SHALL restore that segment for the same session. A first open in a
fresh session SHALL start on Changes.

#### Scenario: Return from a capability restores Specs

- **WHEN** the user opens a capability from Specs and then returns to the OpenSpec root
- **THEN** the Specs segment is shown, not Changes

#### Scenario: Return from an archived change restores Archive

- **WHEN** the user opens an archived change from Archive and then returns to the OpenSpec root
- **THEN** the Archive segment is shown, not Changes

#### Scenario: Fresh session starts on Changes

- **WHEN** the panel opens in a session that has not viewed the panel
- **THEN** the Changes segment is selected

### Requirement: Change status, summary, and provenance

Each change row and change header SHALL state a derived status — planning, ready to apply, applying,
complete, or archived — a task progress bar with completed and total counts, a one-line purpose taken
from the proposal's Why, the last-modified time, and the last commit when available.

#### Scenario: Planning change

- **WHEN** a change has a proposal but no tasks
- **THEN** its status reads planning in the attention tone and its progress states that tasks are not written yet

#### Scenario: Ready to apply

- **WHEN** a change has tasks and none is done
- **THEN** its status reads ready to apply in the informational tone and its progress bar is empty

#### Scenario: Applying

- **WHEN** a change has 4 of 12 tasks done
- **THEN** its status reads applying and its progress bar shows one third, with `4/12` as text

#### Scenario: Complete and archived

- **WHEN** a change has all tasks done, and separately when it is archived
- **THEN** the complete status uses the success tone and the archived status uses the neutral archived treatment with its archive date

#### Scenario: Narrow panel keeps the facts

- **WHEN** the row renders at the narrowest supported width
- **THEN** the status, progress, purpose and provenance wrap without horizontal scrolling

### Requirement: Archived changes are browsable

The Archive segment SHALL list archived changes newest first with archive date, task completion, a
one-line purpose, and the last commit when available, SHALL offer a text filter, and SHALL open an
archived change in its own read-only tab. A workspace with no archived changes MUST show an empty
state.

#### Scenario: Archive lists closed work

- **WHEN** the workspace reports thirty-four archived changes
- **THEN** the segment lists them newest first with date, task completion, purpose and commit

#### Scenario: Archive is filterable

- **WHEN** the user types into the Archive filter
- **THEN** only changes whose name or purpose contains the text remain

#### Scenario: Archived change opens read-only

- **WHEN** the user chooses an archived change
- **THEN** its proposal, design, delta specs and tasks are readable and no action edits or reopens it

#### Scenario: Empty archive

- **WHEN** the workspace reports no archived changes
- **THEN** the segment explains that archiving a completed change makes it appear there

### Requirement: Specification history

A capability view SHALL offer a History tab listing, newest first, every archived change whose delta
specs include that capability, each row stating the archive date, the change's task completion and its
last commit. Choosing a row SHALL open that archived change in its own tab. A capability with no
archived producer MUST show an empty history state naming that.

#### Scenario: History lists producing changes

- **WHEN** three archived changes carried a delta spec for `admin-indicator`
- **THEN** History lists those three newest first with date, `5/5` tasks, and commit

#### Scenario: History row opens the change

- **WHEN** the user chooses the `2026-10-27-add-admin-indicator` history row
- **THEN** that archived change opens in its own tab with its proposal, design, delta spec and tasks

#### Scenario: No history

- **WHEN** a capability was synced without an archived change
- **THEN** History states that no archived change produced it

### Requirement: Structured requirement rendering

Capability and delta requirement lists SHALL render one card per requirement from the CLI's structured
requirement data, with the requirement name, its text with `SHALL` and `MUST` visually marked, and one
labelled block per scenario with its `WHEN` and `THEN` steps marked. Inline code MUST remain code. A
specification with more than twelve requirements SHALL offer a text filter.

#### Scenario: One card per requirement

- **WHEN** a capability reports ten requirements
- **THEN** ten separated cards render, each headed by its requirement name

#### Scenario: Normative keywords stand out

- **WHEN** a requirement text contains `SHALL`, `MUST`, or `MUST NOT`
- **THEN** those words are visually marked without changing their text or meaning

#### Scenario: Scenario steps are labelled

- **WHEN** a requirement carries a scenario written as WHEN/THEN bullets
- **THEN** the scenario renders as one block with its conditions and outcomes distinctly marked

#### Scenario: Inline code survives

- **WHEN** requirement text contains backticked code such as `administrator`
- **THEN** the code renders as code, not as literal backticks

#### Scenario: Long specifications can be filtered

- **WHEN** a specification has more than twelve requirements
- **THEN** a filter narrows the cards by requirement name or text and states when nothing matches

### Requirement: Task checklist rendering

The Tasks artifact of an active or archived change SHALL render a checklist grouped by the tasks
file's sections, marking done and pending tasks, with per-group completed and total counts and the
overall progress, instead of the raw Markdown file.

#### Scenario: Tasks are grouped

- **WHEN** `tasks.md` has three sections of tasks
- **THEN** the checklist renders three labelled groups with their tasks

#### Scenario: Group progress

- **WHEN** the second group has three of four tasks done
- **THEN** that group's header states `3/4` and marks the pending task as not done

#### Scenario: Counts match the CLI

- **WHEN** a tasks file contains `* [x] done`, `1. [ ] pending`, and `- [X] also done`
- **THEN** the checklist marks exactly two of three tasks done and the overall progress says `2/3`, matching `openspec list`

#### Scenario: No tasks written

- **WHEN** the change has no tasks file
- **THEN** the Tasks tab states that tasks are not written yet

### Requirement: Commit provenance facts

For a change directory or a capability spec file the panel SHALL show the last commit's short hash,
date, and subject when the workspace is a git repository and git is available. When git or the
repository is absent the panel MUST omit commit facts and keep every other view working; it MUST NOT
block a read on git.

#### Scenario: Commit facts appear

- **WHEN** a capability spec file was last changed in commit `7e87448`
- **THEN** its row and detail state `7e87448`, the commit date, and the subject on demand

#### Scenario: No repository

- **WHEN** the workspace is not a git repository
- **THEN** rows and details render without commit facts and no error is shown

#### Scenario: Git is unavailable

- **WHEN** git is not installed or the git call fails
- **THEN** the panel renders the same rows and details without commit facts

### Requirement: Visual hierarchy and theme conformance

The panel SHALL separate content into visually distinct tiers using the shipped primitives and design
tokens: a page title, grouped section labels, a card surface with a hairline edge for each change and
requirement, semantic status colours, a progress bar for task completion, and supporting icons for
status, commit, and actions. It MUST NOT introduce a literal colour, font size, or spacing value where
a design token exists, and every interactive row MUST keep the host focus ring.

#### Scenario: Status colours carry meaning

- **WHEN** a status renders as planning, ready, applying, complete, or archived
- **THEN** its colour comes from the matching semantic tag tone and the same status always uses the same tone

#### Scenario: Cards separate dense content

- **WHEN** a change list, requirement list, or task list renders
- **THEN** each item is a separate hairline card with its own padding and a heading tier above its supporting facts

#### Scenario: Narrow width stays readable

- **WHEN** the right sidebar is at its narrowest supported width
- **THEN** a card, its metadata and its controls stay inside the panel without horizontal scrolling

#### Scenario: Theme changes adapt

- **WHEN** the host switches between light and dark appearance
- **THEN** every panel surface, label, edge, and status colour follows the theme without a panel-specific colour value

#### Scenario: Keyboard focus stays visible

- **WHEN** the user reaches a row or action by keyboard
- **THEN** the host focus ring is visible and the row activates with Enter or Space

### Requirement: Live change list

The root view's Changes segment SHALL re-read the change list when a file shown by any active row it
renders changes on disk: the row's proposal, design, tasks file, or any delta spec. Archived rows SHALL
NOT be observed. Updates MUST use the host's shipped file observation — never a polling timer, a
heartbeat, or a plugin-owned filesystem watcher — and MUST stop when the segment is left or the body
unmounts.

#### Scenario: The change list observes its rows

- **WHEN** `proposal.md`, `design.md`, `tasks.md`, or any delta `specs/<capability>/spec.md` of an active change changes on disk while the Changes segment is shown
- **THEN** that row's status, completed and total task counts, purpose, requirement count, and last-modified fact update without reopening the tab

#### Scenario: A delta spec edit reaches its row

- **WHEN** a delta spec of an active change changes while the Changes segment is shown
- **THEN** the row's delta and requirement facts update after one debounced re-read of the list

#### Scenario: Archived rows are not observed

- **WHEN** any file of an archived change changes on disk
- **THEN** the Changes segment opens no watch for that row and schedules no re-read from it

#### Scenario: An archived change leaves the list

- **WHEN** an active change is moved into the archive
- **THEN** the next re-read no longer shows it in the Changes segment

#### Scenario: A new change needs a refresh

- **WHEN** a change is created while the Changes segment is shown
- **THEN** it appears after the native refresh or a hidden-to-visible re-read, not from file observation alone

#### Scenario: No timer while the list is idle

- **WHEN** the Changes segment is open and no observed file changes
- **THEN** no polling request runs and no panel-owned watcher is open

#### Scenario: Host without file observation

- **WHEN** the host provides no file resource provider
- **THEN** the list still renders, and the native refresh and the hidden-to-visible re-read still update it

### Requirement: Change-card actions

A change card in the `Changes` list and the change detail header SHALL offer one state-dependent action: `Apply change` while the change is not complete, and `Archive` when every task is done. `Apply change` SHALL only fill the `/openspec-apply-change <name>` draft. `Archive` SHALL be the user's authorization: one archive request, a busy state cleared after success or refusal, and the Host-reported archived address opened only when one exists. The card action MUST NOT open the card.

#### Scenario: Apply on a non-complete change fills the draft

- **WHEN** an active change has 4 of 12 tasks done and the user activates its action
- **THEN** the action reads `Apply change`, the composer draft becomes `/openspec-apply-change <name>`, and no message is sent

#### Scenario: Archive on a complete change archives it

- **WHEN** an active change has every task done and the user activates `Archive` on its card or in its detail header
- **THEN** one archive request is made, the change is archived, and its archived view opens

#### Scenario: Archive is not offered on an incomplete change

- **WHEN** an active change has pending tasks
- **THEN** neither its card nor its detail header shows `Archive`, and an archive request for it is refused

#### Scenario: A refusal keeps the change active

- **WHEN** the archive request is refused because the change artifacts or the current whole-spec `PASS` record are missing or stale
- **THEN** the bounded reason is shown inline, the change stays active, and the list is not told that it was archived

#### Scenario: An open run or missing approvals does not refuse the click

- **WHEN** a related run has an open required step, or a checked task has no portable task-review PASS, and the whole-spec `PASS` is current
- **THEN** the click is authorized, the Host records it, and the archive proceeds

#### Scenario: The click is the authorization

- **WHEN** the user activates `Archive`
- **THEN** no separate question, dialog, or chat command is required, and the Host records the click as the authorization for that archive

#### Scenario: Archived change appears in Archive

- **WHEN** the archive request succeeds
- **THEN** the next change-list read no longer lists the change under `Changes` and the `Archive` segment lists it

#### Scenario: The Host cannot name the archived row

- **WHEN** the archive succeeds but the Host reports no archived name for the new row
- **THEN** the panel opens no address, clears the busy state, and the refreshed list shows the change in `Archive`

#### Scenario: Two cards archive one after another

- **WHEN** the user archives one complete card and then a second complete card
- **THEN** both requests are sent, and the first success does not leave the second action busy or blocked
