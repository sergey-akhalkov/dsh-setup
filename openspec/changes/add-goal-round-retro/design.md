# Design

## Context

See `proposal.md` for motivation. `@dsh-setup/plugin-goal-continuity` already observes goal rounds through
`session/event`, builds a bounded tool-call evidence bundle for the block review, starts a fresh-context
read-only child through `ctx.subagents.startActivation`, writes local records, and injects non-waking notices.
The block review is currently the plugin's only model call and is tied to one proposed `blocked` update. The
new loop uses the same round observation and child machinery, but it runs between rounds and never gates the
goal itself.

The plugin's continuity supervisor is deliberately deterministic: it may resume, disarm, extend, block, and
notice, but it does not start a turn. The speed review is a second separate responsibility, like the block
review; it may start one child and write a record, and it must not start, continue, or cancel a turn.

## Goals / Non-Goals

**Goals:**

- Measure where a goal round spent its wall time without adding instrumentation to the main agent.
- Produce one concrete, low-risk speedup action (or `no-action`) per expensive round.
- Make the next goal round act on the action before it closes.
- Keep the review read-only, bounded, background, and fail-open.
- Reuse the existing `goal-reviewer` preset and child-scope allowlist; add no new composition row.

**Non-Goals:**

- No write-capable retro child and no automatic merge. The next round starts a worker; the main agent reviews
  and merges.
- No new tool, plugin, goal round, or always-on prompt section.
- No cross-goal learning beyond the local records; no global performance database.
- No replacement for the block review or the continuity supervisor.
- No retro for a non-goal session.

## Decisions

### D1 — The loop lives in `goal-continuity`

The plugin already has the round boundary, the session-event stream, the bounded evidence builder, the child
start path, the read-only preset, the notice delivery, and the local record directory. A new plugin would
duplicate all of it and add a row. The skill/docs describe the plugin as having one model call; this change
updates that to two bounded model calls with separate triggers and off switches.

Alternative rejected: a new `plugin-goal-speed` package. It would isolate the code but duplicate the round and
child plumbing and make two plugins compete for the same goal events.

### D2 — Read-only review, write-capable worker next round

The retro child has only `read`, `grep`, and `glob`. It diagnoses and writes a handoff. The next goal round
starts a separate write-capable worker in its own worktree with the handoff, and the main agent reviews and
merges the result. This keeps the analysis independent and the writes isolated.

Alternatives rejected: a write-capable retro child (it could change the workspace before anyone reviews the
diagnosis); a main-agent self-retro (cheap but not independent, and it tends to rationalize the current plan).

### D3 — One action, not a report

The verdict is strict JSON with exactly one of:

- `no-action`, when no concrete change is expected to save meaningful time in the next round;
- `speedup`, with one bottleneck, one action, a worker handoff, an expected saving, and a risk.

The action has a short `speedup-id` such as `speedup-12-a1b2`. A free-form report would be ignored; one action
is easy to gate and easy to measure. The prompt forbids proposing more planning, more reflection, or generic
"be faster" advice without a concrete target.

### D4 — Measure from live session events

The plugin timestamps `tool/call` and `tool/result` events in its existing `session/event` handler and derives:

- round wall time from the goal-round turn start to turn end;
- tool-call count, error count, and worker starts by tool name;
- the slowest calls with their durations and bounded argument/result summaries;
- approximate non-tool time as wall time minus the union of observed tool intervals, or wall time minus the
  sum of durations when the union is not worth tracking.

The metrics are stored in memory for the current round and snapshotted into the review input. A round whose
start was not observed has no wall time and is not reviewed. This avoids a new tracing service and keeps the
prompt focused on the calls that actually dominated the round.

Alternatives rejected: asking the main agent to self-report its waits (unreliable); adding OpenTelemetry or a
separate timing plugin (too heavy for this loop).

### D5 — Adaptive cadence

A review starts when any of these holds, and the round is a goal round with observed start and end:

- the round had at least `minToolCalls` (default 12);
- the round lasted at least `minMinutes` (default 5);
- a single tool call lasted at least `slowCallMs` (default 120000);
- `everyRound` is true (a deliberate maximum-pressure setting).

Additional defaults: `maxPerGoal` 20, `timeoutMs` 120000, and `brief: true`. The provider, model, and effort
are `speedReview` fields; the reviewer preset is the block review's configured `reviewerPreset` (default
`goal-reviewer`). The follow-through gate is always strict for a pending action when both a decline path and a
worker-start tool are available; the review's off switch is `speedReview.enabled: false` or the row. The child
runs in the background; the next round is not delayed. A review that takes longer than its timeout is abandoned
and the goal continues.

Alternatives rejected: a review on every round regardless of size (token spend on trivial rounds); a review
only at the final round (too late to help); a fixed N-round cadence (misses the expensive round in between).

### D6 — Brief every goal round, gate the pending action

At the first step of a goal round, when the brief is enabled, the plugin injects one bounded notice:

- the speed policy: list independent streams, start workers for the ones that can run in parallel, keep
  integration for the main agent, run known-slow checks in the background, start task reviews as a batch;
- any pending action from the previous round: bottleneck, action summary, `speedup-id`, record path, and the
  instruction to start a worker or record a decline.

The brief is prose, so it is paired with a gate. If the brief is disabled, a pending action is not announced
there; the follow-through gate still steers with the action id and record path when the round closes without
evidence. If the review child finishes after the next round starts, the action is injected as a notice during
that round; the gate applies at the close of the round in which the action was delivered, or at the next
round's close when the delivery happened between rounds. At turn close, if a pending action is still
unresolved, the gate checks the round's tool calls for a successful worker start whose arguments contain the
`speedup-id`, or a successful `task_progress` note whose reason contains it. If neither exists, the gate steers
with the action id and record path and the turn does not close for this gate. The next such evidence marks the
record `started` or `declined`; the gate is then silent for that action.

Alternatives rejected: notice only (the task-lane addendum showed prose alone does not hold); a gate every
round without a specific action (ritual); a pre-execute denial of every non-worker tool (too intrusive).

### D7 — One local record per round, with status

The record is `.dsh/goal-continuity/retro/<goal-id>/<round>.json`, written atomically before the brief or gate
can use it. It contains the bounded metrics, verdict, action, `speedup-id`, status, target, review duration,
time, and session. Status is `pending` for an action, `started` or `declined` after the gate, `no-action` for
a quiet verdict, and `error` for a failed review. The record is local scratch and never a tracked file.

A record for the goal and round is reused instead of starting a second child. A restart mid-round loses the
in-memory metrics and skips the review; a completed record survives. The next review includes the previous
action and the next round's metrics, so the loop can see whether the action helped.

### D8 — Share the reviewer preset and scope

The block review's `goal-reviewer` preset already declares a persona and read/grep/glob, and the plugin
restricts the child's own scope to `['read', 'grep', 'glob']` on `agent/created`. The speed review uses the
same preset and the same restriction. The preset persona is generalized from "reviewer of a proposed goal
block" to "independent read-only reviewer of one goal decision or round"; the two prompts remain specific.

No new preset row is added. The existing preset stays hidden from the human mode roster. If the provider,
preset, fresh-context capability, or scope restriction is unavailable, the review is unavailable and the goal
continues; there is no block.

The new prompt is listed in the package `files` manifest so `pnpm gen` vendors it into the setup tree; the
package test and the serial-tail generated-tree check cover the asset.

### D9 — Fail open and bound the loop

The speed review never blocks the goal. A missing provider, missing preset, timeout, malformed JSON, record
write failure, or unreadable record produces no action and no gate. The per-goal bound stops unbounded spend.
The follow-through gate is the only part that can hold a turn, and it holds only for a pending action with a
valid record. A `task_progress` decline is the escape when it is available; if `task_progress` is absent, no
eligible unchecked task exists, or no worker-start tool is registered, the gate fails open rather than trapping
the turn.

## Testing

The plugin tests import the built entry (`lib/index.js`), so lane 1 builds
`packages/plugin-goal-continuity/lib/**` before running them and owns that output. The serial tail runs the final
build and generation after both lanes and verifies the vendored tree, including `assets/round-review.md`.

## Flow

```text
goal round N ends
  |
  +-- metrics: wall, calls, errors, workers, slowest calls
  |
  +-- threshold met? -- no --> next round, no review
  |         |
  |         yes
  |         v
  |   one read-only review child (parallel, bounded)
  |         |
  |         v
  |   record: no-action | action + speedup-id
  |         |
  +---------+-----------------------------+
                                            |
goal round N+1 starts                      |
  brief: speed policy + pending action <---+ 
  |
  +-- start worker? -- yes --> mark started, gate silent
  |
  +-- task_progress decline? -- yes --> mark declined, gate silent
  |
  +-- neither at turn close --> strict steer (once, then remain)
```

## Risks / Trade-offs

- **The retro misdiagnoses** → The action is reviewed by the main agent before merge; the next review sees the
  next round's metrics and can correct course. A high-risk action can be declined with a note.
- **The retro becomes a bottleneck** → It runs in the background with a timeout, a per-goal bound, and a
  threshold; it never delays the next round. The review duration is recorded so the user can see its cost.
- **The gate is satisfied by a labeled dummy worker** → The gate is pressure, not proof; the record and the
  next review make a dummy visible. The worker prompt still needs a real handoff.
- **Root-only metrics miss worker internals** → The loop targets how the root orchestrates its round; worker
  time appears in the round wall time and in the next review's comparison.
- **A brief every round is repetitive** → It is one bounded notice, only in goal rounds; `brief: false` turns
  it off and the follow-through gate still enforces a pending action with the action id and record path. The
  token cost is bounded.
- **A restart mid-round skips a review** → The metrics are incomplete, so a skipped review is safer than a
  baseless one. The next round's review covers the next round.
- **Two reviews share a preset** → The persona is generalized; the block prompt and the retro prompt stay
  specific; tests cover both.
- **A goal with no further rounds gets no follow-through** → The action cannot be applied if the goal is done;
  the record remains for audit and the next change.

## Migration Plan

The new `speedReview` block is added to the fragment with the documented defaults; existing profiles that do
not name it receive the defaults. `speedReview.enabled: false` disables only the review; the row disable
removes both reviews. No records or goal state need migration. The setup and vendored tree are regenerated;
the owner installs the release and restarts the Host for a live effect. Rollback is the config flag or the
row; the new local records can be left in `.dsh` and are ignored.
