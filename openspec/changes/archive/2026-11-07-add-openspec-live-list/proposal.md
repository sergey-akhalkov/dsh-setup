# Proposal

## Why

The panel's In Progress list is a snapshot, not a live surface: the root Changes view reads once and
re-reads only on mount, the native refresh, or a hidden-to-visible switch, so while an agent is
applying a change the task counts, phase tag, purpose, requirement count, and "updated N ago" fact keep
showing the state from when the tab was opened. The open change and capability views already follow
their files through DSH's shipped observation; the list — the surface the owner watches while work
happens — was left outside that requirement.

## What Changes

- The Changes segment re-reads the change list when an observed file of any active row changes:
  `proposal.md`, `design.md`, `tasks.md`, and every delta `specs/<capability>/spec.md`. Observation
  uses the shipped `file` resource provider over `workspaceFiles.changes`, with the existing 300 ms
  debounce; no polling, heartbeat, or plugin-owned watcher.
- The host change-list route gains one additive row field, `deltaCapabilities`, so the client can
  watch the same delta files the open change view already watches; the host already enumerates those
  files for the row's `presence.specs` and requirement count.
- Archived rows and the Archive segment stay manual; archived changes are immutable by convention.
- **Explicit limit:** a change created while the Changes segment is open has no file to observe yet and
  appears only after the native refresh or a hidden-to-visible re-read; the delta spec states this
  scenario.
- No new package, bundle row, route family, dependency, or write surface.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-panel`: gains the "Live change list" requirement — the root Changes segment re-reads when a
  file shown by an active row changes, through the shipped file observation, with scenarios for the
  live list, the archived-row exclusion, the archive-move disappearance, the new-change limit, and the
  no-timer rule. The existing "Live artifact updates" requirement stays scoped to open change and
  capability views.

## Impact

- `packages/plugin-openspec/src/host/change-list.ts`: `WorkspaceChange` gains `deltaCapabilities`; no
  extra filesystem pass.
- `packages/plugin-openspec/src/client/panel.ts`: `ChangeRow` gains the optional field; watch paths
  reuse `changeWatchPaths` and `fileAddress`.
- `packages/plugin-openspec/src/client/index.tsx`: `useResource` reaches `RootBody`; the Changes
  segment owns the observation and the debounced re-read; a segment switch and unmount dispose them.
- Tests in `packages/plugin-openspec/test/panel.test.ts` and `change-list.test.ts`;
  `docs/plugins.md`; the accepted `openspec/specs/openspec-panel/spec.md` on sync.
- `packages/setup` regenerated with the rebuilt client bundle; no bundle, installer, market, or
  dependency change.
