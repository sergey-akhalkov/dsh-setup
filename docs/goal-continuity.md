# Goal continuity, block review, and work checkpoints

`@dsh-setup/plugin-goal-continuity` keeps an active goal alive across recoverable harness stops,
reviews every model-proposed goal block before it can end the run, and requires one structured work
checkpoint before a substantial root turn closes. The supervisor is deterministic; the block review
is one bounded, read-only model call; the checkpoint gate steers but never starts, continues, or
cancels a turn, and never changes the goal.

## Blocker definition

A goal may be marked `blocked` only when the next step needs the user: an action only the user can
perform, or knowledge only the user has. A restart, a credential, a product decision, a publication,
or data only the user has are blockers. Difficulty, uncertainty, remaining work, a library,
sibling-repository, test, or testability change, and a permission the runtime already grants are not
blockers. A blocker names exactly one user-only action; a menu that also offers an authorized code
option is not a blocker. The always-on working contract carries the same rule.

## The block-review gate

The plugin registers a `tools/pre-execute` waterfall listener. It reviews a root agent's
`update_goal` call only when all of these hold:

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

## Shared read-only reviewer

The block review uses a fresh-context child, started through `ctx.subagents.startActivation` with the
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
the review unavailable; an unavailable block review follows `onUnavailable`.

The block-review prompt ships as `assets/blocker-review.md` in the package, and the manifest lists it
so the setup vendors it with the plugin.

## Block-review evidence

One block review receives a bounded, redacted bundle:

- the goal objective, rounds started, and round cap;
- the block reason, treated as a claim to verify, not evidence;
- the last three goal rounds' tool calls and results (bounded per call and per round);
- the recent direct user messages and the runtime permission policy from the session;
- the workspace `AGENTS.md` and the local grant ledger;
- the workspace path with a read-only instruction.

The reviewer prompt defaults to `not-blocker`, names the user-only definition and the non-blocker
examples, rejects a menu, distinguishes a test-only route from a production behavior change, and
requires exactly one fenced JSON verdict. `blocker` requires `userAction`; `not-blocker` requires
`nextStep`; prose, several verdicts, missing fields, or unknown fields are a review error, never a
blocker. Machine paths and obvious credentials are redacted before the evidence leaves the process.

## Standing-grant ledger

A user grant is recorded durably with its date and scope in the workspace `AGENTS.md` or in
`.dsh/goal-continuity/grants.json` (machine-local, ignored by git). Both files are part of the block
review evidence, so a permission block for a covered action is reviewed as `not-blocker` and denied.
A grant covers means only; it never authorizes a new product requirement, destroyed data, a
credential, or a publication unless it names it, and a foreign or stale grant does not apply.

## Block-review records, cache, and budget

Each block review writes one atomic record under the workspace's local state:

```
.dsh/goal-continuity/block-review/<goal-id>/<digest>.json
```

The digest covers the objective, the block reason, and the evidence bundle. A matching digest reuses
the recorded verdict without another model call. A per-goal review bound (`maxReviewsPerGoal`,
default 3) stops unbounded spend; differing evidence does not reset it, only raising the bound does.
A review that starts but then fails (timeout, abort, invalid verdict) still consumes one unit of the
bound; an unavailable target spends no model call and consumes none. Every step that allows an
unverified block (`onUnavailable`, `onReviewError`, or `onExhausted` set to `allow`) writes a record
marked `verified: false` and injects a visible notice naming the policy. An `allow` policy is the
only way an unverified block can take effect.

## Work checkpoints

A work checkpoint is one structured, machine-checkable decision recorded at a substantial pause. It
names whether the work is done, what is verified, what remains, whether the remainder has independent
parallel lanes, and the next action. The close gate requires the checkpoint before the turn closes,
so a pause cannot silently drop the decision; the checkpoint is self-review, not an independent
review, and the block review remains the independent check for blockers.

### Trigger

The plugin evaluates a root agent's turn close from the tool results it already observes. A
substantial pause requires one checkpoint when all of these hold:

- the turn has at least `minToolCalls` tool calls (default 4);
- when `requireWrite` is true (the default), at least one successful `edit`/`write` or worker start
  (one of `subagent`, `subagent_fork`, `spawn_teammate`, `workflow`, `delegate`) occurred;
- the last tool call of the turn is not `ask_user_question`.

No checkpoint is required for a subagent turn, an aborted turn, a turn whose session state cannot be
read, or a turn that already contains a successful `work_checkpoint` call. At most one checkpoint is
required per turn; the checkpoint record path is fixed by the turn, so a repeated call replaces the
same record.

### Checkpoint request

The plugin steers one bounded checkpoint request at the turn-close boundary. It names the observed
evidence: the tool-call count, up to five written paths, the last shell command and its exit state,
the last failed tool, and the worker starts. It asks whether the work is done, what is verified, what
remains, whether the remaining lanes are independent (parallel), and the next action. The request is
attributed to the `goal-continuity` source, is redacted (machine paths and obvious credentials), is
capped at `maxMessageChars` (default 1200), and is delivered with `agent.steer`: it never starts an
idle agent and never wakes one.

### The `work_checkpoint` tool and record

The Host registers one `work_checkpoint` tool with these fields:

- `outcome`: `done` or `continue`;
- `verified`: a list of verified facts (optional);
- `remaining`: a list of remaining items (optional);
- `parallel`: whether the remainder has independent lanes (default false);
- `serialReason`: required when `outcome` is `continue` and `parallel` is false;
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
  "next": "add the guard, then the test",
  "time": "2026-10-31T12:00:00.000Z",
  "session": "session-83a9285d-c895-4235-a36b-5e302e02e035"
}
```

An unknown field, an unknown outcome, a missing next action, and a continuation without a serial
reason are rejected with a field diagnostic. Every successful call writes one atomic local record:

```
.dsh/work-checkpoints/<hashed-session>/<turn>.json
```

The session key is the SHA-256 prefix of the session id, matching the delegation session ledger; the
record carries the decision, a stable checkpoint id (`checkpoint-<turn>-<hash>`), the turn, the time,
and the session. Each field is bounded and redacted, and the record is replaced rather than
duplicated when the same turn calls the tool again. The record is machine-local scratch under
`.dsh/` and is never a tracked file. The tool result is a short summary with the checkpoint id and
the workspace-relative record path.

A write failure still counts as a successful checkpoint for the close gate: the tool returns the
decision with a bounded warning naming the record failure, and never claims that a record exists.

### Close gate and the UNCHECKED cap

After a substantial pause the `agent/turn-stopping` listener refuses the close by steering the
checkpoint request; a successful checkpoint for the turn allows the close. The gate allows at most
`maxBlocks` refusals (default 3) per turn and then allows the close with a visible `UNCHECKED` notice
that states it is not a pass. The refusal budget is shared with the parallel-action gate. An
internal state error fails open: the close is allowed and no verification or checkpoint is claimed.
A subagent turn is never evaluated.

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
closes and the next round sees the decision through the session log. The checkpoint never changes the
goal: it does not block, pause, complete, or resume it, and the goal driver may continue after the
turn closes. The block review is independent and still runs when the same turn proposes a block. No
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
```

- `checkpoint.enabled: false` disables only the checkpoint tool, the trigger, and the close and
  parallel gates; continuity supervision and the block review still run.
- `checkpoint.minToolCalls` raises or lowers the pause threshold; `checkpoint.requireWrite: false`
  also checkpoints a read-only turn.
- `checkpoint.maxBlocks: 0` closes immediately with the `UNCHECKED` notice; `maxBlocks` is the shared
  refusal budget for both gates.
- `checkpoint.enforceParallel: false` keeps the checkpoint but drops the tagged-worker requirement.
- `speedReview` is deprecated: a profile may still carry the object, the plugin loads, reports one
  warning, and runs no speed review. Remove the section.
- `blockReview.enabled: false` disables only the block gate; continuity supervision and the work
  checkpoint still run.
- `blockedAfterConsecutiveRounds` is the block gate's view of the goal tool's setting in the
  selected preset/row. Keep the two values equal: a lower gate value spends a review the goal tool
  would reject, and a higher one skips a review the goal tool would accept.
- Block-review defaults: `onReviewError: deny` (a failed review leaves the goal active),
  `onUnavailable: allow` (a configuration problem must not trap the session), `onExhausted: deny`
  (the default preserves the goal).
- Unknown, mistyped, or out-of-range fields in either section fail plugin load with a field
  diagnostic.
- Disabling the plugin row, or setting `enabled: false`, removes continuity supervision, the block
  review, and the work checkpoint; the `preset-goal-reviewer` declaration remains installed but is
  only selected by the block review.

The block reviewer's selector is `provider` + the shared `reviewerPreset`; the setup ships the
preset row and the fragment generator allows it as the approved Harness-provided declaration without
duplicating its packages as setup dependencies. A profile may override or disable the preset; the
block review treats a missing, non-read-only, or unrestrictable preset as unavailable.
