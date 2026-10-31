# Goal continuity, user-decision review, and work checkpoints

`@dsh-setup/plugin-goal-continuity` keeps an active goal alive across recoverable harness stops,
reviews every model-proposed goal block and every goal-round user question with one independent,
bounded, read-only model call before either can end or hold the run, and requires one structured work
checkpoint before a substantial root turn closes and at each configured step interval. The supervisor
is deterministic; the user-decision review is that one model call; the checkpoint gate steers but
never starts, continues, or cancels a turn, and never changes the goal.

## Blocker definition

A goal may be marked `blocked` only when the next step needs the user: an action only the user can
perform, or knowledge only the user has. A restart, a credential, a product decision, a publication,
or data only the user has are blockers. Difficulty, uncertainty, remaining work, a library,
sibling-repository, test, or testability change, and a permission the runtime already grants are not
blockers. A blocker names exactly one user-only action; a menu that also offers an authorized code
option is not a blocker. The always-on working contract carries the same rule.

## The user-decision review gate

The plugin registers one `tools/pre-execute` waterfall listener with two subjects: a proposed goal
block and a goal-round question. The `blockReview` section keeps its name, and its
`reviewQuestions` switch controls only the question subject.

### Block subject

It reviews a root agent's `update_goal` call only when all of these hold:

- the caller is a root agent with an active current goal;
- `action` is `blocked` and the call's `goal_id` and `revision` match the current goal;
- the open turn is not an explicit user block request;
- the call is a direct-human turn, or a goal-round call at or above the effective
  `blockedAfterConsecutiveRounds` threshold.

A goal-round call below the threshold is left to the goal tool's own rejection and consumes no
review budget. A direct user message that does not explicitly ask for the block is reviewed even
below the threshold, because the goal tool's direct-human authority would otherwise accept it
unreviewed. Only an explicit block request skips the review.

A `not-blocker` verdict denies the tool call with the reviewer's concrete next action and the
`GOAL_BLOCK_REVIEW_REJECTED` code; the goal stays active. A `blocker` verdict lets the call proceed
and injects a notice naming the exact user-only action that the closing message must carry.

### Question subject

With `blockReview.reviewQuestions: true` (the default) the same gate also reviews a root agent's
`ask_user_question` call when all of these hold:

- the caller is a root agent with an active current goal;
- the open turn is a goal round of that exact goal, so a direct user message is never reviewed;
- `blockReview.reviewQuestions` is true.

The subject is the call's JSON-normalized arguments, bounded and redacted like a block reason; the
reviewer judges the proposed question and its options without a typed question schema. A
`not-blocker` verdict denies the call with the reviewer's concrete next action and the
`GOAL_QUESTION_REVIEW_REJECTED` code; the goal stays active and the turn continues in place, so the
model can take that next step and record the assumption in its next `work_checkpoint`. A `blocker`
verdict lets the question proceed to the user. The gate never starts, continues, or cancels a turn
and never blocks, pauses, resumes, or completes the goal.

Question and block reviews share the digest-bound cache, the per-goal `maxReviewsPerGoal` bound, the
`onReviewError`, `onUnavailable`, and `onExhausted` policies, and the reviewer preset and allowlist.
The digest includes the subject kind, so identical block and question text never share a verdict.
`blockReview.enabled: false` disables both subjects; `reviewQuestions: false` disables only the
question subject.

A residual limit remains: the stock `ask_user_question` row runs in `legacy` mode, so a genuinely
user-only question still holds the turn until the user answers. Switching that row to `timed` is an
owner-level profile decision outside this bundle; the gate removes the unjustified waits, not a
justified one.

## Shared read-only reviewer

The review gate uses a fresh-context child, started through `ctx.subagents.startActivation` with the
configured provider, model, reasoning effort, and the independent `goal-reviewer` preset. The
fragment declares that preset with `@deepseek-ai/dsh-agent-preset`: a persona, `read` only (no
`write`/`edit`), and `grep`/`glob`. The bundle applies the enforcement, not the preset list alone:
when the child is announced through `agent/created`, the plugin calls
`agent.ctx.tools.restrict({ allow: ['read', 'grep', 'glob'] })` on the child's own scope. That
allowlist is the only reader of the preset; there is no second preset row.

The preset is not a human choice, so the plugin keeps it out of the Web mode roster: it filters the
`agentPresets/list` Remote projection that the client's picker reads, while the registry keeps the
mounted preset for the child start path. Disabling the plugin row stops filtering and the
declaration becomes visible again.

That scope inherits the preset tools and the global tool layer, so the allowlist keeps the preset's
read tools and filters inherited globals such as `mcp_call`, `delegate`, the shell, and the goal
tools. A restriction in the preset's shared scope would see its own tools as current registrations
and throw; the child scope is the only correct place. A parent `danger-full-access` override cannot
re-add a mutation tool through the sandbox: the effective tool surface is the allowlist, so the
session sandbox is deliberately not the enforcement. A provider that cannot select the preset, a
missing provider or preset, a child that inherits the parent context, or a failed restriction makes
the review unavailable; an unavailable review follows `onUnavailable`.

The reviewer prompt ships as `assets/blocker-review.md` in the package, and the manifest lists it so
the setup vendors it with the plugin.

## Review evidence

One review receives a bounded, redacted bundle:

- the goal objective, rounds started, and round cap;
- the subject — the block reason or the proposed question — treated as a claim to verify, not
  evidence;
- the last three goal rounds' tool calls and results (bounded per call and per round);
- the recent direct user messages and the runtime permission policy from the session;
- the workspace `AGENTS.md` and the local grant ledger;
- the workspace path with a read-only instruction.

The reviewer prompt defaults to `not-blocker`, names the user-only definition and the non-blocker
examples, rejects a menu, distinguishes a test-only route from a production behavior change, and
requires exactly one fenced JSON verdict. Its question section answers whether the agent can answer
the question itself: scope-narrowing, partial acceptance, deferring, and avoiding difficulty are
`not-blocker`, the model's own `(Recommended)` label is not evidence, and a reversible choice the
agent records is not user-only. `blocker` requires `userAction`; `not-blocker` requires `nextStep`;
prose, several verdicts, missing fields, or unknown fields are a review error, never a blocker.
Machine paths and obvious credentials are redacted before the evidence leaves the process.

## Standing-grant ledger

A user grant is recorded durably with its date and scope in the workspace `AGENTS.md` or in
`.dsh/goal-continuity/grants.json` (machine-local, ignored by git). Both files are part of the review
evidence, so a permission block for a covered action is reviewed as `not-blocker` and denied. A grant
covers means only; it never authorizes a new product requirement, destroyed data, a credential, or a
publication unless it names it, and a foreign or stale grant does not apply.

## Review records, cache, and budget

Each review writes one atomic record under the workspace's local state:

```
.dsh/goal-continuity/block-review/<goal-id>/<digest>.json
```

The record names its `subject` (`block` or `question`) and carries the bounded, redacted subject
text. The digest covers the objective, the subject kind and text, and the evidence bundle. A matching
digest reuses the recorded verdict without another model call. The per-goal review bound
(`maxReviewsPerGoal`, default 3) is shared by both subjects and stops unbounded spend; differing
evidence does not reset it, only raising the bound does. A review that starts but then fails
(timeout, abort, invalid verdict) still consumes one unit of the bound; an unavailable target spends
no model call and consumes none. Every step that allows an unverified proposal (`onUnavailable`,
`onReviewError`, or `onExhausted` set to `allow`) writes a record marked `verified: false` and injects
a visible notice naming the policy. An `allow` policy is the only way an unverified block or
question can take effect.

## Work checkpoints

A work checkpoint is one structured, machine-checkable decision recorded at a substantial pause and
at each configured step interval. It names whether the work is done, what is verified, what remains,
whether the remainder has independent parallel lanes, the current bottleneck, and the next action.
The close gate requires a fresh checkpoint before the turn closes, so a pause cannot silently drop
the decision; the checkpoint is self-review, not an independent review, and the review gate remains
the independent check for blockers and user-only questions.

### Trigger

The plugin evaluates a root agent's turn close from the tool results it already observes. A
substantial pause requires one checkpoint when all of these hold:

- the turn has at least `minToolCalls` tool calls (default 4);
- when `requireWrite` is true (the default), at least one successful `edit`/`write` or worker start
  (one of `subagent`, `subagent_fork`, `spawn_teammate`, `workflow`, `delegate`) occurred;
- the last tool call of the turn is not `ask_user_question`;
- the latest checkpoint is `stepInterval` steps old or older.

No checkpoint is required for a subagent turn, an aborted turn, or a turn whose session state cannot
be read. A turn whose latest checkpoint is younger than `stepInterval` steps needs no new one; a
checkpoint 2 steps before the close satisfies it, and a stale checkpoint is refused with a fresh
request. The checkpoint record path is fixed by the turn, so a repeated call replaces the same
record.

### Mid-turn trigger

The plugin also evaluates the `agent/pre-step` boundary. It counts model steps in the current root
turn and steers the same bounded request when the turn reaches `stepInterval` steps (default 40)
since the turn start, the latest checkpoint, or the previous request. The mid-turn request requires a
successful `edit`/`write` or worker start unless `requireWrite` is false, and is skipped while the
last tool call is `ask_user_question`. It never starts or wakes an idle agent; an ignored request is
repeated at the next interval, not at every step.

### Checkpoint request

The plugin steers one bounded checkpoint request at the turn-close boundary and when the step
interval is reached. It names the observed evidence: the tool-call count, up to five written paths,
the last shell command and its exit state, the last failed tool, and the worker starts; an interval
request also names the step count and the interval. It asks whether the work is done, what is
verified, what remains, whether the remaining lanes are independent (parallel), what the current
bottleneck is, and the next action. The request is attributed to the `goal-continuity` source, is
redacted (machine paths and obvious credentials), is capped at `maxMessageChars` (default 1200), and
is delivered with `agent.steer`: it never starts an idle agent and never wakes one.

### The `work_checkpoint` tool and record

The Host registers one `work_checkpoint` tool with these fields:

- `outcome`: `done` or `continue`;
- `verified`: a list of verified facts (optional);
- `remaining`: a list of remaining items (optional);
- `parallel`: whether the remainder has independent lanes (default false);
- `serialReason`: required when `outcome` is `continue` and `parallel` is false;
- `bottleneck`: the current bottleneck and the next action that removes it; required when `outcome`
  is `continue`;
- `next`: the next action (required);
- `speedup`: an optional speedup for the next turn.

A call and its record look like this (the record is written by the tool; the model only sends the
arguments):

```json
{
  "outcome": "continue",
  "verified": ["the parser test fails on the empty input"],
  "remaining": ["guard the empty input", "add a regression test"],
  "parallel": false,
  "serialReason": "the test must be written after the guard exists",
  "bottleneck": "the guard does not exist yet, so the test cannot pass",
  "next": "add the guard, then the test"
}
```

```json
{
  "version": 1,
  "checkpoint": "checkpoint-3-1a2b3c4d",
  "turn": 3,
  "outcome": "continue",
  "verified": ["the parser test fails on the empty input"],
  "remaining": ["guard the empty input", "add a regression test"],
  "parallel": false,
  "serialReason": "the test must be written after the guard exists",
  "bottleneck": "the guard does not exist yet, so the test cannot pass",
  "next": "add the guard, then the test",
  "time": "2026-10-31T12:00:00.000Z",
  "session": "session-83a9285d-c895-4235-a36b-5e302e02e035"
}
```

An unknown field, an unknown outcome, a missing next action, a continuation without a serial reason,
and a continuation without a bottleneck are rejected with a field diagnostic. Every successful call
writes one atomic local record:

```
.dsh/work-checkpoints/<hashed-session>/<turn>.json
```

The session key is the SHA-256 prefix of the session id, matching the delegation session ledger; the
record carries the decision, a stable checkpoint id (`checkpoint-<turn>-<hash>`), the turn, the time,
and the session. Each field is bounded and redacted, and the record is replaced rather than
duplicated when the same turn calls the tool again. The record is machine-local scratch under
`.dsh/` and is never a tracked file. The tool result is a short summary with the checkpoint id, the
workspace-relative record path, and the decision including the bottleneck.

A write failure still counts as a successful checkpoint for the close gate: the tool returns the
decision with a bounded warning naming the record failure, and never claims that a record exists.

### Close gate and the UNCHECKED cap

After a substantial pause the `agent/turn-stopping` listener refuses the close by steering the
checkpoint request; a successful checkpoint younger than `stepInterval` steps allows the close and an
older one is stale and refused with a fresh request. The gate allows at most `maxBlocks` refusals
(default 3) per turn and then allows the close with a visible `UNCHECKED` notice that states it is
not a pass. The refusal budget is shared with the parallel-action gate. An internal state error fails
open: the close is allowed and no verification or checkpoint is claimed. A subagent turn is never
evaluated.

### Parallel-action gate and the serial escape

When a `continue` checkpoint declares `parallel: true` and `enforceParallel` is true (the default),
the turn may close only after one of these:

- a successful worker start after the checkpoint whose serialized arguments contain the checkpoint
  id (one of `subagent`, `subagent_fork`, `spawn_teammate`, `workflow`, `delegate`; a cached
  `delegate` reuse does not count);
- an amendment that replaces the checkpoint with `parallel: false` and a non-empty serial reason.

A failed worker start, an untagged worker start, and a worker start before the checkpoint do not
satisfy the gate. Each unsatisfied close steers with the checkpoint id, shares the `maxBlocks` budget,
and reaches the same `UNCHECKED` notice at the cap. The gate reports nothing when no worker-start tool
is registered or when the checkpoint outcome is `done`. The serial reason is the explicit escape for
a genuinely sequential remainder; if almost every checkpoint is serial, the measurement shows the
gate is not changing behavior.

### Goal rounds

A goal round ends through the same turn-close path, so the checkpoint is required before the round
closes and the next round sees the decision through the session log. The mid-turn trigger also runs
inside a goal round and never changes the goal. The checkpoint never changes the goal: it does not
block, pause, complete, or resume it, and the goal driver may continue after the turn closes. The
review gate is independent and still runs when the same turn proposes a block or asks a question. No
goal-round-specific checkpoint, brief, or record exists.

The injected request and the `work_checkpoint` tool call are attributable to the shipped
`goal-continuity` observability row through the source kind and a `work_checkpoint` tool match; no
separate log or storage surface is written.

## Configuration

```yaml
- id: dsh-setup-goal-continuity
  config:
    blockReview:
      enabled: true
      reviewQuestions: true
      provider: spawn
      model: deepseek-flash
      reasoningEffort: max
      reviewerPreset: goal-reviewer
      blockedAfterConsecutiveRounds: 3
      timeoutMs: 300000
      maxReviewsPerGoal: 3
      onReviewError: deny
      onUnavailable: allow
      onExhausted: deny
    checkpoint:
      enabled: true
      minToolCalls: 4
      requireWrite: true
      maxBlocks: 3
      enforceParallel: true
      maxMessageChars: 1200
      stepInterval: 40
```

- `checkpoint.enabled: false` disables only the checkpoint tool, the trigger, and the close and
  parallel gates; continuity supervision and the review gate still run.
- `checkpoint.minToolCalls` raises or lowers the pause threshold; `checkpoint.requireWrite: false`
  also checkpoints a read-only turn.
- `checkpoint.stepInterval` (default 40, integer 1–1000) sets the mid-turn request interval and the
  freshness window a checkpoint must fall within at the close.
- `checkpoint.maxBlocks: 0` closes immediately with the `UNCHECKED` notice; `maxBlocks` is the shared
  refusal budget for both gates.
- `checkpoint.enforceParallel: false` keeps the checkpoint but drops the tagged-worker requirement.
- `speedReview` is deprecated: a profile may still carry the object, the plugin loads, reports one
  warning, and runs no speed review. Remove the section.
- `blockReview.enabled: false` disables both review subjects; continuity supervision and the work
  checkpoint still run.
- `blockReview.reviewQuestions: false` disables only the question subject while block review stays
  on; a goal-round question then reaches the user unreviewed.
- `blockedAfterConsecutiveRounds` is the block gate's view of the goal tool's setting in the
  selected preset/row. Keep the two values equal: a lower gate value spends a review the goal tool
  would reject, and a higher one skips a review the goal tool would accept.
- Review defaults: `onReviewError: deny` (a failed review leaves the goal active),
  `onUnavailable: allow` (a configuration problem must not trap the session), `onExhausted: deny`
  (the default preserves the goal).
- Unknown, mistyped, or out-of-range fields in either section fail plugin load with a field
  diagnostic.
- Disabling the plugin row, or setting `enabled: false`, removes continuity supervision, both review
  subjects, and the work checkpoint; the `preset-goal-reviewer` declaration remains installed but is
  only selected by the review gate.

The reviewer's selector is `provider` + the shared `reviewerPreset`; the setup ships the preset row
and the fragment generator allows it as the approved Harness-provided declaration without duplicating
its packages as setup dependencies. A profile may override or disable the preset; the review gate
treats a missing, non-read-only, or unrestrictable preset as unavailable.
