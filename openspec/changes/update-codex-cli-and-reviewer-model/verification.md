# Full gate evidence (task 4.2)

Recorded 2026-11-18. The commands were first run in the shared checkout while a second
session held uncommitted edits in `packages/plugin-workflows/**`; `pnpm check` and
`git diff --exit-code` failed there on that session's files, not on this change.

The same commands were then run against this change's committed tree in a clean
worktree (`verify-quiet-gate`, base commit `d2261c7`). Every command exits 0 there:

| Command                     | Result                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm install`              | exit 0                                                                              |
| `pnpm build`                | exit 0 (17 workspace packages, 4 client bundles)                                    |
| `git diff --exit-code`      | exit 0: the build leaves the committed tree byte-identical                           |
| `pnpm check`                | exit 0: typecheck, lint, build, and the full suite (160 files, 2912 tests)           |
| `pnpm validate:repo`        | exit 0 (1092 files scanned)                                                         |
| `pnpm validate:composition` | exit 0                                                                              |
| `pnpm validate:installer`   | exit 0                                                                              |

The shared-checkout failures are the concurrent session's uncommitted work:
`docs/openspec-status.md`, `docs/workflows.md`,
`openspec/changes/ignore-archived-change-involvement/**`,
`packages/plugin-workflows/src/host/{condition,engine-gates,index}.ts`, and the tests
beside them. None of those paths belongs to this change.

The temporary worktree carried no change of its own and was removed after the run.
