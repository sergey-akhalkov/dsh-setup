# observability Specification

## Purpose
Lets a DSH user see from one view whether the behaviors a setup relies on actually happened in recent
sessions, by deriving counts from the session trajectories DSH already records, without a second log.

## Requirements

### Requirement: Activity is derived from session trajectories

The system SHALL derive every reported number from the session event log through the Host session
query service. It MUST NOT introduce a separate metrics log, a persisted aggregate store, or any
per-plugin instrumentation.

#### Scenario: Numbers come from existing sessions

- **WHEN** the view is opened on a profile that already recorded sessions
- **THEN** every row is computed from those session events and no new file appears under the Harness home

#### Scenario: Session with no events

- **WHEN** a session in the window has no matching events
- **THEN** its window contributes zero and the view still renders

### Requirement: Each event counts once

A session log MAY begin with a prefix inherited from a parent session. The system SHALL count only the
events a session owns, using the durable inheritance boundary, and MUST NOT count an inherited copy a
second time. Within one window total, an event SHALL contribute exactly once.

#### Scenario: Continuable fork

- **WHEN** a child session is seeded with a prefix of its parent's log
- **THEN** the copied prefix is excluded from the child's contribution and the parent's activity is not doubled

#### Scenario: Child's own work still counts

- **WHEN** the same child session records its own tool calls after the inherited prefix
- **THEN** those calls count once, toward the same rows as the parent's

### Requirement: Rows are declarative and inert

A configured row SHALL be defined by data only: an id, a label, a kind (`signal` or `guidance`), and for
a signal one or more predicates over event type, tool, injected-message source kind, turn-abort reason
prefix, command name, and one argument field/value. A row MAY carry a `trigger` sentence, and a guidance
row MAY carry `mounted` section and/or skill names. Descriptors are inert. Configuration MUST NOT be
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

#### Scenario: Unknown predicate rejected

- **WHEN** configuration uses a predicate field the schema does not define
- **THEN** startup fails with an error naming the unknown field and the row is not mounted

#### Scenario: Unknown descriptor field rejected

- **WHEN** a guidance row's `mounted` names a field the schema does not define
- **THEN** startup fails with an error naming the unknown field and the row is not mounted

### Requirement: Built-in signal sets need no configuration

The system SHALL provide an `activity` set, a `tools` set, and an `errors` set that are computed
without any configuration, so a fresh installation shows a populated view.

#### Scenario: Fresh installation

- **WHEN** the plugin is installed with no signal configuration
- **THEN** the view shows turn, step, and tool-call counts, one row per observed tool name, and error counts

#### Scenario: Unknown tool appears

- **WHEN** a tool that no configuration mentions is called
- **THEN** it appears in the `tools` set under its own name

### Requirement: Plugin attribution is automatic where the log carries it

Injected messages SHALL be attributed by their declared source kind, and aborted turns by their
reason prefix. An abort-derived row SHALL be named by a content-free owner token from that prefix
(the leading `plugin:` segment), never by the whole reason, because the text after the prefix can
quote streamed model output. Tool ownership SHALL be attributed only from configured mapping; a tool
without a mapping MUST remain visible under its tool name.

#### Scenario: Injected message attributed

- **WHEN** a plugin injects a message carrying its source kind
- **THEN** the message counts toward the row for that source kind without any configuration

#### Scenario: Abort attributed by prefix

- **WHEN** a turn is aborted with a reason whose prefix names a plugin
- **THEN** the abort counts toward that plugin's row

#### Scenario: Abort text stays out of the row

- **WHEN** an abort reason quotes streamed model text after its plugin prefix
- **THEN** the row id and label carry only the plugin token and never the quoted text

#### Scenario: Unmapped tool stays visible

- **WHEN** a tool has no configured owner
- **THEN** it is still shown, under its tool name, rather than dropped

### Requirement: Ranges and buckets are fixed

The view SHALL offer the ranges `session`, `day`, `week`, and `month`. Buckets MUST be the session's
turns, then hours, then days, then days. Events that belong to no turn, such as a command appended
outside one, SHALL count in one explicit outside-turn bucket of the session range rather than being
dropped. A range SHALL cover every session in the workspace whose events fall inside the window,
including subagent child sessions.

#### Scenario: Week range

- **WHEN** the week range is selected
- **THEN** the view renders seven daily buckets

#### Scenario: Subagent work counted

- **WHEN** a parent session started subagent sessions in the window
- **THEN** their events count toward the same rows

#### Scenario: Command outside a turn

- **WHEN** a session records a command that no turn wraps
- **THEN** the command appears in the outside-turn bucket and in the session total

### Requirement: Absence is explicit, never silent

A configured signal with no matches in the window MUST appear as an explicit row stating that it has no
traces in the period. The row SHALL also state what it waits for: its configured `trigger` sentence when
present, and the window's activity denominators (turns, tool calls, sessions) beside its own zero. The
view SHALL state once per group that absence is not evidence of a fault. Absence alone MUST NOT place a
row in needs-attention.

#### Scenario: Silent signal shown

- **WHEN** a signal is configured but matched nothing in the window
- **THEN** its row is present and labelled as having no traces, not omitted

#### Scenario: Trigger and context shown

- **WHEN** a silent row carries a trigger sentence
- **THEN** the row shows that sentence and the window's turns and tool calls beside its zero

#### Scenario: Silence without a trigger

- **WHEN** a silent row carries no trigger sentence
- **THEN** the row still states that it has no traces and that absence is not evidence of a fault

### Requirement: Guidance rows come from configured descriptors

A configured row of kind `guidance` SHALL be rendered as guidance-only and MUST NOT be reported as
silent, not loaded, or failing, whatever the events and tools show. A guidance row that declares a prompt
contribution reports its readiness under the readiness requirement and still carries no activity counts.

#### Scenario: Prompt-only plugin declared

- **WHEN** configuration declares a guidance row with no contribution
- **THEN** its row states that it is guidance-only and carries no counts

#### Scenario: Guidance row never turns red

- **WHEN** a guidance row's plugin produces no events and registers no tools
- **THEN** the row is not reported as silent or not loaded, and only a declared contribution that is not mounted needs attention

#### Scenario: Declared contribution reported

- **WHEN** a guidance row declares a section or skill
- **THEN** the row reports that readiness and carries no activity counts

#### Scenario: Readiness is not activity

- **WHEN** a mounted guidance row's plugin still produces no events
- **THEN** the row stays mounted and is not reported as silent

### Requirement: Loaded state is distinguished from activity

For signals bound to tool names, the system SHALL compare the configured tools against the live tool
registry and mark an unregistered tool as not loaded, distinctly from a loaded-but-silent signal.

#### Scenario: Tool missing from the registry

- **WHEN** a signal names a tool that the running Host does not expose
- **THEN** its row reports not loaded, not silence

### Requirement: Nothing is persisted

Aggregates SHALL be computed on demand. The system MUST NOT write its own files: any caching is
in memory, keyed by session identity and modification time, and MUST NOT survive a Host restart.

#### Scenario: Restart recomputes

- **WHEN** the Host restarts and the view is opened again
- **THEN** the same numbers are recomputed from the sessions and no cache file exists

#### Scenario: Unchanged session not re-read

- **WHEN** the same range is requested twice and no session changed
- **THEN** the second request is answered from the in-memory aggregate

### Requirement: The view is a dashboard, not a log browser

The plugin SHALL register one Conversation view that appears beside the shipped Chat and Trajectory views.
The dashboard SHALL present, before any trace detail, a health summary, a KPI strip, one activity chart,
a collapsed failure list, plugin health cards grouped by attention, and a tool distribution. Status MUST
be conveyed as text, not by colour alone, and charts MUST use the published theme tokens without adding a
client-side charting dependency.

#### Scenario: Health at a glance

- **WHEN** the view is opened
- **THEN** the health summary, KPI strip, activity chart, failure count, and plugin cards are visible without reading trace lists

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

The KPI totals and the activity series SHALL be computed once from the window's records. They MUST
NOT be produced by summing rows, because a row set overlaps by design (a tool call belongs to both
the built-in tools set and the configured plugin row that owns it).

#### Scenario: Overlapping rows do not double count

- **WHEN** a tool call belongs to both the built-in tools set and a configured plugin row
- **THEN** the activity chart and the KPI totals count it once

### Requirement: Trace detail is collapsed and metadata-only

The dashboard SHALL keep per-row trace detail collapsed and SHALL show at most the five most recent
entries per row when expanded: time, turn, row id, tool name, and error flag. The failure list is not
trace detail: it MAY show every failure up to its bound with time, session, turn, step, tool, severity,
and the error name and code. Neither SHALL render message text, tool arguments, or a failure's raw
reason.

#### Scenario: Large session stays scannable

- **WHEN** a row has hundreds of traces in the window
- **THEN** the dashboard stays scannable and the row offers at most five recent metadata entries

#### Scenario: Secret-like event text

- **WHEN** an underlying event contains secret-like text, a tool argument, or a raw failure reason
- **THEN** none appears anywhere in the rendered dashboard or its copy output

#### Scenario: Failure context without text

- **WHEN** a failure entry is expanded
- **THEN** it shows its recorded metadata and no failure reason

### Requirement: Blind spots are stated in the view

The view SHALL name what it cannot observe: whether a model complied with a prompted rule, UI rendering
effects, and a plugin failure that leaves no registered tool, prompt section, or skill. It MUST NOT claim
that prompt-only guidance is unobservable, because its delivery is checked; compliance is what remains
unknowable.

#### Scenario: Blind spots visible

- **WHEN** the view is opened
- **THEN** it names the unobservable categories rather than implying complete coverage

#### Scenario: Delivery is not compliance

- **WHEN** a guidance contribution is reported mounted
- **THEN** the blind spots still state that compliance with its text is not observable

### Requirement: Failures are listed with severity and context

Every failed or cut record in the window SHALL appear in one failure list that is independent of the
configured plugin rows and of the per-row trace-detail cap. Each entry SHALL carry its severity, time,
session, turn, step when known, the tool name when known, and the error identity the log records (`name`
and `code`). The list SHALL be computed from the same records as the dashboard totals, and its counts
SHALL cover the whole window even when the rendered entries are bounded.

#### Scenario: Tool failures listed

- **WHEN** a window holds 22 failed tool results across `edit`, `write`, `read`, and `delegate`
- **THEN** the list shows 22 entries, each with its tool and recorded error identity, not one aggregated number

#### Scenario: Severity classes are distinct

- **WHEN** a turn ended with reason `error`
- **THEN** its entry is a turn failure, reported separately from the window's tool failures

#### Scenario: A cut turn is visible without an error result

- **WHEN** a turn ended with `max-tokens` or `interrupted`
- **THEN** it appears as a turn cut even though no failed tool result was recorded

#### Scenario: Recovered tool failure

- **WHEN** a tool result failed and its turn ended `completed`
- **THEN** the entry is marked recovered and that failure alone does not make the window need attention

#### Scenario: Unrecovered tool failure

- **WHEN** a failed tool result's turn ended otherwise, is still open, or has no closer in the session
- **THEN** the entry is not recovered and the window needs attention for it

#### Scenario: Bounded list, complete counts

- **WHEN** the window holds more failures than the rendered list bound
- **THEN** the counts still cover every failure and the list states that it shows the newest entries

#### Scenario: No failure text

- **WHEN** a failure's raw reason, message text, or tool arguments contain secret-like text
- **THEN** neither the rendered list nor its copy output contains that text

### Requirement: Failures can be opened and turned into a fix session

The view SHALL open a failure in its recorded context: within the current session it focuses the
registered tool-call inspector on that call, and for another session it opens that session. It SHALL
also offer a prefilled new session describing the listed failures; the prompt is a reviewable draft, is
never submitted automatically, and never discards an existing draft. Where a new session cannot be
opened, the control is absent and the list stays copyable.

#### Scenario: Focus the inspector

- **WHEN** a failure entry from the current session is opened
- **THEN** the registered tool-call inspector focuses that recorded call

#### Scenario: Open another session

- **WHEN** a failure entry from another session is opened
- **THEN** that session opens and the view does not claim to focus the event across the session boundary

#### Scenario: Prefilled fix session

- **WHEN** the fix control is used
- **THEN** a new session opens with a draft naming the listed failures and no message has been sent

#### Scenario: Existing draft preserved

- **WHEN** the target blank session already holds a draft
- **THEN** that draft is kept and the failure prompt is appended to it

#### Scenario: Degraded client

- **WHEN** the client cannot open a new session
- **THEN** no fix control is shown and the failure list remains copyable

### Requirement: Needs-attention is earned by readiness or unrecovered failure

The view SHALL report needs-attention only when the window holds a turn failure, a turn cut, a tool
failure its turn did not recover from, a signal whose configured tool is not loaded, or a guidance row
whose declared contribution is not mounted. Silence, recovered tool failures, and an unknown readiness
check MUST NOT produce needs-attention on their own.

#### Scenario: Unmapped failure still needs attention

- **WHEN** an unmapped tool's result failed and its turn did not complete, while every configured signal is silent and their readiness checks pass
- **THEN** the window needs attention for that failure

#### Scenario: Recovered-only window stays healthy

- **WHEN** the only failures in the window are recovered tool failures and every readiness check passes
- **THEN** the health verdict is healthy

#### Scenario: Unknown readiness never raises attention

- **WHEN** a declared readiness check cannot complete
- **THEN** needs-attention is not raised for it

#### Scenario: Silence alone stays healthy

- **WHEN** every configured signal is silent, no failure needs attention, and every readiness check passes or is unknown
- **THEN** the health verdict is healthy

### Requirement: A tool's failing share uses one call population

The tool distribution SHALL compute each tool's failing share over the calls made inside the window,
joining a call to its own result by call identity, so the share never exceeds that call count. A call
that has no joined failed result MUST count as not failed. A tool with no calls in the window has no
share to draw.

#### Scenario: Proportional share

- **WHEN** a tool made 179 calls inside the window and 17 of them failed
- **THEN** its bar draws 17 of 179 with that percentage, not a fully failing bar

#### Scenario: Boundary results do not inflate a share

- **WHEN** failed results inside the window belong to calls made before it
- **THEN** those results do not enter the bar's share, while the failure list still shows them by their own time

#### Scenario: Missing result is not a failure

- **WHEN** a call inside the window has no result yet
- **THEN** the bar does not count it as failed

#### Scenario: Zero calls

- **WHEN** a tool has no calls in the window
- **THEN** no failing share is drawn for it

### Requirement: Guidance readiness is checked against the live registries

Each declared prompt contribution SHALL be checked against the live registries: a prompt section against
the assembled system prompt's section names, a skill against the skill catalog's completed discovery. A
guidance row whose declared contribution is present reports `mounted`; an absent one reports `not mounted`
and needs attention. A guidance row with no declared contribution, or whose check cannot run or did not
complete, MUST NOT be reported as failing.

#### Scenario: Section mounted

- **WHEN** a guidance row declares the section `dsh-setup:ponytail` and the assembled prompt contains it
- **THEN** the row reports mounted

#### Scenario: Section absent

- **WHEN** the declared section is absent from the assembly
- **THEN** the row reports not mounted and the view names it as needing attention

#### Scenario: Skill mounted

- **WHEN** a guidance row declares a skill and the catalog lists it
- **THEN** the row reports mounted

#### Scenario: Check unavailable

- **WHEN** the prompt or skill registry is unavailable, or the assembly fails
- **THEN** the row reports readiness unknown and is not reported as failing

#### Scenario: Partial skill discovery

- **WHEN** the catalog reports an incomplete observation and the declared skill is not listed
- **THEN** the row reports readiness unknown rather than not mounted

#### Scenario: No declaration

- **WHEN** a guidance row declares no contribution
- **THEN** it stays guidance-only with no readiness word
