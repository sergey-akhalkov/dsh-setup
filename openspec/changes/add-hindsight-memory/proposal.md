# Proposal

## Why

Every DeepSeek Harness session starts without the project context accumulated in earlier sessions. Hindsight provides local, per-repository long-term memory, and its official `@vectorize-io/hindsight-coding-agents` package already ships a native DSH entry point that performs recall, retain, knowledge-page maintenance, and native `hindsight_*` tools. The setup does not mount it yet, so every machine must be wired by hand and the portable setup misses a capability its owner uses daily.

The owner runs Hindsight locally on every PC (`127.0.0.1:8888`) with a DeepSeek API key for extraction, and wants the agent to provision that local server rather than do it by hand. The integration must therefore default to the local server, never to Hindsight Cloud, and must keep credentials out of the repository.

## What Changes

- Add `@dsh-setup/plugin-hindsight`, a thin setup-bundle plugin that mounts the official native DSH entry (`@vectorize-io/hindsight-coding-agents/dsh`) and supplies machine-independent connection defaults to it.
- Pin `@vectorize-io/hindsight-coding-agents` to the exact release `0.8.2`; the setup manifest hoists it as a registry-installed runtime dependency instead of vendoring its 16.7 MB package tree.
- Ship the row enabled by default with `serverMode: self-hosted` and `apiUrl: http://127.0.0.1:8888`. The wrapper writes those values as `HINDSIGHT_SERVER_MODE`/`HINDSIGHT_API_URL` fallbacks only when they are unset, so `~/.hindsight/coding-agent.json` and explicit environment variables keep precedence.
- Reuse everything upstream: automatic git seeding, per-prompt recall and injection, session write-back, knowledge pages, the `hindsight_*` tool set, and the companion skill installed on the first session. Add no parallel memory logic, MCP adapter, or always-on prompt rule.
- Provision the local Hindsight server on each owner machine as part of this change: install the official `hindsight-embed` CLI, configure its default profile for DeepSeek on `127.0.0.1:8888`, take the key from an untracked machine-local source, start the daemon through its own lifecycle, register an idempotent logon start, and write a machine-local `~/.hindsight/coding-agent.json` pointing at `http://127.0.0.1:8888`. Provisioning preserves existing data and configuration.
- Add a default-on `autostart` setting to the Hindsight row: at Host load, when the effective connection is loopback self-hosted and the local daemon is unhealthy, the wrapper starts the installed `hindsight-embed` daemon detached and fails open. It does not install the tool; the one-click bootstrap and logon task remain the install/reboot path. `autostart: false` disables the attempt.
- Ship a standalone `setup-hindsight.ps1` one-click bootstrap for other Windows PCs: it installs the pinned `hindsight-embed` tool, accepts the DeepSeek key from an environment variable, a machine-local file, or a secure prompt, configures the local profile and TLS trust, starts the daemon, registers the logon start, writes the machine-local coding-agent configuration, and verifies a retain/recall round-trip. It is idempotent and never puts the key in the repository.
- Document the local `hindsight-embed` daemon (default profile), its DeepSeek provider and key handling, the default endpoint, the config-file override, the opt-out, the token and privacy cost, the logon start, the one-line bootstrap, and the fact that the official `install dsh` home-patch route is an alternative that must not be combined with this bundle row.
- Add the exact-pinned registry runtime dependency allowance to the `portable-setup` capability, since the setup now formally relies on that existing mechanism for third-party code.
- Release the set at a new minor version and verify a live retain/recall round-trip on a machine with the local server before calling the integration done.

**BREAKING**: none. A profile without the local server keeps booting; memory calls fail open and the row can be disabled.

## Capabilities

### New Capabilities

- `hindsight-memory`: native Hindsight long-term memory as a shipped setup plugin, including the one-click `hindsight-embed` bootstrap, default-on local daemon autostart, the local-only connection default, upstream reuse, config precedence, failure behavior, opt-out, and live verification.

### Modified Capabilities

- `portable-setup`: adds the exact-pinned third-party registry runtime dependency allowance and its installation/verification contract.

## Impact

- New package `packages/plugin-hindsight` (manifest, fragment, Host wrapper with the default-on autostart decision, type shim, test, locale, icon, TypeScript project).
- `scripts/lib/generate.ts`: treat the Hindsight package as registry-installed rather than vendored; generated setup patch, manifest, and vendored tree change.
- Root `package.json` and `pnpm-lock.yaml`: exact dev dependency so the linked checkout resolves the upstream package at runtime.
- `packages/setup` generated manifest now declares the Hindsight package as a regular dependency; profile installation fetches it from npm.
- Documentation: new Hindsight page, install-guide section, root README plugin row, market locale/icon.
- No `dsh.json`, `install.ps1`, installer-option, or supported-DSH-version change: the installer installs the same setup bundle, and the profile install resolves the new dependency.
- The `hindsight-embed` user-level tool and its default profile, the embedded pg0 data directory, its daemon log/lock files, an idempotent logon start, and a root `setup-hindsight.ps1` one-click bootstrap; the extraction key stays in an untracked machine-local profile file and never enters the repository or generated setup files.
- Release `0.11.0` (proposed): version bump, build, full validation, dogfood, tag, market publication, and agent live acceptance with the local `hindsight-embed` daemon.
- Out of scope: Cloud mode, cross-PC memory sync, MCP-based memory, a custom memory UI, Memory Defense configuration, and automatic server installation from `install.ps1` or the setup bundle. The agent provisions and verifies the server as an explicit machine-local step during apply; the installer remains unchanged.
