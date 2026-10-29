# Proposal

## Why

The v0.12.0 release archived and pushed three changes (`add-goal-block-review`,
`adopt-agent-best-practices`, `fix-delegation-review-build-inputs`) with 48 checked tasks and zero
task-review records. The session-scoped turn gate had no attributed tasks to require, the archive
skill moved each change without a review check, and git had no approval boundary; a post-hoc Codex
review then found four P1 findings. "Every checked task has a reviewer PASS" must become a property
of the change, enforced before archive and before push, not a property of whichever session happened
to tick a checkbox.

## What Changes

- A task-review PASS writes a sanitized, portable approval record at
  `openspec/changes/<change>/reviews/<taskId>.json`; the change artifact digest excludes `reviews/`;
  the local `.dsh` record remains.
- The engine computes change-level approval over every checked task, independent of session
  attribution: only a task-review PASS counts; `ERROR`, `FINDINGS`, missing or malformed records, and
  unparseable checked lines do not. Unchecked tasks are reported but not required.
- The turn gate gains a completion rule: when a session's tick makes the task list fully checked,
  that session must obtain PASS records for every checked task, not only its own.
- In a repository that opts in with `openspec/review-approval.json`, the engine refuses the documented
  archive operation (`openspec archive`, `mv`/`Move-Item`/`git mv` into `changes/archive/`) before it
  runs unless every checked task is approved; the denial lists the missing tasks and the exact review
  calls. Repositories without the marker are unchanged.
- The repository adds a checked-in pre-push hook (`pnpm hooks:install`) and a CI check that validate
  the portable records of archived changes in the pushed range;
  `pnpm reviews:check --change|--all|--push` is the single audit command.
- The three v0.12.0 changes are an explicit exception: no per-task backfill. The post-hoc integration
  review PASS and the fixes on `review-v0-12-0` are recorded, the cutoff is the v0.12.0 tag, and
  `reviews:check --all` reports the exception rather than hiding it.
- Archives created before the cutoff are reported as a historical baseline and are not required to
  carry retroactive portable records; a later modification to any archive is checked under the normal
  rule.

## Capabilities

### New Capabilities

- `review-approval`: the repository-level approval boundary for archived changes, the pre-push and CI
  enforcement, the portable evidence, and the v0.12.0 exception.

### Modified Capabilities

- `delegation-rules`: task-review PASS records become portable; the engine computes change-level
  coverage and enforces it at completion and archive; the PASS-only approval boundary and the
  status/audit change.

## Impact

- `packages/plugin-delegation-rules/src/host/index.ts`, its tests, the built `lib/**`, and the
  vendored setup copy.
- A new shared approval module and `scripts/reviews-check.ts`; `.githooks/pre-push`;
  `scripts/install-hooks.ts`; `package.json` scripts; the CI and release workflows.
- `openspec/review-approval.json` (opt-in, rule selection, exception and cutoff);
  `openspec/config.yaml` archive guidance.
- `docs/delegation-rules.md`, `docs/contributing.md`, `AGENTS.md`, `docs/openspec-status.md`; the
  `delegation-rules` and `review-approval` specs.
- No breaking change to existing rules or workspaces; the archive gate is opt-in per repository. The
  integration review remains as configured (soft) and is not part of this change.
