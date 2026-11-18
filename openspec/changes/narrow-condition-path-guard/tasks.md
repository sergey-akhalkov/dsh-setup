# Tasks

Single lane (serial): the guard and its tests, then the error state and its tests, then generated
`lib/**` and the serial full gate. A parallel writer would cost more than this diff.

## 1. Guard: condition.ts and its boundary tests (lane: `src/host/condition.ts`, `test/condition.test.ts`)

- [x] 1.1 In `packages/plugin-workflows/src/host/condition.ts`, apply `assertNoPath` only to `event.path`, `event.command`, and each lane's `owned` globs, delete the task-text and lane-title checks, and rewrite the boundary comment to name prose as owner-authored input. Mask every non-`file:` `scheme://…` span before the retained checks, keeping `file:` URLs, drive, UNC, traversal, delimiter-adjacent absolute POSIX paths, and shell redirection rejected. Verify with 1.2 that a context builds for prose containing `https://example.invalid`, `sidebar://worktrees`, ``refuses `mv`/archive``, and an absolute POSIX path, while a drive, UNC, or traversal value on a lane owner or in the event fields is still rejected; a non-`file:` URL stays accepted there and a `file:` URL is rejected.
- [x] 1.2 In `packages/plugin-workflows/test/condition.test.ts`, invert the prose-rejection cases into build assertions, move each retained rejection to a lane owner or an event field so drive, UNC, traversal, and delimiter-adjacent absolute paths stay covered, and add a non-`file:` URL in `event.command` and in `event.path`, including query parameters (`https://example.invalid/?a=1&next=/archive`), that builds next to a `file:` URL and an unquoted URL followed by a redirection that reject. Verify `pnpm exec vitest run packages/plugin-workflows/test/condition.test.ts` passes and the suite names each accepted prose case and each retained rejection.

## 2. Error state: triggers.ts, index.ts, and its tests (lane: `src/host/triggers.ts`, `src/host/index.ts`, `test/condition.test.ts`, `test/host-wiring.test.ts`)

- [x] 2.1 Add an optional `conditionError` to `DefinitionEvaluationContext`, answer `reason: 'error'` with the fixed bounded detail `the condition context could not be built` for every condition-bearing definition, forward it through `evaluateDefinitions`, and return `{ conditionError }` from `conditionsFor` instead of the all-false map; unconditional definitions still evaluate. Verify a unit test in `packages/plugin-workflows/test/condition.test.ts` records the `error` row with its detail, keeps `condition-false` for a built context, and leaves an unconditional row unchanged.
- [x] 2.2 In `packages/plugin-workflows/test/host-wiring.test.ts`, assert a turn close whose lane ownership carries an absolute path records the `error` rows for `spec-review` and `integration-review`, starts no conditional run, keeps the health cause, and still evaluates `task-review` from the same event. Verify `pnpm exec vitest run packages/plugin-workflows/test/host-wiring.test.ts` passes.

## 3. Serial tail: docs, build, and the full gate

- [x] 3.1 Update the `condition` paragraph in `docs/workflows.md` with the context boundary (prose is carried as-is; the guard covers `event.path`, `event.command`, and lane ownership; a URL is not a path; a failed build records an error) and verify the page links resolve and `pnpm lint` accepts it.
- [x] 3.2 Run `pnpm build` so the committed `packages/plugin-workflows/lib/**` matches the source, then `pnpm exec vitest run packages/plugin-workflows/test/condition.test.ts packages/plugin-workflows/test/triggers.test.ts packages/plugin-workflows/test/host-wiring.test.ts`; verify the focused suites pass and a second `pnpm build` leaves no further `lib/**` diff.
- [x] 3.3 Run `pnpm check`, `pnpm validate:repo`, and `openspec validate narrow-condition-path-guard --strict`; verify all pass and the new fixtures contain no machine path (compose drive strings at runtime as the existing tests do), and record each command with its exit status and summary in `verification.md`.
- [x] 3.4 Run `pnpm gen` so the vendored setup copies under `packages/setup/node_modules/@dsh-setup/**` carry the rebuilt workflows runtime, then `pnpm gen:check`; verify it reports every generated file matching its sources.

## Workflow follow-up

- Request the task-review PASS for each checked task (`pnpm reviews:check --change narrow-condition-path-guard`) before archiving.
- Archive the change with the spec sync after the review approvals exist, then verify the archived entry and the released `lib/**`.
