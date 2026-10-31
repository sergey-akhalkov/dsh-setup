# Proposal

## Why

We ship process rules (lane decomposition, work checkpoints, self-reflection every N steps) but cannot
tell whether they change what the agent does. The view reports outcomes — episodes, tokens, failures —
not the behavior the rules are meant to cause: when workers were spawned, how many ran at once, and
when the agent paused to reflect. Without that, "did decompose-before-apply help?" is answered by
impression, and silence is mistaken for compliance.

## What Changes

- Derive a **process timeline** from existing session metadata: worker activations (subagent child
  session starts), the number of workers active over time, self-reflection calls (`work_checkpoint`),
  episode starts, human messages, and the step rate between them.
- Marker **decomposition** as a worker burst: the first worker activation in an episode (or after an
  idle gap) and the burst's size; marker **reflection** as a `work_checkpoint` call, with the steps
  since the previous reflection.
- Report the **process summary**: time from episode start to the first worker, worker activations per
  episode, maximum concurrent workers, steps between reflections, reflections per episode, and
  reflection coverage.
- Render a **Process** panel in the Overview: one time axis with the worker-concurrency series, the
  decomposition and reflection markers over it, and a step-rate strip, so an intervention date can be
  read directly.
- Accept one optional **intervention date** in the plugin configuration; the panel splits the series
  into before and after and states the comparison as an association with its sample sizes. Without it
  the panel uses the previous equal window as the reference.

Out of scope: reading prompts or skill text, deciding whether the model "chose" to decompose, a
stored experiment registry, and any new event or persistence. The intervention date is configuration,
not logged configuration history.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `observability`: the capability gains a process timeline (worker concurrency, decomposition and
  reflection markers), a process summary, an optional configured intervention date, and a before/after
  association comparison.

## Impact

- `packages/plugin-observability` host: a new pure process-timeline module, the report field, and
  fixtures; the plugin configuration gains one optional field.
- `packages/plugin-observability` client: one Process panel in the Overview and its component tests.
- Docs: `docs/plugins.md` process section and the out-of-scope list.
- No new dependency, no new event, no persisted store; the existing per-session cache is reused.
