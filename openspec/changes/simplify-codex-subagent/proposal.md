# Proposal

## Why

Every Codex delegation currently starts a required Serena MCP server with a
throwaway `SERENA_HOME`, a fixed disabled-tool list, and `uvx`/`serena-agent` as a
machine prerequisite. The owner wants Serena only as the session's lazy MCP server,
not as a dependency of every Codex review or patch: the integration adds startup
latency, a second out-of-sandbox safety surface, and a large block of configuration,
tests, and documentation for a capability the reviews do not need.

Separately, the bundled `@openai/codex` dependency is pinned at `0.164.0`, while the
latest stable npm release is `0.169.0`. The fork should track a verified stable CLI.

## What Changes

- Remove the fixed `-c mcp_servers.serena...` app-server overrides, the per-run
  `SERENA_HOME` and its config/home lifecycle, the disabled-tool list, and the
  `serenaFailure` diagnostic from the Codex provider. The Codex child uses the
  user's `~/.codex` configuration as-is.
- Remove the `serena` field and render line from `codex_subagent_status`; keep its
  other fields.
- Bump `@openai/codex` `0.164.0` -> `0.169.0` in the package dependency,
  `pnpm-lock.yaml`, `NOTICE`, README, docs, status/tests, the spec, and the
  generated `packages/setup` tree; re-run the live app-server acceptance.
- Keep all other behavior: bundled/`codexPath`/PATH discovery and `--version`
  validation, read-only and workspace-write providers, target
  `model`/`reasoningEffort`, review-thread reuse, Windows `ComSpec` handling, and
  login diagnostics.
- Add a `codex_subagent` tool that starts a parent-delivered activation on the
  read-only `codex-subagent` provider: the run is cataloged as an external child in
  the delegating Session's subagent list, and its answer arrives as a settlement
  notice. `delegate` runs stay caller-delivered and remain outside that list.
- No change to the delegation engine, its targets/rules, the lazy `serena` MCP
  entry, or the Serena guidance bundle.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `codex-subagent`: the three Serena requirements are removed; the status, app-server
  execution, bundled-version, setup/delivery, and maintenance requirements are
  updated to the no-Serena provider and the `0.169.0` pin, and a new requirement adds
  the visible `codex_subagent` tool.

## Impact

- `packages/plugin-codex-subagent/lib/**` (vendored fork code) and its typed
  declarations; the new `codex_subagent` tool adds one tool schema to every request.
- `packages/plugin-codex-subagent/{package.json,NOTICE,README.md,locale/en.json}`.
- `packages/plugin-codex-subagent/test/codex-subagent.test.ts`.
- `docs/codex-subagent.md`, root `README.md`.
- `pnpm-lock.yaml`; generated `packages/setup/package.json`,
  `packages/setup/cordis.patch.yml`, and the vendored setup tree.
- `openspec/specs/codex-subagent/spec.md` delta.
- Runtime: Codex delegations no longer require `uvx`/`serena-agent`; the provider
  binary moves to the `0.169.0` platform package.
