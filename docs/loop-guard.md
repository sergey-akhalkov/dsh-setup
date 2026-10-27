# Loop guard

`@dsh-setup/plugin-loop-guard` (row `dsh-setup-loop-guard`) detects a repeated line in the model's
streamed output, ends that model response early, and steers the model back to a constructive step.
It ships enabled by default with the setup bundle and needs no Client half, prompt section, or
external runtime.

The row exists because a model can loop on one reasoning line while still calling tools correctly. The
loop burns output tokens and wall-clock time, and ordinary steering messages did not break it. The
guard cuts only the repeated output; the turn, the session, and the active goal round continue without
a user stop.

## Behaviour

The guard inspects streamed reasoning by default (`reasoning: true`) and visible text only when
`text: true` is set. It normalizes each line (trim, collapse whitespace) and ignores blank lines,
lines shorter than `minLineChars`, and lines inside fenced code. It reports a loop when either:

- one normalized line repeats `minRepeats` times within the current model request (default 5); or
- the same line appears in `crossBlockRepeats` of the last `crossBlockWindow` reasoning blocks,
  counting the current block (defaults 4 of 10).

Each detection counts as one intervention in the current turn. Recovery is bounded:

1. **Cut and steer.** The guard stops consuming the model stream and submits a short user message
   through agent steering, so it is claimed by the next step. The notice names the repeat count and a
   capped preview of the line, then asks the model to use the latest tool result and take the next
   concrete action or finish. The second notice tells it to stop planning and act; the third tells it
   to make the next call or write the final answer.
2. **Automatic turn reset.** After `maxInterventionsPerTurn` notices (default 3) in one turn, the next
   detection does not steer another notice. The guard waits for the step-end boundary, after the
   step's assistant message, tool calls, and results have settled, then cancels the turn with a hook
   cause and `keepInbox`. It removes only its own pending notice and starts exactly one follow-up
   turn whose notice asks for three bullets from the latest tool results (done, verified, next
   action) and the next concrete action.
3. **Final stop.** After `maxResetsPerSession` automatic resets (default 2), a persistent loop stops
   the turn at the same step-end boundary with a reason that names the repeated line (capped) and the
   limits, and starts no follow-up. This is the rare last resort.

A turn that ends cleanly clears the reset budget, so an old failure does not poison later work.
External cancellation wins over recovery: after the user, the parent, or disposal cancels the turn,
the guard delivers no notice and starts no follow-up.

### Tool-call safety

The guard tracks block starts and ends and never cuts while a tool-call block is being streamed. If a
repetition is detected during a tool call, it lets the stream finish and delivers the notice at the
next step. A tool call that already completed keeps its exact arguments and result; the automatic
reset runs only at the step-end boundary, after that call has been dispatched and its result
committed. The guard never modifies tool arguments or results.

## Configuration

The bundle's composition fragment carries these defaults. A profile patch may override the row; a
patch replaces the whole `config` object, so restate every field the row needs.

```yaml
- id: dsh-setup-loop-guard
  config:
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

| Field                     | Default | Meaning                                                                          |
| ------------------------- | ------- | -------------------------------------------------------------------------------- |
| `reasoning`               | `true`  | Inspect streamed reasoning.                                                      |
| `text`                    | `false` | Inspect streamed visible text too.                                               |
| `subagents`               | `false` | Also guard subagent sessions.                                                    |
| `minRepeats`              | `5`     | Repetitions of one normalized line within a request that trigger a cut.          |
| `minLineChars`            | `12`    | Lines shorter than this are ignored.                                             |
| `crossBlockWindow`        | `10`    | Number of recent reasoning blocks kept for the cross-block signal.               |
| `crossBlockRepeats`       | `4`     | Blocks containing the line (current block included) that trigger a cut.          |
| `maxInterventionsPerTurn` | `3`     | Recovery notices before the next detection resets the turn.                      |
| `maxResetsPerSession`     | `2`     | Automatic turn resets before the final stop; `0` stops at the first reset point. |
| `previewChars`            | `80`    | Maximum characters of the repeated line quoted in a notice or stop reason.       |
| `finalFallback`           | `stop`  | Last resort after the reset limit; `stop` is the supported value.                |

`reasoning` and `text` cannot both be `false`, `crossBlockRepeats` cannot exceed
`crossBlockWindow`, and every numeric field must be an integer in its documented range. Invalid
configuration fails at plugin load with a message naming the field; the guard never silently falls
back to defaults.

To disable the guard, disable or remove the row in the profile patch:

```yaml
- id: dsh-setup-loop-guard
  disabled: true
```

Do not install both the setup bundle and this plugin individually: the row id would mount twice.

## Goal-pause trade-off

The recovery notice is ordinary steering, so it does not cancel the turn and does not touch a goal. The
automatic turn reset is a cancellation: `dsh-goal-round-driver` pauses a goal when its round is
cancelled, and the follow-up turn is a normal user turn. The goal stays paused until the owner resumes
it. That one residual manual action is the documented cost of the reset, and it happens only after the
recovery ladder is exhausted, not on an ordinary loop.

## Final fallback

The final stop is the safety valve against an endless cut/reset cycle. It uses the same step-end
boundary, cancels synchronously with a hook cause, and writes no follow-up. The turn ends with an
aborted reason that names the capped repeated line and both limits. Work after that point needs a new
turn from the owner; the rest of the session and the profile are untouched.

## Privacy

The guard keeps streamed text in memory only. Per-request line counts are discarded at each model
request; the cross-block window stores 64-bit line hashes, not reasoning text. The only reasoning text
the guard persists is the capped preview carried by its notice message and its stop reason, both bound
by `previewChars`. It creates no guard-owned files or logs and registers no system-prompt section.

## Known limits

- **Exact normalized lines only.** Semantic near-repetition, inline repetition without line breaks, and
  repeated sentences spread across otherwise different lines are not detected. Add a sentence or
  shingle signal only if that pattern is observed.
- **Tool loops are out of scope.** The shipped `repeat-tool-reminder` covers identical tool calls; this
  guard only watches model output.
- **A tool-call block delays the cut.** Detection during a tool call lets the stream finish, so a long
  call can still burn tokens until it ends; the notice still reaches the next step.
- **Subagents are excluded by default.** Enable `subagents` when a subagent loop is observed.
- **No Client UI.** The notice is a normal user message in the transcript, and the stop reason is
  durable in the session log.
