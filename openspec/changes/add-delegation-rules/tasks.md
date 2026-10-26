# Tasks

## 1. Package scaffold and composition

- [ ] 1.1 Scaffold `packages/plugin-codex-subagent` as a Host-only forked provider: manifest with `name` `@dsh-setup/plugin-codex-subagent`, version equal to the set, `main`/`types`, exports, `files` (icon, locale, lib, both YAMLs, README, NOTICE), exact `engines.dsh` copied from `dsh.json`, `@deepseek-ai/cordis` peer, `dsh.bundle.patch`, `cordis.fragment.yml` with row `dsh-setup-codex-subagent`, `locale/en.json`, `icon.svg`, and the copied upstream `lib/**` and types. Verify `pnpm validate:repo` accepts the manifest, row, and `engines.dsh`, and that no install script is present.
- [ ] 1.2 Scaffold `packages/plugin-delegation-rules` from the `packages/plugin-working-principles` shape: manifest with `name` `@dsh-setup/plugin-delegation-rules`, `main`/`types`, exports, `files` (icon, locale, lib, both YAMLs, assets), exact `engines.dsh`, `@deepseek-ai/cordis` peer, `dsh.bundle.patch`, `cordis.fragment.yml` with row `dsh-setup-delegation-rules`, `tsconfig.json`, the root `tsconfig.json` reference, `locale/en.json`, and `icon.svg`. Verify `pnpm build` emits `lib/index.js`/`lib/index.d.ts` and `pnpm validate:repo` accepts the package.
- [ ] 1.3 Run `pnpm install` after the dependency changes; verify the lockfile is updated, the install succeeds, and neither package adds an install script.
- [ ] 1.4 Run `pnpm gen`; confirm the generated package patches, `packages/setup/cordis.patch.yml`, `packages/setup/package.json`, and the vendored setup tree contain exactly the two new rows and package copies; verify a second `pnpm gen:check` exits 0.

## 2. Codex fork provider

- [ ] 2.1 Copy the upstream MIT `@deepseek-ai/dsh-subagent-codex@0.2.1-rc.3` `lib/index.js` and types into the fork, add the upstream license/NOTICE and a README recording the upstream version and the local binary-resolution patch. Verify a static provenance test checks the NOTICE, upstream version, and no official-provider runtime dependency.
- [ ] 2.2 Replace the package-local binary resolution with `codexPath`/`PATH` discovery and `codex --version` validation. Verify tests cover an explicit valid path, PATH discovery, a missing CLI, an invalid path, and a version-command failure; verify the error names the `codexPath` key and the status tool.
- [ ] 2.3 Implement Windows command handling: spawn `.cmd`/`.bat` through `ComSpec` with fixed arguments and `.exe` directly; never interpolate the prompt into a command line. Verify tests with a fake `.cmd` and `.exe` cover both branches and that the prompt reaches stdin.
- [ ] 2.4 Register `codex-subagent` (read-only) and `codex-subagent-write` (workspace-write) provider instances and verify the official `codex` provider can coexist. Verify provider tests cover both names, distinct permissions, and no duplicate registration.
- [ ] 2.5 Implement `codex_subagent_status` reporting the resolved path, version, source (`config` or `PATH`), and a paste-ready `codexPath` snippet; it must not modify the profile. Verify tests cover a found CLI, a missing CLI, a config-sourced path, and no file writes.
- [ ] 2.6 Verify the retained app-server adapter starts the installed Codex 0.164.0 with `app-server --stdio` and handles the handshake; patch the adapter if 0.164.0 differs from 0.153.4. Verify the live handshake test completes or records the exact protocol delta.
- [ ] 2.7 Implement cancellation, timeout, process-tree cleanup, and non-completed run reporting for the fork; verify tests cover turn cancellation, timeout, and a crashed app-server.
- [ ] 2.8 Verify the fork vendors no Codex binary, installs nothing, signs in to nothing, and uses the user's installed CLI/config/auth; verify a static package test and `pnpm validate:repo` pass.

## 3. Rules engine: config, targets, triggers

- [ ] 3.1 Implement the Config schema for `targets`, `rules`, timeouts, and `failureStreak`, with defaults. Verify tests cover a minimal config, the shipped default rules, and a config with no rules.
- [ ] 3.2 Implement rule validation: unique kebab-case ids, known triggers/contracts/gates, existing targets, required phase for review, required isolation for patch, and no duplicate strict gate for the same digest scope. Verify tests cover each invalid shape and a valid config.
- [ ] 3.3 Implement target resolution against `ctx.subagents`: provider name, optional model/agent options, capabilities check, missing provider, and unsupported option. Verify tests cover a Codex target, a DSH in-process target, a missing provider, and an unsupported model option.
- [ ] 3.4 Implement the `manual`, `spec-ready`, and `implementation-complete` trigger evaluators, including the review-ready and complete-task conditions and archived/multi-change handling. Verify tests cover each positive/negative case.
- [ ] 3.5 Implement the `failure-streak` trigger and its per-turn state from `tools/result`, including reset on success and turn change through an observe-only `agent/pre-step` listener returning `next()`. Verify tests cover threshold, reset, disabled threshold, and failed-consultation tracking.
- [ ] 3.6 Verify the config/code boundary: a new rule on an existing trigger/contract validates without code; an unknown trigger/contract is rejected with a clear error. Verify tests cover both.

## 4. Contracts, records, and the gate

- [ ] 4.1 Implement the spec digest (all change files except `.openspec.yaml`, task checkbox normalization) and the worktree digest (status, binary diff, untracked bytes, `.dsh`/`.tmp` ignored, fixed git arguments). Verify tests cover stable/changed digests, checkbox-only edits, tracked/untracked changes, and a non-git failure.
- [ ] 4.2 Implement atomic `.dsh/delegation/<rule>/<phase>.json` records with rule, phase, digest, verdict, findings, target identity, and time; matching PASS/FINDINGS reuse, ERROR retry, stale/malformed record handling. Verify tests cover each branch and no credentials/machine paths in the record.
- [ ] 4.3 Implement the `review` contract: phase digest, P0/P1 prompt, one fenced JSON verdict, digest/severity validation, PASS only with zero findings, FINDINGS/ERROR records. Verify fake-target tests cover PASS, FINDINGS, malformed, stale, and target failure.
- [ ] 4.4 Implement the `answer` contract: read-only prompt, evidence/sources, bounded output, no gate record, and failure reporting. Verify fake-target tests cover research, blocker, and target failure.
- [ ] 4.5 Implement the `patch` contract: validate a write-capable target, create an isolated git worktree, run the target, return diff/changed files/test results, and never apply to the session worktree. Verify tests cover a produced patch, a read-only target rejection, a failed patch, and no auto-merge.
- [ ] 4.6 Implement the turn-stopping gate for strict/soft/none rules: matching PASS/ERROR requirement, stale-record rejection, text-claim rejection, soft steering once per streak, and no target run from the listener. Verify tests cover each state and a failing digest/read becoming an issue rather than a throw.
- [ ] 4.7 Implement the gate steer message with source kind `delegation-rules`, naming the rule, digest, record path, and exact delegate call; cover multiple changes, archived changes, nested cwd, and no OpenSpec root. Verify tests cover the steer text and allow/refuse decisions.
- [ ] 4.8 Verify the gate never starts a target run and never throws; verify a static test rejects target/subagent calls in the listener and tests cover unreadable change directories.

## 5. Tools, skill, default rules, and model-agnostic proof

- [ ] 5.1 Implement the `delegate` tool with a `rule` enum generated from the configured rules, required-input validation per contract, a description naming the manual tasks, and result rendering. Verify tests cover a manual delegation, an unknown rule, and a missing required input.
- [ ] 5.2 Implement `delegation_status` listing registered providers/capabilities, targets, rules, and missing-target diagnostics. Verify tests cover a complete config and a missing target.
- [ ] 5.3 Write the default rule assets/prompts for spec review, implementation review, blocker, research, and bug-fix: P0/P1 rubric, evidence, untrusted artifacts, read-only review/answer, worktree patch, and P0/P1-only residuals. Verify prompt tests assert each required section and the review verdict schema.
- [ ] 5.4 Write `assets/delegation-rules/SKILL.md` with the trigger/contract/gate model, rule authoring, default rules, manual delegation, failure/opt-out, cost, and security boundaries; register the skill provider with a matching catalog description. Verify tests cover the one candidate, frontmatter/description match, and body-on-demand.
- [ ] 5.5 Add the model-facing budget test: two tool descriptions plus the skill catalog description under 700 estimated tokens, the skill body under 20,000 UTF-8 bytes, and no `systemPrompt.section`/always-on contribution. Verify the test passes and fails on padded scratch copies, and state the measured sizes in docs.
- [ ] 5.6 Prove model-agnostic behavior with a non-Codex test: a fake DSH `spawn` target with a different model runs a review or answer rule and the same contract/gate applies. Verify the test fails if the engine references Codex.

## 6. Setup, documentation, and market

- [ ] 6.1 Configure the setup defaults for the rules plugin: the Codex targets (read-only/write) and the default rules; the fork row. Verify `pnpm gen` places the config in the setup patch and `pnpm validate:composition` mounts both rows once.
- [ ] 6.2 Write `docs/delegation-rules.md`: the trigger/contract/gate model, rule/target examples, default rules, a non-Codex target example, manual delegation, patch worktree/no auto-merge, ERROR/blocked handoff, opt-out, model-facing cost, security, and troubleshooting. Verify `pnpm lint`, links, and the documented measured sizes.
- [ ] 6.3 Write `docs/codex-subagent.md`: the installed-Codex prerequisite, PATH/`codexPath` discovery, `codex_subagent_status`, version validation, read-only/write providers, the app-server/0.164.0 note, the model/effort config, cost, and the MIT/upstream notice. Verify links and that no machine path or credential is committed.
- [ ] 6.4 Add the market metadata: `locale/en.json` cards for both packages naming the generic rules engine, the Codex target prerequisite, the row opt-out, and the non-Codex target possibility; use original icons. Verify `pnpm validate:repo` and the market mapping test accept both cards.
- [ ] 6.5 Update the docs indexes/README/combined tables as needed so both packages are discoverable and no stale `codex-senior`/`codex-tasks` naming remains. Verify `pnpm lint` and every intra-repo link.

## 7. Repository integration

- [ ] 7.1 Run `pnpm build`, then `git diff --exit-code` after committing the generated output; verify the committed `lib/**` matches a fresh build. Run `pnpm gen`/`pnpm gen:check`; verify the setup patch, setup manifest, and vendored tree are current with no unexpected files.
- [ ] 7.2 Run `pnpm check` (typecheck, lint, build, test) and `pnpm validate:repo`; fix every failure. Verify the new packages' tests run under the repository Vitest configuration.
- [ ] 7.3 Run `pnpm validate:composition` with the published DSH CLI or `DSH_CLI`; verify the composed dump contains exactly one `dsh-setup-delegation-rules` and one `dsh-setup-codex-subagent` row.
- [ ] 7.4 Verify no `dsh.json`, `install.ps1`, existing plugin, or generated setup selection changed beyond the two new packages, their defaults, and vendored copies.

## 8. Live acceptance in a throwaway profile

- [ ] 8.1 Create a throwaway `dev`/`ci` profile with the two bundles; put the installed `codex` 0.164.0 on PATH; verify auto-detect and `codex_subagent_status` report its path/version; run a manual `delegate` review or answer and record the result. Do not install into the live desktop profile from a shell hosted by the running Harness.
- [ ] 8.2 Set an explicit `codexPath`, verify it wins over PATH; test a `.cmd` and an `.exe`; remove the path/CLI and verify the missing-CLI error and the status snippet. Verify the profile patch is unchanged by the status tool.
- [ ] 8.3 Seed a test OpenSpec change with a deliberate P0 gap; run the spec-review rule, verify FINDINGS with evidence/fix, fix the spec, re-run to PASS, edit the spec and verify the stale re-review; tick a task and verify the spec pass remains valid.
- [ ] 8.4 Complete a test implementation; verify the implementation-review gate, pass it, then edit a tracked and an untracked file and verify the stale re-review.
- [ ] 8.5 Point a rule at a non-Codex DSH in-process target with another model; verify the same review/answer contract and gate apply. This is the model-agnostic acceptance.
- [ ] 8.6 Run the bug-fix patch rule against a write target; verify the worktree, diff, and test results are returned, the session worktree is unchanged, and no auto-merge occurs.
- [ ] 8.7 Simulate an unavailable target and verify the matching `ERROR` record, visible failure, and blocked handoff; verify a failed soft consultation does not trap the turn.
- [ ] 8.8 Verify disabling/removing the rules row stops the gate and removes the tools/skill, while records/worktrees/change artifacts remain; re-enable and verify re-evaluation.
- [ ] 8.9 Measure one review, one answer, and one patch run for latency/token cost; confirm the configured timeout/failure-streak defaults are workable and tune only Config values.

## 9. Release preparation

- [ ] 9.1 Run `pnpm release:prepare --version X.Y.Z`, then `pnpm gen` and `pnpm build`; verify the one version appears in the root, both packages, and the generated setup manifest, and `pnpm gen:check` exits 0. Do not tag or publish without the owner's release decision.

## Workflow follow-up

- Archive the change after implementation, sync the two delta specs into the main specs, and verify the archived result.
- After release, confirm the market lists both cards and the setup's composed patch contains both rows; monitor the first sessions for review latency, rule/target misconfiguration, and false-positive findings.
- If the app-server 0.164.0 protocol needs adapter changes, patch the fork's adapter and re-run task 8/7 before release; do not silently fall back to the bundled 0.153.4.
- On a future DSH support bump, rebase the fork and re-run its acceptance as part of that change.
- If the rules DSL needs a new trigger or contract, open a separate change for the code extension; do not hide it in config.
- If the owner later wants cryptographic anti-forgery of records, open a separate change for signed records; the current gate is a process-integrity check.
- The live Codex sign-in/config and the non-Codex target are the acceptance prerequisites: keep task 8 open until real runs succeed.
