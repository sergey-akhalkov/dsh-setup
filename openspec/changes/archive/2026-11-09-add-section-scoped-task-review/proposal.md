# Proposal

## Why

Every task in a change pays one full model review, so a 30-40 task change spends hours on
check-by-check reviews and still ends with the same few findings classes. The owner asked for
section-scoped review (for example all `1.x` tasks in one run) to speed development without giving up a
review gate or per-task archive approvals.

## What Changes

- Add a section-scoped task-review mode to the delegation engine: a `delegate` call names a `tasks.md`
  section (its level-2 heading number, such as `1` or `1.x`), and one review run covers every checked
  task in that section with one verdict, one snapshot, and one prompt.
- Publish a section PASS as the existing per-task portable `reviews/<taskId>.json` approvals for every
  checked task it covered, so `pnpm reviews:check` and the archive gate stay unchanged; unchecked tasks
  are never approved.
- Key the section run by the section selector, the checked task set, the frozen change artifacts, and
  the snapshot; an unchanged section reuses a FINDINGS record, and the review queue keeps its
  identity/dedupe/pending behavior.
- Keep per-task review calls unchanged, and document the section mode, its examples, and its limits.
- Out of scope: changing the archive gate or record schema, auto-approving unchecked tasks, registering
  a new package/row/dependency, and replacing the whole-spec review.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `delegation-rules`: adds section-scoped task review selection, one-run/one-verdict section coverage,
  and per-task approval publication. Existing per-task review requirements remain in force.

## Impact

- `packages/plugin-delegation-rules`: Host review start/selection path, section digest/identity,
  portable approval publication, tests; the `delegate` tool description.
- `packages/plugin-delegation-rules/assets/delegation-rules`: task-review prompt and skill text.
- `docs/delegation-rules.md`.
- No new package, bundle row, dependency, DSH version, config option, or portable record schema field
  that the archive gate depends on; existing per-task records and changes stay valid.
