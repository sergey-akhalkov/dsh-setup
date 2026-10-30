# Design

## Context

See `proposal.md` — Why. The facts this design depends on, verified against the running Host and the
installed packages:

- Every session is an append-only event log. The Host exposes it through `sessionQuery`:
  `listSessions()`, `readSession(id)`, `listEvents(id)`, `traceSession(id)`. The web client never needs
  the on-disk zstd framing, which is a private format.
- A Conversation view is a `conversation.view` list slot with three registration fields (`id`, `order`,
  `label`). Shipped occupants are `chat` (order 0) and `trajectory` (order 10). Views are session
  scoped and their standard props include session and chat projections.
- The tool registry exposes `ToolSchema` and `ToolDefinition` — name, description, parameters, execution.
  There is no owner field and no API that maps a tool to the plugin that registered it.
- A plugin can declare the source kind of the messages it injects and the prefix of a turn-abort reason;
  those two are the only self-declared identities in the log.
- The client exposes theme tokens (`--dsw-alias-*`) and React; no charting component was found among the
  verified primitives.
- Repository conventions apply: one bundle per plugin, a composition fragment the generator folds into
  the setup patch, prebuilt `lib/` shipped, no install-time script, English artifacts.

## Goals / Non-Goals

**Goals:**

- One generic engine that turns session events into per-signal buckets, and one view that renders any
  set of signals. Plugins are configuration, not a code path.
- Useful with zero configuration on any DSH installation, and useful for this setup's sixteen plugins
  with only a data change.
- No new source of truth: read the log, compute on demand, keep nothing.

**Non-Goals:**

- Alerting, thresholds, export, scheduled snapshots.
- Reading across workspaces or machines.
- Judging whether the model complied with a prompted rule.
- Observing prompt-only guidance, plugin load failures, or UI rendering.
- A CLI or an agent-facing tool in this change.

## Decisions

### Rows, not plugins

The unit is a configured **row**: `{ id, label, kind, match }` with `kind` being `signal` or
`guidance`. A signal's `match` is one predicate or a list of them, each selecting on event type, tool
name, injected-message source kind, turn-abort reason prefix, command name, and one argument
field/value; a list is an any-of, so one row covers several tools. A guidance row carries no match:
it exists so a prompt-only plugin can be named honestly instead of being absent or misread as broken.
Rows, buckets, ranges, and the view are generic over rows.

Alternative rejected: per-plugin instrumentation that emits its own metric events. It would duplicate
the log, require touching every plugin, and still drift. Alternative rejected: a hardcoded
plugin→tool table inside the package. It is specific to this setup, and it rots silently whenever a tool
is renamed.

### Attribution is data, and the view says when it is missing

Injected messages and aborts are attributed with no configuration because the log carries their
identity. An abort row is named by the content-free owner token before the first colon: a hook reason
such as `loop-guard:final: repeated line: "…"` may quote streamed model output after the prefix, so
neither the row id nor the label may include the rest of the reason. Tool ownership cannot be derived,
so it comes from a configured map. An unmapped tool is shown under its own name instead of being
hidden — the view remains honest on a third-party profile.

### Read through the Host, aggregate in a pure function

The Host reads records; `aggregate(records, signals, range)` is a pure function returning buckets per
signal. It is tested on event fixtures with no Host and no UI. The route
`GET /plugins/dsh-setup-observability/report?range=…` returns the aggregate as JSON, following the
existing web-route pattern.

Alternative rejected: parsing `session.v4.jsonl.zstd` directly. The framing is private, concatenated
zstd frames; the service already reads it, prefers live sessions over disk, and survives format changes.

### Subagent sessions count, but only their own events

Child sessions are separate logs, and most delegated work happens inside them. A range covers every
workspace session whose events fall in the window, parent or child.

A continuable child may be seeded with a prefix of its parent's log, so that child's file can repeat
events the parent already recorded. `sessionQuery.readSession` returns a `SessionLogSnapshot` whose
`inheritedEventCount` sits beside the header — not inside it — and the reader starts at that count,
skipping the copied prefix. The header carries only `isSeeded`, which says a seed happened without
saying where it ended. No lineage walk is needed for selection; the boundary is a per-session number.
The alternative — counting everything and documenting the over-count — would make the totals wrong
exactly where delegation is heaviest.

### Buckets are fixed per range

`session` → one bucket per turn plus one trailing outside-turn bucket; `day` → 24 hourly buckets;
`week` → 7 daily buckets; `month` → one bucket per calendar day. The outside-turn bucket exists because
a command is appended straight to the log with no turn around it; dropping it would hide exactly the
activity an operator looks for. Fixed buckets keep the aggregate comparable across ranges and keep the
client dumb.

### The view is a dashboard, not a log browser

The view answers "is everything healthy?" before "what exactly happened": a health line, a KPI strip
(turns, steps, tool calls, errors), one activity chart for the range, plugin health cards grouped by
attention, and a tool distribution. Built-in aggregates feed the KPI strip and the tool list; configured
rows become cards. They do not share one flat table, because that mixes totals with owners and reads as
a log. Trace detail stays collapsed: the full log already lives in Chat and Trajectory.

### One activity series, not a sum of rows

Rows overlap by design: a `delegate` call belongs to both the tools set and the delegation-rules row.
The Host therefore computes the dashboard's per-bucket activity and error series once from the records,
and the KPI totals from those same records. The client never adds row counts together.

### Status is four words, always spelled out

`not loaded` (a configured tool is absent from the live registry), `error` (at least one error trace),
`active` (traces present), `silent` (configured, no traces). Each is rendered as text as well as colour.
`silent` is explicitly labelled as the absence of traces, not proof of a fault. A guidance row has no
status at all: it keeps its guidance-only label and never enters these four.

### Nothing is persisted; the cache is memory

Per-session aggregates are cached by session id plus modification time. A second request for an unchanged
range is served from memory. The cache is bounded (least-recently-used) and dies with the Host, so there
is no schema to migrate and no data to leak.

### Details are on demand and metadata-only

A card's expanded view lists at most the five most recent traces: time, the turn when the event belongs
to one, the row id, the tool name, and the error flag. It never shows message text or tool arguments:
aggregates are the point, and a snippet is the easiest way to leak a secret into a UI that gets
screenshotted. A row with hundreds of traces must not turn into a wall of bullets.

### Charts are inline SVG with an axis

The activity chart is one titled bar per bucket, with the error share in the error token, y gridlines,
first/middle/last axis labels, and a legend. Sparklines are the same primitives at card size. SVG
inherits the theme tokens and switches with the light/dark theme for free; a charting library would add
tens of kilobytes to a published client bundle and still need manual theming.

## Risks / Trade-offs

- Cold month read is slow. → Read sessions with bounded concurrency, cache per session, and show a
  loading state; the first request is the only slow one.
- A renamed tool makes a mapped row silent. → The `not loaded` state catches it, and the signal map has a
  test comparing it with the tools the plugins register.
- Session log format changes. → We read through `sessionQuery`, never the file format.
- The view is reachable only inside a session. → Accepted for v1; the range selector still spans all
  sessions, so the data is not limited to the open one.
- The client route could leak aggregates to an unauthenticated peer. → Register the route with the same
  connection admission check the existing plugin routes use; it returns counts, not content.
- A profile with hundreds of sessions may make the month range heavy. → Bounded concurrency plus the
  in-memory cache; if it still measures badly, add a per-day checkpoint later without changing the
  contract.
- A forked child can repeat its parent's prefix. → The reader starts at the session's inheritance
  boundary, and a seeded-child fixture asserts that the copied events count once.

## Migration Plan

New package, so no existing behavior changes until the setup is regenerated and installed. Publishing
regenerates the setup patch and vendors the package; installing the setup mounts the row. Disabling the
`dsh-setup-observability` row removes the view and leaves every other row untouched. No data migration:
the plugin owns no durable state.

## Open Questions

Whether the shipped UI primitives include a table or segmented control worth reusing instead of local
markup. It does not change the contract or the task breakdown; implementation checks the package and
falls back to plain elements.
