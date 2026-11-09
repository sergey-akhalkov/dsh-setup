# Design

## Context

See `proposal.md` - Why. The read-only surface has to be built before the obligation engine, because the engine's trigger evaluation and run records are the same data the owner needs to see. The pieces already exist:

- DSH exposes the process events a workflow trigger needs: `agent/pre-step`, `agent/turn-stopping`, `tools/result`, `subagent/start`, `subagent/end`, and `fs.watch` over the session workspace.
- The Observability plugin already registers a full-width conversation view (`conversation.view`, id `observability`, order 20) and a read-only authenticated route through `ctx.webServer.register` plus `ctx.connection.requestRejection`.
- The OpenSpec panel already proves the host/client split, a `dsh-resource://` address, a document-relative Fetch route, and the right-sidebar tab pattern. This change uses the full-width view instead, because a timeline needs width.
- Existing local records already contain most process facts: `.dsh/work-checkpoints/<sha256(session)>/<turn>.json` (the directory hashes the session id), `.dsh/delegation/runs/<runId>.json` (run state only), `.dsh/delegation/<rule>/<change>/**` (settled review records with target and an optional session), and `openspec/changes/*/reviews/<taskId>.json` (portable approvals with no session).

The plugin does not parse raw DSH session logs. The Observability plugin owns that surface; the Workflows view links to it for session statistics.

## Goals / Non-Goals

**Goals:**

- One place to see the configured triggers, every evaluation (matched or not), the current session's process events, and the projected runs from existing records.
- Distinguish three states that currently look the same: no event, event with no matching trigger, and broken listener.
- Stay read-only: no steering, no blocking, no execution, no writes outside `.dsh/workflows/`.
- Make the data model the same one the obligation engine will use, so change `add-workflow-obligations` is additive instead of a rewrite.

**Non-Goals:**

- Workflow definitions, execution, gates, evidence enforcement, the editor, and intent classification.
- A second session-log parser or a second Observability report.
- Historical backfill beyond the bounded journal and the existing `.dsh` records.
- Cross-workspace aggregation. The view is session-scoped.

## Decisions

### 1. Observe a fixed event set, not the whole session log

The recorder subscribes to a named set and never mirrors `session/event` wholesale:

| Event | Use |
| --- | --- |
| `agent/pre-step` | turn/step boundary and root-vs-subagent identity |
| `agent/turn-stopping` | turn stop attempt and the turn's final tool/worker facts; a refusal continues the turn |
| `tools/result` | tool outcomes, `delegate`/review starts, worker starts |
| `subagent/start`, `subagent/end` | child link and settlement |
| `fs.watch` on `openspec/changes/**` | change created, `tasks.md` changed, review record written, archive move |

`fs.watch` is debounced per path (250 ms) and re-scans the directory on a watch error, because Windows watchers can drop events. The `fs` service is used instead of Node `fs.watch` so the sandbox and workspace resolution stay consistent.

Alternatives: `session/event` would capture everything but duplicates the Observability parser and multiplies volume. A periodic scan alone would miss ordering and timing.

### 2. Journal is per session, append-only, and bounded at the write boundary

Path: `.dsh/workflows/events/<sessionId>.jsonl`. Each line is one record:

```json
{
  "v": 1,
  "at": 1762500000000,
  "session": "session-...",
  "turn": 4,
  "kind": "tool/result",
  "subject": "delegate",
  "callId": "call-...",
  "ok": true,
  "summary": "task-review r1 PASS",
  "bytes": 812,
  "truncated": false
}
```

- `summary` is a short redacted summarizer result, not the raw payload. The raw payload stays in the existing session log; the journal is an index, not a copy.
- Redaction is key-based (`authorization`, `token`, `apiKey`, `password`, `secret`, `cookie`) plus value-shape redaction for bearer tokens and private-key blocks.
- Per-record cap 4 KB; per-session file cap 5 MB; workspace retention 30 days or 50 MB, whichever comes first. Pruning runs after a successful append and never blocks the turn.
- A failed write is a health event, not a turn error. The recorder must never throw into the event dispatch path.

Alternatives: a single workspace JSONL is simpler but makes session queries and pruning worse. SQLite adds a dependency and a migration surface for an index that is already a log.

### 3. Trigger evaluation is a pure function with a fixed reason vocabulary

A shadow trigger is data:

```json
{
  "id": "openspec-task-checked",
  "event": "fs.change",
  "filter": { "path": "openspec/changes/**/tasks.md", "change": "created-or-modified" },
  "mode": "shadow",
  "dedupe": "path+content-hash"
}
```

`evaluate(trigger, event, context)` returns `{ matched, reason }`, where `reason` is `would-fire` for a match and one of `event-mismatch`, `filter-mismatch`, `dedupe`, `disabled`, `not-ready`, or `error` for a non-match. The Why-not table records this result for every trigger. A matched shadow trigger records `would-fire`; it never calls a tool or steers.

Intent triggers are deliberately absent. A semantic "the user wants a new change" decision is a model classification, belongs to the obligation engine, and must be labeled as fallible; presenting it as a deterministic event would repeat the current confusion.

### 4. Project existing records through versioned adapters

The unified run view has one shape:

```ts
interface RunView {
  id: string
  source: 'checkpoint' | 'delegation' | 'review' | 'workflow'
  session?: string
  attribution: 'local' | 'portable' | 'unattributed'
  title: string
  startedAt: number
  status: 'running' | 'done' | 'failed' | 'unknown'
  steps: Array<{ id: string; title: string; state: string; at?: number; evidence?: string }>
  error?: string
}
```

`attribution` is provenance, not a guess: `local` when the run's session comes from a local record or an observed started/queued `delegate` call, `portable` when the run exists only as a committed `reviews/<taskId>.json` approval, and `unattributed` when no session is resolvable. A field the producer does not supply stays absent; the adapter never treats a directory name as a session id and never infers a target or attempt count from a path or a neighbouring file.

Session attribution follows the producer contract:

- checkpoint: the producer writes `.dsh/work-checkpoints/<sha256(sessionId)>/<turn>.json`, where the directory is `sha256` of the session id truncated to 16 hex characters; the persisted `session` field is redacted and bounded. The adapter hashes the requesting session id the same way, reads only that directory, and attributes its records to the requesting session. The directory name is never used as a session id.
- delegation: `.dsh/delegation/runs/<runId>.json` is a `RunFile` with `id`, `rule`, `change`, `taskId?`, `key`, `identity`, `state`, `record`, `startedAt`, and `detail?` - no session, target, or attempt count. The session is captured from a `delegate` tool result observed in the journal whose declaration line reports the review as started (`review started`) or queued (`review queued`) and names `run: <runId>`. A response whose declaration line says `review already pending` also names the run id but MUST NOT establish or transfer ownership, and it never overrides an existing attribution. A settled `ReviewRecord` whose `runId` equals the run id also supplies the session, because `publishRecord` writes the calling session.
- The `RunFile.record` path is a display hint, not attribution. Another session can write the same rule/change/task record, and `beginReviewRun` may complete a run as `reused record` when an existing record matches, so the path may hold a record with a different `runId`. A settled local `ReviewRecord` joins a run only when `record.runId === run.id`; it then contributes its verdict, target, time, and session. A record whose `runId` differs is not joined and never re-attributes the run.
- review: `openspec/changes/*/reviews/<taskId>.json` is a portable approval with no session and no run id. It is attributed to a session only through a matching local `ReviewRecord` with the same change, task, and digest; otherwise it is `unattributed`.

A run with no resolvable session stays in the workspace run list labeled `unattributed` and is excluded from the session timeline.

Three adapters:

- checkpoint: `.dsh/work-checkpoints/<sha256(session)>/<turn>.json`; steps are outcome, lanes, bottleneck, next; a missing directory is empty, a malformed file is an error row.
- delegation: maps `queued`/`running` to `running`, `completed` to `done`, and `failed`/`discarded` to `failed` with `detail`; steps are rule, change/task, and run state, plus verdict, target, and time only from a joined `runId`-matching record. The `RunFile` has no attempt counter, so no attempt step is projected.
- review: `openspec/changes/*/reviews/<taskId>.json`; steps are verdict, target, digest, task id.

Adapters are read-only and tolerant: an unknown field is ignored, a missing required field is an error row, and the file path is always shown. No adapter writes a record or starts a run.

### 5. The client is a conversation view with its own authenticated read API

Register `conversation.view` with id `workflows`, order 30, label from locale. The view uses the host's standard `openView` owner prop for navigation; it does not add a new main panel or a second shell.

Host routes, registered through the carrier-neutral `ctx.connection.fetch` pattern used by the OpenSpec panel (the same routes serve the desktop Fetch carrier and the browser), with the existing admission check:

- `GET /api/workflows/session/<sessionId>/events?cursor=&limit=`
- `GET /api/workflows/session/<sessionId>/runs?cursor=&limit=`
- `GET /api/workflows/triggers?session=<sessionId>`
- `GET /api/workflows/health?session=<sessionId>`

The triggers and health routes require a session id; the host resolves that session's workspace and returns session-specific state. Every route caps `limit` (default 50, max 200) and returns `next` when more data exists. The client never asks for the whole log. The view uses the shipped component primitives for controls and tokens for colour; no colour, spacing, or control is redefined.

The Start page entry is a follow-up within this change: register the same client command surface the OpenSpec panel uses if the host exposes one for a conversation view; otherwise the conversation tab is the entry and the task records that limitation. The tab is the primary surface either way.

### 6. Health is a first-class state, not a log line

`health.json` under `.dsh/workflows/` carries `{ listenerCount, lastEventAt, journalWritable, triggerCount, lastErrorAt, lastError }`, updated on boot and on every event. The view renders three distinct states:

- `listener-down`: a required service is missing, registration threw, or no heartbeat for 10 minutes while the session is running.
- `waiting`: listener healthy, no matching event yet; the Why-not table explains non-matches.
- `healthy`: listener healthy and at least one matching event observed.

A periodic self-check (60 s) verifies the journal is writable; a failure flips health to `journal-readonly` without throwing.

### 7. Read-only means no side effects, and tests prove it

The host module has no `agent.steer`, no `agent.inject`, no `tools/pre-execute` listener, and no `tools` registration. A test harness dispatches a turn start, tool result, and turn stop and asserts zero steer/inject calls and zero pre-execute registrations. The journal and health files are the only writes.

The projection and API are read-only; a malformed record produces a visible error, never a repair. No adapter deletes or moves a record.

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| Event volume grows with long sessions. | Fixed event set, per-record cap, per-session cap, retention, and summary-only payloads. The raw data stays in the session log. |
| Windows `fs.watch` drops or coalesces events. | Debounce plus a directory rescan on error and on open; record a rescan event so a missed create is visible. |
| Journal privacy leaks a token. | Key and value redaction, no file contents, no raw tool arguments, bounded summary; a redaction test covers bearer tokens and private-key blocks. |
| Record formats drift. | Versioned adapters, tolerant parsing, visible error row, and a test per adapter; the record owner keeps the source of truth. |
| The view duplicates Observability. | It links to Observability for session statistics and shows process decisions only; no duration/token/cost report. |
| A broken listener looks like a quiet session. | Health state and heartbeat are separate from the event list; `listener-down` and `waiting` are different states. |
| The client request is slow on a long session. | Pagination, summaries, and no full log; the host caps page size and the client virtualizes the timeline. |
| The Start entry is not available for a conversation view. | The tab is the primary surface; the task verifies the command surface and records the limitation instead of inventing a second shell. |

## Migration Plan

1. Add the package, fragment, row, locale, icon, and client registration; run `pnpm gen`.
2. Enable the row in the setup defaults. The plugin is read-only, so no existing behavior changes.
3. Ship the default trigger catalog in shadow mode; no trigger is active in this change.
4. Rollback: disable the row. The journal and health files are local scratch; deleting `.dsh/workflows/` loses only the observation history, not any process decision.

## Open Questions

- Whether the Start page exposes a command for a conversation view is verified in the first live check; it does not change the specs or the tab surface.
