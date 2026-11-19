# Verification

Gate results for the reviewed revision of `fix-review-run-liveness` (source commits through
`09ecef0`, which also carries the sibling `show-review-status` live-read, session-mark, label and
snapshot-ignore slices). Run from the repository root of a tree with dependencies installed; the
task-review snapshot carries no `node_modules`, so this file is the gate evidence the review reads.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm check` | 0 | typecheck, lint, build and the full suite in sequence: 166 test files, 3071 tests passed |
| `pnpm validate:repo` | 0 | 1355 files scanned, 18 plugin packages, AGENTS.md 15904 bytes (budget 16000), no problems |
| `pnpm gen:check` | 0 | 676 generated files match their sources |
| `pnpm build` then `git diff --exit-code` | 0 | the build leaves the committed tree byte-identical; only the untracked sibling change directory remains |
| `openspec validate fix-review-run-liveness --strict` | 0 | the change is valid with its ADDED and MODIFIED requirements |

The focused suites that exercise the new behavior passed inside `pnpm check`: host-wiring (including
the live-coverage reuse, the concurrent-start reuse window, the duplicate-admission settlement with a
live incumbent, the status liveness tokens, the three restart-supersede definitions, the resumed
predecessor that must not be cancelled and the interrupted intake that must be preserved), review,
review-host, review-scheduler and review-queue.
