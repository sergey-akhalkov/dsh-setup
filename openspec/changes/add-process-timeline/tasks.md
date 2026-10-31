# Tasks

## 1. Host: process timeline and summary (owns `packages/plugin-observability/src/host/process.ts`, `report.ts`, `config.ts`)

- [ ] 1.1 Add a pure `packages/plugin-observability/src/host/process.ts`: worker spans from joined child sessions clipped to the window, worker concurrency, decomposition markers (each episode's first worker activation after no active worker, with the episode's worker count), reflection markers from `work_checkpoint` records with a parsed outcome (time, episode id, outcome word, steps since the previous reflection), and the per-window summary (workers, episodes with a worker, activations, maximum concurrency, time to first worker p50/p90, steps between reflections p50/p90, reflections per episode, reflection coverage). Verify with fixtures for one worker, two overlapping workers, no worker, an empty window, one reflection and two reflections, a reflection after a long step gap, and a malformed checkpoint that is not a marker, does not reset the cadence, and does not count toward coverage.
- [ ] 1.2 Carry `process` in the report and accept one optional `interventionAt` ISO date in the plugin configuration: when set, split the episodes by start at that instant and report both summaries with sample sizes and an association label, reading insufficient below the configured minimum; without it compare with the previous equal window, or with the previous completed session for the session range, naming that baseline. Reject a malformed date by name. Verify with a report fixture for the timeline shape, the intervention split, the insufficient sides, the session-range previous-completed-session baseline with its label, and the absence of message text, arguments, goal objectives, and checkpoint list text.
- [ ] 1.3 Document the process timeline, its marker definitions, the summary metrics, the intervention date and the association/insufficient states in `docs/plugins.md`.

## 2. Client: Process panel in the Overview (owns `packages/plugin-observability/src/client/index.tsx`, `test/client.test.ts`)

- [ ] 2.1 Add a `ProcessTimeline` chart: time on X, worker concurrency as a step line with decomposition and reflection markers, a step-rate strip below it, and a compact summary table with the before/after comparison and its labels; no new top-level tab, no new dependency. Verify with component tests for one worker, two overlapping workers, markers with times and counts only, no workers, an empty window, an insufficient comparison, and no message text.
- [ ] 2.2 Render the panel in the Overview beside the activity chart with the configured intervention date printed when present, and keep the existing failure access, scorecards, and silent group. Verify with component tests for the panel presence, the date line, and the empty state.

## 3. Integration (serial tail)

- [ ] 3.1 Run the local gate: `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, `pnpm build && git diff --exit-code`; fix what fails.
- [ ] 3.2 Run `pnpm dogfood` and confirm the composed observability row is unchanged (the new field is optional and unset in the shipped defaults).
