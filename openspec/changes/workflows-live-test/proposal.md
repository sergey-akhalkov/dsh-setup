# Proposal

## Why

The live desktop profile owns the checkpoint and task-review gates through the `workflows`
plugin, but the live intake path had never executed in this workspace. A live run on
2026-11-10 found that the intake's owned `create-change` dispatch failed: it sent a decoded
object instead of a model-shaped tool-call block. The fix shipped in v0.29.4, and the rerun
created this change.

This change records what the live walk confirmed and closes the one spec gap it surfaced:
the shipped `verify` definition is inert while a profile configures no verification command,
and the main spec does not state that.

## What Changes

- State in the `workflows` capability that an empty `verify.commands` list keeps the
  verification definition inert and records the `no-command` evidence.
- Document that default in `docs/workflows.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflows`: the owned-verification requirement gains the empty-commands inert case.

## Impact

- `openspec/specs/workflows/spec.md` (delta in this change), `docs/workflows.md`.
- No runtime code, no new package, and no DSH version change.
- Out of scope: the intake dispatch fix (shipped in v0.29.4) and any behavior change beyond
  the documented default.
