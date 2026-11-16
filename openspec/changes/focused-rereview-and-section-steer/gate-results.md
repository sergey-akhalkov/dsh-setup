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
| `pnpm check` | 0 | typecheck, lint, build and the full suite in sequence; 3340 of 3340 tests pass |
| `pnpm exec vitest run --maxWorkers=2` | 0 | 3340 of 3340 tests pass, 0 failed |
| `pnpm gen:check` | 0 | 449 generated files match for 18 plugins |
| `pnpm validate:repo` | 0 | 1147 files scanned, AGENTS.md 15974 bytes of 16000, no problems |
| `pnpm validate:composition` | 0 | setup bundle composes on DSH 0.2.2-rc.2 |
| `pnpm validate:installer` | 0 | install.ps1 enables the setup on DSH 0.2.2-rc.2 |
| `node scripts/workflows-parity.ts --check` | 0 | tracked parity report matches the recomputed table |
| `openspec validate focused-rereview-and-section-steer --strict` | 0 | change is valid |

## Parallelism note

`pnpm check` chains the typecheck, lint, build and test steps. The vitest pool is capped at four
workers in `vitest.config.ts` to match the 4-core CI runner: with an uncapped pool this 24-logical-
processor host oversubscribed the disk and unrelated, timing-sensitive suites intermittently missed
the repository's 20 s test timeout (observed in `plugin-delegation-rules/test/review-queue.test.ts`
and the git-backed integration suites). Each such suite passed alone, and the full suite passed at
two and four workers. The cap changes no test and no assertion.

## Post-install verification

0.41.1 was installed from the published index on 2026-11-17. The live profile reports `@dsh-setup/setup`
and `@dsh-setup/plugin-workflows` at 0.41.1, the workflows host health reports six listeners with a
writable journal and nine triggers, and the worktree was clean at the release commit before this
record was added.

## Review status at recording time

`node scripts/reviews-check.ts --change focused-rereview-and-section-steer` reported portable
`task-review` PASS for 12 of 13 checked tasks; task 4.4 is the record this evidence accompanies.
