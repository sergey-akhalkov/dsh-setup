# Spec Delta

## Purpose

Reclaims disk space from finished Git worktrees safely and gives the owner one place in DSH to see
which worktrees exist, what is not merged, and what each sweep removed or kept.

## ADDED Requirements

### Requirement: Worktree inventory

The Host SHALL list every linked Git worktree of the session workspace with its branch, creation
time, last activity, merge state into the base branch, uncommitted file count, derived status, and the
reason for that status. The primary checkout SHALL NOT be offered as a removable worktree.

#### Scenario: Inventory names every linked worktree

- **WHEN** the panel opens for a workspace with linked worktrees
- **THEN** each linked worktree appears once with branch, creation time, last activity, and status,
  and the primary checkout is not offered for removal

### Requirement: Safe automatic removal

A sweep SHALL remove a linked worktree only when every commit of its branch is reachable from the base
branch and the checkout has no uncommitted or untracked files. The sweep SHALL re-check both conditions
immediately before each removal, MUST NOT pass `--force`, and MUST leave the branch and its commits in
place.

#### Scenario: Merged and clean

- **WHEN** a lane worktree is merged into the base branch and `git status` reports nothing
- **THEN** the scheduled sweep removes the checkout and the branch remains

#### Scenario: Unmerged or dirty

- **WHEN** a worktree has commits outside the base branch or any uncommitted file
- **THEN** the sweep keeps it and records the reason in the report

### Requirement: Bounded automatic scope

Automatic removal SHALL be limited to lane worktrees, identified by the `lane-` branch prefix, by
default. The configuration SHALL accept `managed`, `all`, and `off`: `all` also permits manual
worktrees, and `off` disables automatic removal.

#### Scenario: Manual worktree kept by default

- **WHEN** a user-created worktree is merged and clean under the default `managed` scope
- **THEN** the sweep keeps it and the panel offers manual deletion instead

#### Scenario: Owner widens the scope

- **WHEN** the configuration sets `autoRemove` to `all`
- **THEN** any merged and clean linked worktree becomes eligible for automatic removal

### Requirement: Idle escalation

The Host SHALL derive last activity from the newest of the branch's last commit and the modification
times of the worktree's changed paths. A worktree that is not safely removable and has no activity for
`staleDays` days SHALL be marked stalled. A sweep MUST NOT remove a stalled worktree; only an explicit
owner action through the panel may delete it.

#### Scenario: Stalled worktree is reported

- **WHEN** an unmerged worktree has no activity for the configured stale period
- **THEN** it is listed as stalled, the scheduled sweep keeps it, and the report names the stalled
  reason

#### Scenario: Stalled worktree is never deleted automatically

- **WHEN** a scheduled sweep runs while a stalled worktree exists
- **THEN** the worktree remains and the panel offers manual deletion only

### Requirement: Unsafe deletion confirmation

Deleting a worktree that is not safely removable SHALL require explicit confirmation bound to a
Host-computed fingerprint of its head, commits outside the base branch, and content digests of every
changed, staged, and untracked file. The confirmation SHALL name those commits and files. A confirmed
request with a stale fingerprint SHALL be refused with refreshed details, and only a confirmed unsafe
deletion MAY pass `--force` while the branch MUST remain.

#### Scenario: Unconfirmed unsafe delete refused

- **WHEN** a delete request for an unmerged or dirty worktree has no confirmation
- **THEN** nothing is removed and the refusal names the commits and files that would be lost

#### Scenario: Worktree changed after the confirmation

- **WHEN** a confirmed deletion arrives after the worktree gained another uncommitted file
- **THEN** the Host refuses it, refreshes the confirmation payload, and removes nothing

#### Scenario: Existing file edited after the confirmation

- **WHEN** a confirmed deletion arrives after a file already listed as modified changed content again
  without a new path or commit
- **THEN** the Host refuses it, refreshes the confirmation payload with the new content digest, and
  removes nothing

### Requirement: Persistent sweep report

Every sweep SHALL write one report under `.dsh/worktrees/reports/` recording its trigger, time, and
the removed, kept, and failed worktrees with the reason for each. The Host SHALL retain the last 14
reports across restarts.

#### Scenario: Report survives a restart

- **WHEN** the Host restarts after a sweep removed a worktree
- **THEN** the Report segment still shows that sweep and its reason

### Requirement: Protected worktrees

A sweep MUST NOT remove the primary checkout, a worktree containing the working directory of a live
Agent, a Git-locked worktree, a checkout under `.agents/worktrees/`, or a workflow review snapshot
under `.dsh/workflows/snapshots/`. The sweep SHALL re-evaluate every protection immediately before
each removal.

#### Scenario: Live session protects its checkout

- **WHEN** a live session's working directory is inside a merged and clean worktree
- **THEN** the sweep keeps it and names the session as the reason

#### Scenario: Session starts using a planned worktree

- **WHEN** a session starts using a planned worktree after the sweep planned its removal
- **THEN** the removal is skipped and the report names the live session

### Requirement: Worktrees panel

The plugin SHALL register a right-sidebar tab type with a Start-page guide entry. The tab SHALL provide
a `Worktrees` segment listing the inventory and a `Report` segment listing recent sweeps. Opening a
worktree row SHALL show its commits outside the base branch and its uncommitted files.

#### Scenario: Open a worktree row

- **WHEN** the owner opens a row for an unmerged worktree
- **THEN** the panel lists the commits not in the base branch and the uncommitted files

### Requirement: Delete re-validation

A delete request SHALL be checked against a freshly read inventory. The Host MUST refuse an unknown
path, the primary checkout, a protected worktree, and an unsafe worktree without explicit
confirmation, and MUST NOT remove any path that is not a linked worktree in that fresh inventory.

#### Scenario: Unknown path refused

- **WHEN** a delete request names a path that is not a linked worktree in the current inventory
- **THEN** the Host refuses it and removes nothing

### Requirement: Configurable sweep schedule

The plugin SHALL sweep at the configured local time (default 04:00), once shortly after Host start,
and on demand from the panel. After each sweep it SHALL recompute the next local calendar occurrence
of `sweepAt`, not use a fixed interval. A nonexistent local time SHALL move to the first valid local
minute after it that day; a repeated local time SHALL use its first occurrence. Configuration:
`staleDays` (default 7), `sweepAt` (default 04:00), `autoRemove` (default `managed`).

#### Scenario: Startup catch-up

- **WHEN** the Host starts after the scheduled time has passed
- **THEN** one sweep runs and its report records the startup trigger

#### Scenario: Nonexistent local time

- **WHEN** the local timezone skips the `sweepAt` hour on the next local day
- **THEN** the sweep runs at the first valid local minute after `sweepAt` on that day

#### Scenario: Repeated local time

- **WHEN** the local timezone repeats the `sweepAt` hour on the next local day
- **THEN** the sweep runs at the first occurrence and the following sweep still starts at `sweepAt`
