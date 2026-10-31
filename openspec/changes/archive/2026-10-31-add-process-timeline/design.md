# Design

## Context

The observability view (`packages/plugin-observability`) already reconstructs task episodes, joins
subagent child sessions to their parent episode, and derives `work_checkpoint` facts. It reports what
the work cost and produced; it has no time axis for the behavior the process rules are meant to cause.
The rules under test are shipped as guidance and gates (lane decomposition before an apply,
self-reflection every N steps), so the only evidence of compliance is what the agent actually called
and when.

The data already exists:

- A child session records its start and end through its own event times; the reader already joins it to
  the parent episode and reports its span.
- `work_checkpoint` calls carry an outcome word and their timestamp; the record extractor keeps the
  outcome and drops the lists.
- `step/start`, `user/message`, and `turn/end` times give the work rate and the episode boundaries.

No new event, no prompt inspection, no persistence.

## Goals / Non-Goals

**Goals**

- Show worker activations, active worker concurrency, and reflection points on one time axis.
- Show the work rate (steps per bucket) under the markers, so a reader can see what changed when.
- Summarize the process per window: time to first worker, activations per episode, maximum concurrency,
  steps between reflections, reflections per episode, and coverage.
- Compare a configured intervention date, or the previous equal window, as an association.

**Non-Goals**

- Deciding whether the model *decided* to decompose; only calls are observable.
- Reading prompt, skill, or configuration text.
- A stored experiment registry or history of configuration changes.
- Per-prompt compliance measurement.

## Decisions

### Process events

A **worker** is a joined child session of an episode. Its activation time is its first own record and
its end is its last own record; the span is clipped to the observed window.

A **decomposition marker** is the first worker activation of an episode after a period with no active
worker; the marker carries the episode id, the activation time, and the number of workers in that
episode. Marking every activation would drown the chart; marking each burst start answers "when did
parallel work begin?".

A **reflection marker** is a `work_checkpoint` call whose outcome word parsed; it carries the time, the
episode id, the outcome word, and the number of steps since the previous reflection (or since the
episode start). A malformed checkpoint call (no parseable outcome) is not a reflection: it does not
reset the cadence and does not count toward reflection coverage; it stays visible in the raw checkpoint
count. This is the self-reflection instrument the rules use; the 40-step cadence is read as the observed
distance between markers, not assumed.

The **step-rate strip** reuses the window's step events: steps per bucket. Buckets are the range's
existing buckets for day/week/month and 24 equal parts of the session timeline for the session range.

### Summary

Per window: workers (distinct joined child sessions), episodes with a worker, worker activations,
maximum concurrent workers, time from episode start to its first worker (p50/p90 over episodes with a
worker), steps between reflections (p50/p90), reflections per episode, and reflection coverage (episodes
with at least one reflection over all episodes). Absent data reads absent, never zero-success.

### Before and after

The plugin configuration gains one optional `interventionAt` ISO date. When set, the panel splits the
episodes by start at that instant and reports both summaries with their episode counts and an
association label; below the configured minimum on either side the comparison reads insufficient data.
Without the date the panel compares with the previous equal window the report already carries, or with
the previous completed session for the session range, and names that baseline. The date is
configuration data, not logged configuration history, and the view states that it is the reader's
declared marker.

### Rendering

One panel in the Overview, next to the activity chart: a worker-concurrency step chart (0..N) with
decomposition and reflection markers, a step-rate strip below it, and a compact summary table. Time is
the X axis; every marker carries a title with its time and counts only. The panel is not a new
top-level tab; the four sub-views stay.

## Risks / Trade-offs

- **Sparse workers** → most windows will show no markers; the panel states "no worker was observed" and
  never implies the rule fired.
- **Burst definition is a heuristic** → a worker started for an unrelated reason still marks a burst;
  the summary states counts, not intent.
- **Intervention date is declarative** → a wrong date misleads the split; the panel prints the date it
  used.
- **Reflection cadence is observed, not enforced** → a gap is evidence of no call, not proof the agent
  skipped reflection.

## Migration Plan

Source-only: a new pure module, one report field, one optional configuration field, one client panel,
and docs. Existing profiles remain valid because the field is optional; no stored state moves.
Rollback is a version revert.

## Open Questions

None. The list of process rules this measures is open-ended; further instruments (blocking waits,
human corrections) stay out of scope until this one is exercised.
