# Codex subagent (installed CLI)

`@dsh-setup/plugin-codex-subagent` adds Codex as a DeepSeek Harness subagent
target without installing or bundling Codex. It is an MIT-attributed fork of the
official `@deepseek-ai/dsh-subagent-codex` provider: the app-server protocol
adapter is retained, while binary resolution now uses the Codex CLI already
installed on the machine.

Use it when you want the delegation rules from
[delegation-rules](delegation-rules.md) to call Codex for whole-spec reviews,
per-task reviews, blockers, research, or isolated bug-fix patches.

## Prerequisite: install and sign in to Codex

The bundle runs `codex app-server --stdio` with **your** Codex configuration,
MCP servers, skills, and authentication. It does not install Codex, vendor a
Codex binary, or automate sign-in.

1. Install the Codex CLI with the installer you already use (for example npm).
2. Sign in or otherwise configure auth so a normal Codex turn works.
3. Check that `codex --version` succeeds in the environment that starts the
   Harness. The fork validates this command before every run.

If `codex --version` fails or the app-server turn is rejected, the fork reports
the failure with the resolved path and the CLI version. A signed-out install is
reported as a failed turn with HTTP 401, not as a protocol mismatch.

## Discovery

Resolution order for every run and for the status tool:

1. `codexPath` from the `dsh-setup-codex-subagent` row config (absolute path,
   relative path, or command name).
2. `codex` on `PATH` (Windows probes `PATHEXT`: `.exe`, `.cmd`, `.bat`, ...).
3. No executable: the run fails with an error naming the `codexPath` config key
   and the `codex_subagent_status` tool. There is no bundled fallback.

The resolved executable is validated with `codex --version` before an app-server
starts. A configured path that does not exist, does not run, or does not print a
version fails the run instead of starting a child.

On Windows, `.cmd` and `.bat` shims start through `ComSpec` with fixed arguments,
while `.exe` files start directly. The delegation prompt is sent over the
app-server's stdin and is never interpolated into a command line.

## Status tool

`codex_subagent_status` reports:

- whether a CLI was found;
- the resolved path and `codex --version` output;
- the source (`config` or `PATH`);
- a paste-ready row override for pinning the path.

It only reads the machine and the CLI: it never writes the profile. Pin a
detected CLI only if PATH discovery could change, for example:

```yaml
- id: dsh-setup-codex-subagent
  config:
    codexPath: <absolute path to the installed codex executable>
```

The profile's `cordis.patch.yml` outranks the setup defaults, and a patch row
replaces the whole `config` object; a `codexPath`-only override is enough for
this row because the other fields keep their defaults. To turn the bundle off,
disable the row or remove the bundle; Codex-targeted rules then report the
target as unavailable.

## Providers

One row registers two instances with fixed names and fixed permissions:

| Provider               | Sandbox           | Used for                                  |
| ---------------------- | ----------------- | ----------------------------------------- |
| `codex-subagent`       | `read-only`       | `review` and `answer` contracts           |
| `codex-subagent-write` | `workspace-write` | `patch` contracts in an isolated worktree |

Both use Codex's non-interactive approval policy (`never`); the sandbox fixes the
permission boundary, so a read-only rule cannot silently escalate itself. The
official `codex` provider from `@deepseek-ai/dsh-subagent-codex` may stay
installed in the same profile: the fork's names are distinct and both providers
can compose.

A patch rule runs in the isolated worktree that the rules engine creates; the
fork passes the sandbox and does not merge anything. Review the returned diff and
tests before applying them.

## Configuration

The row accepts:

| Field            | Default | Meaning                                                   |
| ---------------- | ------- | --------------------------------------------------------- |
| `codexPath`      | unset   | installed CLI path or command name; unset uses `PATH`     |
| `model`          | unset   | native Codex model fixed for both instances               |
| `env`            | `{}`    | explicit child environment entries layered over the scrub |
| `disposeGraceMs` | `3000`  | grace between app-server termination tiers                |

Example:

```yaml
- id: dsh-setup-codex-subagent
  config:
    codexPath: <absolute path to the installed codex executable>
    model: <native Codex model id>
```

Reasoning effort is owned by your Codex configuration (`config.toml`), not this
row; the fork passes only the fixed app-server fields and the optional model.
Subscription, auth, sandbox defaults, MCP servers, and skills come from the
installed CLI and its Codex home.

## App-server compatibility

The retained adapter was written against Codex app-server 0.153.4 and was
verified against the installed Codex CLI 0.164.0 during this change: the
`initialize`/`initialized` handshake, `thread/start` with an ephemeral thread,
approval policy, sandbox, and `turn/start` with text input all work live. The
0.164 notification schemas still match every field the adapter reads:
`ThreadItem.agentMessage` carries the nullable
`phase` (`commentary`/`partial_answer`/`final_answer`) and `text`, and
`turn/completed` carries `status` and `error`.

The acceptance run used an install with no `config.toml` or `auth.json`: the
handshake succeeded, `turn/start` was accepted, and the turn ended `failed` with
HTTP 401 `Missing bearer or basic authentication`, so a completed model turn was
not exercised. That is the exact remaining prerequisite, not a protocol delta.
Configure or sign in to Codex, then re-run the acceptance before release.

If a future Codex version changes the protocol, the provider reports the failure
with the CLI version and the failing stage (for example `stage: thread-start`),
and the adapter is patched in the fork package. Do not silently fall back to the
bundled 0.153.4 wrapper; the fork has none.

## Cost

Every delegation starts one app-server, creates one ephemeral thread, and runs
one turn on your Codex account: it costs a Codex request and tokens, and reviews
are slow by nature. Per-task reviews multiply the runs. The rules engine's
`task_progress` note runs no model and is the cheap way to close a turn while a
task is still in progress.

## License and maintenance

The package vendors MIT-licensed `@deepseek-ai/dsh-subagent-codex` 0.2.1-rc.3
code (Copyright (c) 2026 DeepSeek). The complete MIT text is the package
`LICENSE`; `NOTICE` records the upstream version and the local patch, and the
package [README](../packages/plugin-codex-subagent/README.md) records the rebase
procedure. A DSH support-version change must rebase the fork and re-run its
app-server acceptance; only the fork package's vendored code changes, not the
generic rules engine.

## Troubleshooting

| Symptom                                   | Next action                                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Codex CLI not found` / `codexPath` error | Install Codex, put `codex` on `PATH`, or pin `codexPath`; re-run `codex_subagent_status`.                       |
| `--version` failed or printed no version  | Run the same command in the Harness environment; fix or pin `codexPath`.                                        |
| Turn fails with HTTP 401                  | Sign in to Codex or fix its `config.toml`/auth; rerun the turn.                                                 |
| Turn fails with a protocol/stage error    | Check the reported Codex version and stage; patch the fork's adapter and re-run its tests and acceptance.       |
| Patch target rejected by the rules engine | Point the rule at `codex-subagent-write`, not `codex-subagent`; a read-only target is never silently escalated. |
