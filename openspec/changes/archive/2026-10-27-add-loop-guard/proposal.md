# Proposal

## Why

A model can loop on the same reasoning line while it still calls tools correctly. The neighbouring
`add-admin-indicator` session produced 54,387 occurrences of one reasoning line across 147 assistant
messages; one 43,344-character thinking block repeated the line 1,631 times and ran for 54 seconds.
The loop ended only when the user stopped the turn by hand and wrote that the agent was looping. The
same session had already received ordinary steering and delegation-gate messages, which did not break
the loop.

The shipped `repeat-tool-reminder` guard detects identical tool calls only, and the setup has no
mechanism that cuts a repeated reasoning stream and puts the model back on a constructive path. Every
loop therefore costs output tokens, wall-clock time, and an eventual manual intervention.

## What Changes

- Ship a new Host-only bundle, `@dsh-setup/plugin-loop-guard` (row `dsh-setup-loop-guard`), enabled
  by default from the setup bundle.
- Detect repetition in streamed reasoning (default) and optionally in visible text: an exact
  normalized line repeated five times within one request, or the same line present in four of the
  last ten reasoning blocks. Lines shorter than 12 characters and fenced code are ignored. Per-agent
  state resets at each turn.
- When repetition is detected and no tool-call block is in progress, end the current model stream
  early and steer a short recovery notice into the next step. The turn and the active goal round
  continue; no manual resume is required.
- Escalate through a bounded ladder: three cut-and-steer interventions per turn, then automatic turn
  resets (cancel plus a follow-up reset notice that starts a new turn), and a final stop only after
  the configured resets fail to break the loop.
- Expose the detection thresholds, intervention and reset limits, subagent scope, and the final
  fallback in the row configuration. Invalid configuration fails at load instead of silently falling
  back.
- Do **not** add tool-call enforcement in this change: the shipped advisory `repeat-tool-reminder`
  already covers identical tool calls, and tool loops have not been observed. There is no Client
  half; the recovery notice is an ordinary transcript message and the turn-end reason is durable.

## Capabilities

### New Capabilities

- `loop-guard`: automatic detection and in-turn recovery for repeated model output, with bounded
  escalation and a rare final fallback.

### Modified Capabilities

- None.

## Impact

- New package `packages/plugin-loop-guard` with Host source, composition fragment, locale, icon,
  TypeScript project, and tests. The setup bundle gains the dependency and vendored copy through
  `pnpm gen`.
- Documentation: add the bundle to the plugin inventory and document its behaviour, configuration,
  and limitations.
- Reuses the supported DSH 0.2.1-rc.3 extension points (`llm/stream`, `agent/pre-step`, agent
  steering, cancellation, and follow-up). No new runtime dependency, no Client bundle, and no
  breaking change.
- Repository gates stay: `pnpm build`, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  and `pnpm validate:repo`.
