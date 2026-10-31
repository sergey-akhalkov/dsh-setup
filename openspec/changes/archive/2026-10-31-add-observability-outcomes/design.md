# Design

## Context

The shipped view (`packages/plugin-observability`, v0.19.0) derives plugin liveness and failures from
session trajectories and writes nothing. Its rows, readiness checks, failure list, and blind-spot
statement are kept. The missing layer is task-level outcome: episodes, token usage, quality, speed,
autonomy, subagents, goals, and comparisons.

The data needed for that layer is already recorded:

- `assistant/message.data.usage` carries `inputTokens`, `outputTokens`, `cacheReadTokens`,
  `cacheWriteTokens`, and `totalTokens` per model step.
- `user/message.data.source.kind` separates human messages (`user`) from machine injections
  (`goal`, `goal-continuity`, `delegation-rules`, `verification-gate`, `user-approval`, `agent-message`).
- `goal/change` carries the operation, phase, and `roundsStarted`.
- `work_checkpoint` calls carry `outcome`, `verified`, `remaining`, and `parallel` in their arguments.
- `SessionRecord.header.parentSession`, `origin`, and `delegationDepth` link child sessions to a parent.
- `step/start`, `step/end`, `turn/start`, `turn/end`, `tool/call`, and `tool/result` carry timing and
  failure state.

A read-only pass over 36 sessions in this workspace found 2.15 billion tokens, 99.2% of them cache
reads, 6537 steps, 533 delegate calls, 11 child sessions, 14 goal events, and 4 checkpoints. That sample
is three days wide; it is enough to prove the data exists, not to conclude that any plugin helps.

Constraints:

- No new metrics log, no persisted aggregate, no per-plugin instrumentation (existing requirement).
- No message text, tool arguments, or checkpoint list text in the report.
- Inline SVG and theme tokens only; no charting dependency.
- The current chart is a fixed `viewBox` stretched with `preserveAspectRatio="none"`; this is the defect
  the new chart components remove.

## Goals / Non-Goals

**Goals:**

- Derive task episodes from human messages and use them for quality, cost, speed, and autonomy.
- Read token usage, subagent links, goals, and checkpoints from existing events.
- Show plugin scorecards with a business goal, activation, eligible episodes, an outcome comparison,
  sample size, and an association label.
- Compare against the previous equal window and matched episodes; state data sufficiency.
- Replace the stretched categorical chart with a session timeline and range time series.
- Organize the view as Overview, Plugins, Tasks, and Hypotheses.
- Keep the existing failure, readiness, guidance, and blind-spot behavior.

**Non-Goals:**

- Causal proof, randomization, or a controlled experiment. Comparisons remain associations.
- Price tables, currency, or billing. Cost is expressed in tokens and context load.
- Diff churn, rework from git, per-session configuration history, review verdicts, and CSV export.
- Changes to the DSH core, a new event type, or a new persistence layer.

## Decisions

### Episode model

An episode starts at a `user/message` whose source kind is `user`. Machine messages and tool activity
stay inside it. It ends before the next human message, at session end, or after a configurable idle gap
(default 30 minutes). Events before the first human message are preamble and do not form an episode.
Activity after the idle gap and before the next human message is outside any episode. A session can hold
several episodes; a session with no human message contributes none.

Alternatives considered:

- Turn as the unit: rejected because goal continuity lengthens turns, so turn-based cost would improve
  simply because the plugin ran.
- Session as the unit: rejected because one session often contains several tasks and approvals.
- Goal as the unit: rejected as the primary unit because goals are sparse; it remains a reported
  dimension.

Episode identity is `sessionId#index`, where index follows start time. Episodes are never merged across
sessions. A child session is joined to the parent episode by time overlap with the parent; an unlinkable
child is reported as unlinked. An episode with no final `turn/end` is open and excluded from completed
and failed shares.

### Record extraction

`TraceRecord` gains only metadata:

- `usage` on `assistant/message`: input, output, cache read, cache write, total.
- `goalOperation`, `goalPhase`, and `goalRounds` on `goal/change`; the objective text is not stored.
- `checkpointOutcome`, `checkpointVerifiedCount`, `checkpointRemainingCount`, and `checkpointParallel` on
  a `work_checkpoint` call. The verified, remaining, next, and serial-reason strings are dropped.
- `sessionOrigin` and `parentSession` are carried from `SessionRecord.header`, not from each event.

The checkpoint extraction is dedicated and safer than a configurable argument field: the checkpoint's
lists are user-visible text and paths, and only their lengths and the parallel flag are needed. Unknown
or malformed checkpoint arguments contribute zero, not a startup failure.

### Aggregation

A new pure `episodes` module takes the complete session records, the window, the session headers, and the
configured rows, and returns:

- `Episode[]`: start, end, active time, human and machine message counts, steps, tool calls, token
  totals, outcome, verified flag, goal summary, subagent summary, failures, and the session title.
- Per-row fired and eligible episode sets, built once from the row predicates and the episode index;
  activation uses their intersection.
- Aggregate quality, cost, speed, and autonomy summaries; distributions, not just means.
- Scorecards: eligible counts, the fired intersection, error rate, and the outcome deltas for the treated
  cohort (fired and eligible) versus the control (eligible and not fired).

The existing `aggregate` remains the source of row liveness, the activity series, and failure
attribution. The report composes both; totals come from episodes once, never from row sums or from a
child session added outside its parent.

Episode accounting: episodes are reconstructed from complete session records before filtering. An episode
joins the cohort of the window that contains its start, and joins exactly one cohort. Tokens, steps, and
active intervals are attributed by event time to the window that contains them, splitting an episode that
spans a boundary, so adjacent windows reconcile and no work is lost. Cohort outcomes are observed at the
window end; a baseline never sees a completion after its cutoff. Per-episode cost is measured through the
cutoff by default and labelled; the Tasks detail may show the full episode cost, labelled full. A session
that overlaps a window is read in full, so the human message before the boundary is available.

Matching rule: episodes are binned by tool-call count (0-9, 10-49, 50-199, 200+) and compared within the
same week. If a size bin and week cell is too small, the bin is aggregated across weeks and the report
states that the week was relaxed. A comparison below the configured minimum (default 10 episodes per
side) reads insufficient data.

Activation is the intersection of fired and eligible episodes over eligible episodes. A fired episode
outside its eligibility predicate is shown separately and never enters activation or the treated cohort;
zero eligible episodes read not applicable. The treated cohort is fired and eligible; the control is
eligible and not fired.

Reader: wider ranges already read every session in the workspace. The session range branch currently reads
only the open session, so it must also discover descendants through `parentSession`, read their events
with the same inheritance deduplication, and pass the augmented corpus to the episode builder. A
child-only overlap pulls its parent chain into the read so the parent episode can be reconstructed; an
unresolvable parent is still reported as unlinked. The existing parent-only reader test is replaced by an
integrated session report with children.

### Metrics

Quality: completed, failed, cut, blocked, other, and open shares; verified and unverified completion;
unrecovered failure rate; checkpoint coverage. The map is completed for `completed`, failed for `error`,
cut for `aborted`/`max-tokens`/`interrupted`, blocked for `blocked`, other for an unmapped terminal kind,
and open when there is no final turn end. An unrecovered failure outranks the closer and makes the episode
failed. Verified means a completed checkpoint with a non-empty verified list; self-reported evidence is
labelled as such. A substantive episode has at least four tool calls and at least one successful edit or
write.

Cost: input, output, cache read, cache write, total, context load (input plus cache read), context per
step, and cache hit ratio. Percentiles p50 and p90 are shown; no currency. A message without usage lowers
coverage and contributes zero.

Speed: active time is the union of step intervals and tool intervals, clipped to the episode, excluding
gaps above the idle threshold; a tool inside a step counts once. Command events are not tool intervals and
do not add active time. The view shows p50 and p90 active minutes per episode and per completed episode.
Wall-clock span is never used as speed.

Autonomy: steps per human message; machine injections per human message; human messages per completed
goal; episodes per session; goal completion; rounds started. A human-messages-per-episode count is not a
metric because the episode definition makes it constant.

Subagents: delegate calls per episode; episodes with at least one child; parallel width; parent wait
time; child tokens and outcome; unlinked child count. Child tokens count once in the parent episode.

Hypotheses: configuration entries with `metric`, `direction`, `threshold`, `window`, `minEpisodes`, and
a `guardrail` metric; the metric ids come from a fixed catalog (verified completion rate, tokens per
episode through cutoff, context tokens per step, active minutes per episode, steps per human message,
human messages per completed goal, delegate rate, checkpoint coverage, failure rate). A hypothesis is
`collecting` below its minimum, `supported` when it meets the threshold and its guardrail does not
regress, `refuted` when it moves opposite beyond the threshold, and `inconclusive` otherwise. The UI says
"supported in the observed window", never "proven".

### Attention findings

The dashboard measures outcomes; it also has to say when a run went the wrong way even though every
plugin loaded. The first rule is the serial long run: an episode with at least 40 steps or 20 active
minutes whose joined child sessions never overlapped (parallel width at most one) becomes one attention
finding carrying its episode ids, steps, active minutes, width, and a next action. It is a derivation
over the episode and child metadata the report already carries: no new event, no text. The rule never
fires on an empty window, and a long run with overlapping children is not flagged. Further process rules
(blocking waits, human corrections, untested edits) are out of scope until this one is exercised.

### Baseline

For day, week, and month, the report reads the previous equal window through the same session query
service and computes the same metrics; the existing in-memory cache is reused. The session range uses
the previous completed session in the same workspace, or no baseline when none exists. No baseline data
means the comparison is absent, not zero.

The baseline read doubles the session reads. The design accepts that cost: the cache is keyed by session
identity and modification time, the reader keeps its concurrency bound, and no aggregate is written.
Month is the worst case; the episode list is capped at 200 newest entries while counts remain uncapped.

### Chart rendering

Charts render at the container's actual pixel width, obtained with `ResizeObserver` and a deterministic
fallback width for tests. The SVG has no `preserveAspectRatio="none"` and no fixed 720-unit viewBox
stretched over the panel. Labels are positioned in the same coordinate space, so text and strokes keep
their aspect ratio.

- `SessionTimeline`: time on X, lanes for steps, tools, human messages, and errors; about 96 px high.
  A compact per-turn row sits under it for duration, steps, calls, and errors.
- `RangeSeries`: 24 hourly, 7 daily, or 30 daily bars; bounded bar width (at most 24 px); error overlay;
  three to five X labels; about 140 px high.
- `TokenMix`: one stacked horizontal bar for cache read, input, and output, with a caption.
- `Scorecard`: goal, status pill, activation, primary metric, delta, sparkline, sample size, and the
  association label.
- `Dumbbell`: optional before/after comparison for a scorecard or hypothesis; two points and a
  connecting line, with n printed.

No pie, gauge, dual axis, or animation. Status words accompany colour. The panels use a two-column grid
on wide screens and stack below 900 px, so one chart no longer stretches across the whole page.

### Configuration

Rows gain two optional declarative fields:

- `goal`: a non-empty sentence rendered in the scorecard.
- `eligible`: a predicate list on signal rows; an episode is eligible when any record in it matches any
  predicate. Guidance rows must not declare it.

The shipped defaults gain a goal for each row and eligibility for the rows where it is meaningful
(for example an edit or write predicate for goal continuity and the verification gate). Rows without
eligibility state that eligibility is not declared. The config schema rejects empty goals, eligibility
on guidance rows, and unknown fields by name.

Hypotheses live in the plugin configuration as an array; the shipped default carries two entries (goal
continuity on steps per human message and delegation on active minutes per episode), both likely
collecting on current data. The schema rejects unknown metric ids. There is no formula language and no
code execution.

### Privacy

The report carries metadata only: event times, counts, token numbers, tool names, session ids and
titles, goal phase, checkpoint counts, and flags. It never carries message text, tool arguments, goal
objectives, checkpoint lists, or failure reasons. Fixtures include secret-like strings to prove the
report and the client do not render them.

## Risks / Trade-offs

- **Small sample** → the first weeks will mostly read insufficient data. Mitigation: state it, show
  coverage, and accumulate; never convert absence into health.
- **Selection bias** → plugins fire on tasks that need them, so treated and control episodes differ.
  Mitigation: match on size bin and week; show n; label association; keep the blind-spot statement.
- **Self-reported verification** → a checkpoint can claim success without proof. Mitigation: count only
  non-empty evidence, keep the unverified share visible, and pair it with failures and coverage.
- **Cache reads dominate tokens** → total tokens can mislead. Mitigation: show context per step and the
  cache mix; use p50/p90, not a single mean.
- **Baseline cost** → reading the previous window doubles the work. Mitigation: reuse the cache, bound
  concurrency, cap the episode list, and keep the no-persistence rule.
- **Chart testability** → `ResizeObserver` is not available in every test environment. Mitigation: a
  deterministic fallback width and a pure geometry function tested without a DOM.
- **Configuration replacement** → a profile patch replaces the whole config object, so a profile that
  overrides rows must restate goal and eligibility. Mitigation: defaults regenerate; the signal-map test
  asserts the shipped rows carry the fields; docs state the rule.
- **Guidance compliance remains unobservable** → no counter can prove the model followed a prompt.
  Mitigation: measure delivery and outcomes; keep the blind spot.

## Migration Plan

There is no stored state to migrate. The change is source-only: extend the host extraction and report,
add the episode and chart modules, update the client, regenerate the setup defaults, and build. Existing
profiles remain valid because the new row fields are optional and hypotheses default to empty.

Verification: unit tests for episode boundaries, usage accounting, child joins, scorecards, comparisons,
and chart geometry; route tests for the report shape and privacy; client tests for the four sub-views and
the compact silent group; `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, and `pnpm dogfood`. The
live Desktop profile is installed and reloaded by the owner from an external shell, never by the agent.

Rollback is a version revert. No data or cache survives the process, so a revert loses no measurement
history that the session logs do not already hold.
