# Tasks

## 1. Bundled Codex dependency and fork metadata

- [x] 1.1 Add `@openai/codex@0.164.0` to `packages/plugin-codex-subagent` `dependencies`; run `pnpm install`; verify the platform package and binary resolve from the workspace and update `pnpm-lock.yaml`.
- [x] 1.2 Update the fork `README.md`/`NOTICE` with the bundled version, the resolution order (`codexPath` > bundled > `PATH`), the Serena `-c` patch, and the no-committed-binary rule; verify no binary is tracked.

## 2. Bundled binary resolution and status

- [x] 2.1 Implement bundled-package resolution after `codexPath` and before `PATH`; verify unit tests cover the `config`, `bundled`, and `PATH` sources, the bundled version, the PATH fallback only when no bundled binary is discovered, and a selected invalid executable failing without a PATH fallback.
- [x] 2.2 Keep Windows `.cmd` through `ComSpec` and spawn the bundled `.exe` directly; verify the argv tests and the live `--version`.
- [x] 2.3 Extend `codex_subagent_status` with the bundled version, Serena config summary, and login command; verify it never writes the profile or `~/.codex`.

## 3. Serena, login, and app-server

- [x] 3.1 Add fixed `-c mcp_servers.serena.command/args/cwd/enabled/required` overrides (including an explicit `--project=<run working directory>` and a pinned `cwd` = that same run working directory) to the app-server spawn, a precreated per-run `SERENA_HOME` with empty project trust and a run-scoped `project_serena_folder_location` whose resolved project data directory is also precreated for the exact cwd, and the mutating Serena tools plus `activate_project` disabled for both instances; verify the argv/env tests, an inherited `enabled=false` fixture, an inherited per-tool `approval_mode="approve"` and trusted activation-hook fixture, an inherited Serena cwd pointing at the session checkout, that a project-dependent symbol read succeeds for both providers (read-only and the write worktree), that the session checkout is unchanged even with a pre-existing `.serena` project file set (incomplete `project.yml`, missing `.gitignore`) and even when the cwd is nested beneath an ancestor project with an existing `.serena`, a write instance that cannot touch the session checkout, that a missing Serena server fails the run, and that `~/.codex/config.toml` and the user's Serena config are byte-identical after a run.
- [x] 3.2 Verify the bundled `0.164.0` app-server handshake and a completed authenticated turn using the existing `~/.codex` login; verify a 401 is reported with the login next action.
- [x] 3.3 Update the fork tests and docs for the Serena config and login; verify the docs' login command and the `uvx`/`serena-agent` prerequisite.

## 4. Target model and reasoning effort

- [x] 4.1 Extend the delegation target schema with `model` and `reasoningEffort` alongside `agentOptions`; verify config validation and the fragment/docs example (Astra/`xhigh`).
- [x] 4.2 Pass target options through the subagent start request and map them in the Codex provider to the app-server thread/config; verify unit tests for pass-through, defaults, and unsupported options.
- [x] 4.3 Document the per-target model/effort example (Codex and non-Codex) and update the budget/asset tests; verify `pnpm exec vitest run packages/plugin-delegation-rules/test`.

## 5. Setup, build, and packaging

- [x] 5.1 Run `pnpm build`, `pnpm gen`, `pnpm gen:check`, and `pnpm validate:repo`; verify the setup manifest/vendor tree carries the dependency declaration, not a binary.
- [x] 5.2 Run `pnpm validate:composition`, `pnpm validate:installer`, and `pnpm dogfood`; verify the setup installs the Codex dependency and the new rows compose.
- [x] 5.3 Update the setup/docs/market card and the AGENTS spec notes; verify the generated files and documentation links.
- [x] 5.4 Bump the set version with `pnpm release:prepare --version 0.4.0`, rebuild, and verify the generated/version diff is clean.

## 6. Live acceptance

- [ ] 6.1 Install the setup into the throwaway `headless`/`ci` profile and run a live turn that calls `codex_subagent_status`, `delegation_status`, and `delegate`; verify the bundled version and a completed Codex answer.
- [ ] 6.2 Exercise a target with `model`/`reasoningEffort` (Astra/`xhigh` or the available slug) and a non-Codex target; verify the same review/answer/gate contract.
- [ ] 6.3 Exercise the gate/patch/task-review path on a scratch OpenSpec change and verify the provider leaves `~/.codex/config.toml` and profile patches unchanged; allow Codex-managed auth token state to change.
- [ ] 6.4 Record the exact commands/results and the remaining platform/runtime limits in the docs.

## Workflow follow-up

- Archive the change after the live acceptance and review.
- Push all changes to `main`.
