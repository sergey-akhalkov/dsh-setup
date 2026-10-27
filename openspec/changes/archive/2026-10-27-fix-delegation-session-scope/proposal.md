# Proposal

## Why

A new DSH session that opens a workspace with active OpenSpec changes can adopt every change that has no local owner file and is then steered to review all of those changes' checked tasks, even when another session created and is editing them. Ownership is local scratch under `.dsh/` (gitignored) and is claimed by first observation, so a fresh checkout, a change created before the owner feature, or a change created by another live session is adopted by whichever session runs a pre-step, gate, or `delegation_status` first. Once adopted, every historical checked task is in scope. Observed live: a change created by another session during a turn was adopted by the design session, the gate demanded its spec and task reviews, and its still-missing `tasks.md` was reported as a worktree-digest failure.

## What Changes

- Replace exclusive first-observer change ownership with per-session involvement: each DSH session records the active changes it created or modified under `.dsh/delegation/sessions/`.
- Attribute involvement only from session-attributable write evidence or explicit change-scoped tool calls: a successful write or creation tool call targeting the change, with the turn snapshot used only to determine what that write changed (created, spec-changed, checked tasks). Reads, `delegation_status`, and another session's snapshot changes never attribute a change.
- Attribute task checkboxes per write from the successful write's canonical before/after contents; set spec-changed when that write's checkbox-normalized before/after differ (a substantive task-plan edit or a newly supplied `tasks.md`), and do not use the whole-change digest for that decision. A checkbox-only tick does not set spec-changed; creation sets created/spec-changed without importing another session's checked tasks.
- Limit explicit attribution to `task_progress` and a review or patch `delegate`; an `answer` delegate with a change argument does not attribute.
- Scope the gated triggers to the current session's involvement: `spec-ready` only for changes the session created or whose spec artifacts it changed; `spec-task-ready` only for tasks the session checked; `implementation-work` only for involved changes; `implementation-complete` only when the session's work completed the task list. The gate's task-review steer names the explicit task id so it cannot select an earlier foreign task.
- Make task lookup tolerate unreadable unrelated changes, so a foreign missing `tasks.md` cannot block a progress-note handoff for a healthy involved change.
- Remove the exclusive-owner review refusal: any session may run a review, and the record names the reviewing session; records remain workspace-global.
- Keep the per-change artifact error separation: an unreadable or missing `tasks.md` stays a per-change hint and never becomes a worktree-digest failure. The gate evaluates only involved changes, so a foreign change's artifacts cannot block this session.
- Update `delegation_status`, the bundled skill, `docs/delegation-rules.md`, and tests. Ignore and document the legacy `owners/` files; no migration.
- No rule configuration, tool parameter, or record shape changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `delegation-rules`: replace change ownership by first observation with per-session change involvement, scope the gated triggers and task-review obligations to the session's own work, and allow reviews from any session.

## Impact

- `packages/plugin-delegation-rules/src/host/index.ts`
- `packages/plugin-delegation-rules/test/{gate,engine,config,assets}.test.ts`
- `packages/plugin-delegation-rules/assets/delegation-rules/SKILL.md`
- `docs/delegation-rules.md`
- `openspec/specs/delegation-rules/spec.md` (through this change's delta)
- Generated `packages/plugin-delegation-rules/lib/**` and the vendored setup copy via `pnpm build`/`pnpm gen`
- No new dependencies, no Client half, no profile configuration change. The installed Host only picks up the behavior after a rebuild and a Harness restart.
