# Proposal

## Why

The delegation stack should work out of the box with the latest Codex and Serena. Today the
`codex-subagent` fork requires a separately installed CLI and the delegation targets cannot select a
model or reasoning effort. The owner wants the setup to install the latest Codex binary and a
Serena-configured app-server, so a fresh profile needs only a Codex login, and wants per-target
selection such as Astra at `xhigh`.

## What Changes

- Add the current latest stable `@openai/codex` npm release (`0.164.0`) as a runtime dependency of the
  fork. pnpm installs the platform binary into the profile; the fork resolves its own bundled binary,
  keeps `codexPath` as an override, and falls back to `PATH`. The binary is not committed to git.
- Pass the Serena MCP server configuration through Codex `-c mcp_servers.serena...` overrides to the
  bundled `app-server --stdio`. Use the existing `~/.codex` auth and config; do not rewrite the user's
  config. The user logs in once with the bundled CLI; `codex_subagent_status` reports the login
  command, resolved path, version, source, and config.
- Add `model` and `reasoningEffort` to delegation targets. The engine passes them through the DSH
  subagent start request; the Codex provider maps them to the app-server thread and config overrides.
  Validate requested options against provider capabilities and document the Astra/`xhigh` example.
- Update the fork package, manifest, status, tests, README/NOTICE, setup composition, docs, and market
  card. **BREAKING** the previous "installed CLI only / no bundled Codex" behavior is replaced;
  `PATH` remains a fallback and `codexPath` still wins.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `codex-subagent`: bundled latest CLI resolution, `-c` Serena configuration, existing `~/.codex`
  auth/login, and the status/setup contract; the "no bundled Codex" requirement is removed.
- `delegation-rules`: explicit `model`/`reasoningEffort` target options, provider pass-through, and
  the acceptance for a Codex target such as Astra `xhigh`.

## Impact

- `packages/plugin-codex-subagent`: package dependency and lockfile, binary resolver, app-server
  spawn args, status, tests, README/NOTICE.
- `packages/plugin-delegation-rules`: target config schema, target resolution, tests, docs, fragment.
- `packages/setup`: generated manifest/vendor tree and installed dependency closure (the Codex binary
  is a profile dependency, not a committed file).
- `pnpm-lock.yaml`, CI install time/size, `docs/codex-subagent.md`, `docs/delegation-rules.md`.
- The user's `~/.codex` auth is read; no credential or machine path is written to tracked files.
