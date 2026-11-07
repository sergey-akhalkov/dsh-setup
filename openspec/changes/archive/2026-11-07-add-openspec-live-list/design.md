# Design

## Context

See `proposal.md` — Why. The relevant current state:

- The root view's `RootBody` performs one `GET /api/plugins/dsh-setup-openspec/changes` read. Only
  `ChangeBody` and `CapabilityBody` own file observations; the accepted "Live artifact updates"
  requirement covers open change and capability views, not the list.
- The shipped `file` resource provider (`@deepseek-ai/dsh-api-workspace-files` on DSH 0.2.2-rc.1)
  opens one Host `workspaceFiles.changes` stream per requested path, stats the path, and reports a
  `version` on each change frame. The Host can watch a directory's direct entries, but the provider's
  stat accepts only a regular file, so a directory address reports `failed` and the panel's observer
  can never settle it as observable.
- A change-list re-read runs `openspec list --all --json`, `openspec list --specs --json`, one
  `git log`, and per-row file reads, then derives each row's phase, presence, purpose, requirement
  count, and last-modified fact on the Host.
- `changeWatchPaths(name, capabilities)` and the `fileAddress` grammar already describe exactly the
  files a change view observes.

## Goals / Non-Goals

**Goals:**

- The Changes segment reflects edits made while it is visible, using the shipped file observation and
  the existing debounce, with one additive host field as the only wire change.
- Reuse the watch-path derivation and observation components the change view already uses.
- Keep archived surfaces manual.

**Non-Goals:**

- Observing a change created while the list is open (there is no file to observe yet).
- Live updates for the Specs and Archive segments.
- A lighter list route that avoids the CLI and git.
- Any write, new package, bundle row, or dependency.

## Decisions

### D1 — Watch the files of each active row, not the changes directory

Each active row contributes the paths `changeWatchPaths(row.name, row.deltaCapabilities)`:
`proposal.md`, `design.md`, `tasks.md`, and every delta `specs/<capability>/spec.md`. That is the same
set the open change view already watches, through the same helper and the same address grammar.

Alternatives rejected: watching `openspec/changes` as a directory (the Host feed accepts it, but the
client provider's stat refuses a directory, so the address can never be `live` and the observer would
never schedule a re-read); a plugin-owned tree watcher or a host-side tree-revision stream (duplicates
the shipped observation and adds a protocol surface); polling (forbidden by the accepted requirement).

### D2 — The host row carries `deltaCapabilities`

The client cannot enumerate delta specs for a row it has not opened. The host already calls
`deltaSpecFiles` for `presence.specs` and `requirementCount`, so returning the capability ids is one
extra field on data it already computed. The field is optional on the wire: an older host omits it and
the client watches the three fixed artifacts; an older client ignores it.

Alternatives rejected: client-only three fixed artifacts (delta-spec edits would leave the requirement
count and last-modified fact stale — exactly the class of frozen field this change removes); a second
host route listing watch paths (extra request per reload); ready-made watch paths in the row (moves the
address grammar into the host when the client already owns it).

### D3 — Reuse the observation components and the 300 ms debounce

`RootBody` receives `useResource` from the tab body — the same framework prop that already reaches
`ChangeBody` and `CapabilityBody` — and owns `useLiveReload(changes.reload)` plus `useObservation`. It
renders one hidden `FileWatch` per address for the active rows of the Changes segment, then disposes
them when the segment changes or the body unmounts.

- Watches mount only while the Changes segment is selected, owned by a small observation component that
  is a sibling of the read content rather than a child of its ready branch. A list re-read renders the
  loading state; an observer under that branch would unmount and remount on every read, and its
  first-settlement reconciliation would schedule the next read forever. The observer stays mounted
  across reloads, and `RootBody` retains the last ready row set in a ref so the address set survives a
  loading render. Leaving the segment disposes the batch and cancels a pending debounce; returning
  starts a fresh batch whose first settlement schedules one reconciliation read even when the address
  set is unchanged, so Specs and Archive pay nothing and a stale list is reconciled on return.
- The first settlement of the initial address set schedules exactly one debounced re-read, closing a
  save that landed between the route response and observation readiness. After that only a `version`
  change, an appearance, or an absence schedules one more re-read.
- No timer runs while nothing changes and the subscriptions exist only while the body does.

### D4 — A newly created change stays manual

A change created while the segment is mounted has no requested path to follow: the provider registers
a follow per requested path, and a path that does not exist fails its stat before any file appears, so
the segment cannot learn about the new directory. The list therefore picks the change up on the native
refresh or the hidden-to-visible re-read. Closing the gap would need a host tree-revision stream (a new
surface) or polling (forbidden); the delta spec states the scenario so it is a contract, not a
surprise.

### D5 — Cost is bounded by the number of active changes

Each active row contributes three plus its delta-spec count to the watch set; the current six active
changes open roughly 25-30 Host watches. An edit burst collapses into one re-read, and each list
re-read runs two CLI calls plus one `git log` — the same cost an open change view already pays. A cap
on watched rows would silently freeze the rest of the list, so none is introduced; the Archive segment
is the escape valve for large histories.

## Risks / Trade-offs

- A change created while the list is open is not live → specified; the native refresh and the
  hidden-to-visible re-read remain the recovery path.
- A large number of active changes raises the watch count linearly → accepted; each path uses one
  shared Host stream, the same client address is shared with an open detail tab, and no read happens
  while nothing changes.
- A slow `openspec` CLI delays an update instead of duplicating reads → the debounce coalesces the
  burst and the existing loading state shows the re-read.
- Relative "updated N ago" labels advance only on a re-read → accepted; the panel still has no timer.
- A watched file disappears outside the archive move (manual delete) → the resource reports failure,
  the panel treats it as a change, and the row disappears after one re-read.
- An older host without `deltaCapabilities` → the list watches the three fixed artifacts and keeps
  working; an open change view keeps full coverage.

## Migration Plan

Additive; no stored state, option, route, or configuration migration. The host and client ship
together inside the existing package, and the wire field is optional. Rollback is reverting the commit
or disabling the row (which also removes the six skills); the change creates no data. Verification:
unit tests and the repository gate, then a check in a throwaway Harness on the supported DSH versions
(never the live desktop profile).
