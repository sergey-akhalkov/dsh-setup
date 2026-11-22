# Spec Delta — openspec-panel

## ADDED Requirements

### Requirement: Change card gutter

A change card for an active change in the `Changes` list SHALL render a fixed-width numeric gutter,
separated from the card body by a hairline. The gutter SHALL state the completed and total task counts
over a `tasks` label, or a dash when no tasks are written.

#### Scenario: Counts lead the row

- **WHEN** an active change reports 3 of 12 tasks done
- **THEN** its gutter states `3/12` above `tasks`, and the body states the name, purpose, facts and navigation

#### Scenario: No tasks written

- **WHEN** an active change has a proposal but no tasks file
- **THEN** the gutter states a dash instead of a fraction and the facts row states that no tasks are written yet

### Requirement: Change card body

The body of an active change card SHALL state, in order, the change name with its last-modified time,
the proposal's purpose clamped to two lines, one facts row, and one navigation row carrying the
artifact entries beside the card's actions. An archived change card SHALL keep its current rendering.

#### Scenario: Purpose stays short

- **WHEN** a proposal's Why runs longer than two lines of the body at the current width
- **THEN** the purpose shows two lines with a trailing ellipsis and the full text on demand

#### Scenario: Navigation row

- **WHEN** an active change carries a proposal, a design, delta spec requirements and tasks
- **THEN** one navigation row lists those artifacts beside the card's actions, and choosing an entry opens that artifact

#### Scenario: Archived row keeps its history layout

- **WHEN** a card renders an archived change in the `Archive` segment or in the empty-state recents
- **THEN** it keeps the current archived rendering — archive date, task completion, purpose and last commit — and offers no action

## MODIFIED Requirements

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
- **THEN** its row shows the name, the in-progress status, `4/12` in its numeric gutter, the artifact navigation, a two-line purpose, when it was last modified, and no commit fact

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

### Requirement: Change status, summary, and provenance

Each active change row SHALL state a derived status — planning, ready to apply, applying, complete, or
archived — as a status dot with a short label, the task counts, a purpose taken from the proposal's
Why clamped to two lines, and the last-modified time, inside the card layout. The change detail header
SHALL state the derived status, the task counts, the purpose, the last-modified time, and the last
commit when available. An active change row MUST NOT show commit facts; an archived row keeps the
archive facts the `Archived changes are browsable` requirement states.

#### Scenario: Planning change

- **WHEN** a change has a proposal but no tasks
- **THEN** its status reads planning in the attention colour, its gutter states a dash, and its facts say that tasks are not written yet

#### Scenario: Ready to apply

- **WHEN** a change has tasks and none is done
- **THEN** its status reads ready to apply in the informational colour and its gutter states `0/14`

#### Scenario: Applying

- **WHEN** a change has 4 of 12 tasks done
- **THEN** its status reads applying and its gutter states `4/12` with no progress bar

#### Scenario: Complete and archived

- **WHEN** a change has all tasks done, and separately when it is archived
- **THEN** the complete status uses the success colour and the archived status uses the neutral archived treatment with its archive date

#### Scenario: Provenance lives in the detail header

- **WHEN** a change was last touched by commit `a841fd33`
- **THEN** its active row shows no commit fact and its detail header shows `a841fd33`, the commit date and the subject on demand

#### Scenario: Narrow panel keeps the facts

- **WHEN** the row renders at the narrowest supported width
- **THEN** the gutter, the facts and the navigation row wrap or stack without horizontal scrolling and without losing a fact

### Requirement: Visual hierarchy and theme conformance

The panel SHALL separate content into visually distinct tiers using the shipped primitives and design
tokens: a page title, grouped section labels, a card surface with a hairline edge for each change and
requirement, semantic status colours, task counts in a numeric gutter on active change rows, and
supporting icons for status, commit, and actions. It MUST NOT introduce a literal colour, font size, or
spacing value where a design token exists, and every interactive row MUST keep the host focus ring.

#### Scenario: Status colours carry meaning

- **WHEN** a status renders as planning, ready, applying, complete, or archived
- **THEN** its colour comes from the matching semantic state token and the same status always uses the same colour

#### Scenario: Cards separate dense content

- **WHEN** a change list, requirement list, or task list renders
- **THEN** each item is a separate hairline card with its own padding and a heading tier above its supporting facts

#### Scenario: Progress is a count, not a bar

- **WHEN** an active change row renders task progress
- **THEN** it states the counts as a numeral in the gutter and draws no tracking bar on the row

#### Scenario: Narrow width stays readable

- **WHEN** the right sidebar is at its narrowest supported width
- **THEN** a card, its metadata and its controls stay inside the panel without horizontal scrolling

#### Scenario: Theme changes adapt

- **WHEN** the host switches between light and dark appearance
- **THEN** every panel surface, label, edge, and status colour follows the theme without a panel-specific colour value

#### Scenario: Keyboard focus stays visible

- **WHEN** the user reaches a row or action by keyboard
- **THEN** the host focus ring is visible and the row activates with Enter or Space

### Requirement: Change-card actions

A change card for an active change SHALL render both actions the panel can perform — `Apply` and
`Archive` — and SHALL enable only the one matching the change's task completion: `Apply` while the
change is not complete, `Archive` once every task is done. The disabled action MUST be inert:
activating it sends no request and opens nothing. The disabled control SHALL state the reason for its
own state: `Archive` on an incomplete change states that every task must be complete before archiving,
and `Apply` on a complete change states that the change is complete. `Apply` SHALL only fill the
`/openspec-apply-change <name>` draft. `Archive` SHALL be the user's authorization: one archive
request, a busy state cleared after success or refusal, and the Host-reported archived address opened
only when one exists. Neither action MUST open the card. The change detail header keeps its single
state-dependent action.

#### Scenario: Apply on a non-complete change fills the draft

- **WHEN** an active change has 4 of 12 tasks done and the user activates `Apply` on its card
- **THEN** the composer draft becomes `/openspec-apply-change <name>`, no message is sent, and the card's `Archive` is disabled

#### Scenario: Archive on a complete change archives it

- **WHEN** an active change has every task done and the user activates `Archive` on its card or in its detail header
- **THEN** one archive request is made, the change is archived, and its archived view opens

#### Scenario: Archive is not offered on an incomplete change

- **WHEN** an active change has pending tasks and the user activates `Archive` on its card
- **THEN** no archive request is sent, no busy state appears, the change stays active, the disabled control states that every task must be complete, and neither its card nor its detail header offers a usable `Archive`

#### Scenario: Disabled action announces itself

- **WHEN** a card renders a disabled action
- **THEN** the control's accessible name or description states why it is unavailable for that card's state, and keyboard focus skips no enabled control

#### Scenario: Apply is not offered on a complete change

- **WHEN** an active change has every task done and the user activates `Apply` on its card
- **THEN** no draft is filled, and the disabled control states that the change is complete

#### Scenario: A refusal keeps the change active

- **WHEN** the archive request is refused because the change artifacts or the current whole-spec `PASS` record are missing or stale
- **THEN** the bounded reason is shown inline, the change stays active, and the list is not told that it was archived

#### Scenario: An open run or missing approvals does not refuse the click

- **WHEN** a related run has an open required step, or a checked task has no portable task-review PASS, and the whole-spec `PASS` is current
- **THEN** the click is authorized, the Host records it, and the archive proceeds

#### Scenario: The click is the authorization

- **WHEN** the user activates an enabled `Archive`
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
