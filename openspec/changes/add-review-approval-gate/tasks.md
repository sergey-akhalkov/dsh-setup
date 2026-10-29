# Tasks

## 1. Shared approval core

- [x] 1.1 Add the pure shared approval module (`packages/plugin-delegation-rules/src/shared/approval.ts`) with the numbered-task parser and task-id hash, the portable record shape and validation, the coverage computation, the archive-command recognition, and the marker schema; verify `pnpm exec vitest run packages/plugin-delegation-rules/test/approval.test.ts` covers the parser, task-id and malformed-record edge cases.
- [x] 1.2 Replace the Host's local task parser, task-id hash, and record helpers with the shared module without changing the existing gate behavior; verify `pnpm exec vitest run packages/plugin-delegation-rules/test` passes.
- [x] 1.3 Add the `reviews/export` validation path to the shared module: a local `.dsh` task-review PASS is copied only when its rule, change, task id, and verdict match the change; verify the export tests reject an `ERROR`, a mismatched task id, and a foreign change.

## 2. Portable task-review approval

- [x] 2.1 On a task-review PASS, write the sanitized `openspec/changes/<change>/reviews/<taskId>.json` record atomically in addition to the local `.dsh` record; a failed portable write publishes no PASS. Verify the new tests cover PASS, ERROR/FINDINGS, a failed write, the absent session/run/machine fields, and the local record still existing.
- [x] 2.2 Exclude the `reviews/` directory from the change artifact digest and the reviewed change-artifact inputs; verify a portable record added after a spec review does not stale that review and a concurrent task approval does not discard a running whole-spec review.
- [x] 2.3 Add `pnpm reviews:export --change <name>` for the bootstrap of existing `.dsh` PASS records; verify it writes the portable records for this change, refuses an `ERROR`, and refuses a task-id mismatch.
- [x] 2.4 Document the portable record path, shape, digest exclusion, and local/portable relationship in `docs/delegation-rules.md`; verify `pnpm lint` and the documented command against a fixture.

## 3. Change-level coverage, status, and audit

- [ ] 3.1 Compute approval over every checked task, independent of session attribution: PASS-only, `ERROR`/`FINDINGS`/missing/malformed unapproved, an unparseable checked line fails closed, and unchecked tasks are reported only. Verify the tests cover a shell tick, a foreign-session PASS, an `ERROR`, a malformed record, an unparseable line, and an unchecked task.
- [ ] 3.2 Extend `delegation_status` with `PASS x, ERROR y, missing z`, the missing task number/text/id/record path, and `archive-ready`; verify the status test output and the existing status tests.
- [ ] 3.3 Add `scripts/reviews-check.ts` with `--change`, `--all`, `--push`, and `--export`, reading the marker, the v0.12.0 exception, and the pre-cutoff baseline; verify the script tests cover an active change, a post-cutoff archive, a pre-cutoff historical archive, the exception, a malformed record, and a missing approval.
- [ ] 3.4 Add the `package.json` scripts and the command reference to `docs/contributing.md`; verify `pnpm reviews:check --change add-review-approval-gate` runs and `pnpm lint` passes.

## 4. Completion and archive gate

- [ ] 4.1 Add the completion steer: when the session's checklist write makes the task list fully checked, require a PASS for every checked task; before completion the per-task scope is unchanged. Verify a completion turn with one missing PASS is steered and a non-completion turn is not.
- [ ] 4.2 Add the `tools/pre-execute` archive gate: read `openspec/review-approval.json`, recognize `openspec archive <change>` and `mv`/`Move-Item`/`git mv` into `changes/archive/`, deny before the move with the missing tasks and the exact review calls, fail closed, and apply to subagents. Verify the harness tests for denied, allowed, marker-absent, invalid-rule, unreadable-evidence, and non-archive commands.
- [ ] 4.3 Add `openspec/review-approval.json` with `archiveGate: true`, `taskRule: task-review`, the v0.12.0 cutoff, and the three grandfathered changes; add the archive operation guidance to `openspec/config.yaml`; verify `openspec validate` and the audit reports the three as an exception and the pre-cutoff archives as the historical baseline.
- [ ] 4.4 Update `docs/delegation-rules.md`, `docs/contributing.md`, and `AGENTS.md` with the completion/archive gate, the marker, PASS-only approval, and the commands; verify the AGENTS.md instruction-budget check and `pnpm lint` pass.

## 5. Push hook and CI

- [ ] 5.1 Add the checked-in `.githooks/pre-push` hook and `scripts/install-hooks.ts` with `pnpm hooks:install`; the hook runs `pnpm reviews:check --push` and fails closed on an unknown range. Verify the hook file has LF endings, the install sets `core.hooksPath`, and a manual `--push` run with a fixture blocks a missing approval and allows a complete one.
- [ ] 5.2 Add the approval audit step to `.github/workflows/validate.yml` (and the release workflow) with the v0.12.0 exception, the pre-cutoff baseline, and the cutoff; verify the workflow YAML parses, the full audit passes with the baseline and exception, and a fixture archive after the cutoff fails.
- [ ] 5.3 Update `docs/contributing.md` and `AGENTS.md` with the hook install, the push result, the CI step, and the manual full-audit fallback; verify `pnpm lint`.

## 6. Repository approval documentation and specs

- [ ] 6.1 Write `docs/review-approval.md`: the approval rule, the portable record, the audit commands, the marker, the opt-in boundary, the push/CI enforcement, the worktree workflow, and the known limits; verify `pnpm lint` and every documented command against a fixture.
- [ ] 6.2 Record the v0.12.0 exception and the pre-cutoff historical baseline in `docs/openspec-status.md`: the three changes, their checked-task counts (17, 20, 11), the post-hoc integration review PASS in the `review-v0-12-0` worktree, the fixes branch, the older archives reported as baseline, and the cutoff; verify the audit reports both and the document links resolve.
- [ ] 6.3 Sync the `delegation-rules` and `review-approval` deltas into the main specs with the `openspec-sync-specs` workflow; verify `openspec validate --specs` and `openspec validate --all` pass.

## 7. Integration verification

- [ ] 7.1 Run the full local gate: `pnpm build`, `pnpm gen`, `pnpm gen:check`, `pnpm check`, `pnpm validate:repo`, `pnpm validate:composition`, `pnpm validate:installer`, and `git diff --exit-code`; verify the built `lib/**` and the vendored setup copy match the sources.
- [ ] 7.2 Review this change's tasks, export their `.dsh` PASS records with `pnpm reviews:export --change add-review-approval-gate`, and run `pnpm reviews:check --change add-review-approval-gate`; verify every checked task has a portable PASS and the status is archive-ready.
- [ ] 7.3 Verify the push path with the installed hook and a fixture archive: a missing approval blocks the push, a complete archive passes, and the full audit prints the pre-cutoff baseline and the v0.12.0 exception without failing for either.

## Workflow follow-up

- Release the setup, install it from an external PowerShell window with the desktop app closed, and run the live acceptance in a throwaway workspace: archive denied without a PASS, allowed with a PASS, the push refused, and the status counts correct.
- Archive this change after `pnpm reviews:check --change add-review-approval-gate` passes and its task reviews are recorded; the pre-push hook validates the archive commit.
- Verify the archived change, update `docs/openspec-status.md` with the archive entry, and confirm the next change uses the live archive gate.
