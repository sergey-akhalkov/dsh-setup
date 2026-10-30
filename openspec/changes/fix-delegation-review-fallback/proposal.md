# Proposal

## Why

A review's live input guard counts the engine's own portable approval records as reviewed inputs. One
task review's `PASS` writes `openspec/changes/<change>/reviews/<taskId>.json`, and any review running at
the same time that tracks the Git-visible worktree treats that write as an input change. Observed live:
six task reviews ran in parallel, the first `PASS` wrote its approval record, and the other five failed
with `reviewed inputs changed during the run`. The same guard runs when a task review cannot build its
frozen snapshot (for example, the repository does not gitignore `.dsh/`), and the run detail says only
`live worktree`, so the operator cannot see why the immutable path was skipped.

Separately, the default review timeout (600 000 ms, 10 minutes) is shorter than a whole-spec `xhigh`
review of a large change. A slow review becomes an `ERROR` record, and the strict gate then requires the
same review again, which is the situation that produced the loop observed in the reported session.

## What Changes

- The change's `reviews/` approval directory is engine output and MUST NOT be a reviewed input. Exclude
  it from the Git-visible input set the live mutation guard tracks, so a portable approval record written
  during a review never invalidates another review. The change-artifact walk already excludes it.
- When a task-review snapshot cannot be built, the run detail reports a bounded reason (for example, the
  `.dsh/` scratch directory is not Git-ignored, the change directory lies outside the repository, or the
  index has unmerged entries) instead of only `live worktree`.
- Raise the default `timeouts.review` from 600 000 ms to 1 200 000 ms (20 minutes). The existing config
  override still works, and the run error still names it.
- Update the `delegation-rules` delta spec and `docs/delegation-rules.md`.

**Out of scope:** serializing live reviews, auto-writing `.dsh/` into a repository's ignore files,
changing the worktree digest or the record shape, changing how the snapshot is built, changing
whole-spec/integration review semantics beyond the approval-directory exclusion, and changing any gate
rule.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `delegation-rules`: the reviewed worktree input set excludes the change's portable approval directory,
  and the task-review snapshot fallback reports its bounded reason.

## Impact

- `packages/plugin-delegation-rules/src/host/index.ts`: reviewed-input signature, snapshot fallback
  diagnostics, default timeouts.
- `packages/plugin-delegation-rules/test/engine.test.ts`, `packages/plugin-delegation-rules/test/config.test.ts`.
- `docs/delegation-rules.md`.
- Generated `packages/plugin-delegation-rules/lib/**`, its bundle patch if the config text changes, and
  the vendored `packages/setup/node_modules/@dsh-setup/plugin-delegation-rules` copy.
- Release `v0.17.1`.
