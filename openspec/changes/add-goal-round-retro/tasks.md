# Tasks

Lanes: 1 (engine, review child, record, gate, config, manifest, and tests) and 2 (documentation) own disjoint
paths and can run in parallel. 3 is the serial tail for generated output and the full repository gate.

## 1. Engine, review child, record, gate, and tests (lane 1, owns `packages/plugin-goal-continuity/src/**`, `packages/plugin-goal-continuity/lib/**`, `packages/plugin-goal-continuity/assets/**`, `packages/plugin-goal-continuity/test/**`, `packages/plugin-goal-continuity/package.json`, `packages/plugin-goal-continuity/cordis.fragment.yml`)

Lane 1 owns the plugin `lib/**` and `package.json`; run `pnpm build` before each test verification because the
tests import the built entry.

- [x] 1.1 Add the `speedReview` configuration: enabled, provider, model, reasoningEffort, minToolCalls,
      minMinutes, slowCallMs, everyRound, timeoutMs, maxPerGoal, and brief; reuse `blockReview.reviewerPreset`
      for the reviewer preset; add the shipped defaults to `cordis.fragment.yml`; reject unknown, mistyped, or
      out-of-range fields with a field diagnostic. Verify: run `pnpm build`, then
      `pnpm exec vitest run packages/plugin-goal-continuity/test/config.test.ts` covers the defaults, the
      disabled flag, every boundary value, and the rejected shapes.
- [x] 1.2 Measure the current goal round in the existing `session/event` handler: wall time, tool-call count,
      error count, worker starts, the slowest calls with durations, and approximate non-tool time; keep the
      metrics in memory, snapshot them at turn end, and skip a round whose start was not observed. Verify: run
      `pnpm build`, then `pnpm exec vitest run packages/plugin-goal-continuity/test/metrics.test.ts` covers a
      dominant slow call, worker counts, errors, a partial round, and bounded/redacted output.
- [x] 1.3 Add `assets/round-review.md` and the read-only review child: start one child for a qualifying round
      through `ctx.subagents.startActivation` with the shared `goal-reviewer` preset and the existing
      child-scope allowlist; require one strict JSON verdict (`no-action` or one bottleneck + action +
      handoff + expected saving + risk + `speedup-id`); write one atomic local record under
      `.dsh/goal-continuity/retro/<goal-id>/<round>.json`; cap the review at `maxPerGoal` and reuse an
      existing record. Add `assets/round-review.md` to `package.json` `files` and update
      `test/package.test.ts` to require it. Verify: run `pnpm build`, then
      `pnpm exec vitest run packages/plugin-goal-continuity/test/speed-review.test.ts
      packages/plugin-goal-continuity/test/package.test.ts` covers threshold met/not met, `no-action`,
      duplicate round end, timeout/failure, the per-goal bound, record status, redaction, and the shipped
      prompt manifest entry.
- [x] 1.4 Add the next-round brief: at the first step of a goal round inject one bounded non-waking notice with
      the speed policy and any pending action's bottleneck, summary, `speedup-id`, record path, the
      start-or-decline instruction, and the exact `task_progress` decline call when that path is available;
      inject the action as a notice when the review finishes during a round; do not inject it on a non-goal
      turn or wake an idle agent. Verify: run `pnpm build`, then the speed-review test covers a pending action,
      no action, a non-goal turn, a disabled brief, the exact decline call, a late result, and the notice
      bound.
- [x] 1.5 Add the follow-through gate on `agent/turn-stopping`: for a root goal round with a pending action,
      accept a successful worker start whose arguments contain the `speedup-id` or a successful
      `task_progress` note whose reason contains it; otherwise steer once with the action id and record path;
      mark the record `started` or `declined`; fail open when the record is missing or unreadable, when
      `task_progress` is unavailable, when no active change has an eligible unchecked task, or when no
      worker-start tool is registered; skip subagent turns. Verify: run `pnpm build`, then the speed-review
      test covers start, decline, neither, missing record, a subagent turn, and all three unavailable cases.
- [x] 1.6 Share the reviewer preset and scope with the block review: generalize the preset persona to one
      read-only goal reviewer, keep both prompts specific, and confirm the child scope allows only `read`,
      `grep`, and `glob` for both reviews. Verify: run `pnpm build`, then
      `pnpm exec vitest run packages/plugin-goal-continuity/test/block-review.test.ts
      packages/plugin-goal-continuity/test/roster.test.ts
      packages/plugin-goal-continuity/test/package.test.ts` still passes and the speed-review test covers the
      read-only scope and an unavailable provider.

## 2. Documentation (lane 2, owns `docs/goal-continuity.md`, `docs/plugins.md`, `docs/openspec-status.md`)

- [x] 2.1 Update `docs/goal-continuity.md`: the two bounded model calls, round metrics, review prompt and
      strict verdict, record path/status, next-round brief, follow-through gate and its availability fail-open,
      `speedReview` defaults, the two off switches, the read-only preset sharing, the shipped prompt asset, and
      the goal-only scope. Verify `pnpm lint` and that the page names `speedReview`, `speedup-id`, the record
      path, `minToolCalls`, `maxPerGoal`, `task_progress`, and the disabled flags.
- [x] 2.2 Update `docs/plugins.md` and `docs/openspec-status.md` with the speed-review capability and the
      change entry. Verify `pnpm lint` and that the pages name `add-goal-round-retro` and the plugin row.

## 3. Serial tail: generated output and full gate (serial, owns `packages/plugin-goal-continuity/cordis.patch.yml`, `packages/setup/**`)

- [x] 3.1 Run `pnpm gen` and the final `pnpm build`, then confirm the generated `cordis.patch.yml` carries
      `speedReview`, the generalized preset description, and the vendored setup tree matches the package,
      including `packages/setup/node_modules/@dsh-setup/plugin-goal-continuity/assets/round-review.md`; verify
      `pnpm gen:check` exits 0 and the generated and built output is committed.
- [x] 3.2 Run `pnpm check`, `pnpm validate:repo`, `pnpm validate:composition`, and
      `openspec validate "add-goal-round-retro" --strict`; verify they all pass and `git diff --exit-code` is
      clean after the generated and built output is committed.

## Workflow follow-up

- Run the task-scoped review for every checked task and confirm the portable `reviews/<taskId>.json` PASS
  records before archiving.
- Sync the `goal-continuity` delta into the main spec with the `openspec-sync-specs` workflow.
- Archive the change after the approval audit and `pnpm reviews:check --change add-goal-round-retro`.
- Owner follow-up: the shipped defaults reach a machine only after the next release and install, and the Host
  needs a restart for the new child path; the live acceptance is a real goal with an expensive round that
  shows the brief, the worker start, and the gate.
