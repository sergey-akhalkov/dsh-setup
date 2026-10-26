# Tasks

## 1. Package scaffold and composition

- [x] 1.1 Scaffold `packages/plugin-codex-subagent` as a Host-only forked provider: manifest with `name` `@dsh-setup/plugin-codex-subagent`, version equal to the set, `main`/`types`, exports, `files` (icon, locale, lib, both YAMLs, README, NOTICE), exact `engines.dsh` copied from `dsh.json`, `@deepseek-ai/cordis` peer, `dsh.bundle.patch`, `cordis.fragment.yml` with row `dsh-setup-codex-subagent`, `locale/en.json`, `icon.svg`, and the copied upstream `lib/**` and types. Verify `pnpm validate:repo` accepts the manifest, row, and `engines.dsh`, and that no install script is present.
- [x] 1.2 Scaffold `packages/plugin-delegation-rules` from the `packages/plugin-working-principles` shape: manifest with `name` `@dsh-setup/plugin-delegation-rules`, `main`/`types`, exports, `files` (icon, locale, lib, both YAMLs, assets), exact `engines.dsh`, `@deepseek-ai/cordis` peer, `dsh.bundle.patch`, `cordis.fragment.yml` with row `dsh-setup-delegation-rules`, `tsconfig.json`, the root `tsconfig.json` reference, `locale/en.json`, and `icon.svg`. Verify `pnpm build` emits `lib/index.js`/`lib/index.d.ts` and `pnpm validate:repo` accepts the package.
- [x] 1.3 Run `pnpm install` after the dependency changes; verify the lockfile is updated, the install succeeds, and neither package adds an install script.
- [x] 1.4 Run `pnpm gen`; confirm the generated package patches, `packages/setup/cordis.patch.yml`, `packages/setup/package.json`, and the vendored setup tree contain exactly the two new rows and package copies; verify a second `pnpm gen:check` exits 0.

## 2. Codex fork provider

- [x] 2.1 Copy the upstream MIT `@deepseek-ai/dsh-subagent-codex@0.2.1-rc.3` `lib/index.js` and types into the fork, add the upstream license/NOTICE and a README recording the upstream version and the local binary-resolution patch. Verify a static provenance test checks the NOTICE, upstream version, and no official-provider runtime dependency.
- [x] 2.2 Replace the package-local binary resolution with `codexPath`/`PATH` discovery and `codex --version` validation. Verify tests cover an explicit valid path, PATH discovery, a missing CLI, an invalid path, and a version-command failure; verify the error names the `codexPath` key and the status tool.
- [x] 2.3 Implement Windows command handling: spawn `.cmd`/`.bat` through `ComSpec` with fixed arguments and `.exe` directly; never interpolate the prompt into a command line. Verify tests with a fake `.cmd` and `.exe` cover both branches and that the prompt reaches stdin.
- [x] 2.4 Register `codex-subagent` (read-only) and `codex-subagent-write` (workspace-write) provider instances and verify the official `codex` provider can coexist. Verify provider tests cover both names, distinct permissions, and no duplicate registration.
- [x] 2.5 Implement `codex_subagent_status` reporting the resolved path, version, source (`config` or `PATH`), and a paste-ready `codexPath` snippet; it must not modify the profile. Verify tests cover a found CLI, a missing CLI, a config-sourced path, and no file writes.
- [x] 2.6 Verify the retained app-server adapter starts the installed Codex 0.164.0 with `app-server --stdio` and handles the handshake; patch the adapter if 0.164.0 differs from 0.153.4. Verify the live handshake test completes or records the exact protocol delta.
- [x] 2.7 Implement cancellation, timeout, process-tree cleanup, and non-completed run reporting for the fork; verify tests cover turn cancellation, timeout, and a crashed app-server.
- [x] 2.8 Verify the fork vendors no Codex binary, installs nothing, signs in to nothing, and uses the user's installed CLI/config/auth; verify a static package test and `pnpm validate:repo` pass.

## 3. Rules engine: config, targets, triggers

- [x] 3.1 Implement the Config schema for `targets`, `rules`, timeouts, and `failureStreak`, with defaults. Verify tests cover a minimal config, the shipped default rules, and a config with no rules.
- [x] 3.2 Implement rule validation: unique kebab-case ids, known triggers/contracts/gates, existing targets, required phase for review, required isolation for patch, and no duplicate strict gate for the same digest scope. Verify tests cover each invalid shape and a valid config.
- [x] 3.3 Implement target resolution against `ctx.subagents`: provider name, optional model/agent options, capabilities check, missing provider, and unsupported option. Verify tests cover a Codex target, a DSH in-process target, a missing provider, and an unsupported model option.
- [x] 3.4 Implement the `manual`, `spec-ready`, and `implementation-complete` trigger evaluators, including the review-ready and complete-task conditions and archived/multi-change handling. Verify tests cover each positive/negative case.
- [x] 3.5 Implement the `failure-streak` trigger and its per-turn state from `tools/result`, including reset on success and turn change through an observe-only `agent/pre-step` listener returning `next()`. Verify tests cover threshold, reset, disabled threshold, and failed-consultation tracking.
- [x] 3.6 Verify the config/code boundary: a new rule on an existing trigger/contract validates without code; an unknown trigger/contract is rejected with a clear error. Verify tests cover both.
- [x] 3.7 Implement the `spec-task-ready` trigger: parse `tasks.md`, derive a stable task id from the normalized task text, find checked tasks without a matching task-review record, and report them at turn-stopping. Verify tests cover a new checked task, an already-reviewed task, a changed task text, and an unchecked task.
- [x] 3.8 Implement the `implementation-work` trigger: compare the turn's implementation worktree digest with the last turn, detect a newly checked reviewed task or a matching `task_progress` note, and report when neither exists. Verify tests cover a code-changing turn with a tick+review, with a progress note, with neither, and a docs-only turn.

## 4. Contracts, records, and the gate

- [x] 4.1 Implement the spec digest (all change files except `.openspec.yaml`, task checkbox normalization) and the worktree digest (status, binary diff, untracked bytes, `.dsh`/`.tmp` ignored, fixed git arguments). Verify tests cover stable/changed digests, checkbox-only edits, tracked/untracked changes, and a non-git failure.
- [x] 4.2 Implement atomic `.dsh/delegation/<rule>/<phase>.json` records with rule, phase, digest, verdict, findings, target identity, and time; matching PASS/FINDINGS reuse, ERROR retry, stale/malformed record handling. Verify tests cover each branch and no credentials/machine paths in the record.
- [x] 4.3 Implement the `review` contract: phase digest, P0/P1 prompt, one fenced JSON verdict, digest/severity validation, PASS only with zero findings, FINDINGS/ERROR records. Verify fake-target tests cover PASS, FINDINGS, malformed, stale, and target failure.
- [x] 4.4 Implement the `answer` contract: read-only prompt, evidence/sources, bounded output, no gate record, and failure reporting. Verify fake-target tests cover research, blocker, and target failure.
- [x] 4.5 Implement the `patch` contract: validate a write-capable target, create an isolated git worktree, run the target, return diff/changed files/test results, and never apply to the session worktree. Verify tests cover a produced patch, a read-only target rejection, a failed patch, and no auto-merge.
- [x] 4.6 Implement the turn-stopping gate for strict/soft/none rules: matching PASS/ERROR requirement, stale-record rejection, text-claim rejection, soft steering once per streak, and no target run from the listener. Verify tests cover each state and a failing digest/read becoming an issue rather than a throw.
- [x] 4.7 Implement the gate steer message with source kind `delegation-rules`, naming the rule, digest, record path, and exact delegate call; cover multiple changes, archived changes, nested cwd, and no OpenSpec root. Verify tests cover the steer text and allow/refuse decisions.
- [x] 4.8 Verify the gate never starts a target run and never throws; verify a static test rejects target/subagent calls in the listener and tests cover unreadable change directories.
- [x] 4.9 Implement task-scoped review records: task id from the normalized task text, change artifact digest plus worktree snapshot, historical per-task record, reuse/staleness rules, and the later-task-does-not-invalidate rule. Verify tests cover a task PASS/FINDINGS, a changed task text, a later task, and a stale snapshot.
- [x] 4.10 Implement the `note` contract and `task_progress` record: task id, status, reason, worktree digest, time; no target run, no PASS; active/stale note state. Verify tests cover in-progress, blocked, no-model, and stale-after-worktree-change.
- [x] 4.11 Implement the task progress gate: a code-changing turn without a checked reviewed task or matching note is refused; a checked task without a task-review PASS/ERROR is refused even with a note; a stale note is refused. Verify tests cover each branch.
- [x] 4.12 Implement the optional integration review: current whole-worktree digest, `soft`/`none` default, stale invalidation, and its independence from per-task records. Verify tests cover soft/none/strict and a later task not invalidating per-task records.

## 5. Tools, skill, default rules, and model-agnostic proof

- [x] 5.1 Implement the `delegate` tool with a `rule` enum generated from the configured rules, required-input validation per contract, a description naming the manual tasks, and result rendering. Verify tests cover a manual delegation, an unknown rule, and a missing required input.
- [x] 5.2 Implement `delegation_status` listing registered providers/capabilities, targets, rules, and missing-target diagnostics. Verify tests cover a complete config and a missing target.
- [x] 5.3 Write the default rule assets/prompts for whole-spec review, task review, integration review, task progress, blocker, research, and bug-fix: P0/P1 rubric, evidence, untrusted artifacts, task-scope review, read-only review/answer, worktree patch, progress note, and P0/P1-only residuals. Verify prompt tests assert each required section and the review verdict schema.
- [x] 5.4 Write `assets/delegation-rules/SKILL.md` with the trigger/contract/gate model, rule authoring, default rules, the tick-after-task / progress-note workflow, manual delegation, failure/opt-out, cost, and security boundaries; register the skill provider with a matching catalog description. Verify tests cover the one candidate, frontmatter/description match, and body-on-demand.
- [x] 5.5 Add the model-facing budget test: three tool descriptions plus the skill catalog description under 900 estimated tokens, the skill body under 24,000 UTF-8 bytes, and no `systemPrompt.section`/always-on contribution. Verify the test passes and fails on padded scratch copies, and state the measured sizes in docs.
- [x] 5.6 Prove model-agnostic behavior with a non-Codex test: a fake DSH `spawn` target with a different model runs a review or answer rule and the same contract/gate applies. Verify the test fails if the engine references Codex.
- [x] 5.7 Implement the `task_progress` tool: validate the unchecked task id/status/reason, write the note record with the current worktree digest, run no target, and report active/stale notes through `delegation_status`. Verify tests cover in-progress, blocked, a checked task rejection, and no model start.

## 6. Setup, documentation, and market

- [x] 6.1 Configure the setup defaults for the rules plugin: the Codex targets (read-only/write) and the default rules; the fork row. Verify `pnpm gen` places the config in the setup patch and `pnpm validate:composition` mounts both rows once.
- [x] 6.2 Write `docs/delegation-rules.md`: the trigger/contract/gate model, rule/target examples, default rules, the tick-after-task/task-review flow, the `task_progress` note, the optional integration review, a non-Codex target example, manual delegation, patch worktree/no auto-merge, ERROR/blocked handoff, opt-out, model-facing cost, security, and troubleshooting. Verify `pnpm lint`, links, and the documented measured sizes.
- [x] 6.3 Write `docs/codex-subagent.md`: the installed-Codex prerequisite, PATH/`codexPath` discovery, `codex_subagent_status`, version validation, read-only/write providers, the app-server/0.164.0 note, the model/effort config, cost, and the MIT/upstream notice. Verify links and that no machine path or credential is committed.
- [x] 6.4 Add the market metadata: `locale/en.json` cards for both packages naming the generic rules engine, the Codex target prerequisite, the row opt-out, and the non-Codex target possibility; use original icons. Verify `pnpm validate:repo` and the market mapping test accept both cards.
- [x] 6.5 Update the docs indexes/README/combined tables as needed so both packages are discoverable and no stale naming remains. Verify `pnpm lint` and every intra-repo link.
- [x] 6.6 Update the repository `AGENTS.md` OpenSpec flow and the `delegation-rules` skill with the future-session workflow: after completing a task, mark it `[x]` and run its task review; if a turn stops mid-task, call `task_progress` with the reason; the gate enforces the decision. Verify the text matches the spec/tool descriptions and `pnpm lint` passes.

## 7. Repository integration

- [x] 7.1 Run `pnpm build`, then `git diff --exit-code` after committing the generated output; verify the committed `lib/**` matches a fresh build. Run `pnpm gen`/`pnpm gen:check`; verify the setup patch, setup manifest, and vendored tree are current with no unexpected files.
- [x] 7.2 Run `pnpm check` (typecheck, lint, build, test) and `pnpm validate:repo`; fix every failure. Verify the new packages' tests run under the repository Vitest configuration.
- [x] 7.3 Run `pnpm validate:composition` with the published DSH CLI or `DSH_CLI`; verify the composed dump contains exactly one `dsh-setup-delegation-rules` and one `dsh-setup-codex-subagent` row.
- [x] 7.4 Verify no `dsh.json`, `install.ps1`, existing plugin, or generated setup selection changed beyond the two new packages, their defaults, and vendored copies.

## 8. Live acceptance in a throwaway profile

- [ ] 8.1 Create a throwaway `dev`/`ci` profile with the two bundles; put the installed `codex` 0.164.0 on PATH; verify auto-detect and `codex_subagent_status` report its path/version; run a manual `delegate` review or answer and record the result. Do not install into the live desktop profile from a shell hosted by the running Harness.
- [ ] 8.2 Set an explicit `codexPath`, verify it wins over PATH; test a `.cmd` and an `.exe`; remove the path/CLI and verify the missing-CLI error and the status snippet. Verify the profile patch is unchanged by the status tool.
- [ ] 8.3 Seed a test OpenSpec change with a deliberate P0 gap; run the whole-spec review rule, verify FINDINGS with evidence/fix, fix the spec, re-run to PASS, edit the spec and verify the stale whole-spec re-review.
- [ ] 8.4 Task-by-task acceptance: tick one task and run its task review (FINDINGS→PASS); tick the next task and verify the earlier task record remains historical; verify a checked task without a review is refused and an unchecked task is not reviewed.
- [ ] 8.5 Mid-task acceptance: change implementation files without ticking; verify `implementation-work` steers; record `task_progress(in-progress)` and verify the turn may close; change the worktree and verify the note is stale; verify a checked task without PASS is refused even with a note.
- [ ] 8.6 Verify the optional integration review in `soft`, `none`, and `strict` modes on the current whole worktree, and that per-task records survive later tasks.
- [ ] 8.7 Point a rule at a non-Codex DSH in-process target with another model; verify the same review/answer contract and gate apply. This is the model-agnostic acceptance.
- [ ] 8.8 Run the bug-fix patch rule against a write target; verify the worktree, diff, and test results are returned, the session worktree is unchanged, and no auto-merge occurs.
- [ ] 8.9 Simulate an unavailable target and verify the matching `ERROR` record, visible failure, and blocked handoff; verify a failed soft consultation does not trap the turn.
- [ ] 8.10 Verify disabling/removing the rules row stops the gate and removes the tools/skill, while records/progress notes/worktrees/change artifacts remain; re-enable and verify re-evaluation.
- [ ] 8.11 Measure one whole-spec review, one task review, one progress note, one answer, and one patch run for latency/token cost; confirm the configured defaults are workable and tune only Config values.

## 9. Release preparation

- [x] 9.1 Run `pnpm release:prepare --version X.Y.Z`, then `pnpm gen` and `pnpm build`; verify the one version appears in the root, both packages, and the generated setup manifest, and `pnpm gen:check` exits 0. Do not tag or publish without the owner's release decision.

## Workflow follow-up

- Archive the change after implementation, sync the two delta specs into the main specs, and verify the archived result.
- After release, confirm the market lists both cards and the setup's composed patch contains both rows; monitor the first sessions for task-review latency, missing ticks, stale progress notes, rule/target misconfiguration, and false-positive findings.
- If the per-task review becomes noisy, tune `task-review` to `soft` or batch tasks in a separate change; do not silently drop the tick/gate discipline.
- If the integration review proves unnecessary, set it to `none`; if cross-task regressions appear, set it to `strict`.
- If the app-server 0.164.0 protocol needs adapter changes, patch the fork's adapter and re-run task 8/7 before release; do not silently fall back to the bundled 0.153.4.
- On a future DSH support bump, rebase the fork and re-run its acceptance as part of that change.
- If the rules DSL needs a new trigger or contract, open a separate change for the code extension; do not hide it in config.
- If the owner later wants cryptographic anti-forgery of records, open a separate change for signed records; the current gate is a process-integrity check.
- The live Codex sign-in/config and the non-Codex target are the acceptance prerequisites: keep task 8 open until real runs succeed.
