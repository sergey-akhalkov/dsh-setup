# Design

## Context

The lane machinery already exists: the task-lane addendum defines a lane, the delegation engine has
`lane-assignment` and `lane-boundary` triggers, a per-lane `task_progress` note records a serial
decision, and the goal-continuity work checkpoint asks for a parallel-or-serial decision. See
proposal.md for the observed failure.

Three properties of the current state shape the approach:

- The shipped default rules omit `lane-fanout`, and the trigger fails open when a level-2 heading
  names no owned path, as the observed `tasks.md` did.
- The work-checkpoint decision runs only at turn close; a single long apply turn never reaches it.
- The documented apply workflow contradicts itself: the numbered steps in `docs/delegation-rules.md`
  and the packaged `SKILL.md` say to run the task review "immediately, before starting the next
  task", while a later paragraph already says "Keep implementing while it runs". `AGENTS.md`
  repeats the blocking wording. The bundled whole-spec review has no lane-shape criterion. Task
  reviews use a frozen snapshot when one can be built, but fall back to the live worktree under the
  mutation guard; a write then invalidates the verdict.
- The always-on working contract is the only surface read before every task in every workspace. Its
  registered section is 5,993 bytes (about 1,498 estimated tokens) against a hard 1,500-token
  budget, and the contract file is 5,810 bytes against the reviewed 5,850-byte range. `AGENTS.md`
  has room but applies to this workspace only.
- The current checkpoint asks only at turn close and only for the lane decision; its `speedup` field
  is optional, so it does not require a bottleneck reflection. A baseline over 12 sessions and 21
  substantial pauses shows a median of 51 steps and 16 minutes per pause, p75 at 84 steps, and p90
  at 163; the observed apply turn ran past 130 steps and 67 minutes without a close. A wall-clock
  trigger is unreliable (one 9-hour outlier), so the interval must count steps.

## Goals / Non-Goals

**Goals:**

- Make the plan declare its work lanes (owned paths) or one explicit single-lane reason about the
  work before implementation starts.
- Make the whole-spec review catch an unlaned plan or a review-process single-lane reason.
- Remove the blocking-review instruction from the packaged skill, `AGENTS.md`, and the docs so a
  running review does not stop the next independent task.
- Make the same stream check apply to any multi-file or multi-step task through the always-on plan
  clause, without raising the contract budget.
- Run the checkpoint every `stepInterval` steps (default 40) and force both the lane decision and
  the bottleneck reflection, not only at turn close.
- Extend the existing goal-continuity bundle and `work_checkpoint` tool; do not add a plugin or row.

**Non-Goals:**

- No new plugin, row, or tool; the existing goal-continuity trigger and `work_checkpoint` tool are
  extended.
- No wall-clock trigger; no second record per checkpoint (one record per turn, replaced).
- No generic gate, plan artifact, or trigger for non-spec tasks beyond the contract nudge.
- Do not enable `lane-fanout` in the shipped defaults or the profile.
- Do not automate worktree creation or merging for parallel writers.
- Do not rewrite the active `add-observability-outcomes` plan.

## Decisions

### 1. Fix the plan and the review, not the gate

The root cause is an unlaned plan plus a serialReason that cites the review process. A new lane gate
would still fail open on the same plan, and a mid-turn trigger is a separate code lane (decision 8),
added after the text scope. The existing whole-spec review already reads `tasks.md` before
implementation, so one blocking criterion reaches every plan without new state.

Alternatives considered: enabling `lane-fanout` (still a no-op without owned paths, and turn-close
only), changing the work-checkpoint contract (a separate always-on budget change), and adding a
mid-turn trigger (code, now decision 8). All are deferred except the mid-turn trigger.

### 2. A single-lane reason must describe the work, not the process

Task review is serial regardless of how many work lanes exist: the review pipeline and the work
structure are two different axes. Accepting "apply is task-by-task with a review after each task"
as a lane reason is a category error and was the exact recorded decision in the observed run. The
guidance and the review criterion both require a work constraint: a shared hot file, generated
output, or a serial gate.

### 3. Apply starts with one lane check, without new state

Before the first implementation task the apply guidance reads the level-2 headings once and names
each independent lane's owner or its serial decision. The serial decision can live in a heading
that contains `serial` or in the existing per-lane `task_progress` note; the plan-level checkpoint
carries the remainder. No new tool, ledger, or configuration is added.

### 4. Review overlap is a documentation fix, not a new wait primitive

A task review runs in the background and, when `createReviewSnapshot` succeeds, is bound to a
frozen snapshot: a write after the call does not enter its evidence and the record still matches.
When snapshot creation fails (for example, `.dsh` is not Git-ignored), the engine falls back to the
live worktree and `completeReviewRun` rejects the verdict if any reviewed input changed. The
guidance must therefore condition overlap on the reported frozen snapshot and name the fallback
branch: restore snapshot support and re-run, or defer writes until the run settles without a
blocking sleep. The contradiction in the numbered steps, `SKILL.md`, and `AGENTS.md` is the
documentation bug; the engine's snapshot and fallback behavior is unchanged. The turn-close gate
and the archive gate still require the record.

### 5. Text assets plus one code lane

The task-lane guidance, the review instruction, and the contract are plugin-owned text assets;
`pnpm gen` copies the changed assets into the vendored setup tree. The periodic checkpoint and the
bottleneck field are code in the existing goal-continuity bundle and its `work_checkpoint` tool; no
new plugin, row, dependency, or profile patch is added, and the fragment gains one default
configuration value.

### 6. The general rule lives in the always-on plan clause

The plan clause is already required before a multi-file or unclear-cause change and is read before
every task. Adding the stream check there reaches non-OpenSpec work without a new tool or artifact.
The threshold stays "multi-file or multi-step"; a one-line fix is exempt. `AGENTS.md` was rejected
because it is workspace-only; a separate contract section was rejected because the budget is
already exhausted; a generic gate was rejected as engine code for a nudge.

### 7. Budget-neutral rewrite

The registered section is 5,993 bytes (about 1,498 estimated tokens) against the 1,500 cap, and the
contract is 5,810 bytes against the 5,850 reviewed range. The stream sentence must replace, not add:
the delegation paragraph is the natural home, and its "do not build a team for sequential work"
restatement is dropped because the serial reason covers it. The budget test is the check; if the
wording still does not fit, condense elsewhere rather than raise the budget, because the contract is
paid on every step of every session.

### 8. Periodic checkpoint at a configurable step interval

The plugin counts model steps in the current root turn and steers the same bounded checkpoint
request at each `stepInterval` steps (default 40) since the turn start or the latest checkpoint. It
uses the existing `agent/pre-step` hook, the same one the delegation and loop-guard gates use. The
steer requires a root turn with at least one successful write or worker start (or
`requireWrite: false`) and a last tool call other than `ask_user_question`; it never starts an idle
agent. Forty is the default because the median substantial turn is 51 steps and p75 is 84: most
turns get one check, the long tail gets several, and a 10-step interval would be noise. A wall-clock
timer is rejected because the one 9-hour outlier shows idle time dominates; every tool call is
rejected as noise.

### 9. One checkpoint, both outputs

Every checkpoint must return both the lane decision (`parallel` or `serialReason`) and the
bottleneck reflection. The tool gains `bottleneck` (a bounded, redacted non-empty string required
when the outcome is `continue`), the request asks "parallel lanes? bottleneck? next action?", and the
record stores the bottleneck so the next turn can see it. `speedup` stays optional; the reflection is
no longer optional. A separate reflection tool or a second reviewer was rejected: it doubles the
schema and prompt cost and splits one decision across two records.

### 10. Freshness, not one checkpoint per turn

The close gate accepts a checkpoint younger than `stepInterval`; an older one requires a fresh
checkpoint. The record stays one per turn and a later call replaces it with the latest decision, so
a checkpoint made two steps before the close satisfies the close without a duplicate. A checkpoint
made 40 steps before the close is stale and the mid-turn trigger would already have asked; if it was
ignored, the close gate refuses and steers once more. The alternative — any checkpoint in the turn
satisfies — would let a step-2 checkpoint authorize a 200-step close, which is the gap this change
closes.

### 11. Count steps, not wall time

The plugin counts pre-step boundaries per turn; the step at the checkpoint is the count when the
tool runs, and the close gate compares it to the current count. The state is in memory and resets on
a new turn; `resumeAfterRestart` is false, so a lost state cannot strand a resumed turn. The record
schema is unchanged; the step is derived from the event and state, not persisted. A wall-clock
trigger was rejected because the 9-hour outlier includes waiting, while the plugin sees steps.

## Risks / Trade-offs

- **Prompt-only nudge** → the review criterion is the blocking check, and the asset tests assert
  the exact guidance text. A reviewer that ignores the criterion still lets the plan pass; that is
  the known limit of a text change.
- **Over-correction** → the work-level single-lane reason is explicitly allowed, so a genuinely
  serial plan stays valid. The review checks the reason, not the number of lanes.
- **Fan-out cost** → worktrees, installs, merges, and digest-bound reviews cost time. The guidance
  keeps the serial tail and does not force fan-out on shared files; the owner chooses.
- **Stale review while the next task runs** → with a frozen snapshot, a write after the call does
  not enter its evidence and the record still matches. With the live-worktree fallback, any write
  fails `completeReviewRun`; the guidance says so and directs a snapshot re-run or a nonblocking
  deferral, and the test assertion checks that text.
- **Always-on cost** → the rewrite is net-neutral and the budget test enforces the 1,500-token cap;
  no raise without an explicit owner decision, because every session pays it.
- **Nudge only for non-spec tasks** → the contract is always read, but no gate verifies the streams;
  the OpenSpec lane gates remain the hard checks. A generic gate is out of scope.
- **Extra steer cost** → one request per interval, not per step; the freshness rule prevents a
  duplicate at close; the default 40 matches the median turn.
- **Self-reported bottleneck** → the checkpoint requires it, but no independent reviewer verifies
  its quality; the spec and task reviews remain the independent checks.
- **Ignored steer** → the mid-turn request is a steer; if ignored, the close gate still refuses a
  stale checkpoint and the parallel gate still applies at close.
- **Parallel action is close-gated** → a mid-turn `parallel: true` does not force a worker until the
  turn closes; the guidance says to start it now, and a stronger mid-turn gate is out of scope.
- **Step counting** → one step may contain several tool calls; the interval is model steps, as
  requested, not tool calls. The `minToolCalls` condition remains for the close.
- **Budget** → adding `bottleneck` and the interval to the contract clause must be absorbed by the
  lane-3 trim; the budget test is the check.

## Migration Plan

1. Update the OpenSpec task-lane guidance and the delegation review assets.
2. Extend the goal-continuity checkpoint: `stepInterval`, the mid-turn trigger, the freshness-aware
   close gate, and the required `bottleneck` field; update its tests and `docs/goal-continuity.md`.
3. Rewrite the contract's delegation and checkpoint clauses, extend its budget test, and update
   `docs/principles.md`; run the working-principles tests.
4. Update `AGENTS.md`, `docs/openspec.md`, and `docs/delegation-rules.md`; run `pnpm lint:fix`.
5. Run `pnpm gen` to refresh the vendored setup tree, then the four test suites, `pnpm gen:check`,
   and `pnpm validate:repo`.
6. Roll back by reverting the code and text and regenerating; no data or profile migration exists.
