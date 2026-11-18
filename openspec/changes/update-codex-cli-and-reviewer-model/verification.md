# Full gate evidence (task 4.2)

Observed on 2026-11-18 (Windows, repository root) while a second session held
uncommitted edits in `packages/plugin-workflows/**` and two docs files in the same
checkout.

## Results

| Command                      | Result                                                                                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                 | exit 0; `git status --porcelain` was identical before and after, so the build adds no drift                                                                                                                                          |
| `pnpm check`                 | exit 1 after typecheck, lint, and build passed: `packages/plugin-workflows/test/host-wiring.test.ts` ("reuses a blocked task review for a section that it fully covers") failed in the full suite and passed when run alone; `packages/plugin-workflows/test/live-harness.test.ts` failed once and passed in a second run of the plugin's test directory |
| `pnpm validate:repo`         | exit 0 (1093 files scanned)                                                                                                                                                                                                          |
| `pnpm validate:composition`  | exit 0                                                                                                                                                                                                                              |
| `pnpm validate:installer`    | exit 0                                                                                                                                                                                                                              |
| `git diff --exit-code`       | exit 1; only the concurrent session's in-flight paths differ                                                                                                                                                                         |

The `git diff --exit-code` and `pnpm check` failures are confined to the concurrent
session's uncommitted work: `docs/openspec-status.md`, `docs/workflows.md`,
`openspec/changes/ignore-archived-change-involvement/**`,
`packages/plugin-workflows/src/host/index.ts`, and
`packages/plugin-workflows/test/host-wiring.test.ts`. None of those paths is owned by
this change, and the same worktree carried them before this change started.

## Exception

The owner chose on 2026-11-18 to accept the results above for task 4.2 instead of
waiting for the other session to commit: every failure is attributable to uncommitted
concurrent work, while this change's own edits, tests, generated output, and the three
validators are green. The full green gate is rerun against a quiet checkout before
release.
