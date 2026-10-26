# @dsh-setup/plugin-codex-subagent

A DeepSeek Harness Host bundle that adds a Codex subagent target running the
Codex CLI **installed on the machine**. It is an MIT-attributed fork of the
official `@deepseek-ai/dsh-subagent-codex` 0.2.1-rc.3 provider; the difference is
binary resolution and provider/status wiring, not the Codex app-server protocol.

## Prerequisite

Install and sign in to the Codex CLI yourself. This bundle does not install
Codex, vendor a Codex binary, or automate sign-in. It runs `codex app-server
--stdio` with your Codex configuration, MCP servers, skills, and authentication.
Install it with npm, for example, then check that `codex --version` works in the
same environment that starts the Harness.

## Discovery

For every run (and for the status tool) the fork resolves the CLI in this order:

1. `codexPath` from the plugin row config — an absolute path, a relative path, or
   a command name.
2. `codex` on `PATH` (Windows `PATHEXT` candidates, `.exe`/`.cmd`/`.bat`).
3. Otherwise the run fails with an error naming the `codexPath` key and
   `codex_subagent_status`; there is no bundled fallback.

The resolved executable is validated with `codex --version` before any app-server
starts. Discovery and validation failures report the resolved path or the missing
lookup plus the two next actions.

Windows `.cmd`/`.bat` shims are started through `ComSpec` with every argument as
its own argv entry; `.exe` files start directly. The delegation prompt is never
interpolated into a command line: it reaches the app-server over stdin.

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

## Status tool

`codex_subagent_status` reports the resolved path, version, and source
(`codexPath` config or `PATH`) and prints a paste-ready profile row snippet. It
never writes the profile. To pin a detected CLI, add the snippet to the profile's
`cordis.patch.yml`; a patch replaces the whole row config, so a `codexPath`-only
override is enough for this row:

```yaml
- id: dsh-setup-codex-subagent
  config:
    codexPath: <absolute path to the installed codex executable>
```

To turn the providers and tool off, disable the row (`- id:
dsh-setup-codex-subagent` with `disabled: true`) or remove the bundle.

## Configuration

Row config fields:

| Field            | Default | Meaning                                                   |
| ---------------- | ------- | --------------------------------------------------------- |
| `codexPath`      | unset   | installed CLI path or command name; unset uses `PATH`     |
| `model`          | unset   | native Codex model fixed for both instances               |
| `env`            | `{}`    | explicit child environment entries layered over the scrub |
| `disposeGraceMs` | `3000`  | grace between app-server termination tiers                |

Reasoning effort is owned by your Codex configuration (`config.toml`), not this
row. The model belongs to the config, while subscription, auth, sandbox defaults,
MCP servers, and skills come from the installed CLI and its Codex home.

## Cost and safety

A delegation starts one Codex app-server, creates one ephemeral thread, and runs
one turn: it costs a Codex request and tokens on your account, and reviews are
slow by nature. Per-task reviews multiply the runs; the rules engine's task
progress note is the cheap alternative. The user's Codex sandbox and config
govern the target's permissions; the fork adds no approval UI and grants nothing
interactively. Stderr from Codex is forwarded to the Harness process stderr.

## App-server compatibility

The retained adapter was written against Codex app-server 0.153.4 and was
verified against Codex CLI 0.164.0: `initialize`/`initialized`, `thread/start`
with an ephemeral thread, sandbox and approval policy, and `turn/start` with text
input all work live. The 0.164 notification schemas match the fields the adapter
reads: `ThreadItem.agentMessage` still carries the nullable
`phase` (`commentary`/`partial_answer`/`final_answer`) plus `text`, and
`turn/completed` still carries `status` and `error`. That install had no
completed model turn because it was not signed in: the handshake succeeds, then
the turn fails with HTTP 401 `Missing bearer or basic authentication`, which the
provider reports as a non-completed run with the CLI version and HTTP status.
Sign in and re-run the acceptance to exercise a completed turn before release.
If a future Codex version changes the protocol, patch
`lib/index.js`/`lib/types/wire.d.ts` and re-run this package's tests and the live
acceptance.

## Upstream, license, and rebase

- Upstream: `@deepseek-ai/dsh-subagent-codex` version `0.2.1-rc.3`, MIT,
  Copyright (c) 2026 DeepSeek, from the DeepSeek Harness repository
  (`packages/subagent/subagent-codex`).
- `LICENSE` is the upstream MIT text; `NOTICE` records the fork and the local
  changes.
- Local changes are limited to: installed-CLI discovery/validation
  (`lib/index.js` resolve region), Windows `ComSpec` spawning, the fixed
  read-only/workspace-write sandbox per provider, two provider registrations,
  the `codex_subagent_status` tool, `Config` fields (`codexPath`, no
  `providerName`/`permissionMode`), and the declaration/import path updates under
  `lib/types/`. The app-server adapter and child lifecycle are upstream code.

Rebase procedure on a DSH support bump:

1. Copy `lib/index.js` and `lib/types/{index,run,wire}.d.ts` from the matching
   `@deepseek-ai/dsh-subagent-codex` release.
2. Re-apply the local changes listed above (resolve region, `codexSpawnArgv`,
   sandbox parameter, provider/status region, declaration updates).
3. Keep `NOTICE`'s upstream version current.
4. Run `pnpm exec vitest run packages/plugin-codex-subagent/test`, then the live
   app-server handshake/turn acceptance, before release.

The copied code lives only in this package; the generic delegation-rules engine
does not import Codex.
