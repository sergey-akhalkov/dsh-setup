# dsh-setup

[![validate](https://github.com/sergey-akhalkov/dsh-setup/actions/workflows/validate.yml/badge.svg)](https://github.com/sergey-akhalkov/dsh-setup/actions/workflows/validate.yml)
![DeepSeek Harness 0.2.1-rc.5](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1--rc.5-blue)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A portable setup for [DeepSeek Harness](https://www.deepseek.com/en/harness/) (DSH). Sixteen plugin
bundles add rules, skills, MCP access, second-model review, recovery guards, and memory to an agent
session; `@dsh-setup/setup` mounts all of them with working defaults, and one PowerShell command
reproduces the setup on another machine.

What changes in a session:

- The smallest complete change, with scope confirmed before it grows.
- A fix is proven by its original failure instead of asserted.
- Risky work comes back from a second model as a diff and a test report.
- A runaway loop or a stranded goal ends with a result or a named blocker.
- Context goes to the task: MCP tool schemas load on first use, bulky shell output is routed.
- The repository is remembered between sessions, locally.

Every plugin is also installable on its own; use either the full setup or the individual plugins for
a given plugin, never both, because both mount the same row.

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
verifies the result, provisions the local Hindsight runtime when `uv` and a DeepSeek key are
available, and starts the app again. **Rerun the same command to update**; when the newest release is
already installed, it changes nothing, and a configured Hindsight runtime is skipped without
prompting.

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

| Dependency                                                      | Needed for                                                              | Install                                                                                                                    |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| DeepSeek Harness Desktop 0.2.1-rc.5 (0.2.1-rc.3 also supported) | Running any plugin; the installer refuses an unsupported version        | [Download DeepSeek Harness](https://www.deepseek.com/en/harness/)                                                          |
| PowerShell 5.1+ (7 recommended)                                 | The one-command installer                                               | [Install PowerShell](https://learn.microsoft.com/powershell/scripting/install/installing-powershell)                       |
| Git                                                             | The installer fetches the setup through a commit-pinned git spec        | [Download Git](https://git-scm.com/downloads)                                                                              |
| Node.js with npm                                                | Installing the two global CLI prerequisites below                       | [Download Node.js](https://nodejs.org/en/download)                                                                         |
| `uv` (includes `uvx`)                                           | Serena MCP, every Codex delegation run, and the local Hindsight runtime | [Install uv](https://docs.astral.sh/uv/getting-started/installation/)                                                      |
| `@nuphus/nuphus-mcp`                                            | Nuphus MCP desktop and browser automation                               | `npm install -g @nuphus/nuphus-mcp`                                                                                        |
| `@fission-ai/openspec@1.15.0`                                   | The six OpenSpec skills                                                 | `npm install -g @fission-ai/openspec@1.15.0`                                                                               |
| `rtk`                                                           | The RTK routing rule and skill                                          | [Install RTK](https://github.com/rtk-ai/rtk#installation)                                                                  |
| Codex CLI (bundled)                                             | The Codex subagent and the default delegation target                    | No separate install: the bundle ships `@openai/codex` 0.164.0; log in once with the command `codex_subagent_status` prints |

## What the setup installs

All sixteen plugin bundles are mounted and enabled by default, and the setup applies owner defaults:
the `deepseek-flash` model at max reasoning effort, the dark theme, detailed transcript and usage
display, and the `cordis` agent preset. A profile's own `cordis.patch.yml` still outranks these
defaults.

"Always-on" contributions are a system-prompt section paid on every model step; on-demand skills are
listed in the catalog and load only when invoked.

### Plugin bundles

| Plugin                                                                       | Enabled contribution                                                                                                    | What it gives you                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@dsh-setup/plugin-ponytail`](packages/plugin-ponytail)                     | Always-on ruleset + `ponytail` skill                                                                                    | Minimal-code discipline: the smallest complete change, no unrequested abstractions, a reply a busy person reads once. Vendored upstream prompt (MIT, ~0.7k tokens per step); `alwaysOn: false` keeps the skill and drops the section.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [`@dsh-setup/plugin-working-principles`](packages/plugin-working-principles) | Always-on working contract + `working-principles`, `verify-change`, `instruction-budget`, and `interface-design` skills | Keeps scope with the user, demands evidence for claims, makes dissent concrete, and turns failures into recovery instead of retries; `verify-change` proves a fix by its original trigger; `interface-design` applies the first-time interface test across UI, CLI, API, and agent-facing definitions. ~1.5k tokens per step.                                                                                                                                                                                                                                                                                                                                                                                                        |
| [`@dsh-setup/plugin-rtk`](packages/plugin-rtk)                               | Always-on routing rule + `rtk` skill                                                                                    | Routes bulky git, test, build, and search output through [RTK](https://github.com/rtk-ai/rtk), cutting shell-output tokens while keeping errors and exit codes; native commands remain the fallback. ~0.2k tokens per step; needs the rtk CLI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [`@dsh-setup/plugin-serena`](packages/plugin-serena)                         | Always-on large-file/cross-file refactor trigger + `serena-discipline` skill                                            | Symbol-level navigation and editing with exact callers instead of whole-file passes, limited to large-file and cross-file refactor work; ordinary reads and text stay on `grep`/`glob`/`read`/`edit`. The setup configures the `serena` lazy server, so reach it with `mcp_tools`/`mcp_call`; no static adapter row is mounted. Needs `uvx`; ~0.2k tokens per step.                                                                                                                                                                                                                                                                                                                                                                  |
| [`@dsh-setup/plugin-nuphus-mcp`](packages/plugin-nuphus-mcp)                 | Nuphus MCP lazy server guidance + `nuphus-discipline` skill                                                             | Desktop and browser control for tasks that need the real UI: windows, keyboard and mouse, local OCR and vision, Chrome over CDP. The setup configures the `nuphus-mcp` lazy server: reach it with `mcp_tools`/`mcp_call`; no static adapter row is mounted. Machine writes require explicit confirmation by default. Needs the `nuphus-mcp` binary.                                                                                                                                                                                                                                                                                                                                                                                  |
| [`@dsh-setup/plugin-mcp-lazy`](packages/plugin-mcp-lazy)                     | `mcp_tools` and `mcp_call` proxy tools over dormant stdio MCP servers                                                   | Keeps configured stdio servers from paying their tool-schema cost in every request: a server starts on its first `mcp_tools`/`mcp_call`, is reused for the session, and is terminated on unload. The model-facing tool set stays at exactly two tools. The setup configures `nuphus-mcp` and `serena` as its lazy servers and mounts no static adapter row. Text results only, stdio only; a server must not also be mounted as a static adapter row (a call fails with a one-home error if it is). See [lazy-mcp](docs/lazy-mcp.md).                                                                                                                                                                                                |
| [`@dsh-setup/plugin-openspec`](packages/plugin-openspec)                     | Six on-demand OpenSpec skills                                                                                           | Spec-driven changes in every session: propose, explore, apply, update, sync specs, archive. The skills ship here; specs live in each workspace's `openspec/`. Needs the `openspec` CLI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| [`@dsh-setup/plugin-rust`](packages/plugin-rust)                             | `rust` skill (on demand)                                                                                                | MSRV-correct standard-library use, the narrowest `cargo check`/`test`/`clippy` command, and diagnosis for slow builds, slow tests, and growing target directories. No per-step cost.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [`@dsh-setup/plugin-answer-page`](packages/plugin-answer-page)               | `answer-me-with-html` skill (on demand)                                                                                 | Turns a complex answer into one self-contained HTML page rendered offline inside the workspace: the model writes a compact Markdown draft and the bundled answer-me-with-html 0.5.10 CLI (MIT, by QingYunA) owns layout, diagrams, and styling. Renders only on request or for a genuinely diagram-shaped explanation; the page stays under `.tmp/answers/` in the workspace and is presented as a file. No per-step cost. See [answer-pages](docs/answer-pages.md).                                                                                                                                                                                                                                                                 |
| [`@dsh-setup/plugin-delegation-rules`](packages/plugin-delegation-rules)     | `delegate`, `task_progress`, `delegation_status` tools, turn-stopping gate, skill                                       | Structured second-model reviews, research, and isolated worktree patches with digest-bound records; the strict gate stops a turn until a task is reviewed or a progress note explains the open work. Defaults target Codex; disabling the row removes the tools and gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [`@dsh-setup/plugin-loop-guard`](packages/plugin-loop-guard)                 | Host stream guard (no per-step prompt cost)                                                                             | Cuts repeated streamed reasoning early, steers a simple recovery notice into the next step, and escalates through bounded turn resets to a clear stop; enabled by default and subagents excluded. See [loop-guard](docs/loop-guard.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| [`@dsh-setup/plugin-goal-continuity`](packages/plugin-goal-continuity)       | Host goal supervisor + block review + `work_checkpoint` pause gate (no always-on prompt section)                        | Re-arms an active goal after recoverable harness stops: resumes a loop-guard reset, prevents the driver's pause, extends the round cap within a bounded budget, and blocks with a visible `continuity-stopped` reason on real stops. Every proposed `blocked` update is reviewed by a read-only `goal-reviewer` preset subagent before it takes effect: a denial continues with the next action, a verified blocker names the exact user-only action, and verdicts/grants are recorded locally; the reviewer preset stays hidden from the mode roster. See [goal-continuity](docs/goal-continuity.md). Restart resume is off by default and `resumeAfterUserStop` defaults to `non-goal`; disabling the row restores stock behavior. |
| [`@dsh-setup/plugin-hindsight`](packages/plugin-hindsight)                   | Native Hindsight memory + one-click local bootstrap                                                                     | Reuses the official native DSH plugin for automatic recall, retention, knowledge pages, and `hindsight_*` tools; defaults to a local `hindsight-embed` daemon at `127.0.0.1:8888` and autostarts it when unhealthy. The one-command installer provisions the runtime after the profile phase; `setup-hindsight.ps1` runs only that phase. Disable the row or set `autostart: false` to opt out. See [Hindsight](docs/hindsight.md).                                                                                                                                                                                                                                                                                                  |
| [`@dsh-setup/plugin-codex-subagent`](packages/plugin-codex-subagent)         | Codex subagent provider with a pinned bundled CLI                                                                       | A second model for reviews, blockers, research, and bug-fix patches; runs `@openai/codex` 0.164.0, reuses your `~/.codex` login, and pins its Serena MCP setup. One login is required; `codex_subagent_status` reports the command and the resolved CLI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| [`@dsh-setup/plugin-admin-indicator`](packages/plugin-admin-indicator)       | Desktop administrator label + shortcut                                                                                  | Shows whether the Desktop app is elevated with the visible **Standard User**/**Administrator** badge next to the composer permission control; the menu creates an administrator desktop shortcut and shows a native success toast. The restart action is behind the default-off `restart` flag pending live UAC verification.                                                                                                                                                                                                                                                                                                                                                                                                        |
| [`@dsh-setup/plugin-observability`](packages/plugin-observability)           | Observability dashboard: plugin health and signal counts derived from session logs (no second log)                      | Answers whether a rule actually fired and a plugin is still working: a health verdict and KPI strip, an activity/error chart, plugin health cards grouped by attention with status words (active, error, not loaded, silent), tool distribution, and details on demand. The shipped per-plugin signal map covers every plugin; guidance rows name prompt-only plugins, and the blind spots are stated rather than hidden. Reads the session logs on demand and keeps nothing. See [plugins](docs/plugins.md#observability-view).                                                                                                                                                                                                     |
| [`@dsh-setup/plugin-verification-gate`](packages/plugin-verification-gate)   | Host turn-close gate (no per-step prompt cost)                                                                          | Refuses to close a code-changing turn until one configured check command has succeeded after the last `edit`/`write`; inert with no `commands`, capped after `maxBlocks` (default 8) consecutive refusals, and only the configured command (optionally prefixed by one `rtk ` token) satisfies it. See [verification-gate](docs/verification-gate.md).                                                                                                                                                                                                                                                                                                                                                                               |

[`@dsh-setup/setup`](packages/setup) is the meta-bundle: one install mounts all sixteen plugins and
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
  [RTK](docs/rtk.md), [Rust](docs/rust.md), [Serena](docs/serena.md), [OpenSpec](docs/openspec.md),
  [Loop guard](docs/loop-guard.md)
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
