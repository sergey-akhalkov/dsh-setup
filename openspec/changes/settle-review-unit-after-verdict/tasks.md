# Tasks

**Single serial lane:** every group edits the same shared hot files —
`packages/plugin-workflows/src/host/index.ts`, `review.ts`, `intake.ts`, `engine-gates.ts`,
`evidence.ts`, and the shared `test/host-wiring.test.ts` / `test/review-host.test.ts` fixtures — so
no independent work lane exists; implement the groups serially in one lane, with
`docs/workflows.md`, the generated output, and the full gate as the serial tail.

## 1. The settled-round read model (owns `packages/plugin-workflows/src/host/review.ts`, `packages/plugin-workflows/test/review.test.ts`)

- [x] 1.1 Add the settled-round lookup to `packages/plugin-workflows/src/host/review.ts`: read the unit's record at the path `reviewRecordPathOf` derives and accept it only when it is well-formed and, for a whole-scope unit, its `digest` equals the live prepared-equivalent digest (`currentSpecDigest` plus `reviewInputTree`, the artifact digest for a spec unit); for a task or section unit, its `digest` equals the digest that run recorded for its round (the snapshot input-tree digest, or the fallback `worktreeDigest` when snapshot creation failed) and, for a section, its `taskIds` equal the run's covered checked-task set. Task and section records stay historical: a later write does not invalidate them (existing `Task-scoped review`). Return the verdict, digest, record path, and covered ids. Verify with `pnpm exec tsc -p packages/plugin-workflows` and `review.test.ts` unit cases for a snapshot match, a stale whole-scope digest, a fallback record, changed coverage, and a malformed record.
- [x] 1.2 Add the step settlement from a stored verdict: a matching `PASS` settles `done` when the step's contract accepts it, a `FINDINGS` settles `blocked` with the verdict, digest, record, and remedies, and a terminal `ERROR` settles `failed` with its failure class; leave an already settled step untouched so a repeated close writes nothing. Verify with a unit test that a second settlement returns the same run object.
- [x] 1.3 Use the lookup in the review executor in `packages/plugin-workflows/src/host/index.ts`: before the unit reservation, snapshot preparation, and enqueue, settle the step from the stored verdict and return without starting a reviewer. A run context carrying `explicitReview: true` bypasses the lookup only while the run's review step holds no published verdict for the requested round; once that verdict exists, the normal settlement applies to every later advance. Verify with `test/review-host.test.ts` that a settled unit never reaches `enqueue`, an explicit start still dispatches one reviewer, and a second close after the explicit round's verdict starts none.
- [x] 1.4 Keep the step walk's accepted-`PASS` shortcut historical: a task or section `PASS` stays accepted after later writes (existing `Task-scoped review`), and the run-level settlement from 1.3 is what stops the repeat. Verify with `test/host-wiring.test.ts` that a later task's write leaves the earlier `PASS` accepted and starts no round.

## 2. Automatic start and due-unit suppression (owns `packages/plugin-workflows/src/host/index.ts`, `packages/plugin-workflows/src/host/engine-gates.ts`)

- [x] 2.1 Suppress a whole-scope review definition for the event in the trigger path (`index.ts` event router): gather the settlement only for review definitions whose event kind and filters already match, skip a settled one, and record a `run-suppressed` row naming the verdict, digest, and the explicit fresh-round action. Verify with `test/host-wiring.test.ts` that a settled spec unit records `run-suppressed` and starts no run, while an unsettled unit still starts.
- [x] 2.2 Report a settled non-`PASS` unit in the unit text (`engine-gates.ts`) as settled (verdict, digest, explicit re-run) instead of a missing `PASS`, and keep the historical task/section `PASS` coverage in `taskReviewPass`/`reviewUnits` unchanged. Verify a settled lane's close text names the verdict and no run starts.
- [x] 2.3 Keep `workflows start` able to create a fresh run whose executor dispatches a reviewer: verify with `host-wiring.test.ts` that an explicit start for a settled unit starts exactly one reviewer.

## 3. The close surface and coverage (owns `packages/plugin-workflows/src/host/index.ts`)

- [x] 3.1 Restrict the close's `reviewOpenRuns` (`index.ts`) to a run the executor holds, an in-flight admission, or a run whose read-time liveness is `waiting`; verify that a blocked run with no executor no longer makes the waiting close.
- [x] 3.2 Surface a settled whole-scope unit in `reviewCloseStatus` (`index.ts`): refuse with the verdict, digest, record, and the two remedies, replacing the current "the next close starts a new round" text. Evaluate the settled verdict for the session's involved changes independently of the session's eligible local runs, so another session's settled non-`PASS` with no local review run still refuses. Verify the refusal text and that no reviewer starts, with and without a local run.
- [x] 3.3 Surface a settled lane unit in the task branch of `reviewCloseStatus` (through the unit text from 2.2) and keep an unsettled due unit's start action unchanged; verify both texts in `host-wiring.test.ts`.

## 4. Section approval reuse (owns `packages/plugin-workflows/src/host/evidence.ts`, `packages/plugin-workflows/test/evidence.test.ts`)

- [x] 4.1 In `packages/plugin-workflows/src/host/evidence.ts`, validate the explicit-start approval check against every covered checked task of a section record (the rule `portableRecoveredEvidence` already applies) and never against the synthetic section record id; a section `PASS` whose covered approvals match settles, a missing or mismatched approval still blocks the step. Verify with `test/review-host.test.ts` and `test/evidence.test.ts` cases for a matching section, one missing covered approval, and a per-task record.

## 5. Regressions (owns `packages/plugin-workflows/test/**`)

- [x] 5.1 `test/host-wiring.test.ts`: a whole-scope `FINDINGS` at the current digest refuses the close, names the verdict and the explicit start, and starts no reviewer on the next close; a changed whole-scope digest and a newly checked section task each start exactly one round, while a task `PASS` followed by a later task's write stays historical coverage and starts no round; a fallback record (snapshot creation forced to fail) settles its run, with an unchanged `FINDINGS` and a `PASS` each starting no reviewer; a foreign session's settled `FINDINGS` with no local run refuses the close and starts no reviewer.
- [x] 5.2 `test/review-host.test.ts`: an explicit start that publishes `FINDINGS` starts no reviewer on the following automatic closes; a matching-digest `PASS` never starts a reviewer, including the stored section run the old approval check blocked.
- [x] 5.3 `test/review-status.test.ts` and `test/host-wiring.test.ts`: a settled run reports `orphaned` with the verdict in its step reason and no new liveness token; a blocked run with no executor no longer makes the waiting close.
- [x] 5.4 `test/recovery-completion.test.ts`, `test/recovery-integration.test.ts`, and `test/review-restart.test.ts`: an interrupted attempt is not a settled round, the next close supersedes it, exactly one fresh round starts, and no record is synthesized.
- [x] 5.5 `test/review-scheduler.test.ts`: a settled unit is rejected before admission and never reaches `enqueue`; the live identity dedupe and the duplicate settlement are unchanged.
- [x] 5.6 Run the focused suites (`pnpm exec vitest run packages/plugin-workflows/test/host-wiring.test.ts packages/plugin-workflows/test/review-host.test.ts packages/plugin-workflows/test/review-scheduler.test.ts packages/plugin-workflows/test/recovery-completion.test.ts packages/plugin-workflows/test/recovery-integration.test.ts packages/plugin-workflows/test/review-restart.test.ts packages/plugin-workflows/test/review-status.test.ts packages/plugin-workflows/test/review.test.ts packages/plugin-workflows/test/evidence.test.ts`) and verify they pass.

## 6. Documentation (owns `docs/workflows.md`)

- [x] 6.1 Update the review-executor paragraph, the lane-unit/gate paragraph, and the runs paragraph of `docs/workflows.md`: a verdict settles its unit at its digest, a fresh round needs a changed digest, changed coverage, or an explicit start that lasts one round, a settled non-`PASS` refusal names the verdict and the explicit action and applies across sessions without a local run, a stale stored `PASS` is due, a cancelled or interrupted attempt is not settled, and a blocked run with no executor no longer makes the waiting close.
- [x] 6.2 Verify `pnpm lint` passes on the edited markdown.

## 7. Generated output and the full gate (owns `packages/plugin-workflows/lib/**`, the vendored setup copy)

- [x] 7.1 Run `pnpm build` and `pnpm gen`, commit the regenerated `packages/plugin-workflows/lib/**` and the vendored setup copy, and verify `pnpm gen:check` exits 0 and `pnpm build` leaves no uncommitted generated diff.
- [x] 7.2 Run `pnpm check` (typecheck, lint, build, test) and `pnpm validate:repo`; verify each exits 0.
- [x] 7.3 Run `openspec validate settle-review-unit-after-verdict --strict` and verify exit 0.

## Workflow follow-up

- Sync the `workflows` delta into `openspec/specs/workflows/spec.md` and archive the change after the owner's approval and the current task-review and spec-review PASS.
- Run `pnpm reviews:check --change settle-review-unit-after-verdict` before archiving; every checked task needs a committed `reviews/<taskId>.json` PASS.
- Release through the repository process (version bump, build, gate, tag, push) when the owner schedules it.
