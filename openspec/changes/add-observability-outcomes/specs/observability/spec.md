# Spec Delta

## ADDED Requirements

### Requirement: Episodes are derived from human messages

The system SHALL group a session's events into task episodes. An episode SHALL start at a `user/message`
whose source kind is `user`; machine messages and tool activity remain inside it. It SHALL end before the
next human message, at session end, or after a configured idle gap. Events before the first human message
are preamble and MUST NOT form an episode.

#### Scenario: Human message starts an episode

- **WHEN** a session records a `user/message` with source kind `user`
- **THEN** an episode starts at that event and the following activity belongs to it

#### Scenario: Machine message does not split an episode

- **WHEN** a goal, delegation, verification, approval, or agent message appears inside an episode
- **THEN** it stays inside the episode and is counted as a machine injection, not a new task

#### Scenario: Idle gap ends an episode

- **WHEN** no event occurs for longer than the configured idle gap
- **THEN** the current episode ends and later activity starts a new episode only at the next human message

#### Scenario: Activity after an idle gap

- **WHEN** activity appears after the idle gap and before the next human message
- **THEN** it is outside any episode and is not counted as task work

#### Scenario: No human message

- **WHEN** a session has no `user/message` with source kind `user`
- **THEN** it contributes no episode and is not counted as a task

#### Scenario: Preamble is excluded

- **WHEN** a session records system, runtime, or approval events before its first human message
- **THEN** those events are preamble and do not form an episode

#### Scenario: Several episodes in one session

- **WHEN** a session contains several human messages separated by work
- **THEN** each human message starts its own episode and the episodes do not overlap

### Requirement: Token usage is derived from step records

The system SHALL read the usage fields recorded on every assistant message and report input, output,
cache-read, cache-write, total, context load (input plus cache read), and cache hit ratio per episode,
with the observation cutoff stated. A message without usage SHALL contribute zero and lower the stated
coverage. The system MUST NOT estimate tokens from message text or add a metrics log.

#### Scenario: Usage is counted once

- **WHEN** an assistant message carries usage
- **THEN** its input, output, cache-read, cache-write, and total values are added once to its episode

#### Scenario: Missing usage lowers coverage

- **WHEN** an assistant message has no usage
- **THEN** it contributes zero and the data-quality statement reports steps with usage below total steps

#### Scenario: Cache hit ratio

- **WHEN** an episode records input and cache-read tokens
- **THEN** the view reports cache read as a share of input plus cache read

#### Scenario: Context load per step

- **WHEN** an episode records several assistant messages
- **THEN** the view reports context load per step as the mean of input plus cache read across those messages

#### Scenario: No text inference

- **WHEN** usage is absent
- **THEN** the system does not estimate it from message text, tool arguments, or model output

### Requirement: Episode outcomes are classified without message text

The system SHALL classify each episode as completed, failed, cut, blocked, other, or open from its final
turn end and its unrecovered failures. It SHALL mark an episode verified only when a completed work
checkpoint carries non-empty evidence, and unverified when it completes without that evidence. It MUST NOT
infer success from message text.

#### Scenario: Verified completion

- **WHEN** an episode ends with a completed turn and a completed checkpoint carries non-empty evidence
- **THEN** the episode is completed and verified

#### Scenario: Unverified completion

- **WHEN** an episode ends with a completed turn and no completed checkpoint carries evidence
- **THEN** the episode is completed and unverified

#### Scenario: Failed episode

- **WHEN** an episode's final turn ended with reason `error` or a tool failure was not recovered
- **THEN** the episode is failed

#### Scenario: Unrecovered failure outranks the closer

- **WHEN** a tool failure has no completed turn closer and the final turn ended `aborted`
- **THEN** the episode is failed, not cut

#### Scenario: Cut episode

- **WHEN** an episode's final turn ended with `aborted`, `max-tokens`, or `interrupted`
- **THEN** the episode is cut rather than completed or failed

#### Scenario: Blocked episode

- **WHEN** an episode's final turn ended with reason `blocked`
- **THEN** the episode is blocked

#### Scenario: Other terminal reason

- **WHEN** an episode's final turn ended with a reason the outcome map does not define
- **THEN** the episode is other and the unmapped count is reported

#### Scenario: Open episode

- **WHEN** an episode has no final turn end
- **THEN** it is open and is not counted in the completed or failed shares

#### Scenario: Recovered failure

- **WHEN** a tool failure occurred in an episode whose turn ended `completed`
- **THEN** the failure does not make the episode failed

#### Scenario: No text reading

- **WHEN** message text says the task is done
- **THEN** the outcome still comes from the recorded turn end and failure state, not from that text

### Requirement: Active time excludes idle gaps

The system SHALL compute an episode's active time as the union of step intervals and tool intervals,
clipped to the episode, excluding gaps longer than the configured idle threshold. A tool interval inside
a step SHALL count once. The system MUST NOT use the wall-clock span from the first to the last event.
Speed metrics SHALL use active time rather than elapsed time.

#### Scenario: Idle gap excluded

- **WHEN** an episode spans several hours but has a long gap with no events
- **THEN** the gap is excluded from active time

#### Scenario: Intervals are unioned

- **WHEN** a tool call runs inside a step
- **THEN** its time counts once, not once for the step and again for the tool

#### Scenario: Tool outside a step

- **WHEN** a tool call runs outside any step
- **THEN** its call-to-result interval adds to active time

#### Scenario: Command events are not active time

- **WHEN** a command runs outside any step
- **THEN** it does not add active time, because it is not a step or tool interval

#### Scenario: No steps

- **WHEN** an episode records no step or tool interval
- **THEN** its active time is zero and it remains visible

#### Scenario: Long session does not inflate speed

- **WHEN** a session stays open overnight
- **THEN** its active time reflects the work, not the overnight wall-clock span

### Requirement: Subagent work is joined to the parent episode

The system SHALL join a child session to its parent episode through the recorded parent session link,
count its tokens and tools once in that episode, and report delegate calls, parallel width, parent wait
time, and child outcome. A child session MUST NOT become a separate top-level episode. A child whose
parent cannot be resolved SHALL be reported as unlinked, not dropped.

#### Scenario: Child joined to parent

- **WHEN** a session records a child with a parent session
- **THEN** the child's tokens and tool calls belong to the parent episode

#### Scenario: Parallel width

- **WHEN** two child sessions overlap in time inside one episode
- **THEN** the episode reports a parallel width of two

#### Scenario: Parent wait time

- **WHEN** a delegate call is followed by no parent tool activity until its result arrives
- **THEN** that interval is reported as parent wait time

#### Scenario: Child failure is visible

- **WHEN** a child session ends failed or cut
- **THEN** its outcome is reported beside the parent episode without silently failing the parent

#### Scenario: Unlinked child

- **WHEN** a child session has no resolvable parent
- **THEN** it is reported as unlinked rather than dropped or counted as a separate task

#### Scenario: Child work counted once

- **WHEN** a child session is counted in a parent episode
- **THEN** its inherited prefix and its own events are not counted a second time in the same episode

### Requirement: Goals and autonomy are reported

The system SHALL report goals from the session's goal-change events and autonomy from steps and machine
injections per human message. It SHALL report goal completion, rounds started, human messages per
completed goal, and steps between human messages. A session without goals SHALL still report autonomy and
MUST mark goal metrics not applicable.

#### Scenario: Goal created and completed

- **WHEN** a goal is created and later completed
- **THEN** the view reports one completed goal and the human messages spent on it

#### Scenario: Goal paused or open

- **WHEN** a goal is paused, resumed, or left active
- **THEN** its completion is not counted as completed and its phase is reported

#### Scenario: Machine injection is not human

- **WHEN** a goal, delegation, verification, approval, or agent message appears
- **THEN** it is counted as a machine injection and not as a human message

#### Scenario: Several human messages in a goal

- **WHEN** a human sends several messages during one goal
- **THEN** the goal reports all of them and the autonomy metric reflects the ratio

#### Scenario: Steps per human message

- **WHEN** an episode records steps and one human message
- **THEN** the view reports steps between human messages, not a constant one-message count

#### Scenario: No goals

- **WHEN** a session records no goal-change event
- **THEN** autonomy is still reported and goal metrics read not applicable

#### Scenario: Rounds started

- **WHEN** a goal records a started round
- **THEN** the view reports the round count without treating it as a human message

### Requirement: Verification evidence is explicit

The system SHALL treat a work checkpoint as verification evidence only when its outcome is `done` and its
verified list is non-empty. It SHALL report verified and unverified closes and checkpoint coverage, and
MUST NOT store or render the list's text. A checkpoint with outcome `continue` is not a close.

#### Scenario: Done with evidence

- **WHEN** a checkpoint has outcome `done` and a non-empty verified list
- **THEN** the episode is verified

#### Scenario: Done without evidence

- **WHEN** a checkpoint has outcome `done` and an empty verified list
- **THEN** the episode is unverified

#### Scenario: Continue is not a close

- **WHEN** a checkpoint has outcome `continue`
- **THEN** it does not count as a verified or unverified close

#### Scenario: No checkpoint text

- **WHEN** a checkpoint's verified or remaining lists contain paths, commands, or text
- **THEN** the report carries only counts and the rendered view carries no list text

#### Scenario: Missing checkpoint

- **WHEN** an episode completes without any work checkpoint
- **THEN** it is unverified and the coverage statement says so

#### Scenario: Coverage

- **WHEN** the window holds substantive episodes and checkpoints
- **THEN** checkpoint coverage is the share of substantive episodes with a completed checkpoint

### Requirement: Plugin scorecards declare a goal and an eligible population

Each signal row MAY declare a non-empty business goal and an eligibility predicate. The scorecard SHALL
report eligible episodes, the share of them where the row fired (activation), error rate, and an outcome
comparison when the sample is sufficient. A fired episode outside eligibility SHALL be shown separately
and MUST NOT enter activation. Without eligibility the row SHALL use all episodes and state that
eligibility is not declared.

#### Scenario: Declared goal and eligibility

- **WHEN** a signal row declares a goal and an eligibility predicate
- **THEN** its scorecard shows the goal, the eligible and fired counts, activation, the error rate, and the outcome comparison

#### Scenario: Silent with eligible episodes

- **WHEN** a row matches nothing while eligible episodes exist
- **THEN** the scorecard reads zero of the eligible episodes, not zero of the whole window

#### Scenario: Firing outside eligibility

- **WHEN** a row fires in an episode that its eligibility predicate does not match
- **THEN** the episode is shown separately and is excluded from activation and from the comparison cohorts

#### Scenario: Activation cannot exceed the eligible set

- **WHEN** a row fires in every eligible episode and in additional ineligible episodes
- **THEN** activation reads 100%, not more

#### Scenario: No eligibility declaration

- **WHEN** a signal row declares no eligibility predicate
- **THEN** the scorecard uses all episodes and states that eligibility is not declared

#### Scenario: No episodes

- **WHEN** the window holds no episodes
- **THEN** the scorecard reads not applicable and does not show a zero rate

#### Scenario: Outcome comparison

- **WHEN** a scorecard compares the treated cohort with the control
- **THEN** the comparison shows the sample size and is labelled association, not proof

### Requirement: Comparisons state association and sample size

The system SHALL compare a metric with the previous equal window, or for the session range with the
previous completed session in the same workspace, and with matched episodes of similar size and time.
Every comparison SHALL show its sample size and SHALL be labelled association, not proof. Below the
configured minimum the comparison SHALL read insufficient data and MUST NOT be shown as an improvement or
regression.

#### Scenario: Previous equal window

- **WHEN** the view reports a metric for the current window
- **THEN** it also reports the previous equal window and the delta

#### Scenario: Session baseline

- **WHEN** the session range is selected and another completed session exists in the same workspace
- **THEN** the baseline is that previous session, or the comparison is absent when none exists

#### Scenario: Matched episodes

- **WHEN** a metric is compared between episodes that used a plugin and episodes that did not
- **THEN** the comparison uses episodes of similar size and time, and states the matching rule

#### Scenario: Below the minimum

- **WHEN** either side of a comparison holds fewer episodes than the configured minimum
- **THEN** the comparison reads insufficient data

#### Scenario: No baseline

- **WHEN** no previous-window data exists
- **THEN** the comparison is absent rather than shown as zero or as an improvement

#### Scenario: Association label

- **WHEN** any comparison is rendered
- **THEN** the words association, not proof appear with it

#### Scenario: Cohorts are disjoint

- **WHEN** a signal fires in one eligible episode and does not fire in another eligible episode
- **THEN** the first is the treated cohort and the second is the control, and the two sets do not overlap

### Requirement: Episodes are counted by start

The system SHALL reconstruct episodes from complete session records before window filtering. It SHALL
count an episode in the cohort of the window that contains its start, exactly once. A cohort outcome SHALL
be observed at the window end, and a baseline MUST NOT see a completion after its cutoff.

#### Scenario: Start selects the cohort

- **WHEN** an episode starts inside the current window
- **THEN** it joins the current cohort and not the previous one

#### Scenario: Completion after a baseline cutoff

- **WHEN** a baseline episode completes after the baseline cutoff
- **THEN** the baseline does not see that completion

#### Scenario: Human message before the boundary

- **WHEN** the session log holds the human message that started an episode before the window
- **THEN** reconstruction uses it and does not treat the in-window work as preamble

#### Scenario: Child-only overlap

- **WHEN** only a child session has events in the window
- **THEN** its parent chain is read to reconstruct the episode and the child is not a separate task

#### Scenario: Counted once

- **WHEN** two adjacent windows are reported together
- **THEN** each episode joins exactly one cohort

### Requirement: Window work is attributed by time

The system SHALL attribute each record and each active interval to the window that contains its time,
splitting an episode that spans a boundary, so adjacent windows together count every token, step, and
active interval exactly once. A per-episode cost SHALL state whether it is measured through the cutoff or
over the full episode.

#### Scenario: Work is split at the boundary

- **WHEN** an episode started in the previous window records tokens and active time in the current one
- **THEN** that work counts in the current window's totals, not the previous window's

#### Scenario: Adjacent windows reconcile

- **WHEN** two adjacent windows are reported together
- **THEN** their token and active-time totals equal a single combined window's totals, with each unit counted once

#### Scenario: Cohort cost states its cutoff

- **WHEN** a report shows cost for a cohort episode
- **THEN** it states whether the cost is through the window cutoff or the full episode

### Requirement: The view is organized around product questions

The view SHALL offer Overview, Plugins, Tasks, and Hypotheses sub-views. Overview SHALL show a
data-sufficiency verdict, four outcome tiles (quality, cost, speed, autonomy), token mix, activity, and
plugin scorecards. The verdict MUST NOT be healthy when the sample is insufficient or a metric's coverage
is unknown.

#### Scenario: Sub-views

- **WHEN** the view is opened
- **THEN** Overview, Plugins, Tasks, and Hypotheses are selectable without leaving the view

#### Scenario: Thin data

- **WHEN** the window holds fewer episodes than the configured minimum
- **THEN** the verdict reads insufficient data and does not read healthy

#### Scenario: Four outcome tiles

- **WHEN** the overview renders
- **THEN** it shows quality, cost, speed, and autonomy, each with its sample size and a p50 or p90 value

#### Scenario: Low activity

- **WHEN** the window holds one episode and no failures
- **THEN** the overview still renders and does not claim health

#### Scenario: Failure access

- **WHEN** the overview is shown
- **THEN** the failure count is reachable without opening trace detail

#### Scenario: Silent rows stay compact

- **WHEN** several signals are silent
- **THEN** they are shown in a compact group with their trigger and do not displace the outcome view

### Requirement: Activity is rendered at the shape of its data

The session range SHALL render a time-based timeline. Day, week, and month SHALL render a time series
with 24, 7, and 30 buckets. A categorical chart with few buckets SHALL NOT stretch to fill the panel, bars
SHALL have bounded width, and labels SHALL NOT be distorted by non-uniform scaling.

#### Scenario: Session timeline

- **WHEN** the session range is selected
- **THEN** activity is drawn against time, not against turn categories

#### Scenario: Week range

- **WHEN** the week range is selected
- **THEN** seven ordered points are drawn

#### Scenario: Two buckets do not stretch

- **WHEN** a categorical chart holds two buckets in a wide panel
- **THEN** the bars keep a bounded width and do not expand to fill the panel

#### Scenario: Labels not distorted

- **WHEN** the chart is wider than its natural drawing width
- **THEN** text and strokes keep their aspect ratio

#### Scenario: No activity

- **WHEN** every bucket is zero
- **THEN** the chart states that there is no activity in the range

### Requirement: Hypotheses are declarative and evaluated

The system SHALL accept hypotheses as inert configuration: a metric id, a direction, a threshold, a
window, and a guardrail. It SHALL report collecting, supported, refuted, or inconclusive with the sample
size, and MUST NOT execute hypothesis text as code or claim causation.

#### Scenario: Supported

- **WHEN** a hypothesis reaches its sample minimum, meets its threshold, and its guardrail does not regress
- **THEN** it is reported supported in the observed window

#### Scenario: Insufficient data

- **WHEN** a hypothesis has fewer samples than its minimum
- **THEN** it is reported collecting or inconclusive, not supported

#### Scenario: Guardrail blocks

- **WHEN** a hypothesis meets its threshold but its guardrail regresses
- **THEN** it is not reported supported

#### Scenario: Refuted

- **WHEN** a hypothesis reaches its sample minimum and the metric moves opposite beyond its threshold
- **THEN** it is reported refuted

#### Scenario: Inconclusive

- **WHEN** a hypothesis reaches its sample minimum and neither the threshold nor the opposite movement is met
- **THEN** it is reported inconclusive

#### Scenario: Unknown metric rejected

- **WHEN** a hypothesis names a metric the schema does not define
- **THEN** startup fails with an error naming that metric

#### Scenario: Text is data

- **WHEN** a hypothesis carries a description
- **THEN** the description is rendered as data and never executed

### Requirement: Data quality is stated

The view SHALL state the coverage behind every metric: steps with usage, linked child sessions, goal
events, checkpoints, unmapped terminal kinds, and the comparison sample. A metric with partial coverage
SHALL be shown with that coverage and MUST NOT be silently treated as complete.

#### Scenario: Coverage line

- **WHEN** the overview renders
- **THEN** it states the coverage of usage, child links, goals, checkpoints, unmapped closers, and comparisons

#### Scenario: Missing usage

- **WHEN** some assistant messages have no usage
- **THEN** the token metric reports the share of steps with usage and is not shown as complete

#### Scenario: Unlinked child

- **WHEN** a child session has no resolvable parent
- **THEN** the coverage statement reports it as unlinked

#### Scenario: Unmapped closer

- **WHEN** a final turn end kind is outside the outcome map
- **THEN** the coverage statement reports the unmapped count and the episode is other

#### Scenario: No checkpoints

- **WHEN** no work checkpoint was recorded in the window
- **THEN** verification coverage reads zero and no episode is called verified

### Requirement: A long serial run is surfaced as a finding

The system SHALL derive attention findings from the episode metadata. A long episode SHALL be one
recording at least 40 steps or at least 20 active minutes. The system SHALL report one finding when a
long episode ran with a parallel width of at most one, naming the episode, its steps, active time, and
width, with a next action. The finding MUST carry metadata only and MUST NOT be reported for an empty
window or a long run with a parallel width above one.

#### Scenario: Long serial episode

- **WHEN** an episode records at least 40 steps or at least 20 active minutes and its parallel width is at most one
- **THEN** the view reports a finding naming the episode, its steps, its active time, and its parallel width, with a next action

#### Scenario: Parallel work is not flagged

- **WHEN** a long episode ran with a parallel width above one
- **THEN** no serial-run finding is reported

#### Scenario: Thin data reports nothing

- **WHEN** the window holds no episode
- **THEN** no serial-run finding is reported

#### Scenario: Findings are metadata only

- **WHEN** a finding is rendered
- **THEN** it carries counts, times, and an episode id, never message text or tool arguments

## MODIFIED Requirements

### Requirement: Rows are declarative and inert

A configured row SHALL be defined by data only: an id, a label, a kind (`signal` or `guidance`), and for
a signal one or more predicates over event type, tool, injected-message source kind, turn-abort reason
prefix, command name, and one argument field/value. A row MAY carry a `trigger` sentence, a non-empty
`goal` sentence, and for a signal an `eligible` predicate list; a guidance row MAY carry `mounted` section
and/or skill names and MUST NOT carry `eligible`. Descriptors are inert. Configuration MUST NOT be
executed as code, and an unknown field MUST be rejected naming that field.

#### Scenario: A tool signal matches calls

- **WHEN** a signal declares the tool predicate `delegate`
- **THEN** every `delegate` tool call in the window counts toward that signal

#### Scenario: One row covers several tools

- **WHEN** a signal declares several tool predicates
- **THEN** the calls of all listed tools count toward that one row

#### Scenario: Trigger accepted as data

- **WHEN** a row declares a `trigger` sentence
- **THEN** the row mounts and the sentence is rendered as data, never executed

#### Scenario: Goal accepted as data

- **WHEN** a row declares a non-empty `goal` sentence
- **THEN** the scorecard renders the sentence as data and never executes it

#### Scenario: Eligibility accepted as data

- **WHEN** a signal declares an `eligible` predicate list
- **THEN** the scorecard uses it to count eligible episodes and never executes it

#### Scenario: Guidance eligibility rejected

- **WHEN** a guidance row declares `eligible`
- **THEN** startup fails with an error naming the field and the row is not mounted

#### Scenario: Empty goal rejected

- **WHEN** a row declares an empty `goal`
- **THEN** startup fails with an error naming the field

#### Scenario: Unknown predicate rejected

- **WHEN** configuration uses a predicate field the schema does not define
- **THEN** startup fails with an error naming the unknown field and the row is not mounted

#### Scenario: Unknown descriptor field rejected

- **WHEN** a guidance row's `mounted` names a field the schema does not define
- **THEN** startup fails with an error naming the unknown field and the row is not mounted

### Requirement: Ranges and buckets are fixed

The view SHALL offer the ranges `session`, `day`, `week`, and `month`. The session range SHALL be a
time-based timeline over the session's episodes and MUST NOT use the session's turns as buckets. The day,
week, and month ranges SHALL use 24 hourly, 7 daily, and 30 daily buckets. Events that belong to no turn
SHALL remain in the timeline rather than being dropped. A range SHALL cover every session in the workspace
whose events fall inside the window, including subagent child sessions.

#### Scenario: Week range

- **WHEN** the week range is selected
- **THEN** the view renders seven daily buckets

#### Scenario: Subagent work counted

- **WHEN** a parent session started subagent sessions in the window
- **THEN** their events count toward the same rows

#### Scenario: Session range includes descendants

- **WHEN** the session range is selected for a session that started child sessions
- **THEN** the child sessions' events, tokens, and outcomes are included in the session report

#### Scenario: Command outside a turn

- **WHEN** a session records a command that no turn wraps
- **THEN** the command appears in the session timeline and in the session total

#### Scenario: Session timeline

- **WHEN** the session range is selected
- **THEN** the view draws the session against time rather than one bucket per turn

#### Scenario: Turn buckets are not used

- **WHEN** a session holds several turns
- **THEN** the session range does not render one bar per turn

### Requirement: Absence is explicit, never silent

A configured signal with no matches in the window MUST appear as an explicit row stating that it has no
traces in the period. The row SHALL state what it waits for: its configured `trigger` when present, and
its eligible-episode count beside its zero; without an eligibility declaration it SHALL state that
eligibility is not declared. The view SHALL state once per group that absence is not evidence of a fault.
Absence alone MUST NOT place a row in needs-attention, and a window with no eligible episodes MUST NOT be
reported as healthy.

#### Scenario: Silent signal shown

- **WHEN** a signal is configured but matched nothing in the window
- **THEN** its row is present and labelled as having no traces, not omitted

#### Scenario: Trigger and context shown

- **WHEN** a silent row carries a trigger sentence
- **THEN** the row shows that sentence and its eligible-episode count beside its zero

#### Scenario: Silence without a trigger

- **WHEN** a silent row carries no trigger sentence
- **THEN** the row still states that it has no traces and that absence is not evidence of a fault

#### Scenario: No eligibility declared

- **WHEN** a silent row declares no eligibility predicate
- **THEN** the row states that eligibility is not declared rather than implying it is zero of the whole window

#### Scenario: No eligible episodes

- **WHEN** a silent row's eligibility predicate matches no episode
- **THEN** the window reads insufficient data, not healthy

#### Scenario: Absence is not attention

- **WHEN** every configured signal is silent and no failure needs attention
- **THEN** the rows are not placed in needs-attention

### Requirement: Nothing is persisted

Aggregates SHALL be computed on demand. The system MUST NOT write its own files: any caching is in
memory, keyed by session identity and modification time, and MUST NOT survive a Host restart.

#### Scenario: Restart recomputes

- **WHEN** the Host restarts and the view is opened again
- **THEN** the same numbers are recomputed from the sessions and no cache file exists

#### Scenario: Unchanged session not re-read

- **WHEN** the same range is requested twice and no session changed
- **THEN** the second request is answered from the in-memory aggregate

#### Scenario: Previous-window baseline

- **WHEN** a comparison needs the previous equal window
- **THEN** the report computes it from the sessions and writes no file

#### Scenario: Baseline cache

- **WHEN** the previous window is unchanged between two requests
- **THEN** its aggregate is reused from the in-memory cache and no persisted store appears

### Requirement: The view is a dashboard, not a log browser

The plugin SHALL register one Conversation view that appears beside the shipped Chat and Trajectory
views. The dashboard SHALL present, before any trace detail, a data-sufficiency verdict, four outcome
tiles, token mix, an activity timeline or series, plugin scorecards, a collapsed failure list, and a tool
distribution. It SHALL offer Overview, Plugins, Tasks, and Hypotheses sub-views. Status MUST be conveyed
as text, not by colour alone, and charts MUST use the published theme tokens without adding a client-side
charting dependency.

#### Scenario: Health at a glance

- **WHEN** the view is opened
- **THEN** the verdict, outcome tiles, token mix, activity, failure count, and scorecards are visible without reading trace lists

#### Scenario: Sub-views

- **WHEN** the view is opened
- **THEN** Overview, Plugins, Tasks, and Hypotheses are selectable beside one another

#### Scenario: Thin data

- **WHEN** the window holds fewer episodes than the configured minimum
- **THEN** the verdict reads insufficient data rather than healthy

#### Scenario: Tab appears

- **WHEN** the plugin is installed and a session is open
- **THEN** a third view is selectable beside Chat and Trajectory

#### Scenario: Status readable without colour

- **WHEN** a row is in the error, silent, not-loaded, not-mounted, or guidance state
- **THEN** the state is written in words as well as styled

#### Scenario: Failure count reveals the list

- **WHEN** the failure count control is activated
- **THEN** the failure list is shown with its entries

### Requirement: Dashboard totals are computed once

The episode totals, token totals, and activity series SHALL be computed once from the window's records.
Window token totals SHALL attribute work by event time; episode counts SHALL select by start. They MUST
NOT be produced by summing rows, and a child session MUST NOT be added directly to a total outside its
parent episode, because rows overlap and child work belongs to the parent.

#### Scenario: Overlapping rows do not double count

- **WHEN** a tool call belongs to both the built-in tools set and a configured plugin row
- **THEN** the activity chart and the totals count it once

#### Scenario: Child tokens counted once

- **WHEN** a child session's usage belongs to a parent episode
- **THEN** the token total counts it once

#### Scenario: Tokens are not a row sum

- **WHEN** several plugin rows match the same step
- **THEN** the token total is not the sum of those rows

#### Scenario: Episode count

- **WHEN** one session holds several episodes
- **THEN** the episode total counts each episode once

### Requirement: Blind spots are stated in the view

The view SHALL name what it cannot observe: whether a model complied with a prompted rule, UI rendering
effects, a plugin failure that leaves no registered tool, prompt section, or skill, whether a human
accepted the result, and the configuration or version that was active in a past session. It SHALL state
that comparisons are associations, not causal proof. It MUST NOT claim that prompt-only guidance is
unobservable, because its delivery is checked; compliance is what remains unknowable.

#### Scenario: Blind spots visible

- **WHEN** the view is opened
- **THEN** it names the unobservable categories rather than implying complete coverage

#### Scenario: Delivery is not compliance

- **WHEN** a guidance contribution is reported mounted
- **THEN** the blind spots still state that compliance with its text is not observable

#### Scenario: Association is not proof

- **WHEN** a plugin comparison is shown
- **THEN** the blind spots state that the comparison is an association, not causal proof

#### Scenario: Acceptance is not recorded

- **WHEN** an episode is marked completed
- **THEN** the blind spots state that whether the human accepted the result is not recorded

#### Scenario: Configuration history is not recorded

- **WHEN** a past session is compared with the current one
- **THEN** the blind spots state that the configuration and version active in that session are not recorded
