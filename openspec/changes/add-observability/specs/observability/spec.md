# Spec Delta

## Purpose

Lets a DSH user see from one view whether the behaviors a setup relies on actually happened in recent
sessions, by deriving counts from the session trajectories DSH already records, without a second log.

## ADDED Requirements

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

A configured row SHALL be defined by data only: an id, a display label, a kind (`signal` or
`guidance`), and for a signal one or more predicates over event type, tool name, injected-message
source kind, turn-abort reason prefix, command name, and at most one argument field/value.
Configuration MUST NOT be executed as code, and an unknown predicate field MUST be rejected with an
error naming that field.

#### Scenario: A tool signal matches calls

- **WHEN** a signal declares the tool predicate `delegate`
- **THEN** every `delegate` tool call in the window counts toward that signal

#### Scenario: One row covers several tools

- **WHEN** a signal declares several tool predicates
- **THEN** the calls of all listed tools count toward that one row

#### Scenario: Unknown predicate rejected

- **WHEN** configuration uses a predicate field the schema does not define
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

A configured signal with no matches in the window MUST appear as an explicit row stating that it has
no traces in the period. The view SHALL state that absence is not evidence of a fault.

#### Scenario: Silent signal shown

- **WHEN** a signal is configured but matched nothing in the window
- **THEN** its row is present and labelled as having no traces, not omitted

### Requirement: Guidance rows come from configured descriptors

A configured row of kind `guidance` SHALL be rendered as guidance-only and MUST NOT be reported as
silent, not loaded, or failing, whatever the events and tools show.

#### Scenario: Prompt-only plugin declared

- **WHEN** configuration declares a guidance row for a plugin that only contributes prompt text
- **THEN** its row states that it is guidance-only and carries no counts

#### Scenario: Guidance row never turns red

- **WHEN** a guidance row's plugin produces no events and registers no tools
- **THEN** the row stays guidance-only rather than entering the silent or not-loaded state

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

The plugin SHALL register one Conversation view that appears beside the shipped Chat and Trajectory
views. The dashboard SHALL present, before any trace detail, a health summary, a KPI strip, one
activity chart over the range buckets, plugin health cards grouped by attention, and a tool
distribution. Status MUST be conveyed as text, not by colour alone, and charts MUST use the published
theme tokens without adding a client-side charting dependency.

#### Scenario: Health at a glance

- **WHEN** the view is opened
- **THEN** the health summary, KPI strip, activity chart, and plugin cards are visible without reading trace lists

#### Scenario: Tab appears

- **WHEN** the plugin is installed and a session is open
- **THEN** a third view is selectable beside Chat and Trajectory

#### Scenario: Status readable without colour

- **WHEN** a row is in the error, silent, not-loaded, or guidance state
- **THEN** the state is written in words as well as styled

### Requirement: Dashboard totals are computed once

The KPI totals and the activity series SHALL be computed once from the window's records. They MUST
NOT be produced by summing rows, because a row set overlaps by design (a tool call belongs to both
the built-in tools set and the configured plugin row that owns it).

#### Scenario: Overlapping rows do not double count

- **WHEN** a tool call belongs to both the built-in tools set and a configured plugin row
- **THEN** the activity chart and the KPI totals count it once

### Requirement: Trace detail is collapsed and metadata-only

The dashboard SHALL keep trace detail collapsed and SHALL show at most the five most recent entries
per row when expanded: time, turn, row id, tool name, and error flag. It MUST NOT render message text
or tool arguments.

#### Scenario: Large session stays scannable

- **WHEN** a row has hundreds of traces in the window
- **THEN** the dashboard stays scannable and the row offers at most five recent metadata entries

#### Scenario: Secret-like event text

- **WHEN** an underlying event contains secret-like text or a tool argument
- **THEN** neither appears anywhere in the rendered dashboard

### Requirement: Blind spots are stated in the view

The view SHALL name what it cannot observe: prompt-only guidance plugins, failures while a plugin
loads, UI rendering effects, and whether a model complied with a prompted rule.

#### Scenario: Blind spots visible

- **WHEN** the view is opened
- **THEN** it names the unobservable categories rather than implying complete coverage
