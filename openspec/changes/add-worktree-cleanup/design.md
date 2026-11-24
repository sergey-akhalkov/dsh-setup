# Design

## Context

See `proposal.md` for motivation. The relevant current state:

- The lane steer creates sibling checkouts with raw Git (`git worktree add ../wt-<change>-<n> -b
  lane-<change>-<n>`) and never registers them with a host service.
- DSH's `worktrees` service reclaims only its own `.agents/worktrees/**` checkouts, only on Session
  archive, and keeps the branch.
- The OpenSpec panel proves the right-sidebar pattern: a tab type registered through
  `sidebarRightTabs`, a body in `sidebar.right.pane.tab`, a guide entry on the Start page, and
  workspace resolution from a live session id on Host Fetch routes.
- `.dsh/` is gitignored, so a per-workspace report store needs no storage service.

## Goals / Non-Goals

**Goals:**

- One place that owns the lifecycle of every linked worktree of a workspace, regardless of who created
  it, with Git as the source of truth.
- Automatic removal that is safe by construction: merged, clean, no `--force`, branch preserved.
- A visible, persistent record of every sweep decision, and a manual delete path for unfinished work.
- A panel that fits the existing right-sidebar surface and needs no DSH core change.

**Non-Goals:**

- Worktree sizes, branch deletion, notifications, a settings page, or a per-worktree diff viewer.
- Replacing DSH's `.agents/worktrees` archive cleanup or the lane steer.
- Cross-repository management; the panel always works on the session workspace's repository.

## Decisions

### One new bundle

`@dsh-setup/plugin-worktrees` ships a Host half and a Client half. Alternatives: extend
`plugin-workflows` (couples a process engine to maintenance and makes the panel unavailable without a
workflow run), extend `plugin-openspec` (unrelated capability), or an OS scheduler plus a script (no
DSH report, OS-specific state). A separate bundle keeps install, disable, and rollback independent and
matches the repository's plugin-per-feature shape.

### Git is the inventory

The Host reads `git worktree list --porcelain` plus per-worktree status, merge-base, and log. No
plugin-owned registry is authoritative: lane creation bypasses the host, and existing checkouts
predate the plugin. A registry could exist only as a cache and would add invalidation risk for no
benefit.

### Derived status, not stored state

Every read recomputes `merged`, `clean`, `unmergedCommits`, `uncommittedFiles`, `idleDays`, and the
derived status. Nothing but sweep reports is persisted, so a worktree changed outside DSH is reflected
on the next read. The statuses are `merged`, `unmerged`, `modified`, `stalled`, `in use`, `locked`,
`dsh-owned`, and `manual`; `merged` means the auto path would remove it now.

### Default scope is lane worktrees

Automatic removal defaults to `autoRemove: managed` (branch prefix `lane-`). A manual worktree can
contain ignored local files (`.env`, a local database) that `git worktree remove` deletes silently,
while a lane worktree is agent-created, reproducible, and fully represented by its branch. `all` is a
one-line opt-in for owners who want every merged and clean checkout reclaimed.

### Stalled work is escalated, never deleted automatically

A worktree that is not safely removable becomes `stalled` after `staleDays` of inactivity. The sweep
keeps it and the panel offers an explicit delete with a confirmation that lists the commits and files.
No configuration makes an automatic sweep remove an unmerged or dirty worktree; the only path to that
deletion is an owner action through the panel.

### Report store

Each sweep writes `.dsh/worktrees/reports/<ISO>.json` with `at`, `trigger`, `base`, and the `removed`,
`kept`, and `failed` arrays. The last 14 are retained by pruning older files after a successful write.
A report write failure never changes a removal decision; it is logged and the sweep result is still
returned to the panel.

### Route and panel shape

Four Host routes resolve the workspace from a live session id exactly as the OpenSpec routes do:
`list`, `detail`, `reports`, `sweep`, and `remove`. A path received from the Client is matched against
a freshly read inventory before any worktree command runs; the Client never supplies a path that is
used directly. The panel registers one tab type with a guide entry and two segments; it follows the
OpenSpec panel's locale, slot, and primitive-component pattern.

### Triggers

After every sweep the plugin recomputes the next local calendar occurrence of `sweepAt` and schedules
one timer for it, rather than using a fixed 24-hour interval, so a daylight-saving change does not
move the sweep off the configured local time. A nonexistent local time moves to the first valid local
minute after it that day, and a repeated local time uses its first occurrence. A startup catch-up
sweep runs shortly after mount; `Sweep now` calls the same
sweep. A per-workspace in-flight guard makes concurrent triggers return "already running" instead of
overlapping. A turn-end trigger was considered and deferred: it makes removal timing less predictable,
and the daily sweep plus the manual action cover merges within a day.

### Deletion re-check

The sweep plans from a snapshot but re-evaluates every eligibility condition immediately before each
`git worktree remove`: merge state, cleanliness, the live-session working directories, lock state, and
the protected paths. A worktree that changed in any of those dimensions between planning and removal
fails safe. A Client delete always re-lists, re-derives the status, and refuses the main checkout,
DSH-owned paths, live-session paths, and locked worktrees before running Git. A confirmed unsafe
delete also carries a Host-computed fingerprint of the head, the commits outside the base branch, and
the content digests of every changed, staged, and untracked file; a new path or new content changes
it. The Host recomputes the fingerprint and refuses a mismatched confirmation with the fresh payload
instead of force-deleting content the owner never saw.

## Risks / Trade-offs

- A cold (non-live) Session whose old working directory is a lane worktree loses that directory after
  removal. → Accepted for lane worktrees: commits are in the base branch, the branch remains, and the
  report records the removal. Live Agents are always protected.
- A squash or rebase merge makes a branch look unmerged. → It becomes `stalled`, not deleted; the
  owner can delete it manually.
- Windows can refuse removal while a process holds a file. → Recorded as `failed` with Git's message;
  no retry loop.
- Ignored files are removed with the checkout. → The default scope limits this to agent-created lane
  worktrees; the confirmation for manual deletion lists the uncommitted files.
- A missed scheduled sweep while the Host is closed. → The startup catch-up runs one sweep and the
  report shows the actual trigger.
- Multiple registered workspaces sweep independently; the same repository registered twice is deduped
  by its Git common directory.

## Migration Plan

1. Land the package, fragment, defaults, docs, generated setup tree, and tests; `pnpm gen` and `pnpm
   build` produce the committed artifacts.
2. Install the setup; the plugin row mounts with `autoRemove: managed`. The first startup sweep
   reclaims whatever merged and clean lane worktrees the owner's workspace holds at install time; the
   required acceptance (task 6.2) runs against a seeded temporary repository, not that live inventory.
3. Rollback: disable or remove the plugin row; it owns no checkout and writes only its reports under
   `.dsh/worktrees`, which remain readable.
