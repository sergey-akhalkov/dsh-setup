# Goal continuity, block review, and speed review

`@dsh-setup/plugin-goal-continuity` keeps an active goal alive across recoverable harness stops and
makes two bounded, read-only model calls: it reviews every model-proposed goal block before it can
end the run, and it reviews one expensive goal round for a concrete speedup. The supervisor is
deterministic; neither review starts, continues, or cancels a turn, and neither changes the goal.

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

Both reviews use the same fresh-context child, started through `ctx.subagents.startActivation` with
the configured provider, model, reasoning effort, and the independent `goal-reviewer` preset. The
fragment declares that preset with `@deepseek-ai/dsh-agent-preset`: a persona, `read` only (no
`write`/`edit`), and `grep`/`glob`. The bundle applies the enforcement, not the preset list alone:
when the child is announced through `agent/created`, the plugin calls
`agent.ctx.tools.restrict({ allow: ['read', 'grep', 'glob'] })` on the child's own scope. The speed
review selects the same preset and the same allowlist; there is no second preset row.

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
the review unavailable; an unavailable block review follows `onUnavailable`, and an unavailable
speed review produces no action and the goal continues.

Both prompts ship as assets in the package: `assets/blocker-review.md` for the block decision and
`assets/round-review.md` for the round speed review. The package manifest lists both, so the setup
vendors them with the plugin.

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

## Goal-round speed review

At the end of a goal round the plugin snapshots the cost of that round from the session events it
already observes and, when a threshold is crossed, starts at most one read-only review child in the
background. The round review never delays or blocks the next round:

- the round had at least `minToolCalls` tool calls (default 12);
- the round lasted at least `minMinutes` minutes (default 5);
- a single tool call lasted at least `slowCallMs` milliseconds (default 120000);
- `everyRound` is true (a deliberate maximum-pressure setting).

A round whose start the plugin did not observe has no wall time and is never reviewed. A restart
mid-round loses the in-memory metrics and skips that review; a completed record survives.

### Round metrics

The review input and the local record carry bounded, redacted metrics from the observed round:

- start-to-end wall time;
- tool-call count and failed tool-result count;
- worker starts by tool name (`subagent`, `subagent_fork`, `spawn_teammate`, `workflow`, `delegate`);
- the slowest completed calls with their durations and bounded argument and result summaries;
- approximate non-tool time: wall time minus the sum of observed tool durations (parallel calls are
  summed, so it is a hint rather than a precise measurement).

Every completed call is timed; only the five slowest keep argument and result summaries. Machine
paths and obvious credentials are redacted before the metrics reach the reviewer or the record.

### Strict round verdict

The `assets/round-review.md` prompt asks for one action, not a report, and exactly one fenced JSON
verdict:

- `{"verdict":"no-action"}` when no concrete change is expected to save meaningful time;
- `{"verdict":"speedup", ...}` with one bottleneck, one action, a worker handoff, an expected
  saving, a risk, and a short `speedup-id` such as `speedup-12-a1b2`.

Prose only, several fenced blocks, a missing or unknown field, or a malformed `speedup-id` is a
review error: no action is recorded and the goal continues. The action is a handoff for the next
round, not an automatic write; the main agent starts a write-capable worker and reviews its result.

### Round records and status

Each reviewed round writes one atomic record under the workspace's local state:

```
.dsh/goal-continuity/retro/<goal-id>/<round>.json
```

The record carries the bounded metrics, the verdict, the action (when any), the `speedup-id`, the
status, the review target, the review duration, the time, and the session. `status` is `pending` for
an action, `started` or `declined` after the follow-through gate, `no-action` for a quiet verdict,
and `error` for a failed, timed-out, malformed, or unavailable review. A record for the goal and
round is reused instead of starting a second child, so a duplicate round end or a resumed session
never spends a second call for that round. `maxPerGoal` (default 20) bounds the started reviews for
one goal; only raising it allows another. The record is local scratch: it is never a tracked file.

The next review also receives the previous record, so it can see whether the earlier action was
started, declined, or still pending.

### Next-round brief

At the first step of a goal round the plugin adds one bounded, non-waking notice to the step:

- the speed policy: split independent streams, start workers for the ones that can run in parallel,
  keep integration in the main agent, run known-slow checks in the background, and start task
  reviews as a batch;
- any pending action from an earlier round: bottleneck, action, handoff, expected saving,
  `speedup-id`, record path, the start-a-worker-or-decline instruction, and the exact
  `task_progress` decline call (using the eligible unchecked task's id) when that path is available.

The brief never starts a turn, never wakes an idle agent, and appears only in a goal round. When
`brief` is false, no brief is injected, and a pending action is still enforced by the follow-through
gate. If the review child finishes after the next goal round starts, the action is injected as a
bounded notice during that round.

### Follow-through gate

At the close of a goal round with a pending action, the plugin accepts either piece of evidence:

- a successful worker start whose arguments contain the `speedup-id` (one of `subagent`,
  `subagent_fork`, `spawn_teammate`, `workflow`, `delegate`);
- a successful `task_progress` note whose reason contains the `speedup-id`.

Either one marks the record `started` or `declined` and the gate is silent for that action. When
neither exists, the gate steers once with the action id, the record path, and the exact decline
call; a second close in the same turn does not steer again. The gate fails open (reports nothing and
the goal continues) when the record is missing or unreadable, when `task_progress` is not
registered, when no active OpenSpec change has an eligible unchecked task, or when no worker-start
tool is registered. It skips subagent turns entirely.

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
    speedReview:
      enabled: true
      provider: spawn
      model: deepseek-flash
      reasoningEffort: max
      minToolCalls: 12
      minMinutes: 5
      slowCallMs: 120000
      everyRound: false
      timeoutMs: 120000
      maxPerGoal: 20
      brief: true
```

- `speedReview.enabled: false` disables only the speed review, its brief, and its follow-through
  gate; continuity supervision and the block review still run.
- `speedReview.reviewerPreset` does not exist: the speed review reuses
  `blockReview.reviewerPreset`, so both reviews share the `goal-reviewer` declaration and the
  read-only child scope.
- `blockReview.enabled: false` disables only the block gate; continuity supervision and the speed
  review still run.
- `blockedAfterConsecutiveRounds` is the block gate's view of the goal tool's setting in the
  selected preset/row. Keep the two values equal: a lower gate value spends a review the goal tool
  would reject, and a higher one skips a review the goal tool would accept.
- Block-review defaults: `onReviewError: deny` (a failed review leaves the goal active),
  `onUnavailable: allow` (a configuration problem must not trap the session), `onExhausted: deny`
  (the default preserves the goal).
- Unknown, mistyped, or out-of-range fields in either section fail plugin load with a field
  diagnostic.
- Disabling the plugin row, or setting `enabled: false`, removes continuity supervision and both
  reviews with their brief and gate; the `preset-goal-reviewer` declaration remains installed but is
  only selected by the two reviews.

The reviewer selector for each review is `provider` + the shared `reviewerPreset`; the setup ships
the preset row and the fragment generator allows it as the approved Harness-provided declaration
without duplicating its packages as setup dependencies. A profile may override or disable the
preset; both reviews treat a missing, non-read-only, or unrestrictable preset as unavailable.
