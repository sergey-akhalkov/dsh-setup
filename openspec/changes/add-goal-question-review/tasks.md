# Tasks

## 1. Configuration surface

- [x] 1.1 Add `reviewQuestions?: boolean` to `BlockReviewConfig`, the resolved interface, and the documented defaults (`true`), with boolean validation in `resolveBlockReview`; verify `pnpm build && pnpm exec vitest run packages/plugin-goal-continuity/test/config.test.ts` covers the default, an explicit `false`, and a mistyped value failing load with a field diagnostic.
- [x] 1.2 Add `reviewQuestions: true` under `blockReview` in `packages/plugin-goal-continuity/cordis.fragment.yml`, run `pnpm gen`, and verify `pnpm gen:check` passes with the regenerated patch.

## 2. Subject-aware review core

- [x] 2.1 Generalize the review core from a block-only subject: rename the `buildEvidence` parameter to `subject`, hash `subjectKind` and `subject` in `evidenceDigest`, and label the subject in `composeReviewPrompt` (`Block reason` or `Proposed question`); verify the existing block-review suite still passes unchanged with `pnpm exec vitest run packages/plugin-goal-continuity/test/block-review.test.ts`.
- [x] 2.2 Record the subject on every review record (`subject: "block"` or `"question"`, plus the bounded redacted subject text) in both the verdict record and `recordPolicy`; verify a test reads the record file and asserts the subject field for a block and for a question.

## 3. The question gate

- [x] 3.1 Add the `ask_user_question` branch to the pre-execute `decide`: root agent, current goal `active`, `openTurn(...).goalRound` true, and `reviewQuestions` true; a `not-blocker` verdict denies with the reviewer's `nextStep` and `GOAL_QUESTION_REVIEW_REJECTED`, a `blocker` verdict allows the call; verify deny and allow in `packages/plugin-goal-continuity/test/block-review.test.ts` through a `question()` helper on the harness.
- [x] 3.2 Verify every exclusion starts no review: a direct-human turn, a subagent call, no current goal, a non-`active` goal, and `reviewQuestions: false`; assert `startCalls` stays empty and the call is allowed.
- [x] 3.3 Verify the question path shares the block path's cache, per-goal bound, and `onReviewError` / `onUnavailable` / `onExhausted` policies; assert a reused digest starts no second child, an exhausted bound denies without a review under the default policy, and an unavailable target follows the configured policy.

## 4. Reviewer instruction

- [x] 4.1 Add the questions section to `packages/plugin-goal-continuity/assets/blocker-review.md` (the verdict answers "can the agent answer this itself"; scope-narrowing, partial acceptance, deferring, and difficulty are `not-blocker`; the `(Recommended)` label is not evidence; a reversible recorded assumption is not user-only) and reword the opening to cover a proposed block or question; verify a test asserts the composed question prompt contains the section and the `Proposed question` label.

## 5. Documentation

- [x] 5.1 Document the question gate in `docs/goal-continuity.md`: what is reviewed, the denial behavior, the record subject, the shared bound and policies, the `reviewQuestions` switch, and the residual limit that a justified question still waits in the stock `legacy` ask mode; verify the documented YAML matches the shipped fragment defaults.
- [x] 5.2 Extend the goal-continuity bullet in `docs/plugins.md` and the row description in `packages/plugin-goal-continuity/locale/en.json` to name both review subjects; verify `pnpm lint:fix` leaves no formatting change and the description names the block and the question.

## 6. Verification

- [x] 6.1 Run the full gate and fix any failure: `pnpm build && git diff --exit-code`, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm validate:repo`; confirm the built `packages/plugin-goal-continuity/lib/**` output is committed because it ships prebuilt.

## Workflow follow-up

- Implement under `/openspec-apply-change`, ticking a task only when its stated verification passes and running the task-scoped review the delegation gate requires for each checked task.
- Sync the delta into `openspec/specs/goal-continuity/spec.md` and archive the change once the review-approval gate is satisfied.
