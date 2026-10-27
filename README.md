# dsh-setup

[![validate](https://github.com/sergey-akhalkov/dsh-setup/actions/workflows/validate.yml/badge.svg)](https://github.com/sergey-akhalkov/dsh-setup/actions/workflows/validate.yml)
![DeepSeek Harness 0.2.1-rc.3](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1--rc.3-blue)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A portable, installable setup for [DeepSeek Harness](https://www.deepseek.com/en/harness/) (DSH):
nine plugin bundles for agent rules, skills, code navigation, desktop automation, and cross-model
delegation, aggregated into one setup bundle with owner defaults, plus a static plugin-market index
and a one-command installer that reproduces the setup on another machine.

Every plugin is also installable on its own; use either the full setup or individual plugins for a
given plugin, never both.

## Install or update

### Install individual plugins from Discover

The setup and every plugin are listed in the published market index:

```text
https://sergey-akhalkov.github.io/dsh-setup/index.json
```

Enable **Custom plugin markets** (this adds the Discover tab), open **Discover**, and add that URL as
an index source. The index pins every listed version to a reviewed commit; install either the full
setup or individual plugins for a given plugin, never both, because both mount the same row. See
[Manual install](docs/install.md#manual-install) for the full steps.

Installing the **dsh-setup** entry from Discover mounts the setup and its plugin rows, but it does
not enable the other shipped DSH bundles (Agent Teams, tool worktree, Ralph, session search,
terminal). Enable them in **Plugins**, or use the full-setup command below. See
[Shipped DSH bundles](#shipped-dsh-bundles).

### Install the full setup with PowerShell

Use this on Windows when you want the complete setup in one command. Run it from an ordinary
PowerShell window, not from a terminal hosted by DeepSeek Harness. Start DeepSeek Harness once and
quit it first so the `desktop` profile exists.

```powershell
irm https://raw.githubusercontent.com/sergey-akhalkov/dsh-setup/main/install.ps1 | iex
```

The installer prints its plan, closes DeepSeek Harness, backs up the profile manifest and patch,
enables the shipped DSH bundles, installs or updates `@dsh-setup/setup` from the newest release,
verifies the result, and starts the app again. **Rerun the same command to update**; when the newest
release is already installed, it changes nothing.

For `-DryRun`, a different profile, or a pinned version, download the script and run the file:

```powershell
$installer = Join-Path $env:TEMP 'dsh-setup-install.ps1'
Invoke-WebRequest https://raw.githubusercontent.com/sergey-akhalkov/dsh-setup/main/install.ps1 -OutFile $installer
& $installer -DryRun
```

All options, the manual install, and the update behavior are in [docs/install.md](docs/install.md).

## Dependencies

A missing optional runtime does not break startup: the affected adapter logs a failed connection, a
skill fails only when called, delegation reports the missing target, and everything else keeps
working. Install the runtimes for the plugins you want.

| Dependency                          | Needed for                                                         | Install                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| DeepSeek Harness Desktop 0.2.1-rc.3 | Running any plugin; the installer refuses an unsupported version   | [Download DeepSeek Harness](https://www.deepseek.com/en/harness/)                                                          |
| PowerShell 5.1+ (7 recommended)     | The one-command installer                                          | [Install PowerShell](https://learn.microsoft.com/powershell/scripting/install/installing-powershell)                       |
| Git                                 | The installer fetches the setup through a commit-pinned git spec   | [Download Git](https://git-scm.com/downloads)                                                                              |
| Node.js with npm                    | Installing the two global CLI prerequisites below                  | [Download Node.js](https://nodejs.org/en/download)                                                                         |
| `uv` (includes `uvx`)               | Serena MCP, and the Serena server every Codex delegation run needs | [Install uv](https://docs.astral.sh/uv/getting-started/installation/)                                                      |
| `@nuphus/nuphus-mcp`                | Nuphus MCP desktop and browser automation                          | `npm install -g @nuphus/nuphus-mcp`                                                                                        |
| `@fission-ai/openspec@1.15.0`       | The six OpenSpec skills                                            | `npm install -g @fission-ai/openspec@1.15.0`                                                                               |
| `rtk`                               | The RTK routing rule and skill                                     | [Install RTK](https://github.com/rtk-ai/rtk#installation)                                                                  |
| Codex CLI (bundled)                 | The Codex subagent and the default delegation target               | No separate install: the bundle ships `@openai/codex` 0.164.0; log in once with the command `codex_subagent_status` prints |

## What the setup installs

All nine plugin bundles are mounted and enabled by default, and the setup applies owner defaults: the
`deepseek-flash` model at high reasoning effort, the dark theme, detailed transcript and usage
display, and the `cordis` agent preset. A profile's own `cordis.patch.yml` still outranks these
defaults.

"Always-on" contributions are a system-prompt section paid on every model step; on-demand skills are
listed in the catalog and load only when invoked.

### Plugin bundles

| Plugin                                                                       | Enabled contribution                                                              | What it gives you                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@dsh-setup/plugin-ponytail`](packages/plugin-ponytail)                     | Always-on ruleset + `ponytail` skill                                              | Minimal-code discipline: the smallest complete change, no unrequested abstractions, a reply a busy person reads once. Vendored upstream prompt (MIT, ~0.7k tokens per step); `alwaysOn: false` keeps the skill and drops the section.                                     |
| [`@dsh-setup/plugin-working-principles`](packages/plugin-working-principles) | Always-on working contract + `working-principles`, `verify-change` skills         | Keeps scope with the user, demands evidence for claims, makes dissent concrete, and turns failures into recovery instead of retries; `verify-change` proves a fix by its original trigger. ~1.2k tokens per step.                                                         |
| [`@dsh-setup/plugin-rtk`](packages/plugin-rtk)                               | Always-on routing rule + `rtk` skill                                              | Routes bulky git, test, build, and search output through [RTK](https://github.com/rtk-ai/rtk), cutting shell-output tokens while keeping errors and exit codes; native commands remain the fallback. ~0.2k tokens per step; needs the rtk CLI.                            |
| [`@dsh-setup/plugin-serena`](packages/plugin-serena)                         | Serena MCP adapter + always-on code-surface rule + `serena-discipline` skill      | Symbol-level navigation and editing with exact callers instead of whole-file passes; the rule activates the session's project first, so the first symbol call succeeds instead of falling back to file reads. Needs `uvx`; ~0.4k tokens per step.                         |
| [`@dsh-setup/plugin-nuphus-mcp`](packages/plugin-nuphus-mcp)                 | Nuphus MCP adapter + `nuphus-discipline` skill                                    | Desktop and browser control for tasks that need the real UI: windows, keyboard and mouse, local OCR and vision, Chrome over CDP. Machine writes require explicit confirmation by default. Needs the `nuphus-mcp` binary.                                                  |
| [`@dsh-setup/plugin-openspec`](packages/plugin-openspec)                     | Six on-demand OpenSpec skills                                                     | Spec-driven changes in every session: propose, explore, apply, update, sync specs, archive. The skills ship here; specs live in each workspace's `openspec/`. Needs the `openspec` CLI.                                                                                   |
| [`@dsh-setup/plugin-rust`](packages/plugin-rust)                             | `rust` skill (on demand)                                                          | MSRV-correct standard-library use, the narrowest `cargo check`/`test`/`clippy` command, and diagnosis for slow builds, slow tests, and growing target directories. No per-step cost.                                                                                      |
| [`@dsh-setup/plugin-delegation-rules`](packages/plugin-delegation-rules)     | `delegate`, `task_progress`, `delegation_status` tools, turn-stopping gate, skill | Structured second-model reviews, research, and isolated worktree patches with digest-bound records; the strict gate stops a turn until a task is reviewed or a progress note explains the open work. Defaults target Codex; disabling the row removes the tools and gate. |
| [`@dsh-setup/plugin-codex-subagent`](packages/plugin-codex-subagent)         | Codex subagent provider with a pinned bundled CLI                                 | A second model for reviews, blockers, research, and bug-fix patches; runs `@openai/codex` 0.164.0, reuses your `~/.codex` login, and pins its Serena MCP setup. One login is required; `codex_subagent_status` reports the command and the resolved CLI.                  |

[`@dsh-setup/setup`](packages/setup) is the meta-bundle: one install mounts all nine plugins and
applies the owner defaults, and its publishable files are vendored so a git install needs no build
step.

### Shipped DSH bundles

The installer also enables the optional DSH bundles the setup expects; the setup bundle does not
duplicate their rows:

- **Agent Teams** (`@deepseek-ai/dsh-experimental-agent-team-profile`) — durable teammates, a shared
  task board, and isolated write scopes for parallel work.
- **Tool worktree** (`@deepseek-ai/dsh-experimental-tool-worktree`) — per-agent git worktrees, so
  separate agents write without touching the same checkout.
- **Ralph** (`@deepseek-ai/dsh-experimental-ralph-bundle`) — fresh-agent iteration rounds toward one
  immutable objective.
- **Custom plugin markets** (`@deepseek-ai/dsh-experimental-plugin-market-bundle`) — the **Discover**
  tab and external market-index sources.
- **Session search** (`@deepseek-ai/dsh-experimental-session-search`) — search across prior sessions.
- **Terminal** (`@deepseek-ai/dsh-experimental-terminal-bundle`) — persistent terminal sessions for
  REPL and interactive work.

## Development

Requires Node.js `>=24.18.0 <25` and the pinned pnpm `11.28.5` ([install
pnpm](https://pnpm.io/installation)).

```sh
pnpm install
pnpm check        # typecheck, lint, build, tests
pnpm validate     # full local gate, including generated-file and installer checks
pnpm dogfood      # Windows: verify install.ps1 against a copy of this machine's profile
```

Generated files are committed: the setup patch, `lib/` output, and `client.js` bundles are built
ahead of time so bundles install from git without an install-time build step. Run `pnpm gen` after
changing a composition fragment and `pnpm build` after changing TypeScript sources; CI rejects a
commit whose generated files do not match their sources.

## Documentation

- [Install, update, manual install](docs/install.md)
- [Plugin development](docs/plugins.md)
- [Setup composition and the generated bundle](docs/setup-composition.md)
- [Releases, Pages, and the market index](docs/releasing.md)
- [Delegation rules](docs/delegation-rules.md) and the [Codex subagent](docs/codex-subagent.md)
- Plugin notes: [Ponytail](docs/ponytail.md), [working principles](docs/principles.md),
  [RTK](docs/rtk.md), [Rust](docs/rust.md), [Serena](docs/serena.md), [OpenSpec](docs/openspec.md)
- Repository operating guide: [AGENTS.md](AGENTS.md)

## Security

Installing a bundle runs its code with the permissions of the Harness process. Market entries pin an
exact git commit so the reviewed source and the running code are the same revision. Third-party
prompts and skills are vendored with provenance locks (`ponytail.lock.json`, `openspec.lock.json`)
that offline tests verify. The installer closes DeepSeek Harness while it writes the profile, saves a
manifest backup, and changes only the bundle selection and installed packages — never the profile's
own patch. This repository contains no credentials, sessions, or machine-specific paths.

## License

[MIT](LICENSE), copyright (c) 2026 Sergey Akhalkov. It covers the original code and documentation in
this repository. Vendored third-party content keeps its upstream MIT license and attribution, with
the upstream license shipped beside the files: the Ponytail prompt in
`packages/plugin-ponytail/assets/ponytail/`, the OpenSpec skills in
`packages/plugin-openspec/assets/openspec/`, and the Codex subagent provider in
`packages/plugin-codex-subagent/`.
