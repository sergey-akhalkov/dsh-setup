# Tasks

## 1. Package scaffold

- [x] 1.1 Create `packages/plugin-goal-continuity` from the Host-only plugin shape: `package.json` with the current repository version, the exact `engines.dsh`, `@deepseek-ai/cordis` peer, and pinned `dsh-goal`, `dsh-agent`, `dsh-session`, `dsh-llm` dev dependencies; `cordis.fragment.yml` with row `dsh-setup-goal-continuity` and the documented defaults; `locale/en.json`, `icon.svg`, `tsconfig.json`, and the root `tsconfig.json` project reference. Verify `pnpm install` and `pnpm typecheck` pass.
- [x] 1.2 Add the Host entry (`name`, `inject`, `apply`) with the row configuration schema and fail-loud validation, initially inert. Verify `pnpm build` emits `lib/index.js` and `lib/index.d.ts` and a test imports the built module.
- [x] 1.3 Verify the package manifest shape against the repository validator: `pnpm validate:repo` accepts the new package, its engine pin, exports, files, fragment row id, and locale/icon.

## 2. Loop-guard abort cause

- [x] 2.1 Change the loop-guard's reset and final cancellation reasons to start with `loop-guard:reset:` and `loop-guard:final:` while keeping the existing human-readable text and all detection, limits, and notices unchanged. Verify the existing loop-guard tests and new assertions for both prefixes and for the own-reset recognition pass with `pnpm exec vitest run packages/plugin-loop-guard/test`.
- [x] 2.2 Confirm the final stop still has no follow-up turn and the reset still schedules its follow-up; verify the loop-guard test that covers the final-stop path and the reset path.

## 3. Supervisor core

- [x] 3.1 Implement config resolution and per-agent state for `enabled`, `resumeAfterRestart`, `resumeAfterUserStop`, `maxSessionResumes`, `roundExtension`, `maxRoundExtensions`, and `hardMaxGoalRounds`; reject unknown fields and invalid values at load. Verify with unit tests for defaults, every invalid value, and unknown fields.
- [x] 3.2 Implement deterministic signal tracking: `turn/end` reason kinds and nested cause, goal-round detection from a direct `user/message` whose source is `goal`, `goal/activation-changed`, `goal/changed`, `agent/error`, agent/session resolution, and fork/subagent exclusion from the session header. Verify with synthetic event sequences and a fake agents service, including a forked/subagent session that is left untouched.
- [x] 3.3 Implement the deferred reconciliation of an `active + disarmed` root goal: schedule after the dispatch settles, enforce suppression, re-read on a stale revision, and resume once. Verify with fake goal-service tests for the non-goal-abort scenario, a stale reference, and an exhausted/blocked state that must not be resumed.
- [x] 3.4 Implement the restart policy from the design: compare the session creation time with the plugin mount time, fall back to a first-observation flag when the header lacks it, and skip the first resume when `resumeAfterRestart` is false. Verify that a restored session stays disarmed by default, resumes once with the flag true, and a later in-process disarm still reconciles.
- [x] 3.5 Implement the user-stop policy: goal-round abort suppresses until the next direct user message; non-goal-turn abort re-arms with `non-goal` and suppresses with `never`; each path leaves one decision. Verify with fake event sequences for all three cases and for a following direct user message that clears suppression.
- [x] 3.6 Implement suppression for user pause/clear/complete, `model-reported` blocks, `loop-guard:final:` and unrecognized hook causes, `max-tokens`, and `agent/error`, cleared only by a direct user message. Block an active goal with a bounded, trimmed `continuity-stopped` reason; leave a goal paused by the user unchanged. Verify that none of these paths calls `resume`, that final and unknown hook causes block even on a non-goal turn, and that the disabled row or `enabled: false` performs no disarm, resume, extension, block, suppression, or notice.

## 4. Reset continuation and cap extension

- [x] 4.1 Implement pause prevention: for a goal-round `turn/end` with any hook cause (reset, final, or unrecognized), disarm the goal in the `turn/end` dispatch, before the driver's later idle settlement, so no pause is recorded; record a terminal suppression before the disarm so the deferred reconcile cannot resume it; never disarm for a user abort and never change a paused goal. Verify with a fake sequence where `turn/end` precedes the idle pause and the driver skips the pause, a final cause also skips it and is then blocked, an unrecognized hook cause skips the pause and is then blocked, a user abort keeps its pause, and a reversed event order (idle first) leaves the goal paused and is never resumed.
- [x] 4.2 Implement the reset continuation after prevention: reconcile the active+disarmed goal through the resume budget; when `roundsStarted` is at or above `maxGoalRounds`, extend the cap by `roundExtension` under the per-goal extension budget, then resume; when the budget or the hard total cap is exhausted, block the active goal with `continuity-stopped`. Also implement the `round-limit` block extension path; on exhaustion keep the native `round-limit` block and inject a non-waking notice. Never change a `model-reported` block. Verify with fake-service tests for reset continuation, the reset-at-cap extension, the `round-limit` extension, the reset exhaustion (blocks), the `round-limit` exhaustion (keeps the native block), the hard cap, `model-reported`, and a stale revision.
- [x] 4.3 Wire the shared per-session resume budget for reconciliation and extension resumes; a completed goal round must not refill it; exhaustion stops automatic continuation. Verify the 21st resume is refused and the active goal is blocked with `continuity-stopped` and the exhausted budget.

## 5. Notices

- [x] 5.1 Implement the notice as a bounded `UserMessage` with source `goal-continuity` and form `notice`, delivered with non-waking `agent.inject`; never use `followup` or `steer`. On a terminal refusal block the active goal with `continuity-stopped`; a goal paused by the user is left unchanged. Declare the source in `MessageSourceMap`; fail open on a disposed agent. Verify the payload shape, the text bound, the absence of the objective text, that an idle agent stays idle after delivery, that no path calls `followup`/`steer`, and that a disposed agent does not throw.
- [x] 5.2 Verify every automatic resume or extension produces exactly one notice and every terminal refusal leaves exactly one visible record naming the cause, the remaining budget, and the next action; the record is a `continuity-stopped` block on the active goal or the native `round-limit` block; a user-paused goal is unchanged; a disabled row emits none. Verify with fake-agent assertions over all decision paths.

## 6. Working contract

- [x] 6.1 Add the goal-round policy to the existing working-principles section: no round ends only to wait, use `job_output(wait: true)` or independent work, a timeout is not a blocker, `blocked` needs three consecutive rounds with the same checkable obstacle, `complete` needs current evidence, and goal creation omits `max_goal_rounds` unless the user asked. Keep it in the existing section, not a second one. Verify the measured contribution stays within the documented 1500 estimated-token budget and the guidance validation passes.
- [x] 6.2 Confirm the goal policy is visible in a session started with the working-principles row active, and that the text names no command the Harness does not provide. Verify with the repository's guidance test or a prompt assembly check.

## 7. Composition, market metadata, and documentation

- [x] 7.1 Put the documented defaults in the fragment row config, run `pnpm gen`, and verify the generated plugin patch, the setup dependency, and the vendored copy all contain the row; `pnpm gen:check` passes.
- [x] 7.2 Add the root `README.md` plugin row and the `docs/plugins.md` entry (role, behavior, configuration, defaults, the default-off restart policy, and the off switch), the market locale title/description, and the icon; verify `pnpm lint` and `pnpm validate:repo` pass.
- [x] 7.3 Verify a fresh setup composition mounts the row enabled with the defaults and that a disabled row or `enabled: false` restores stock behavior; `pnpm validate:composition` passes.

## 8. Integration verification

- [x] 8.1 Run the repository gate and record the result: `pnpm build && git diff --exit-code`, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:repo`, and `pnpm validate:composition`.
- [ ] 8.2 Live acceptance by the owner, never by an agent-hosted session: fully quit and relaunch the Desktop app, then with a short goal verify a goal-round reset resumes with one notice and no pause, a non-goal user stop re-arms with one notice, a terminal stop leaves a visible `continuity-stopped` block with no new turn, a restart stays disarmed by default, `/goal pause` stays final, and `resumeAfterRestart: true` resumes once after a restart.
- [ ] 8.3 Optional forced-reset check in a throwaway profile with a lowered loop-guard threshold and a short goal: verify the reset is translated into a resume and the notice names the retry budget; do not touch the live Desktop profile.

## Workflow follow-up

- Sync the `goal-continuity`, `session-guidance`, and `loop-guard` deltas into the main specs after implementation review.
- Archive the change after the repository review requirements are satisfied.
- Include the plugin in the next set release and verify the installer update path.
