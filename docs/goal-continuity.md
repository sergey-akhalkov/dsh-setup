# Goal continuity and block review

`@dsh-setup/plugin-goal-continuity` keeps an active goal alive across recoverable harness stops and
reviews every model-proposed goal block before it can end the run. The supervisor is deterministic;
the block review is the plugin's only model call and never starts, continues, or cancels a turn.

## Blocker definition

A goal may be marked `blocked` only when the next step needs the user: an action only the user can
perform, or knowledge only the user has. A restart, a credential, a product decision, a publication,
or data only the user has are blockers. Difficulty, uncertainty, remaining work, a library,
sibling-repository, test, or testability change, and a permission the runtime already grants are not
blockers. A blocker names exactly one user-only action; a menu that also offers an authorized code
option is not a blocker. The always-on working contract carries the same rule.

## The pre-execute gate

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

## Read-only reviewer

The reviewer is a fresh-context child started through `ctx.subagents.startActivation` with the
configured provider, model, reasoning effort, and the independent `goal-reviewer` preset. The
fragment declares that preset with `@deepseek-ai/dsh-agent-preset`: a persona, `read` only (no
`write`/`edit`), and `grep`/`glob`. The gate applies the enforcement, not the preset list alone:
when the child is announced through `agent/created`, the gate calls
`agent.ctx.tools.restrict({ allow: ['read', 'grep', 'glob'] })` on the reviewer child's own scope.

That scope inherits the preset tools and the global tool layer, so the allowlist keeps the preset's
read tools and filters inherited globals such as `mcp_call`, `delegate`, the shell, and the goal
tools. A restriction in the preset's shared scope would see its own tools as current registrations
and throw; the child scope is the only correct place. A parent `danger-full-access` override cannot
re-add a mutation tool through the sandbox: the effective tool surface is the allowlist, so the
session sandbox is deliberately not the enforcement. A provider that cannot select the preset, a
missing provider or preset, a child that inherits the parent context, or a failed restriction makes
the review unavailable and follows `onUnavailable`.

## Review evidence

One review receives a bounded, redacted bundle:

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
`.dsh/goal-continuity/grants.json` (machine-local, ignored by git). Both files are part of the
review evidence, so a permission block for a covered action is reviewed as `not-blocker` and
denied. A grant covers means only; it never authorizes a new product requirement, destroyed data, a
credential, or a publication unless it names it, and a foreign or stale grant does not apply.

## Records, cache, and budget

Each review writes one atomic record under the workspace's local state:

```
.dsh/goal-continuity/block-review/<goal-id>/<digest>.json
```

The digest covers the objective, the block reason, and the evidence bundle. A matching digest reuses
the recorded verdict without another model call. A per-goal review bound (`maxReviewsPerGoal`,
default 3) stops unbounded spend; differing evidence does not reset it, only raising the bound does.
Every step that allows an unverified block (`onUnavailable`, `onReviewError`, or `onExhausted` set to
`allow`) writes a record marked `verified: false` and injects a visible notice naming the policy.
An `allow` policy is the only way an unverified block can take effect.

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
```

- `blockReview.enabled: false` disables only the gate; continuity supervision still runs.
- `blockedAfterConsecutiveRounds` is the gate's view of the goal tool's setting in the selected
  preset/row. Keep the two values equal: a lower gate value spends a review the goal tool would
  reject, and a higher one skips a review the goal tool would accept.
- Defaults: `onReviewError: deny` (a failed review leaves the goal active), `onUnavailable: allow`
  (a configuration problem must not trap the session), `onExhausted: deny` (the default preserves
  the goal).
- Unknown, mistyped, or out-of-range fields fail plugin load with a field diagnostic.
- Disabling the plugin row restores stock behavior; the `preset-goal-reviewer` declaration remains
  installed but is only selected by this gate.

The reviewer selector is `provider` + `reviewerPreset`; the setup ships the preset row and the
fragment generator allows it as the approved Harness-provided declaration without duplicating its
packages as setup dependencies. A profile may override or disable the preset; the gate treats a
missing, non-read-only, or unrestrictable preset as unavailable.
