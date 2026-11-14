# Codex subagent (bundled CLI)

`@dsh-setup/plugin-codex-subagent` adds Codex as a DeepSeek Harness subagent
target backed by a **pinned bundled Codex CLI**: the npm dependency
`@openai/codex` `0.169.0` and its platform binary. The repository commits no
binary; the profile's package install fetches it. `codexPath` and `PATH` remain
overrides. The provider is an MIT-attributed fork of the official
`@deepseek-ai/dsh-subagent-codex` provider with its app-server protocol adapter
retained.

Use it when you want the delegation review rules from
[delegation-rules](delegation-rules.md) to call Codex for whole-spec, per-task, section, and
integration reviews, or when you want an ad-hoc Codex second opinion through the `codex_subagent`
tool.

## Prerequisite: log in once

The bundle runs `codex app-server --stdio` with **your** Codex configuration and
authentication. The fork does not sign in or copy credentials, and it makes no
direct writes to `~/.codex`; `config.toml` stays byte-identical. Codex itself
may refresh its own auth tokens during a run.

1. Install the bundle (or the setup). The `@openai/codex` dependency and its
   platform package are installed by the profile's package manager.
2. Log in once with the resolved CLI:

   ```text
   <resolved codex executable> login
   ```

   `codex_subagent_status` prints the exact command. The login writes the usual
   `~/.codex/auth.json`, which the provider reuses as-is.

The fork verifies the resolved CLI with `codex --version` before every run. The
provider sends no `mcp_servers.*` app-server override: an MCP server configured
in `~/.codex` runs with its own approvals outside the Codex sandbox, and the
worktree-confinement guarantee covers only Codex-sandboxed operations.

## Review thread reuse

For a review run the delegation engine's prompt carries a stable `- Review key:
review:<change>:task:<id>` line (whole-scope: `review:<change>:whole:<phase>`), which the provider
parses as the thread key; an optional `agentOptions.reviewKey` overrides it only for hosts/tests and
must match the prompt line when both exist. The provider starts a persistent Codex thread on the
first review of that key and persists `{threadId, cwd, sandbox}` in
`.dsh/delegation/codex-review-threads.json`; later reviews of the same key call `thread/resume` with
the run's cwd, sandbox, model/effort, and the same fixed sandbox policy instead of rebuilding the
context from scratch. A different key never resumes another key's thread; a missing or mismatched
entry starts a fresh persistent thread. The review result reports `threadReuse: created | resumed`
and the thread id. The thread state is local scratch under `.dsh/delegation`; the user's Codex
config is never read or written for it. Same-key runs are serialized by the engine, and a persistent
Codex thread's rollout lives in Codex's own session store.

## Discovery

Resolution order for every run and for the status tool:

1. `codexPath` from the `dsh-setup-codex-subagent` row config (absolute path,
   relative path, or command name).
2. The bundled `@openai/codex` platform binary
   (`vendor/<target-triple>/bin/codex`).
3. `codex` on `PATH` (Windows probes `PATHEXT`: `.exe`, `.cmd`, `.bat`, ...).

The status tool reports which source won. `PATH` is tried only when `codexPath`
is omitted and no bundled platform binary is discovered. A discovered but invalid
executable is terminal: the run fails with the path and command failure instead
of silently trying another source. If nothing resolves, the error names the
`codexPath` key, the bundled dependency, and `codex_subagent_status`.

After a dependency install or version bump, the bundled version and the
status-reported version change together; the acceptance is re-run against the
new pinned version.

## Login, status, and fixes

`codex_subagent_status` reports:

- whether a CLI was found, with its resolved path, `codex --version`, and source
  (`config`, `bundled`, or `PATH`);
- the installed bundled `@openai/codex` version;
- the exact login command and the Codex home (`~/.codex`, used as-is);
- a paste-ready row override for pinning a CLI.

The fork only reads the machine and the CLI; it makes no direct writes to the
profile or `~/.codex`, and `config.toml` stays byte-identical. Codex itself may
refresh its own auth tokens during a run. To pin a detected CLI:

```yaml
- id: dsh-setup-codex-subagent
  config:
    codexPath: <absolute path to a codex executable>
```

A patch row replaces the whole `config` object, so a `codexPath`-only override is
enough. A 401 from the app-server is reported as a non-completed run whose
diagnostic carries the same login command as the next action.

## Visible subagent tool

`codex_subagent` starts a Codex delegation that appears in the delegating
Session's subagent list as an **external** entry. Rule-driven reviews on the
same external provider also appear there (`delegation:<rule>`) and deliver their
verdict as a settlement notice; the manual tool remains the explicit-run path for
work outside a delegation rule.

The tool accepts `prompt` (required), `description` (required, the task label in
the list), `name` (optional child name), and `cwd` (optional). It returns the
child name immediately; the answer arrives as a settlement notice that starts a
new turn. The entry is a leaf — not openable, no token or duration metrics, no
follow-up messages — and it uses the read-only `codex-subagent` provider. Write
work goes through a write-capable `subagent` in an isolated `create_worktree`
checkout; no shipped delegation contract runs the write provider.

## Providers and target options

One row registers two instances with fixed names and permissions:

| Provider               | Sandbox           | Used for                                                                                             |
| ---------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `codex-subagent`       | `read-only`       | The delegation `review` contract and the visible `codex_subagent` tool                               |
| `codex-subagent-write` | `workspace-write` | No shipped delegation contract; selectable through the first-party `subagent` tool for isolated work |

Both use Codex's non-interactive approval policy (`never`); the sandbox fixes the
permission boundary, so a read-only rule cannot silently escalate itself. The
official `codex` provider may stay installed in the same profile.

The providers declare `agentOptions` support and accept a target's `model` and
`reasoningEffort`:

```yaml
targets:
  codex:
    provider: codex-subagent
    model: gpt-6-astra
    reasoningEffort: xhigh
```

- `model` maps to Codex `thread/start` `model`.
- `reasoningEffort` maps to `thread/start` `config.model_reasoning_effort`.
- A target value wins over the row defaults; a target without values keeps the
  row default or the user's Codex `config.toml` route.
- Any other `agentOptions` entry is rejected before a process starts with a
  `subagent-codex:` diagnostic naming the unsupported option.

The setup's delegation rules use the `codex` target with `gpt-6-astra` at `xhigh` by default.
Override the target in the delegation config (not the provider row) to change a rule's model or
effort; a target that sets neither falls back to the provider row's `model`/`reasoningEffort` or the
user's Codex route.

Invalid model or effort strings are passed to Codex and surface as a normal
non-completed run, which the delegation engine records as an ERROR for that
target.

The write provider stays registered and selectable through the first-party `subagent` tool; no
shipped delegation contract or rule uses it. Give it an isolated `create_worktree` checkout and
review the returned diff and tests before applying them; the engine merges nothing.

## Configuration

The row accepts:

| Field             | Default | Meaning                                                   |
| ----------------- | ------- | --------------------------------------------------------- |
| `codexPath`       | unset   | CLI override; unset uses the bundled binary, then PATH    |
| `model`           | unset   | default native Codex model for both instances             |
| `reasoningEffort` | unset   | default Codex reasoning effort for both instances         |
| `env`             | `{}`    | explicit child environment entries layered over the scrub |
| `disposeGraceMs`  | `3000`  | grace between app-server termination tiers                |

Example:

```yaml
- id: dsh-setup-codex-subagent
  config:
    model: gpt-6-astra
    reasoningEffort: xhigh
```

Subscription, auth, sandbox defaults, MCP servers, and skills come from the
bundled CLI and the user's Codex home.

## App-server compatibility

The retained adapter was written against Codex app-server 0.153.4 and was
verified against the bundled `@openai/codex` 0.169.0, including a completed
authenticated turn on the owner's `~/.codex` login:

- `initialize`/`initialized` and `thread/start` (ephemeral thread, approval
  policy, sandbox, target model, target effort) succeeded;
- `turn/start` accepted the prompt over stdin;
- the `agentMessage` `final_answer` notification and `turn/completed` completed
  the run, returning the model's answer;
- the fixed `app-server --stdio` argument list contained no MCP override.

The earlier not-signed-in behavior remains covered: a 401 becomes a
non-completed run with the login next action. If a future bundled Codex version
changes the protocol, patch the fork's adapter and re-run its tests and the live
acceptance. Do not fall back to another Codex version silently.

The live acceptance is the manual harness
[`packages/plugin-codex-subagent/test/live-acceptance.manual.ts`](../packages/plugin-codex-subagent/test/live-acceptance.manual.ts),
run with `pnpm exec vitest run --config scripts/manual/vitest.config.ts`. It drives
the shipped provider and status tool against the real bundled binary with the owner's
login, plus a signed-out case on an isolated `CODEX_HOME`; it is not part of
`pnpm test` or CI.

## Cost

Every delegation starts one app-server and runs one turn on a fresh ephemeral
thread, or resumes the persisted thread when a review key is reused; it costs a
Codex request and tokens, and reviews
are slow by nature. Per-task reviews multiply the runs. The shipped delegation
target selects `gpt-6-astra` at `xhigh`, so every default Codex review pays the
strong-model rate; override `codex` for routine reviews. The rules engine's
`task_progress` note runs no model and is the cheap way to close a turn while a
task is still in progress.

## License and maintenance

The package vendors MIT-licensed `@deepseek-ai/dsh-subagent-codex` 0.2.1-rc.3
code (Copyright (c) 2026 DeepSeek). The complete MIT text is the package
`LICENSE`; `NOTICE` records the upstream version, the local patch, and the
bundled `@openai/codex` 0.169.0 dependency (Apache-2.0, Copyright OpenAI). The
package [README](../packages/plugin-codex-subagent/README.md) records the rebase
procedure.

A DSH support-version change rebases the fork; a Codex version bump updates the
dependency, lockfile, status, NOTICE, docs, and the live acceptance together.
Only the fork package's vendored code changes, not the generic rules engine.

## Troubleshooting

| Symptom                                   | Next action                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Codex CLI not found` / `codexPath` error | Reinstall dependencies for the bundled binary, set `codexPath`, or put `codex` on `PATH`; re-run `codex_subagent_status`. |
| `--version` failed or printed no version  | Run that command in the Harness environment; fix or pin `codexPath`.                                                      |
| Turn fails with HTTP 401                  | Run the reported `<resolved codex> login`, then retry. The provider writes no credentials.                                |
| Turn fails with unsupported target option | Use only `model` and `reasoningEffort`; other `agentOptions` entries are rejected before a run.                           |
| Write work needed                         | Start a write-capable `subagent` on `codex-subagent-write` in a `create_worktree` checkout; no shipped rule writes.       |
