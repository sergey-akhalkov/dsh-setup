# Task 4.4 gate results

Recorded from the implementation checkout at commit `5166dc3` on 2026-11-16, with a clean
`git status` before each command (the only untracked paths were `.dsh/` scratch state and two
unrelated change directories).

| Command | Exit | Observed result |
| --- | --- | --- |
| `pnpm typecheck` | 0 | `tsc -p tsconfig.check.json`, no errors |
| `pnpm lint` | 0 | 19 warnings and 21 infos, all pre-existing at the base commit |
| `pnpm build` | 0 | 18 workspace packages, 4 client bundles |
| `git diff --exit-code` immediately after `pnpm build` | 0 | no committed-output drift |
| `pnpm exec vitest run --maxWorkers=2` | 0 | 3340 of 3340 tests pass, 0 failed |
| `pnpm gen:check` | 0 | 449 generated files match for 18 plugins |
| `pnpm validate:repo` | 0 | 1147 files scanned, AGENTS.md 15974 bytes of 16000, no problems |
| `pnpm validate:composition` | 0 | setup bundle composes on DSH 0.2.2-rc.2 |
| `pnpm validate:installer` | 0 | install.ps1 enables the setup on DSH 0.2.2-rc.2 |
| `node scripts/workflows-parity.ts --check` | 0 | tracked parity report matches the recomputed table |
| `openspec validate focused-rereview-and-section-steer --strict` | 0 | change is valid |

## Parallelism note

`pnpm check` runs the four checks above in sequence; the recorded test result is its vitest step
with a worker cap. On this host (24 logical processors) the default vitest file parallelism
intermittently pushes unrelated, timing-sensitive suites past the repository's 20 s test timeout
(observed flakes in `plugin-delegation-rules/test/review-queue.test.ts` and the git-backed
integration suites); each such suite passes when run alone and the whole suite passes with a
worker cap. CI runs the same suite on a 4-core `windows-latest` runner.

## Review status at recording time

`node scripts/reviews-check.ts --change focused-rereview-and-section-steer` reported portable
`task-review` PASS for 12 of 13 checked tasks; task 4.4 is the record this evidence accompanies.
