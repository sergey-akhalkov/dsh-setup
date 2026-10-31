# Design

## Context

See `proposal.md` for motivation. The current state that shapes the approach:

- The plugin already owns one `tools/pre-execute` gate for `update_goal` with `action: "blocked"`.
  It builds a bounded, redacted evidence bundle, runs one fresh-context read-only child on the
  `goal-reviewer` preset, parses one strict verdict, writes a digest-bound record, and applies a
  per-goal bound and three policies. That machinery has no dependency on the block subject.
- The harness ask tool ships in `legacy` mode: a call blocks the turn until a human answers. The
  `timed` mode exists upstream but belongs to a stock bundle row this repository does not own, and
  `tools/pre-execute` cannot rewrite call arguments ("input rewriting is excluded"), so the plugin
  can only allow or deny a question.
- A denied pre-execute call materializes its reason as the tool result and the turn continues in the
  same step. It does not end the turn, restart a goal round, or touch the goal.
- The work-checkpoint trigger already excludes a turn whose last call is `ask_user_question`; a denied
  question never executes, so the model keeps working and that exclusion stays correct for questions
  that are genuinely allowed.

## Goals / Non-Goals

**Goals:**

- Close the unenforced second exit from a goal round with the machinery that already gates the first.
- Keep the question gate strictly stateless with respect to the goal: it returns a tool-call decision
  and nothing else.
- Keep one configuration surface, one budget, one record family, and one reviewer prompt.

**Non-Goals:**

- Changing the stock ask tool row, its mode, or its per-call timeout.
- Reviewing questions outside an active goal or outside a goal round.
- Reviewing a turn that ends with a text question but no ask call: the goal driver already continues
  that turn, so there is nothing to hold open.
- A second prompt, preset, or store for questions.

## Decisions

### D1. One gate, two subjects, not a second gate

The `tools/pre-execute` listener keeps a single entry point. `decide` dispatches on the execution name:
`update_goal` keeps the existing block path, `ask_user_question` takes the new path, and both end in
the same `runReview`, `countReviewAttempts`, `cachedVerdict`, `recordPolicy`, and `verdictDecision`
helpers. The build functions are generalized: `buildEvidence`'s `blockReason` parameter becomes
`subject`, `evidenceDigest` hashes the subject instead of the block reason, and
`composeReviewPrompt` labels the subject by kind.

*Alternative rejected:* a second plugin or a second listener with its own config, prompt, and records.
It duplicates the reviewer, the preset, the allowlist, the budget, and the policies for one more
subject.

### D2. Only goal rounds of an active goal

The gate fires only when the current goal is `active` and `openTurn(agent, goal).goalRound` is true.
A direct-human turn means the user is present and asking is legitimate; a turn with no active goal is
not under continuity supervision at all. A subagent call is excluded exactly as the block path
excludes it.

*Alternative rejected:* gating every root-agent question. It would interrupt a live conversation,
where the user can answer in seconds, and it would need its own policy for goals the plugin does not
supervise.

### D3. The subject is the normalized call arguments

The question subject is the JSON-normalized `exec.arguments` string, bounded and redacted like the
block reason. No typed question schema is parsed.

*Alternatives rejected:* reading `questions[]` fields. The `legacy` and `timed` tool definitions differ
in their parameters (the timed one adds `timeout` and can return `pending`), and a hand-rolled schema
would drift with the upstream tool; the reviewer is told to judge the proposed text, and the
serialized arguments carry everything the model proposed.

### D4. `blocker` means "only the user can answer"

The verdict vocabulary is unchanged. For a question, `blocker` allows the call (the answer is
user-only) and `not-blocker` denies it with the reviewer's `nextStep` as the reason. No new verdict
values.

*Alternative rejected:* an `ask`/`decide` verdict pair. It would need a second prompt schema, a second
parser branch, and a second record field for the same binary decision.

### D5. `reviewQuestions` stays inside `blockReview`

One new optional boolean on the existing config object, default `true`, validated as a boolean. The
section keeps its name for profile compatibility; the docs describe the section as the user-decision
review with a block subject and a question subject.

*Alternative rejected:* a top-level `questionReview` section. It would either duplicate the provider,
model, preset, timeout, policies, and bound or add an inheritance rule — more surface for one switch.

### D6. Shared bound and shared policies

Question and block reviews spend the same `maxReviewsPerGoal` units and use the same
`onReviewError`, `onUnavailable`, and `onExhausted` values. The digest includes the subject kind, so a
block and a question with identical text never share a cached verdict.

*Alternative rejected:* a separate question bound. It doubles the budget state and adds a config field
for a case the shared bound already bounds.

### D7. Deny, do not allow-and-steer

A `not-blocker` verdict returns `{ kind: 'deny', reason, info: { name: 'goal-question-review',
code: 'GOAL_QUESTION_REVIEW_REJECTED' } }`. The reason names the reviewer's next action and tells the
model to record the assumption in its next `work_checkpoint`. The model continues the same turn.

*Alternative rejected:* allowing the call and steering a notice afterwards. The call already blocks the
turn, so a notice cannot unblock it.

### D8. The reviewer instruction carries the question rules

`assets/blocker-review.md` gains a questions section: the verdict answers "can the agent answer this
itself"; a question that proposes narrowing the scope, accepting a partial result, deferring, or
avoiding difficulty is `not-blocker`; the model's own `(Recommended)` label is not evidence; a
reversible choice the agent makes and records is not user-only; a menu whose other option is the
autonomous route is not a user decision. The block section is unchanged.

### D9. Records keep their directory and gain a subject

The record stays under `.dsh/goal-continuity/block-review/<goal-id>/<digest>.json` and gains
`subject: "block" | "question"` plus the bounded question text. The path is machine-local scratch, the
digest already separates subjects, and renaming the directory would churn the docs, tests, and any
record an operator reads.

### D10. The work-checkpoint exclusion stays

A turn whose last call is a denied `ask_user_question` is not a substantial pause: the denial is an
error result, the model keeps working, and the following calls decide the turn. An allowed question is
a genuine user pause, and the existing exclusion keeps that turn from asking for a checkpoint it
cannot produce.

### D11. `timed` mode is out of scope

Switching the stock ask row to `timed` would bound a genuinely user-only question, but the row belongs
to `@deepseek-ai/dsh-base`, this repository owns no row for it, and a profile-level override is the
owner's decision. The gate makes asking rare and justified; it does not shorten a justified wait.

## Implementation outline

| Area | Change |
| --- | --- |
| Config | `BlockReviewConfig.reviewQuestions?: boolean`; resolved and default `true`; boolean validation; fragment `reviewQuestions: true` |
| Gate | `decide` branch on `exec.name === 'ask_user_question'`: root agent, active goal, goal round, switch on |
| Evidence | `buildEvidence(agent, goal, subject, workspace)`; `evidenceDigest(goal.objective, subjectKind, subject, evidence)`; prompt header `Proposed question` or `Block reason` |
| Verdict | `not-blocker` denies with the question code and a question-specific reason; `blocker` allows |
| Record | `subject: 'question'`, bounded redacted question text, same target, policies, time, session |
| Prompt asset | `blocker-review.md` question section and block-or-question framing |
| Tests | question path, exclusions, cache, shared bound, policies, record subject, config validation |

## Risks / Trade-offs

- **[A real clarification is denied]** → the reviewer defaults to `not-blocker` only when a route
  exists; the instruction requires a concrete `nextStep`; the denial lets the model proceed with a
  recorded assumption, so a wrong assumption is visible in the next round and in the checkpoint.
- **[Review latency and cost per question]** → only goal rounds are reviewed and the per-goal bound
  caps spend; a cached subject is free.
- **[Questions consume the block budget]** → the default `onExhausted: deny` preserves the active goal
  rather than allowing an unverified block; an operator who needs more reviews raises
  `maxReviewsPerGoal`.
- **[A justified question still waits indefinitely in legacy mode]** → documented as an owner-level
  profile decision; the gate removes the unjustified waits, which is the recorded failure.
- **[Denial loop: the model rephrases and asks again]** → a rephrased question changes the digest and
  costs another review until the bound is spent, after which the exhausted policy denies without a
  review. The record shows the repeated subject.

## Migration Plan

The field is additive with a default, so an existing profile loads unchanged and the behavior applies
as soon as the regenerated patch is installed. Rollback is `blockReview.reviewQuestions: false`
(question review only) or disabling the row (the whole plugin). No data migration: records stay
machine-local scratch under `.dsh/`.
