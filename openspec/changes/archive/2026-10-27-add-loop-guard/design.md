# Design

## Context

See `proposal.md` for the incident and motivation. The relevant DSH 0.2.1-rc.3 facts this design
builds on:

- `llm/stream` is a waterfall around every streamed model call. A listener receives the request
  options and `next()`; it may wrap the `AsyncIterable<StreamChunk>`, pass chunks through, or stop
  consuming before the adapter finishes.
- The runtime's adapter-stream wrapper closes the adapter iterator in a `finally` block when the
  consumer stops; the loop's assembler defaults a missing finish chunk to `stop`, so an early end
  can be treated as a completed attempt. This is read from the installed 0.2.1-rc.3 packages, not yet
  exercised end to end.
- `agent/assistant-stream` publishes every chunk per agent in real time, but its only enforcement
  action is `agent.cancel`.
- `agent.steer(message)` submits a `UserMessage` for the nearest step; fresh steering prevents
  `agent/turn-stopping` from closing the turn. `agent.cancel({ kind: 'hook', reason })` aborts the
  active turn and records the reason; `agent.followup(message)` queues and wakes a new turn.
- `dsh-goal-round-driver` pauses a goal when its round is cancelled and never revives it on its own.
- The shipped `repeat-tool-reminder` already watches identical tool calls; this change does not
  duplicate that signal.
- `dsh-agent-loop`'s README states there is no built-in turn budget; policy belongs to an existing
  lifecycle extension point.

The incident session (`add-admin-indicator`) is the calibration corpus: 349 reasoning blocks, 147
containing the looped phrase, 2.44M reasoning characters, 54,387 occurrences of one phrase, and a
43,344-character block whose fifth occurrence of `The 5.1. The final.` is at character 142.

## Goals / Non-Goals

**Goals:**

- Detect a repeated reasoning line early and cut only the repeated model output.
- Return the model to a constructive step automatically; the normal path needs no user stop or
  resume.
- Bound recovery so a persistent loop cannot retry forever; reset the turn automatically, then stop
  with a clear reason as the last resort.
- Ship enabled by default, configurable from the row and the profile patch, with fail-loud
  validation.
- Keep tool calls, tool results, prompts, and the Client untouched.

**Non-Goals:**

- Tool-loop enforcement. The first-party advisory remains; no tool loops have been observed.
- A Client banner or any UI work.
- Provider-level penalties, a different model, or a fork of `repeat-tool-reminder`.
- Semantic similarity detection. Exact normalized lines cover the observed failure; inline or
  sentence-level repetition is future work.
- Subagent coverage by default; it is a configuration switch.

## Decisions

### D1 - A separate Host-only bundle

The behavior needs to observe and cut model streams and steer a live agent. A prompt rule was already
insufficient in the incident, a Client watchdog would miss Desktop, headless, and subagent runs, and
forking the upstream guard would create vendor drift. A new `@dsh-setup/plugin-loop-guard` bundle
composes with the existing guards and can be disabled or removed without touching shipped rows.

Alternatives considered: an always-on prompt section (cheap, weak); a Client-side detector (races,
uncovered surfaces); extending `repeat-tool-reminder` (wrong signal, upstream ownership).

### D2 - Detection signal: normalized exact lines, intra-request and cross-block

The detector normalizes lines (trim, collapse whitespace), ignores blank lines, lines shorter than
`minLineChars`, and lines inside fenced code, and reports a loop when either:

- one line repeats `minRepeats` times within the current request; or
- the same line appears in `crossBlockRepeats` of the last `crossBlockWindow` reasoning blocks.

Defaults: `minRepeats = 5`, `minLineChars = 12`, `crossBlockWindow = 10`, `crossBlockRepeats = 4`.
On the incident corpus these defaults flagged 133 of 147 looped blocks and 0 of 202 normal blocks;
the per-request line signal alone flagged 111, the cross-block signal 123. The target block's fifth
repeat is at character 142 of 43,344, so the cut saves nearly the whole generation.

Alternatives considered: word-shingle repetition (too noisy: 58-95 false positives out of 202 normal
blocks at practical thresholds); compression-ratio heuristics (less explainable, sensitive to code
and tables); an LLM judge (extra cost and latency). Exact lines are cheap, deterministic, and
explainable in the notice.

Known limit: a repetition that never completes a line (one long line of repeated phrases) is not
detected. Add a sentence or shingle signal only if that pattern is observed.

### D3 - Cut at `llm/stream`, not cancel at `agent/assistant-stream`

The user-facing requirement is recovery, not termination. The `llm/stream` wrapper stops consuming
when the detector fires; the runtime closes the adapter stream; the loop commits the delivered
prefix as the assistant message and proceeds. `agent.cancel` is reserved for the automatic turn reset
and the final fallback.

Tool-call safety: the wrapper tracks `block-start`/`block-end` and `tool-call-delta`. It cuts only
while the current open block is reasoning or text; if a tool-call block is open, it lets the stream
finish and submits the notice for the next step. This prevents an incomplete tool-call argument from
being dispatched. If a tool call already completed, cutting later text or reasoning is safe, but an
escalation MUST NOT cancel the attempt before that completed call is dispatched and its result is
committed. The reset is therefore scheduled, not executed from inside the stream (D5).

Fallback if the installed loop treats a missing finish as an error, or the adapter keeps generating
after the consumer stops: yield a synthetic `finish` chunk with `reason: 'stop'` before returning, or
promote the cancel-plus-follow-up reset to the primary path. The integration check in D8 decides.

### D4 - Recovery delivery through `agent.steer`

After a cut below the intervention limit, the guard submits a short `UserMessage` with source
`{ kind: 'loop-guard' }` through `agent.steer`. The notice names the repeated line count and a capped
preview, then instructs the model to use the latest tool result and take the next concrete action or
finish; later interventions use stronger wording (stop planning, run the next call, or produce the
final answer). Steering is
chosen over `inject` because it wakes/continues the step; `turn-stopping` alone would only act after
the cut and would not guarantee the next request. If integration shows that a pending steer does not
keep the turn alive, add a `agent/turn-stopping` listener that steers the pending notice; that is a
small fallback, not the primary design.

Before submitting a notice, the guard checks the originating turn signal captured from `llm/stream`.
If the signal is aborted by a cause other than the guard's own `hook` cancellation (`user`, `parent`,
`disposed`), the notice is dropped; a late steering message must not wake the agent after the user
pressed Stop. The reset follow-up applies the same check: only the guard's own hook cancellation may
start it.

The guard reads reasoning only to detect repetition. It keeps text in memory, caps every preview at
`previewChars` (default 80), and creates no guard-owned logs or files.

### D5 - Bounded escalation, automatic turn reset, rare final stop

Per agent and turn, the guard counts interventions. Each detection cuts the stream; below the limit
it also steers a recovery notice; at `maxInterventionsPerTurn` (default 3) it schedules the reset
instead of steering and instead of cancelling from inside the stream:

1. record `pendingReset`, do not steer another notice, and mark the reset as scheduled;
2. at the next `step/end` session event, cancel synchronously with `{ kind: 'hook', reason }` and
   `keepInbox: true`. The loop appends `step/end` after the step's assistant message, tool calls, and
   results settle and before the next inbox claim. The guard subscribes to `session/event` (event
   type `step/end`), maps `session.id` to the live agent, and acts only for its pending reset. It
   MUST NOT cancel from `agent/pre-step` or rely on `agent/turn-stopping`: turn-stopping can be
   skipped indefinitely when every step carries a completed tool call;
3. defer every inbox write until the session-event publication unwinds — `session/event` listeners
   run while the append is published, and a nested append is rejected. Schedule exactly one
   `queueMicrotask`/`setImmediate` callback after the observer returns, then:
   a. check which cancellation cause won; if a `user`, `parent`, or `disposed` cause won, stop;
   b. remove the guard's own pending recovery notice;
   c. call `agent.followup(resetNotice)` so the new turn's notice asks for a three-bullet state
      summary from the latest tool results and the next concrete action.
4. the deferred callback is guarded by the scheduled flag so the reset starts exactly once. All
   inbox mutations happen there, never inside the `session/event` listener.

This boundary is guaranteed for every settled step, including one whose response carries a completed
non-concluding tool call. It preserves that call and result, keeps pending user messages in the inbox,
and removes only the guard's own notice; the follow-up turn delivers the user input exactly once. The
final stop uses the same step-end boundary; it cancels synchronously and performs no follow-up.

The reset is automatic. Its documented cost is that cancelling a goal round pauses the goal through
`dsh-goal-round-driver`; the follow-up turn is a normal user turn, and the goal stays paused until
the owner resumes it. This is the one residual manual action, and it happens only after the recovery
ladder is exhausted, not on an ordinary loop.

After `maxResetsPerSession` (default 2), a persistent loop stops the turn with a clear reason and no
follow-up. This final stop is the safety valve against an infinite reset loop; it is configurable
and is the only path that requires a manual restart of the work. A turn that ends cleanly with no
detection clears the reset counter, so an old failure does not poison later work.

Alternatives considered: cut forever (unbounded token burn), pause immediately (the manual behavior
the user rejected), or switch the model/reasoning effort (outside this change's scope).

### D6 - State and privacy

Per-agent state lives in a `WeakMap` so disposal bounds memory:

- turn number, intervention count, reset count, pending-notice flag;
- per-request detector map: normalized line to count, current open block type, fenced-code flag;
- a ring of the last `crossBlockWindow` reasoning blocks, each stored as a set of 64-bit line hashes.

State resets at a new turn; the cross-block ring resets with it. Line hashes avoid retaining full
reasoning strings across steps. The streamed text is otherwise discarded. The capped preview is
intentionally persisted as a normal notice message (through the inbox splice/user message) and in
the turn-end reason; that is the only reasoning text the guard persists. No full reasoning and no
guard-owned logs or files exist.

### D7 - Configuration and deployment

The plugin follows the repository's Host-only bundle shape: `package.json`, `cordis.fragment.yml`
with row `dsh-setup-loop-guard`, `locale/en.json`, `icon.svg`, `src/host/**`, `tsconfig.json`, and
tests. It imports DSH packages for types only and uses `node:crypto` for message ids. The fragment's
row config carries the defaults; `packages/setup/defaults.yml` cannot target a `dsh-setup-*` id, so
the profile patch is the override point. `pnpm gen` adds the setup dependency, the generated patch,
and the vendored copy. Breaking-change level: none; the plugin is additive and default-on.

Defaults:

```yaml
reasoning: true
text: false
subagents: false
minRepeats: 5
minLineChars: 12
crossBlockWindow: 10
crossBlockRepeats: 4
maxInterventionsPerTurn: 3
maxResetsPerSession: 2
previewChars: 80
finalFallback: stop
```

Validation rejects non-integer or out-of-range values, an empty detector scope, duplicate or
non-monotonic thresholds, and an unsupported fallback value. The guard skips hand-built calls without
a live agent session and auxiliary calls with a `purpose` (compaction, session title).

### D8 - Verification

Unit tests cover the detector (synthetic loop text, normal prose, fenced code, short lines,
cross-block recurrence, turn reset), the stream wrapper (cut stops consumption, tool-call safety,
pass-through on no detection), steering and escalation calls, the step-end reset with a completed
tool-call block, the every-step completed-call schedule, the deferred follow-up under an attached
real SessionStore (no reentrant append), queued user steering surviving exactly once with the
guard's obsolete notice removed, external-cancel suppression, the persisted capped preview, and
config validation. The incident text is reproduced synthetically; no session data is committed.

A manual integration task in a dev profile uses a mock or replay adapter that emits a repeated
reasoning stream and asserts, in one run:

1. the stream ends early and the partial assistant message is committed;
2. the turn continues to another step with the notice;
3. no tool call is dropped or malformed, including a completed call at the escalation boundary;
4. the intervention ladder resets at the step-end boundary and a follow-up turn starts;
5. the final fallback stops with the reason;
6. the adapter stops generating (no tokens after the cut);
7. a user stop during stream cleanup wakes no new turn;
8. queued user steering is delivered exactly once across the reset and the guard's own notice is
   removed;
9. every response carries a completed non-concluding tool call before the repetition, yet the reset
   and final-stop limits still fire at `step/end`;
10. the deferred follow-up is accepted after the session-event publication unwinds and starts
    exactly once.

This run is the gate for the early-finish and steering assumptions in D3/D4.

## Risks / Trade-offs

- **False positives on legitimate repetition** -> conservative line length and count, fenced-code
  exclusion, configurable thresholds, and a recovery notice instead of a destructive stop. A false
  cut costs one request prefix and asks the model to continue.
- **Early-finish semantics are unverified** -> the integration check; fallback to a synthetic finish
  or to cancel-plus-follow-up as the primary path if the loop does not commit normally.
- **Adapter may not stop generating after consumer return** -> the runtime's `finally` closes the
  iterator; measure in the integration run and use an explicit abort if the adapter ignores it.
- **Steering may not keep the turn alive** -> pending fresh steering is documented to prevent
  turn-stopping; add the `turn-stopping` fallback if the run disproves it.
- **Reset can race a completed tool call** -> the reset is scheduled at the step-end boundary; the
  completed-call escalation test proves the call and result survive.
- **Turn-stopping-only reset can wait indefinitely** -> `step/end` fires for every settled step,
  including ones with completed tool calls; the every-step test proves the reset and final-stop
  limits still apply.
- **Follow-up inside the step-end observer is a reentrant append** -> cancel synchronously, defer
  every inbox write to a microtask after publication, and prove with an attached real SessionStore
  that the follow-up starts exactly once.
- **Reset from pre-step can lose claimed user steering** -> the guard never cancels from pre-step;
  it removes only its own pending notice in the deferred reset, resets at step-end before the next
  inbox claim, and the queued-steering test proves exactly-once delivery.
- **A late notice can wake the agent after Stop** -> the guard checks the turn signal cause before a
  steer or follow-up; the user-stop-during-cleanup test proves no wake.
- **Preview persistence** -> the capped preview is explicitly permitted in the notice and stop
  reason; verify the persisted inbox/user-message and turn-end payloads carry only that preview.
- **Automatic reset pauses the goal** -> documented side effect of cancelling a goal round; the
  follow-up turn continues the task, and the owner resumes the goal only after repeated failures.
- **Final stop requires manual restart** -> only after the reset cap; clear reason; configurable.
- **Subagent loops** -> excluded by default; the first-party guard still applies; enable when a
  subagent loop is observed.
- **Notice rendering** -> the notice is a normal user message; verify it renders readably in the Web
  GUI. Cosmetic, no approach change.
- **Upstream drift** -> `engines.dsh` pins the supported range; if DSH adds a first-party reasoning
  guard, retire this plugin rather than running both.

## Verification Plan

Run the repository gates (`pnpm build`, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm validate:repo`) and the integration scenario above. The change is complete only when the
integration run proves the early cut, the continued turn, and the reset path; unit tests alone do not
prove the loop's handling of a missing finish.

## Migration Plan

- Additive plugin; no data migration.
- `pnpm gen` updates the setup manifest, patch, and vendored tree; the next set release ships it
  enabled by default.
- Rollback: disable or remove the row in the profile patch; the plugin is inert without the row. A
  release rollback is the standard revert of the set version.

## Open Questions

- Whether the Web GUI needs a dedicated notice style; the message is readable as a normal user
  message today.
- Whether text detection should become the default after a broader corpus; it stays opt-in here.
- Whether inline repetition without newlines justifies a sentence or shingle signal later; not needed
  for the observed failure.
