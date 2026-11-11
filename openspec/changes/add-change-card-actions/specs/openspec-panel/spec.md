# Spec Delta

## MODIFIED Requirements

### Requirement: Read-only with one composer handoff

The panel SHALL read only, with one exception: the `Archive` action on a completed change is an
authorized write that archives that change after the Host verifies the user-clicked authorization and
the archive gate. Every other outward action SHALL place a command draft in the composer without
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

## ADDED Requirements

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

- **WHEN** the archive request is refused because the whole-spec `PASS` record is missing or stale, the portable task-review coverage is incomplete, or a related run has an open required step
- **THEN** the bounded reason is shown inline, the change stays active, and the list is not told that it was archived

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
