# Tasks

The change is one lane: every group edits the shared `packages/plugin-delegation-rules/src/host/index.ts` review start/publish path and the shared `ReviewFinding` type; two writers would conflict. Tests and docs land with the group that owns the behavior.

## 1. Finding class in the review contract (owns `packages/plugin-delegation-rules/src/shared/approval.ts`, `packages/plugin-delegation-rules/src/host/index.ts`, `packages/plugin-delegation-rules/assets/delegation-rules/review-*.md`, `packages/plugin-delegation-rules/test/approval.test.ts`, `packages/plugin-delegation-rules/test/verdict.test.ts`, `packages/plugin-delegation-rules/test/engine.test.ts`)

- [x] 1.1 Extend `ReviewFinding` with the optional class and add the normalization helper; accept the fixed vocabulary, map an absent or unknown value to `other`, and keep the portable PASS parser unchanged. Verify with `pnpm build` then `pnpm exec vitest run packages/plugin-delegation-rules/test/approval.test.ts`.
- [x] 1.2 Update `review-spec.md`, `review-task.md`, and `review-integration.md` to request `class` in the findings example and list the vocabulary; verify the assets test sees the field in all three instructions.
- [x] 1.3 Update `parseVerdict` and the local record writer to store the normalized class and to include it in the formatted finding text; verify a classed finding, an absent class, an unknown class, and a PASS with no findings, and confirm a malformed class never rejects the verdict.
- [x] 1.4 Append one bounded sanitized finding-history entry from `completeReviewRun()` after `publishRecord()` returns and the publish lock is released, outside the publication error path, and nothing when a matching record is reused; catch the append inside the history helper so it never throws into the completion path, attempt one bounded `gap` marker on failure, and do not retry inside the same completion. Verify a FINDINGS then PASS sequence retains the findings, a reused record adds no entry, a failed append after FINDINGS and a failed append after PASS leave the verdict, local record, findings, and portable PASS unchanged and write no ERROR record, the gate still accepts the PASS, the gap is reported by the retro or the run status detail, and the history carries no prompts, credentials, or machine paths.

## 2. Lesson store (owns `packages/plugin-delegation-rules/src/host/lesson-store.ts`, `packages/plugin-delegation-rules/test/lesson-store.test.ts`)

- [x] 2.1 Add the local store under `.dsh/review-learning/<workspaceKey>.jsonl` with the stable workspace key, atomic append, tolerant read, and malformed-line count; verify a write/read round trip, a missing file, and a malformed line.
- [x] 2.2 Implement the dedupe key and the 200-lesson or 1 MB bound, retaining applied lessons and evicting the oldest non-applied lesson first; when no non-applied lesson exists, refuse the write atomically with `capacity` and leave existing records unchanged; verify a duplicate, a full store, and an applied-only full store.
- [x] 2.3 Implement bounded fields, source evidence, and the no-tracked-file rule; verify a 4 KB body is truncated, a machine path is not stored, and `git status` sees no new tracked file.

## 3. Lesson lifecycle and user approval (owns `packages/plugin-delegation-rules/src/host/learning-tools.ts`, `packages/plugin-delegation-rules/test/lesson-lifecycle.test.ts`)

- [x] 3.1 Add `review_lesson` with `list`, `propose`, `decide`, and `apply`; validate ids, classes, titles, bodies, targets, and transitions before effects; verify proposed to accepted, proposed to rejected, accepted to applied, and a refused invalid transition.
- [x] 3.2 Route accept, reject, and apply through `userQuestions.ask` with a bounded question naming the class, title, body preview, and source; verify a yes answer applies the transition, a no answer leaves the lesson unchanged, and a model-supplied answer cannot be used.
- [x] 3.3 Require an applied lesson to name a change, spec, file, or test and record the time; verify an application without a target is refused and a valid one is readable in `list`.
- [x] 3.4 Bind every accept, reject, and apply answer to the exact lesson revision; reject a stale answer and name the current revision; verify a duplicate proposal for an accepted lesson creates a proposed revision without changing the accepted content.

## 4. Deterministic retro report and metric (owns `packages/plugin-delegation-rules/src/host/retro.ts`, `packages/plugin-delegation-rules/src/host/finding-history.ts`, `packages/plugin-delegation-rules/test/retro.test.ts`, `packages/plugin-delegation-rules/test/finding-history.test.ts`)

- [x] 4.1 Add `review_retro` `report` reading the sanitized finding history (default 50, max 200), returning counts, top class, up to three bounded examples, and skipped/malformed and gap counts; verify a mixed window, an empty window, a malformed record, a gap marker, and a FINDINGS then PASS sequence that still sees the findings.
- [x] 4.2 Implement the normalized title hash, the repeat count and rate per class, and the 4000-character output bound; verify a repeated title counts, a first occurrence does not, and a long report is truncated with a marker.
- [x] 4.3 Add `propose` producing at most one draft with title, body, `appliesTo`, and source finding hashes; verify no model call, no file edit, and that a duplicate draft merges by the store key.
- [x] 4.4 Add a FINDINGS then PASS history fixture and verify the retro report counts the earlier finding once even though the current review record is PASS.

## 5. Prompt injection (owns `packages/plugin-delegation-rules/src/host/index.ts` reviewPrompt, `packages/plugin-delegation-rules/test/prompt.test.ts`)

- [x] 5.1 Load matching accepted and applied lessons before `reviewPrompt` and append a bounded `## Lessons from prior reviews` section before the output contract; verify only matching rules and capabilities are included.
- [x] 5.2 Enforce the three-lesson and 1200-character bounds, sanitize control characters, and add the judgment sentence; verify an oversized body is truncated and an injected instruction-shaped finding remains data.
- [x] 5.3 Verify that no matching lesson makes the prompt byte-identical to the classification-aware instruction with lesson injection disabled, and that proposed or rejected lessons are never injected.

## 6. Interfaces, configuration, and verification (owns `packages/plugin-delegation-rules/src/host/index.ts`, `packages/plugin-delegation-rules/cordis.fragment.yml`, `packages/plugin-delegation-rules/package.json`, `packages/plugin-delegation-rules/test/config.test.ts`, `docs/delegation-rules.md`)

- [x] 6.1 Register the `review_retro` and `review_lesson` tools and the `/review-retro` command with descriptions naming the user-approval rule; verify the tools are absent when `reviewLearning.enabled` is false.
- [ ] 6.2 Add `reviewLearning` config with `enabled`, `window`, and `maxLessons` defaults and fail-loud validation; verify defaults, an invalid window, and the disabled path.
- [ ] 6.3 Document the class vocabulary, the store path, the user-approval transitions, the injection bound, the repeat metric, and the opt-out in `docs/delegation-rules.md`; verify the documented commands and paths.
- [ ] 6.4 Run `pnpm build` first, then add every emitted `lib/host/{lesson-store,learning-tools,retro,finding-history}.{js,d.ts}` to `files` in `packages/plugin-delegation-rules/package.json`, and run `pnpm gen` after the build so the vendored setup tree contains them. Verify the package's `files` list, the `pnpm pack` tarball, and `packages/setup/node_modules/@dsh-setup/plugin-delegation-rules/lib/host/` all contain the eight emitted files, and load the packed package from a temporary install outside the source checkout with the package's dependencies available, so a host module missing from the tarball fails to resolve.
- [ ] 6.5 Run `pnpm gen:check`, `pnpm validate:repo`, `pnpm validate:composition`, `pnpm test`, and `openspec validate learn-from-review-findings --strict`; verify all pass and the vendored setup tree still carries the new modules.

## Workflow follow-up

- Run one real task review with a classed finding, then `/review-retro`; confirm the report, the proposed lesson, the user acceptance, and the next review's injected section.
- Archive the change after the project's review requirements are satisfied; do not auto-accept or auto-apply a lesson.
