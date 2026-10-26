# Proposal

## Why

The owner wants to delegate situational work to a stronger model: review OpenSpec specs and completed implementations, help with blockers and high-risk decisions, do research, and fix complex bugs. Today that work is hard-coded to Codex and to two fixed tools. Every new task, model, subscription, or trigger would require another code change, and guidance alone cannot make a delegation mandatory.

DSH `0.2.1-rc.3` already has the right seams: `agent/turn-stopping` is awaited before a turn closes and a listener can steer the agent into another step, while `ctx.subagents` is a registry of providers and models. The smallest durable layer is a model-agnostic delegation-rule engine plus one installed-Codex target; the owner can change rules, targets, instructions, and gates without changing the engine.

## What Changes

- Add `@dsh-setup/plugin-delegation-rules`: a generic Host bundle. Rules select a trigger (`manual`, `spec-ready`, `spec-task-ready`, `implementation-work`, `implementation-complete`, `failure-streak`), a target (any registered DSH subagent provider plus optional model/agent options), an instruction, a result contract (`review`, `answer`, `patch`, `note`), and a gate (`strict`, `soft`, `none`).
- Add `delegate`, `task_progress`, and `delegation_status` tools and an on-demand `delegation-rules` skill. The plugin adds no always-on system-prompt section.
- Ship default rules reproducing the owner flow: `spec-review`, `task-review`, `task-progress`, `blocker`, `research`, `bug-fix`, plus an optional `integration-review`. They are data and can be overridden or extended. The setup defaults target the installed-Codex provider; the engine itself has no Codex dependency.
- Review incrementally: every checked task in `tasks.md` gets its own task-scoped P0/P1 review before the next task; a task that spans turns uses a cheap `task_progress` note; a code-changing turn with neither a ticked-and-reviewed task nor a progress note is refused. The final whole-implementation review is an optional `soft`/`none` integration check, not the primary review.
- Add `@dsh-setup/plugin-codex-subagent`: an MIT-attributed fork of the official `dsh-subagent-codex` provider that uses the Codex CLI installed on the machine instead of the bundled `0.153.4` binary. It auto-detects `codex` in `PATH`, accepts an explicit `codexPath`, validates it with `codex --version`, exposes `codex_subagent_status`, and registers read-only and workspace-write provider instances.
- The `review` contract writes digest-bound P0/P1 records; a strict gate at `agent/turn-stopping` refuses a turn without a matching PASS/ERROR record and steers with the exact rule. Per-task reviews are historical snapshots; the optional integration review checks the current whole worktree. The `answer` contract supports blockers and research. The `patch` contract runs a write target in a worktree and returns the diff; it never auto-merges. The `note` contract records an explicit in-progress/blocked task state without a model run.
- Ship the packages, default rules/prompts, skill, documentation, market metadata, TypeScript/JS integration, generated setup/vendored output, and a set version bump. `dsh.json` and `install.ps1` do not change.

Out of scope: a Client UI or settings page, automatic write-back of `codexPath` to the profile patch, cryptographic record anti-forgery, automatic merge of `patch` results, automatic inference of which task is complete or auto-ticking `tasks.md`, an arbitrary event DSL beyond the documented trigger vocabulary, and installing or signing in to any provider.

## Capabilities

### New Capabilities

- `delegation-rules`: the model-agnostic rules/targets/triggers/contracts/gates engine, its tools, default rules, config/code boundary, and gate semantics.
- `codex-subagent`: the forked installed-CLI Codex provider, its path discovery/validation/status, read-only/write provider instances, license, and maintenance boundary.

### Modified Capabilities

None. The setup delivers two new bundles; no existing behavior or requirement changes.

## Impact

- New packages `packages/plugin-delegation-rules` (Host-only TypeScript) and `packages/plugin-codex-subagent` (Host-only forked JavaScript provider with its own license/attribution).
- Default rules/prompts assets, the `delegation-rules` skill, `locale/en.json`, icons, fragments, and bundle patches; the root `tsconfig.json` reference for the TypeScript package.
- `pnpm gen` rewrites the package patches, setup patch/manifest, and vendored tree; `pnpm build` writes the rules package's `lib/**`; the fork's patched `lib/**` is committed from the upstream code.
- `docs/delegation-rules.md` and `docs/codex-subagent.md`; market cards; setup defaults that target the Codex provider. The repository's `AGENTS.md` OpenSpec flow and the `delegation-rules` skill state the tick-after-task / progress-note workflow, while the gate enforces it.
- Runtime: the setup defaults target the Codex fork; users can configure any registered DSH subagent provider/model/subscription. The fork's `codexPath` is machine-local; no machine path enters a tracked file. Reports are slow and consume the target's tokens/subscription; per-task reviews increase the number of runs, while the task progress note is cheap and does not run a model; patch targets need a worktree and manual review.
- No `dsh.json`, `install.ps1`, existing plugin, or existing spec requirement change.
