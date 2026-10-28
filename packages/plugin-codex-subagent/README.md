# @dsh-setup/plugin-codex-subagent

A DeepSeek Harness Host bundle that adds a Codex subagent target running a
**bundled, pinned Codex CLI**: `@openai/codex` `0.164.0`. It is an
MIT-attributed fork of the official `@deepseek-ai/dsh-subagent-codex`
0.2.1-rc.3 provider; the difference is bundled/installed binary resolution,
Serena MCP configuration, target options, and provider/status wiring, not the
Codex app-server protocol. The repository commits no Codex binary.

## Prerequisite: log in to the bundled Codex once

The first install fetches `@openai/codex` and its platform-specific optional
dependency (the `codex`/`codex.exe` binary) through the profile's package
manager. Then run the bundled CLI once to sign in:

```sh
<resolved codex executable> login
```

`codex_subagent_status` prints the exact command for the resolved CLI. The
login writes the usual `~/.codex/auth.json`; the fork does not sign in or copy
credentials, and it makes no direct writes to `~/.codex` — `config.toml` stays
byte-identical, though Codex may refresh its own auth tokens during a run. A
not-logged-in run is reported as an authentication failure with that login
command as the next action.

The Serena MCP tools require `uvx` and `serena-agent==1.7.0` on the machine.
Serena is a required MCP server for every run, so a missing runtime fails the
run with that next action instead of silently dropping the tools.

## Discovery

For every run (and for the status tool) the fork resolves the CLI in this order:

1. `codexPath` from the plugin row config — an absolute path, a relative path, or
   a command name.
2. The pinned bundled `@openai/codex` platform binary from the installed
   dependency (`vendor/<target-triple>/bin/codex`).
3. `codex` on `PATH` (Windows `PATHEXT` candidates, `.exe`/`.cmd`/`.bat`).

The resolved executable is validated with `codex --version` before any app-server
starts. `PATH` is tried only when `codexPath` is omitted and no bundled platform
binary is discovered; a discovered but invalid executable is terminal and is not
replaced by another source. Discovery and validation failures report the source,
path, and next actions. Windows `.cmd`/`.bat` shims are started through `ComSpec`
with every argument as its own argv entry; `.exe` files, including the bundled
one, start directly. The delegation prompt is never interpolated into a command
line: it reaches the app-server over stdin.

## Serena MCP configuration

Every app-server starts with fixed Codex `-c` overrides that make the Serena MCP
server available:

```text
-c mcp_servers.serena.command=uvx
-c mcp_servers.serena.args=["--from","serena-agent==1.7.0","serena","start-mcp-server","--context=vscode","--enable-web-dashboard=false","--enable-gui-log-window=false","--project","<run working directory>"]
-c mcp_servers.serena.enabled=true
-c mcp_servers.serena.required=true
-c mcp_servers.serena.cwd=<run working directory>
-c mcp_servers.serena.env.SERENA_HOME=<throwaway Serena home>
-c mcp_servers.serena.startup_timeout_sec=120
-c mcp_servers.serena.tool_timeout_sec=120
```

`--project=<run working directory>` makes the run's exact working directory the
active Serena project. It replaces `--project-from-cwd`, which resolves the
nearest ancestor with `.git`/`.serena` and would activate (and possibly rewrite)
an ancestor checkout for a nested run. The server `cwd` is pinned to the same
exact directory so an inherited cwd cannot win. Every run gets a throwaway
`SERENA_HOME` (pinned via the per-server `env`, because Codex starts MCP children
with its own environment) whose minimal `serena_config.yml` sets `projects: []`,
empty `trusted_project_path_patterns`, and a `project_serena_folder_location`
under that home. The resolved `projects/<basename(cwd)>` directory is created
before spawn, so Serena uses the run-scoped data folder instead of falling back
to and rewriting a checkout
`.serena/project.yml`; the user's `~/.serena` config is not read or rewritten,
and an inherited trusted activation hook cannot run. The GUI log window is
disabled, and the home is removed on dispose.

They mirror the setup's lazy `serena` entry, contain no credentials, and
never rewrite `~/.codex/config.toml`. The child explicitly unsets `CODEX_HOME`,
so the existing `~/.codex` login and config apply. `enabled=true` wins over an
inherited `enabled=false`, and `required=true` makes a missing Serena runtime
fail the run with the fixed next action instead of silently dropping the tools.

Both provider instances add a fixed `mcp_servers.serena.disabled_tools=[...]`
override listing the mutating Serena tools (content/symbol edits, memory writes)
plus `activate_project`, whose trusted activation hook can run a shell. Serena's
MCP tools run outside the Codex sandbox, so the disable list and the throwaway
home block inherited approvals/hooks from editing files: a review stays
read-only, and a patch run cannot escape its isolated worktree through Serena.
Writes then go only through the Codex sandbox in that worktree. The override
replaces any inherited `disabled_tools` list.

## Providers

One row registers two provider instances under fixed names:

| Provider               | Sandbox           | Use                                     |
| ---------------------- | ----------------- | --------------------------------------- |
| `codex-subagent`       | `read-only`       | review and answer contracts             |
| `codex-subagent-write` | `workspace-write` | patch contracts in an isolated worktree |

Both use Codex's non-interactive `approvalPolicy: never`; the sandbox fixes the
permission boundary, so a read-only rule cannot silently escalate. The official
`codex` provider (from `@deepseek-ai/dsh-subagent-codex`) may be registered in the
same profile; the fork's names are distinct.

## Target model and reasoning effort

The providers advertise `capabilities.agentOptions: true` and accept the DSH
subagent start request's `{ model, reasoningEffort }`:

- `model` → Codex `thread/start` `model`;
- `reasoningEffort` → Codex `thread/start` `config.model_reasoning_effort`.

A target value overrides the row default; a target without values keeps the row
default or the user's Codex `config.toml` route. Any other `agentOptions` entry
is rejected before a process starts with a `subagent-codex:` diagnostic naming
the unsupported option. Invalid model/effort strings are passed through and
surfaced as a normal non-completed run diagnostic, which the rules engine records
as an ERROR.

## Status tool

`codex_subagent_status` reports the resolved path, version, source (`config`,
`bundled`, or `PATH`), bundled `@openai/codex` version, the fixed Serena command,
`~/.codex`, the exact login command, and a paste-ready profile row snippet. The
fork makes no direct writes to the profile or `~/.codex` (`config.toml` stays
byte-identical; Codex may refresh its own auth tokens during a run). To pin a
detected CLI, add the snippet to the profile's `cordis.patch.yml`; a patch
replaces the whole row config, so a `codexPath`-only override is enough for this
row:

```yaml
- id: dsh-setup-codex-subagent
  config:
    codexPath: <absolute path to a codex executable>
```

To turn the providers and tool off, disable the row or remove the bundle.

## Configuration

Row config fields:

| Field             | Default | Meaning                                                   |
| ----------------- | ------- | --------------------------------------------------------- |
| `codexPath`       | unset   | CLI override; unset uses the bundled binary, then PATH    |
| `model`           | unset   | default native Codex model for both instances             |
| `reasoningEffort` | unset   | default Codex reasoning effort for both instances         |
| `env`             | `{}`    | explicit child environment entries layered over the scrub |
| `disposeGraceMs`  | `3000`  | grace between app-server termination tiers                |

Example with explicit defaults:

```yaml
- id: dsh-setup-codex-subagent
  config:
    model: gpt-6-astra
    reasoningEffort: xhigh
```

The model and effort belong to this row or the delegation target; subscription,
auth, sandbox defaults, MCP servers, and skills come from the bundled CLI and the
user's Codex home.

## Cost and safety

A delegation starts one Codex app-server, creates one ephemeral thread, and runs
one turn: it costs a Codex request and tokens on your account, and reviews are
slow by nature. Per-task reviews multiply the runs; the rules engine's task
progress note is the cheap alternative. The user's Codex sandbox and config
govern the target's permissions; the fork adds no approval UI and grants nothing
interactively. Stderr from Codex is forwarded to the Harness process stderr.
Spawn argv and Serena overrides are fixed; prompt text only travels over stdin.

## App-server compatibility

The retained adapter was written against Codex app-server 0.153.4 and was
verified against the bundled `@openai/codex` 0.164.0, including a completed
authenticated turn on the owner's `~/.codex` login: `initialize`/`initialized`,
`thread/start` with an ephemeral thread, sandbox, approval policy, target model
and effort, `turn/start` with text input, the `agentMessage` `final_answer`
notification, and `turn/completed` all worked; the fixed Serena `-c` overrides
were accepted. A signed-out run is reported as a non-completed run with HTTP 401
and the login next action. If a future bundled Codex version changes the
protocol, patch `lib/index.js`/`lib/types/wire.d.ts` and re-run this package's
tests plus the live acceptance.

## Upstream, license, and rebase

- Upstream provider: `@deepseek-ai/dsh-subagent-codex` version `0.2.1-rc.3`, MIT,
  Copyright (c) 2026 DeepSeek, from the DeepSeek Harness repository
  (`packages/subagent/subagent-codex`).
- Bundled CLI: `@openai/codex` `0.164.0`, Apache-2.0, Copyright OpenAI, installed
  from npm with its platform optional dependency. No binary is committed.
- `LICENSE` is the upstream MIT text; `NOTICE` records the fork, the bundled
  dependency, and every local change.
- Local changes are limited to: bundled/`codexPath`/PATH discovery and
  `codex --version` validation (`lib/index.js` resolve region), fixed Serena `-c`
  overrides, `--project-from-cwd`, the per-run throwaway `SERENA_HOME` with an
  empty trusted-path list, `CODEX_HOME` unset, target
  `model`/`reasoningEffort` mapping, login diagnostics, Windows `ComSpec`
  spawning, fixed read-only/workspace-write sandboxes, two provider
  registrations, the `codex_subagent_status` tool, `Config` fields (`codexPath`,
  `model`, `reasoningEffort`, no `providerName`/`permissionMode`), and
  declaration/import updates under `lib/types/`. The app-server adapter and child
  lifecycle are upstream code.

Rebase procedure on a DSH support bump:

1. Copy `lib/index.js` and `lib/types/{index,run,wire}.d.ts` from the matching
   `@deepseek-ai/dsh-subagent-codex` release.
2. Re-apply the local changes listed above.
3. Keep `NOTICE`'s upstream version current.
4. Run `pnpm exec vitest run packages/plugin-codex-subagent/test`, then the live
   app-server handshake/turn acceptance, before release.

Codex version bumps change the `@openai/codex` dependency, lockfile, NOTICE,
status-reported version, and the live acceptance together; the app-server
protocol is verified against the pinned version, not assumed.

The copied code lives only in this package; the generic delegation-rules engine
does not import Codex.
