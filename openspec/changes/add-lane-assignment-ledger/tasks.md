# Tasks

Lanes: 1 (engine, state, gate tests, and the default rule) and 2 (the on-demand skill, its asset test, and
documentation) own disjoint paths and can run in parallel. 3 is the serial tail for generated output and the
full repository gate.

## 1. Engine, state, and gate tests (lane 1, owns `packages/plugin-delegation-rules/src/**`, `packages/plugin-delegation-rules/lib/**`, `packages/plugin-delegation-rules/test/gate.test.ts`, `packages/plugin-delegation-rules/test/config.test.ts`, `packages/plugin-delegation-rules/cordis.fragment.yml`)

Lane 1 owns the plugin `lib/**`; run `pnpm build` before each verification because the tests import the
built entry.

- [x] 1.1 Add `lane-assignment` to the `Trigger` union and `TRIGGERS`, validate it as a `note` rule with a
      strict gate and no target, keep `lane-boundary` accepted, and switch the shipped `lane-fanout` rule in
      `cordis.fragment.yml` to `lane-assignment`. Verify: run `pnpm build`, then
      `pnpm exec vitest run packages/plugin-delegation-rules/test/config.test.ts` accepts both triggers,
      rejects a target or a review contract for the new trigger, and reports the default rule's new trigger.
- [x] 1.2 Add the session-scoped lane assignment ledger and the `lane-tag` parser: a successful
      `subagent`/`subagent_fork`/`spawn_teammate`/`workflow` start whose arguments contain the exact tag marks
      that lane assigned; a matching `task_progress` note marks only its lane serial; the turn's ticked-task
      lanes are current; completed, disappeared, and renamed lanes prune the assignment. Verify: run
      `pnpm build`, then `pnpm exec vitest run packages/plugin-delegation-rules/test/gate.test.ts` covers
      tagged, untagged, failed, serial, cross-session, completed, and renamed lanes.
- [x] 1.3 Implement the `lane-assignment` condition and steer: report unassigned non-serial lanes with
      unchecked tasks on a turn that ticked a task or changed implementation files when the plan has at least
      two non-serial lanes, exclude the current lane, list only unassigned lanes, and print the root-anchored
      checkpoint, the tagged worker calls, and the per-lane `task_progress` calls without a machine path.
      Verify: run `pnpm build`, then the same gate test covers the first tick, repeated turns, a new lane, an
      assigned lane not reissued, a completed lane disappearing, a lane completed while another remains
      unchecked, and single-lane silence.
- [x] 1.4 Apply the fail-open rules and the deprecation contract: unreadable `tasks.md`, no level-2 headings,
      an unassigned lane without owned paths, and a read-only turn report nothing; the old `lane-boundary`
      trigger still composes and keeps its behavior. Verify: run `pnpm build`, then
      `pnpm exec vitest run packages/plugin-delegation-rules/test/gate.test.ts
      packages/plugin-delegation-rules/test/config.test.ts` includes the fail-open cases and a compatibility
      case for `lane-boundary`.

## 2. Skill and documentation (lane 2, owns `packages/plugin-delegation-rules/assets/delegation-rules/SKILL.md`, `packages/plugin-delegation-rules/test/assets.test.ts`, `docs/delegation-rules.md`, `docs/openspec-status.md`)

The asset test imports the built entry; run `pnpm build` before its verifications. The serial tail re-runs
the final build.

- [x] 2.1 Update `assets/delegation-rules/SKILL.md`: add `lane-assignment` to the trigger and default-rule
      tables, describe the per-lane assignment ledger, the `lane-tag` worker evidence, the per-lane serial
      escape, and mark `lane-boundary` deprecated. Update `test/assets.test.ts` for the new content and the
      24,000-byte budget. Verify: run `pnpm build`, then
      `pnpm exec vitest run -t "keeps the on-demand skill body under 24,000 UTF-8 bytes"
      packages/plugin-delegation-rules/test/assets.test.ts` and the new-content test; the full asset test runs
      after 2.2.
- [x] 2.2 Update `docs/delegation-rules.md` with the new trigger, its difference from the deprecated
      `lane-boundary`, the tag format, the per-lane serial decision, the restart re-arm, and the default-rule
      change; add the change entry to `docs/openspec-status.md`. Verify: run `pnpm build`, `pnpm lint`, and
      `pnpm exec vitest run packages/plugin-delegation-rules/test/assets.test.ts`; the pages name
      `lane-assignment`, `lane-tag`, `lane-boundary` (deprecated), and `lane-fanout`.

## 3. Serial tail: generated output and full gate (serial, owns `packages/plugin-delegation-rules/cordis.patch.yml`, `packages/setup/**`)

- [x] 3.1 Run `pnpm gen` and `pnpm build`, then confirm the generated `cordis.patch.yml`, `lib/**`, and the
      vendored `packages/setup/node_modules/@dsh-setup/plugin-delegation-rules` tree match the source and the
      `lane-fanout` rule uses `lane-assignment`; verify `pnpm gen:check` exits 0 and the generated and built
      output is committed.
- [x] 3.2 Run `pnpm check`, `pnpm validate:repo`, `pnpm validate:composition`, and
      `openspec validate "add-lane-assignment-ledger" --strict`; verify they all pass and
      `git diff --exit-code` is clean after the generated and built output is committed.

## Workflow follow-up

- Run the task-scoped review for every checked task and confirm the portable `reviews/<taskId>.json` PASS
  records before archiving.
- Sync the `delegation-rules` delta into the main spec with the `openspec-sync-specs` workflow.
- Archive the change after the approval audit and `pnpm reviews:check --change add-lane-assignment-ledger`.
- Owner follow-up: the shipped default reaches a machine only after the next release and install; a profile
  that replaces the whole `rules` config must restate `lane-fanout` to keep it.
