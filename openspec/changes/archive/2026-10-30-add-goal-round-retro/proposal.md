# Proposal

## Why

A long goal has no feedback loop on delivery cost. The plugin supervises goal continuity and reviews proposed
blocks, but nothing measures where a goal round spent its time: a slow full check, a serial review batch, a
worktree install, or repeated commands stay invisible, so the next round repeats the same waiting. The agent
is not asked to find the bottleneck and has no mechanism that makes it act on one.

## What Changes

- Add a `speedReview` policy to the goal-continuity row. When a completed goal round crosses a configured
  cost threshold, the plugin starts at most one bounded, read-only subagent for that round.
- Measure the round from session events: wall time, tool-call count, errors, worker starts, the slowest tool
  calls with durations, and approximate non-tool time. Put the bounded, redacted metrics in the review input
  and the local record.
- Require one strict JSON verdict: either `no-action`, or one bottleneck with one concrete action, a worker
  handoff, an expected saving, and a risk. The action carries a short `speedup-id`.
- At the start of the next goal round, inject one bounded non-waking brief with the speed policy and any
  pending action, its `speedup-id`, and its record path.
- Add a strict follow-through gate: the next goal round either starts a successful worker whose arguments
  contain the `speedup-id`, or records a matching `task_progress` decline; otherwise the turn is steered to
  do one of those.
- Reuse the `goal-reviewer` read-only preset for the retro child, generalize its persona, and apply the same
  child-scope allowlist used by the block review. No write, edit, shell, delegation, or MCP tool is exposed.
- Update the bundled asset, configuration fragment, tests, documentation, and generated setup output.

No new plugin, tool, dependency, or always-on prompt section is added. The speed review is a second bounded
model call in the plugin, not a new turn or goal round.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `goal-continuity`: continuity supervision gains a goal-round speed review, round cost metrics, a next-round
  brief, a follow-through gate, and a `speedReview` off switch; the read-only reviewer preset is shared by the
  block review and the speed review; the composition and disabled-row requirements cover both reviews.

## Impact

- `packages/plugin-goal-continuity/src/host/index.ts`: config, round metrics, retro child, record, brief, and
  follow-through gate.
- `packages/plugin-goal-continuity/assets/`: a new round-review prompt beside `blocker-review.md`.
- `packages/plugin-goal-continuity/package.json`: the new prompt is added to the package `files` list.
- `packages/plugin-goal-continuity/cordis.fragment.yml` and the generated `cordis.patch.yml`: the
  `speedReview` defaults and the generalized reviewer preset description.
- Tests under `packages/plugin-goal-continuity/test/`.
- `docs/goal-continuity.md`, `docs/openspec-status.md`, and possibly `docs/plugins.md`.
- Generated `lib/**` and the vendored setup tree; `pnpm gen`, `pnpm build`, and the full repository gate.
- Model-facing cost: no always-on text; the brief is bounded and appears only in a goal round; the retro child
  runs in the background with a timeout and a per-goal bound.
