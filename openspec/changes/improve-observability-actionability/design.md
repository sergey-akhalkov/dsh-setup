# Design

## Context

See `proposal.md` — Why. Facts this design depends on, verified in this checkout:

- The Host exposes `sessionQuery`: `listSessions()`, `readSession(id)`, `listEvents(id)`, and
  `readTitleSnapshots(ids, signal?)`. The reader already extracts every event a session owns, not only
  the in-window slice, so a classification can look outside the window.
- `tool/result` events carry `message.isError` and an optional `error: { name, code, reason? }` outside
  model content. `turn/end` carries `reason.kind` — `completed`, `aborted`, `blocked`, `error`,
  `max-tokens`, `interrupted`, `forked` — and the `error` arm carries `LlmFailure` with a stable `code`.
  The current extractor keeps only a boolean `failed`, so `max-tokens` and `interrupted` are invisible.
- The `conversation.view` props expose `inspectCall(callId)` and `openView(view, focus)`.
  `inspectCall` resolves the first registered view definition with `toolCallFocus` (Trajectory declares
  `toolCallFocus: (callId) => callId`) and activates it with that focus; the Trajectory then opens the
  matching call.
- The client Workspace service exposes `startSession(workspaceId?, { prompt, whenDraftExists,
  agentPreset })`, which opens the blank Session of the current or most recent Workspace with an
  initialized draft, and `openSession(sessionId)`. Both are root Client services.
- The Host `systemPrompt.assemble()` returns `PromptAssembly.sections[].name`; `skills.snapshot()`
  returns `{ skills, complete }`, while `skills.list()` returns only the summaries and silently skips a
  provider whose discovery failed. Both services are optional for this plugin.
- Tool rows count `tool/call` events, while totals and row errors count failed results by their own
  time, so a raw failed-results over calls ratio can exceed 100% when a call and its result fall on
  opposite sides of a window boundary.
- Existing caps: the report keeps 25 detail entries per row and the client renders five. A failure list
  cannot be built from either.

## Goals / Non-Goals

**Goals:**

- Turn the failure count into a place: one list with severity, time, session, and error identity, and an
  action on every entry.
- Make "is this plugin ready?" mechanically answerable for tools, prompt sections, and skills, so a
  plugin that is broken is distinguishable from one that was never triggered.
- Make silence self-explanatory without inventing frequencies.
- Keep the dashboard a projection: no new log, route, storage, or dependency.

**Non-Goals:**

- Declared frequency expectations for silent rows (per-turn/per-session) — rejected in the exploration.
- Forking a session per failure, or a Host action route that creates sessions.
- Judging whether the model complied with prompt text.
- Focusing an event across a session boundary; the public client API has no such operation.
- Changing the built-in signal sets, ranges, buckets, cache, or route shape beyond the new report fields.

## Decisions

### Failures are a report section, not a client filter

The Host adds a `failures` array and uncapped `failureTotals` to the report. Reusing the built-in
`errors` row's details is not enough: details are capped at 25 per row, carry no session or sequence, and
the row is never rendered. The failure list is bounded (200 entries, newest first) while the counts cover
every failure, and the view says it shows the newest N. Alternative rejected: client-side filtering of
`rows[].details` — the data needed for "where and when" is not there.

### Severity is a taxonomy over the log's own reasons

- `turn failure` — `turn/end` with `reason.kind === 'error'`; identity is `LlmFailure.code`.
- `turn cut` — `turn/end` with `max-tokens` or `interrupted`; no error was raised, and today it is
  invisible.
- `tool failure` — `tool/result` with `message.isError`; identity is `error.name`/`error.code`.
- `recovered` — a tool failure whose turn ended `completed`; the failure did not end the work.

`aborted`, `blocked`, and `forked` closers are not failures; an abort is often owner intent and already
appears in the injected-messages and aborts panel. Alternative rejected: "any turn that did not complete"
— it would cry wolf on every cancel. Alternative rejected: counting only errors (today's behaviour) — it
hides cuts.

### Recovery is judged on the session, not the window

A turn may end just outside the day/week/month window while its failed call is inside. The session's full
record set is already read, so recovery looks up the closer by turn within that set. Alternative rejected:
recovery from the window slice — it would mark a boundary-spanning failure unrecovered by accident.

### Failure identity is metadata; the reason stays out

The list shows `error.name` and `error.code` (and the turn failure's `LlmFailure.code`). It never renders
`error.reason`, `LlmFailure.message`, message text, or tool arguments: the reason is raw user-facing text
that may quote output or paths, and the failure list is the most screenshot-prone surface. The one-click
inspector already shows the full reason. Alternative rejected: rendering a truncated reason — it would
reopen the leak the v1 spec closed.

### Session titles name the place, with a fallback

For failures from another session the list shows the session title via `sessionQuery.readTitleSnapshots`
for the unique sessions that have failures, falling back to a short id when a title is absent. Titles are
navigation metadata the session list already shows; they are not message text. Alternative rejected: id
prefix only — it cannot be recognized at a glance across a month window.

### One action model: focus, open, or start a fix session

- Same session: `inspectCall(callId)` focuses the registered tool-call inspector. `openView('trajectory',
  callId)` is the explicit fallback; a turn failure has no call id and offers metadata only.
- Another session: `uiWorkspace.openSession(sessionId)`. The view does not claim to focus the event across
  the boundary because no public API carries a focus request into another session.
- Fix session: `uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'append' })`. The prompt is
  a self-contained bounded summary (time, session id and title, sequence, turn/step, tool, name/code) plus
  instructions to read those events through the session tools and fix root causes. It is a draft: the
  owner reviews and sends. `append` keeps any text already in the reused blank. Alternative rejected:
  creating the session through `sessions.create` plus manual draft initialization — three public steps and
  our own draft-collision policy for the same result. Alternative rejected: forking — a batch spans
  sessions, and a fork inherits the broken context.

### Readiness is checked against the live registries

- A signal's tools: the existing tool-registry comparison (`not loaded`).
- A guidance row's `mounted.section`: `systemPrompt.assemble()` section names, report `mounted` when
  present, `not mounted` when absent.
- A guidance row's `mounted.skill`: `skills.snapshot()` names, and only a completed observation
  (`complete: true`) may turn an absent name into `not mounted`; an incomplete catalog is readiness
  unknown and never absence.
- An undeclared contribution stays guidance-only. A thrown assembly, a missing service, or an incomplete
  skill observation is `readiness unknown` and must not become a failure: a false alarm is worse than an
  unknown.

Only `not mounted` joins needs-attention. The check runs once per report, cached with the report response.
Alternative rejected: matching the system message text in the session log — fragile and contrary to the
no-text rule. Alternative rejected: per-plugin instrumentation — the v1 decision still holds.

### Silence is explained by its trigger and context, not by a declared frequency

A row may carry a `trigger` sentence ("a turn aborts because a loop was detected") that the card shows
when silent, together with the window's denominators (`0 of 5 turns`, `0 of 717 tool calls`). A silent row
without a trigger keeps today's wording. Nothing turns silence into attention on its own. Alternative
rejected: an `expect: per-turn|per-session` field — one wrong number turns the dashboard into a false
alarm, and every plugin owner would have to maintain it.

### Needs-attention is composed from explicit conditions

The verdict is a union of five conditions computed from the same report: a turn failure, a turn cut, a
tool failure its turn did not recover from, a signal whose tool is not loaded, and a guidance row whose
declared contribution is not mounted. It is not derived from a count, so an unmapped failure raises
attention while every configured row is silent, and a recovered failure or an unknown readiness check
cannot. Alternative rejected: deriving the verdict from `failureTotals` — it would count recovered
failures and skip readiness.

### Data fields are optional and fail loud on typos

`trigger` is an optional string on any row; `mounted` is an optional object (`section`, `skill`) allowed
only on guidance rows, at least one name required, unknown keys rejected with the field name. Both are
inert. Existing profiles and overrides keep working without them. The shipped map gains both, and the map
test proves that each declared section or skill is actually contributed by the named plugin, so a rename
or a disabled row fails the suite instead of reporting a fake `not mounted`.

### Presentation: revealed in place, proportional, worded

The failure list is a collapsed section between the activity chart and the plugin cards; the KPI failure
count is a button with `aria-expanded` that reveals it and moves focus to it. No modal, no new client
dependency: the bundle keeps its inline markup and SVG. Tool bars become stacked fills with the failing
share drawn proportionally (`17 of 179 · 9%`) instead of one red bar; the population is fixed by the next
decision. Every status keeps a word. Counts use one pluralization helper. Silent cards collapse to compact
rows; the repetitive absence note moves to the section header.

### One call population for a failing share

The bar joins each in-window `tool/call` to its own result by session and call id, whatever the result's
time, so the numerator is a subset of the denominator and the share never exceeds 100%. A call with no
result or a successful result counts as not failed. The failure list keeps its own result-time membership,
so a result inside the window from a call made before it appears in the list but not in the bar: two
populations, each stated by its label. Alternative rejected: the existing aggregate's errors over calls —
its numerator and denominator are filtered by different event times and can exceed 100% at a boundary.

## Risks / Trade-offs

- `assemble()` outside a turn may be slow or throw. → One call per report, wrapped; a throw reports
  `readiness unknown`, never a failure. If it measures badly, cache the mounted-name set with a short TTL.
- Title lookups may be slow on a month window. → Only the unique sessions in the bounded failure list are
  looked up; absence falls back to a short id.
- The list bound can hide old entries. → Counts are uncapped and the view states the bound.
- A fix prompt can be large. → Bounded by characters and entries; the omitted tail is stated in the prompt.
- `append` writes after a draft the owner forgot about in a reused blank. → Text is preserved and visible;
  the owner can clear it. This is preferred to silently replacing a draft.
- Opening another session replaces the dashboard's session context and the list with it. → The action is
  labelled as opening the session; the list is still copyable before leaving.
- A turn cut can be intentional (`max-tokens` is resumable). → The taxonomy names it; attention is a
  judgement aid, not a gate.
- A failed result inside the window may belong to a call made before it. → The bar counts calls, the list
  counts results, both are labelled by their population, and a boundary fixture pins the behaviour.
- Skill discovery can be partial. → `snapshot().complete === false` reports readiness unknown; an
  incomplete catalog is never evidence of absence.
- A plugin that fails to load but still registers its tool or section looks ready. → The remaining blind
  spot is narrowed in the view's statement, not hidden.

## Migration Plan

No storage, no schema. Shipping adds optional report fields and optional row descriptors; a profile that
already overrides the observability row keeps working, because both fields are optional and omitted ones
fall back to today's presentation. The setup layer supplies the descriptors on the next install via the
regenerated patch. Rollback is the previous release: no data is written, so there is nothing to undo.

## Open Questions

None that change the contract, the approach, or the task breakdown.
