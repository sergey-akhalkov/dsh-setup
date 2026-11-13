# @dsh-setup/plugin-codex-subagent

A DeepSeek Harness Host bundle that adds a Codex subagent target running a
**bundled, pinned Codex CLI**: `@openai/codex` `0.169.0`. It is an
MIT-attributed fork of the official `@deepseek-ai/dsh-subagent-codex`
0.2.1-rc.3 provider; the difference is bundled/installed binary resolution,
target options, provider/status wiring, and the visible `codex_subagent` tool,
not the Codex app-server protocol. The repository commits no Codex binary.

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
`bundled`, or `PATH`), bundled `@openai/codex` version, `~/.codex`, the exact
login command, and a paste-ready profile row snippet. The
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

## Visible subagent tool

`codex_subagent` starts a Codex run that is cataloged in the delegating
Session's subagent list as an **external** child. It is the explicit-request
path; the `delegate` engine keeps its own runs invisible by design.

Parameters: `prompt` (required, the complete self-contained task),
`description` (required, the short task label shown in the list), `name`
(optional child name), and `cwd` (optional initial working directory). The tool
returns the child name immediately; the answer arrives later as a settlement
notice that starts a new turn.

Limits: the entry is a leaf — it cannot be opened, shows no token or duration
metrics, and accepts no follow-up messages. It uses the read-only
`codex-subagent` provider; write work stays on `delegate`'s patch rule in an
isolated worktree. Both the `delegate` runs and the visible run use the same
`@openai/codex` binary and the user's `~/.codex` configuration.

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
user's Codex home. The provider passes no `mcp_servers.*` override: an MCP server
configured in `~/.codex` runs with its own approvals outside the Codex sandbox,
and the worktree-confinement guarantee covers only Codex-sandboxed operations.

## Cost and safety

A delegation starts one Codex app-server and runs one turn on a fresh ephemeral
thread, or on the persisted thread when a review key is reused: it costs a
Codex request and tokens, and reviews are
slow by nature. Per-task reviews multiply the runs; the rules engine's task
progress note is the cheap alternative. The user's Codex sandbox and config
govern the target's permissions; the fork adds no approval UI and grants nothing
interactively. Stderr from Codex is forwarded to the Harness process stderr.
Spawn argv is fixed; prompt text only travels over stdin.

## App-server compatibility

The retained adapter was written against Codex app-server 0.153.4 and was
verified against the bundled `@openai/codex` 0.169.0, including a completed
authenticated turn on the owner's `~/.codex` login: `initialize`/`initialized`,
`thread/start` with an ephemeral thread, sandbox, approval policy, target model
and effort, `turn/start` with text input, the `agentMessage` `final_answer`
notification, and `turn/completed` all worked; the app-server accepted the
`app-server --stdio` argument list with no MCP override. A signed-out run is
reported as a non-completed run with HTTP 401
and the login next action. If a future bundled Codex version changes the
protocol, patch `lib/index.js`/`lib/types/wire.d.ts` and re-run this package's
tests plus the live acceptance.

## Upstream, license, and rebase

- Upstream provider: `@deepseek-ai/dsh-subagent-codex` version `0.2.1-rc.3`, MIT,
  Copyright (c) 2026 DeepSeek, from the DeepSeek Harness repository
  (`packages/subagent/subagent-codex`).
- Bundled CLI: `@openai/codex` `0.169.0`, Apache-2.0, Copyright OpenAI, installed
  from npm with its platform optional dependency. No binary is committed.
- `LICENSE` is the upstream MIT text; `NOTICE` records the fork, the bundled
  dependency, and every local change.
- Local changes are limited to: bundled/`codexPath`/PATH discovery and
  `codex --version` validation (`lib/index.js` resolve region), `CODEX_HOME`
  unset, target `model`/`reasoningEffort` mapping, login diagnostics, Windows
  `ComSpec` spawning, fixed read-only/workspace-write sandboxes, two provider
  registrations, the `codex_subagent_status` tool, the visible `codex_subagent`
  tool, `Config` fields (`codexPath`, `model`, `reasoningEffort`, no
  `providerName`/`permissionMode`), and declaration/import updates under
  `lib/types/`. The app-server adapter and child
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
