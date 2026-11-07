# Spec Delta

## ADDED Requirements

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
