# Tasks

## 1. Package scaffold

- [x] 1.1 Create `packages/plugin-loop-guard` from the Host-only plugin shape: `package.json` with the pinned `engines.dsh` and DSH devDependencies, `cordis.fragment.yml` with row `dsh-setup-loop-guard`, `locale/en.json`, `icon.svg`, `tsconfig.json`, and a root `tsconfig.json` reference. Verify with `pnpm install` and `pnpm typecheck`.
- [x] 1.2 Add the Host entry (`name`, `inject`, `apply`) with the row configuration schema and fail-loud validation, initially inert. Verify `pnpm build` emits `lib/index.js` and `lib/index.d.ts` and the plugin tests can import the built module.

## 2. Detector

- [x] 2.1 Implement the detector: line normalization, blank/short/fenced-code exclusion, per-request repeat counting, cross-block line-hash window, and per-turn reset. Verify with unit tests for synthetic loop text, ordinary prose, fenced code, short lines, cross-block recurrence, and reset.
- [x] 2.2 Add the calibration fixture from the design: a synthetic reasoning block whose fifth repeated line occurs early, plus a normal reasoning sample; assert the detector fires on the first and not on the second, and that the reported preview is capped. Verify with `pnpm exec vitest run packages/plugin-loop-guard/test`.

## 3. Stream cut

- [x] 3.1 Implement the `llm/stream` wrapper: pass chunks through, track block starts/ends and `tool-call-delta`, map `sessionId` to a live agent, and stop consuming on a detector trigger. Verify with a fake async iterable that a cut stops consumption and a pass-through consumes every chunk.
- [x] 3.2 Enforce tool-call safety: no cut while a tool-call block is open; deliver the notice at the next step instead. Verify with a stream that opens a tool-call block before the repetition and with one where the repetition precedes any tool call.
- [x] 3.3 Make the wrapper fail-open: a detector or mapping error must not fail the model request. Verify with a throwing detector/agent lookup and assert the original stream is consumed unchanged.

## 4. Recovery and escalation

- [x] 4.1 Implement the recovery notice and `agent.steer` delivery, including the capped repeated-line preview and stronger wording for the second and third intervention. Each cut below the limit submits one notice; the intervention limit submits none. Check the originating turn signal before steering and drop the notice when the turn was cancelled by `user`, `parent`, or `disposed`. Verify with a fake agent that the notice content follows the escalation step and a user stop during cleanup suppresses the notice.
- [x] 4.2 Implement the step-end reset at `maxInterventionsPerTurn`: record `pendingReset`, subscribe to `session/event` for `step/end`, map `session.id` to the live agent, and cancel synchronously at that boundary with `{ kind: 'hook', reason }` and `keepInbox: true`. Defer every inbox write (remove the guard's own pending notice, then `followup(resetNotice)`) to exactly one microtask after the session-event publication unwinds; never mutate an inbox inside the `session/event` listener, cancel from `agent/pre-step`, or rely on `agent/turn-stopping`. Verify with an attached real SessionStore and a fake agent that no reentrant append is attempted, the follow-up starts exactly once, a completed tool-call block and its result survive, queued user steering is delivered exactly once, a run where every step has a completed non-concluding tool call still resets, and a clean turn clears the reset counter.
- [x] 4.3 Implement the cancellation-cause check in the deferred reset: only the guard's own hook cancellation may start the reset turn. Implement `maxResetsPerSession` and the final stop with no follow-up at the same step-end boundary; the final stop cancels synchronously and performs no deferred inbox write. Verify with a fake agent that a user/parent/disposed cause skips the follow-up, the reset limit is enforced, the stop reason names the repeated line and limits, and no endless reset loop is possible.
- [x] 4.4 Extend the config validation for every field and default from the design, including the detector scope and the unsupported fallback. Verify invalid values fail at load with the field name and valid values start the plugin.
- [x] 4.5 Verify the privacy boundary: the persisted notice message/inbox splice and the turn-end reason carry only the capped preview, and the guard creates no file or log containing streamed reasoning. Verify with a fake-agent assertion over the constructed payloads and the record paths.

## 5. Composition and documentation

- [x] 5.1 Put the documented defaults in the fragment row config, run `pnpm gen`, and verify the generated plugin patch, the setup dependency, and the vendored copy all contain the row; `pnpm gen:check` passes.
- [x] 5.2 Add the bundle to `docs/plugins.md` and a short `docs/loop-guard.md` covering behavior, configuration, the goal-pause trade-off, and the final fallback. Verify `pnpm lint` passes and `pnpm validate:repo` reports no scanned-path or secret issue.
- [x] 5.3 Verify a fresh setup composition mounts the row enabled with the defaults; `pnpm validate:composition` passes.

## 6. Integration verification

- [x] 6.1 In a dev profile with a mock or replay adapter that emits a repeated reasoning stream, verify: the stream ends early and the partial message is committed; the turn continues with the recovery notice; no tool call is dropped or malformed; the adapter stops generating; the result matches the design's D8 gate.
- [x] 6.2 In the same profile, drive the escalation path with a repeated stream after each intervention: verify the step-end reset and follow-up turn, the deferred follow-up starting exactly once after the session-event publication unwinds, a completed tool call and its result surviving the reset, a run where every response has a completed non-concluding tool call before the repetition still resets and stops at the limits, queued user steering delivered exactly once, the reset limit, the final stop reason, and that a user stop during stream cleanup wakes no new turn.
- [x] 6.3 Run the repository gate and record the result: `pnpm build && git diff --exit-code`, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:repo`, and `pnpm validate:composition`.
- [x] 6.4 Confirm the loop-guard source and tests are unchanged by the final setup regeneration; the recorded live mock replay result (cut, tool-result survival, escalation, cleanup) stands because the later worktree changes were admin UI only.

## Workflow follow-up

- Sync the `loop-guard` delta into `openspec/specs/loop-guard/spec.md` after implementation review.
- Archive the change after the repository review requirements are satisfied.
- Include the plugin in the next set release and verify the installer update path.
