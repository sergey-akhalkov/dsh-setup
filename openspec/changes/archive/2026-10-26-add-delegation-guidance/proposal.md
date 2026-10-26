# Proposal

## Why

The setup already follows the single-agent-loop pattern: domain knowledge ships as on-demand skills
and the always-on prompt stays short. But the working contract says nothing about when to use the
Harness's subagent and teammate tools, while the installer enables Agent Teams and the Harness prompt
advertises them. Nothing sets the default, so sessions can drift into spawning a team for work that a
single agent with skills would finish faster and with better context.

Anthropic's guidance "Building agents: When to fold subagents into your main agent loop" (checked
2026-10-26) names the narrow cases where a subagent pays: measurable context bloat, parallel work
with fresh context, and tool-selection or conflicting-instruction problems. It also names the cost:
lossy handoffs, added latency, and a coordination layer that copies the org chart. The setup's
remaining gap is one short policy that states the default and the conditions.

## What Changes

- Add a two-bullet "Delegate only to parallelize" section to the always-on working contract: one
  agent with its skills is the default; a subagent or teammate is for an independent, parallel piece
  that returns a compact result, or for verification that needs a fresh context. No team for
  sequential work, ceremony, or a context restatement.
- Add the rationale to the on-demand `working-principles` skill: delegation conditions, failure
  modes, divide-by-context, one-shot subagent over a durable teammate, and folding a noisy handoff
  back into the main loop.
- Record the adaptation in `docs/principles.md` and update its prompt-cost table with the measured
  size.
- Add a `session-guidance` delta requirement: the always-on contract states the default and the
  conditions, and does not require a team for sequential or shared-context work.
- Regenerate the vendored setup copy of the plugin.

Out of scope: any code change, a new plugin or skill, the `add-delegation-rules` engine and its gate
defaults, `AGENTS.md`, and the `dsh.json`/`install.ps1` bundle selection. Agent Teams stays
available; this change only states when not to use it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-guidance`: adds a delegation-guidance requirement to the first-party always-on contract;
  the existing bounded-cost and adaptation requirements still apply.

## Impact

- `packages/plugin-working-principles/assets/working-principles/contract.md` and `SKILL.md`.
- `docs/principles.md` (what the plugin ships, prompt cost, adaptation record).
- The generated vendored copy under `packages/setup/node_modules/@dsh-setup/plugin-working-principles`
  via `pnpm gen`.
- `openspec/specs/session-guidance/spec.md` through the change delta.
- No `src/**` change, no new dependency, no `dsh.json` or `install.ps1` change, and no edit to the
  `add-delegation-rules` change.
