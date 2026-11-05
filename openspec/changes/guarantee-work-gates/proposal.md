# Proposal

## Why

The 2026-11-05 session analysis (99 sessions across four workspaces) shows the three guarantees are still advisory in practice:

- Delegation is real but almost entirely review fan-out: 960 of 1,195 delegate calls are task reviews, only 8 of 36 dsh root sessions spawned a child, no `subagent_fork` was used, and the eight v2 checkpoint records contain zero computed parallel plans. The current parallel gate fires only when an agent declares two disjoint worker-owned lanes; `done` needs no plan, and one `lead`-owned lane is a free serial escape.
- The checkpoint gate fires (172 enforced steers), but 23 of 35 substantial dsh roots never checkpointed, 7 of 8 v2 records are `done` without a plan, and the one `continue` plan names five lanes all owned by `lead`. The goal-round speed review was removed; no loop turns stale bottlenecks or review findings into the next action.
- The archive gate is real for the documented `openspec archive`/`mv` path, and all 308 portable PASS records are Codex, but the code does not require Codex: any provider's record satisfies coverage, `digest`/`worktreeDigest` are not checked, unchecked tasks need no approval, four manual move groups bypassed the tool guard, and no gate refusal was observed in a log.

The owner asked for guaranteed decomposition/delegation, guaranteed reflection with delegated bottleneck elimination, and guaranteed independent review at task close, without adding bureaucracy for work that does not justify it.

## What Changes

- Enable the existing `lane-assignment` fan-out gate as a shipped strict `lane-fanout` rule. An OpenSpec change with at least two non-`serial` task lanes that own paths and have unchecked tasks must start one tagged worker per unassigned lane or record a per-lane `task_progress` serial note before the turn closes. Single-lane, hot-file, generated-output, and serial-gate plans stay serial with one stated reason; the gate only fires on a readable multi-lane plan.
- Tighten the work-checkpoint bottleneck remedy. A `continue` checkpoint whose bottleneck owner is not `lead` MUST use `worker_start` (or `user_decision`), and a worker start MUST carry both the checkpoint id and the bottleneck id. A `lead`-owned bottleneck may still use a targeted `lead_action` edit/write. This makes delegated improvement the enforced path for worker-owned lanes while keeping local lead fixes possible.
- Bind checkpoint lane ownership to the lane-assignment ledger. When a task lane was assigned to a tagged worker, the matching `continue` checkpoint lane MUST name an owner other than `lead`, and a bottleneck targeting that lane MUST use `worker_start` or `user_decision`. This closes the self-declared-`lead` escape observed in every v2 checkpoint record.
- Bind portable task-review approval to the reviewer configured for the repository. `openspec/review-approval.json` gains optional `reviewerProvider`/`reviewerModel`; when present, the live archive gate, the live task gate, `delegation_status`, and `pnpm reviews:check` reject a PASS whose record target does not match. The repo marker sets `reviewerProvider: "codex-subagent"`.
- Add a staged archive audit: `pnpm reviews:check --staged` plus a tracked `.githooks/pre-commit` hook (selected by `pnpm hooks:install` once per clone) catches manual or `run_code` moves into `changes/archive/` before the commit. The existing pre-push hook and CI `--all` audit remain the authoritative backstop.
- Update the delegation skill, docs, tests, generated setup tree, and the review-approval marker.

**BREAKING (behavior):** the shipped default set gains a strict `lane-fanout` rule. Profiles that replace the whole rules config with their own rules are unaffected; profiles that rely on the shipped defaults will now be asked to assign multi-lane work.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `delegation-rules`: the shipped default set includes a strict lane-fanout rule; the lane-assignment gate is the default decomposition gate for multi-lane OpenSpec changes, and worker-assigned checkpoint lanes are bound to the lane ledger.
- `work-checkpoints`: a continue checkpoint with a worker-owned bottleneck requires a worker start carrying the checkpoint id and bottleneck id; lead_action is limited to lead-owned bottlenecks.
- `review-approval`: approval records are bound to the configured reviewer provider/model when the marker declares one, and a staged archive audit runs before commit.

## Impact

- `packages/plugin-delegation-rules/cordis.fragment.yml`, its skill asset, tests, and `docs/delegation-rules.md`.
- `packages/plugin-goal-continuity/src/host/index.ts`, checkpoint tests, and `docs/goal-continuity.md`.
- `packages/plugin-delegation-rules/src/shared/approval.ts`, `src/host/index.ts`, `scripts/reviews-check.ts`, `scripts/install-hooks.ts`, `.githooks/pre-commit`, `openspec/review-approval.json`, and `docs/review-approval.md`.
- Generated `packages/setup/**` and `packages/*/cordis.patch.yml`/`lib/**` through `pnpm gen`/`pnpm build`.
- No new package, bundle row, installer array, market entry, or DSH version.
- Out of scope: review-start queueing, a new retro command/telemetry, and requiring all (unchecked) tasks before archive; these are follow-ups, not part of the guarantees. The existing Observability process summary is the measurement surface.