# Tasks

## 1. Provider code and tests (lane 1, owns `packages/plugin-codex-subagent/lib/**`, `packages/plugin-codex-subagent/test/**`)

- [x] 1.1 Remove the Serena integration from the vendored provider: the `SERENA_*` constants, `serenaArgsFor`, `serenaConfigContent`, `createSerenaHome`/`removeSerenaHome`, the `-c mcp_servers.serena...` and disabled-tool overrides, the `SERENA_HOME` child env and home lifecycle, the `serenaFailure` diagnostic path, and the status `serena` field/render line; update `codexAppServerArgs(cwd)` and the declarations/exports. Verify `rg -i serena packages/plugin-codex-subagent/lib` returns no match and `pnpm typecheck` passes.
- [x] 1.2 Update the package tests: delete the Serena suites, assert the app-server argv contains no `mcp_servers.*` override and no `SERENA_HOME`, assert the write instance is confined to the Codex sandbox for Codex-tool edits, update the status expectation (no `serena` field), and rebase the version pins on `0.169.0`; keep the discovery, sandbox, effort, thread-reuse, ComSpec, cancellation, and protocol-mismatch tests. Verify `pnpm exec vitest run packages/plugin-codex-subagent/test` passes.
- [x] 1.3 Register the `codex_subagent` tool: `defineTool` with `prompt`, `description`, optional `name` and `cwd`; `execute` requires `exec.agent`, starts a parent-delivered activation on `codex-subagent` (label = description, name, text prompt), and returns `{ kind: 'activation', name }`. Verify a unit test starts the activation with `delivery: 'parent'`, returns the child name, and a tool call without a calling agent fails without starting anything.

## 2. Package metadata and documentation (lane 2, owns `packages/plugin-codex-subagent/{package.json,NOTICE,README.md,locale/en.json}`, `docs/codex-subagent.md`, `README.md`)

- [x] 2.1 Bump `@openai/codex` to `0.169.0` in the package dependency and update `NOTICE`, `locale/en.json`, the package README, `docs/codex-subagent.md`, and the root `README.md` version/row text. Verify `rtk git grep -n "0\.164\.0" -- packages/plugin-codex-subagent docs README.md` returns only historical/changelog lines, and the touched docs name `0.169.0`.
- [x] 2.2 Remove the Serena prerequisite and every "Serena MCP configuration" section from the package README and `docs/codex-subagent.md`; state that the Codex child uses the user's `~/.codex` configuration (including any MCP servers the user configured there), and that those servers run with their own approvals outside the Codex sandbox, so the worktree-confinement guarantee covers only Codex-sandboxed operations. Verify no documented command or path was orphaned and the docs contain no claim that the provider configures or constrains Serena.
- [x] 2.3 Update the app-server compatibility section to state the adapter is verified against `0.169.0`, and keep the login, cost, provider-name, and MIT-attribution text accurate. Verify every relative link in the touched docs resolves.
- [x] 2.4 Document `codex_subagent` in the package README and `docs/codex-subagent.md`: parameters, the external-leaf entry (not openable, no token/duration, no follow-up), the result arriving as a settlement notice, the read-only provider, and that `delegate` runs stay outside the subagent list. Verify the documented name/parameters match the registered schema and the docs state the boundary.

## 3. Serial integration (serial, owns `pnpm-lock.yaml`, `packages/setup/**`, the full repository gate, and the live acceptance)

- [x] 3.1 Run `pnpm install` and verify `pnpm-lock.yaml` pins `@openai/codex@0.169.0` and the platform package resolves from the workspace.
- [x] 3.2 Run `pnpm gen` and commit the regenerated `packages/setup` manifest, patch, and vendored tree. Verify `pnpm gen:check` passes.
- [x] 3.3 Run `pnpm build && git diff --exit-code` and `pnpm check`, `pnpm validate:repo`, `pnpm validate:composition`, `pnpm validate:installer`. Verify every command exits 0.
- [x] 3.4 Run the live acceptance with the owner's existing `~/.codex` login: `codex_subagent_status` reports the `0.169.0` bundled binary and login command; one authenticated delegation completes (`initialize`/`initialized`, `thread/start`, `turn/start`, final answer, `turn/completed`); a signed-out run still reports the login next action. Record the observed result in the change's review evidence.
- [ ] 3.5 In the installed profile, call `codex_subagent` once and verify the delegating Session's subagent list shows the run as an external entry with the task description and child name, and the answer arrives as a settlement notice.
- [x] 3.6 Re-run `openspec validate simplify-codex-subagent --strict` after the edits and verify it exits 0.

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied (`pnpm reviews:check --change simplify-codex-subagent`).
- Sync the delta spec into `openspec/specs/codex-subagent/spec.md` on archive.
