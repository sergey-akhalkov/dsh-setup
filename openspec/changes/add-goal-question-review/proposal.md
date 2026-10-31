# Proposal

## Why

The autonomy contract has one enforced exit from an autonomous goal round, `update_goal` with
`action: "blocked"`, and a second, unreviewed one, `ask_user_question`. A recorded live run showed the
failure: after dozens of successful steps the agent asked a three-option question whose first option
was its own recommendation to continue the full objective, and the legacy ask tool held the turn open
until the owner woke up hours later. The same decision is reviewed when the model presents it as a
block and passes unreviewed when it presents it as a question, so the block review can be bypassed by
rephrasing. The contract text already forbids that pause; only a mechanical gate can enforce it.

## What Changes

- The existing independent block review becomes a **user-decision review** with two subjects. It
  reviews a root agent's `ask_user_question` call as well as a proposed `blocked` update, and denies
  the question when an authorized route lets the agent decide and continue itself.
- A new `blockReview.reviewQuestions` field (default `true`) enables that half; `false` keeps the
  question unexamined while block review stays on.
- The reviewer instruction gains a question section: a question that proposes narrowing the scope,
  accepting a partial result, deferring, or avoiding difficulty is `not-blocker`, and the agent's own
  `(Recommended)` label is not evidence of necessity.
- A rejected question denies the tool call with the reviewer's next action as the reason and the turn
  continues in place: the goal is never blocked, paused, resumed, or otherwise changed by this gate.
- Review records gain a `subject` (`block` or `question`); the digest, the per-goal bound, the cache,
  and the error/unavailable/exhausted policies are shared with the block half.
- Reviewer-scoped evidence, the read-only preset, and the child-scope allowlist are unchanged and
  reused.

Not in scope: the `@deepseek-ai/dsh-tool-ask-user` row stays stock. A genuinely user-only question
still waits for the user in `legacy` mode, and switching that row to `timed` mode is an owner-level
profile decision outside this bundle.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `goal-continuity`: the pre-execute gate gains the `ask_user_question` subject, a new question-review
  requirement set, the `reviewQuestions` default and off switch, and the boundary text that names the
  gate's second subject.

## Impact

- `packages/plugin-goal-continuity/src/host/index.ts`: the second gate branch, the subject-aware
  evidence/digest/prompt, the `reviewQuestions` field and its validation, one rejection code, and the
  record's `subject`.
- `packages/plugin-goal-continuity/assets/blocker-review.md`: the question section and the
  block-or-question framing.
- `packages/plugin-goal-continuity/cordis.fragment.yml`: `reviewQuestions: true`; `pnpm gen` regenerates
  the patch.
- Tests under `packages/plugin-goal-continuity/test/`: the question path of the gate, its exclusions,
  cache, bound, policies, record subject, and config validation.
- `docs/goal-continuity.md`, `docs/plugins.md`, and `packages/plugin-goal-continuity/locale/en.json`.
- No new dependency, no DSH support change, no new row or preset, no tracked machine-local state.
