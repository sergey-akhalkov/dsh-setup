# Design

## Context

The DeepSeek route exposes three effective effort levels: `minimal`/`low` map to `low`,
`medium`/`high`/`xhigh` map to `high`, and `max` is distinct. The shipped setup sets `high` in
`packages/setup/defaults.yml`; the live profile pins `max`. Every shipped delegation target is the
Codex target at `xhigh`, so no cheap in-harness worker exists.

The delegation engine already accepts `model` and `reasoningEffort` on a target and passes them to
the provider; the `spawn` provider reports that it supports agent options, and the engine reports an
unavailable target with a next action instead of failing composition. Rules are data, and a profile
patch replaces the whole rule configuration.

## Goals / Non-Goals

**Goals:**

- Make the owner's main-session policy travel with the setup: `max` by default.
- Give the agent two in-harness worker targets with different effort, reachable from `delegate`.
- State the selection policy in the bundled skill so the choice is not implicit.

**Non-Goals:**

- Per-step effort switching inside the main loop: the request types we have carry effort on the
  route and on delegation targets, not on an individual step.
- A classifier plugin that picks a worker automatically: the agent already picks a rule, and a
  classifier would add a model call and a second place to be wrong.
- Changing the Codex targets, the review gates, or the default model.

## Decisions

### Two named targets, not a router

`delegate` already takes a rule id, and the rule's target is data. Adding `worker-fast` and
`worker-deep` turns the choice into a two-way decision the agent makes with the task in hand, and it
keeps the shipped config inspectable. A router plugin would need to classify before the task is
understood, spend a call doing it, and still be overridden by the agent. Rejected: a per-step effort
switcher, which the request types do not support; a single `worker` target, which cannot express the
cheap/expensive split at all.

### In-harness provider, not Codex

Worker subtasks are ordinary in-harness work: sweeps, reading, summarizing, checking. Routing them to
Codex would spend an external request and the Codex contract's overhead for work the local model can
do. The in-process `spawn` provider also gives the default set the non-Codex target the
`delegation-rules` spec already requires.

### Effort only, no pinned model

The worker targets set `reasoningEffort` and leave `model` unset, so they inherit the profile's model
and cannot drift from `agent-default-model`. A pinned model would have to be bumped with every model
change in `defaults.yml`.

### `max` as the shipped main default

The owner chose quality first for the main loop. The cost is real — output tokens are the most
expensive class — and is accepted; the profile patch still overrides the value per machine, which is
the existing local-precedence rule.

## Risks / Trade-offs

- `max` on every main-loop step raises output tokens and latency. → The worker tiers move cheap work
  off the main loop, and a profile override remains a one-line escape hatch.
- The `spawn` provider name or its agent-option support can differ on another DSH version. → The
  engine already reports an unavailable target with a next action; the spec covers that scenario and
  the tests assert it.
- Three effective effort levels make a five-level policy meaningless. → The skill states the mapping
  so the agent does not ask for `xhigh` as if it were distinct.
- Two more rules enlarge the `delegate` tool's rule enum. → The enum is a short id list; the cost is
  a few tokens per step and is accepted.

## Migration Plan

No migration: the changed values are shipped defaults, and a profile patch keeps precedence. `pnpm gen`
regenerates both the package patch and the aggregated setup patch; a release ships the new values.

## Open Questions

None that change the approach. The exact `spawn` provider id on the supported DSH version is checked
by the config test against the live registry during implementation.
