# Proposal

## Why

A turn in this repository closed with `the worktree digest could not be computed (ENOENT: ... openspec/changes/<change>/tasks.md)` while the active change belonged to another thread and its `tasks.md` had not been written yet. The message blamed the current thread's worktree for a per-change planning problem, and the turn-start baseline still snapshots every active change, so a foreign change's incomplete artifacts can reach thread-local gate state.

## What Changes

- Scope every snapshot the gate captures, including the turn-start baseline, to the changes owned by the evaluating thread.
- Keep per-change artifact failures out of the worktree digest: a missing or unreadable `tasks.md` becomes a per-change hint that names the change and its owner instead of a worktree/git error.
- Keep `delegation_status` reporting foreign ownership and unreadable tasks without failing.
- Add regression tests for a foreign incomplete change and an owned change without `tasks.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `delegation-rules`: separate per-change artifact errors from the worktree digest failure, exclude foreign changes from every snapshot, and name the responsible change and owner in the gate hint.

## Impact

- `packages/plugin-delegation-rules/src/host/index.ts`
- `packages/plugin-delegation-rules/test/gate.test.ts`
- `docs/delegation-rules.md`
- Generated `packages/plugin-delegation-rules/lib/**` and the vendored setup copy

No rule configuration, tool parameter, or record shape changes. The installed plugin only picks up the fix after a rebuild/restart or a separate release.
