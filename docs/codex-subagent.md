# Codex subagent (bundled CLI)

`@dsh-setup/plugin-codex-subagent` adds Codex as a DeepSeek Harness subagent
target backed by a **pinned bundled Codex CLI**: the npm dependency
`@openai/codex` `0.164.0` and its platform binary. The repository commits no
binary; the profile's package install fetches it. `codexPath` and `PATH` remain
overrides. The provider is an MIT-attributed fork of the official
`@deepseek-ai/dsh-subagent-codex` provider with its app-server protocol adapter
retained.

Use it when you want the delegation rules from
[delegation-rules](delegation-rules.md) to call Codex for whole-spec reviews,
per-task reviews, blockers, research, or isolated bug-fix patches.

## Prerequisite: log in once and have uvx for Serena

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

3. For the Serena MCP tools, make `uvx` available and allow
   `serena-agent==1.7.0` to be fetched on first use. Serena is a required MCP
   server for every run, so a missing runtime fails the run with that next
   action instead of silently dropping the tools.

The fork verifies the resolved CLI with `codex --version` before every run.

## Review thread reuse

For a review run the delegation engine's prompt carries a stable `- Review key:
review:<change>:task:<id>` line (whole-scope: `review:<change>:whole:<phase>`), which the provider
parses as the thread key; an optional `agentOptions.reviewKey` overrides it only for hosts/tests and
must match the prompt line when both exist. The provider starts a persistent Codex thread on the
first review of that key and persists `{threadId, cwd, sandbox}` in
`.dsh/delegation/codex-review-threads.json`; later reviews of the same key call `thread/resume` with
the run's cwd, sandbox, model/effort, and the same Serena/MCP restrictions instead of rebuilding the
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
- the fixed Serena MCP command;
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

## Serena MCP configuration

Every app-server starts with fixed `-c` overrides that configure the Serena MCP
server, mirroring the setup's lazy `serena` entry (plus the run's project path):

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

`--project=<run working directory>` activates the run's exact working directory
as the Serena project. It is used instead of `--project-from-cwd`, which resolves
the nearest ancestor with `.git`/`.serena`: a nested run would activate the
ancestor repo and could rewrite its checkout `.serena`. With the exact project,
a nested run keeps its own run-scoped data folder and leaves the ancestor
checkout untouched. The server `cwd` is pinned to the same exact directory so an
inherited cwd cannot win. Each run gets a throwaway `SERENA_HOME` (pinned through
the per-server `env`, because Codex starts MCP children with its own environment)
containing a minimal `serena_config.yml`:

```text
projects: []
trusted_project_path_patterns: []
project_serena_folder_location: "<home>/projects/$projectFolderName"
```

The resolved `<home>/projects/<basename(cwd)>` directory is created before
spawn, so Serena uses the run-scoped data folder instead of falling back to and
rewriting a checkout `.serena/project.yml`. The user's `~/.serena` config is
never read or rewritten, and an inherited trusted activation hook cannot run.
The GUI log window is disabled so a fatal does not open a window in the Harness
process, and the home is removed when the run is disposed.

The child unsets `CODEX_HOME`, so the existing `~/.codex` login and config apply.
The overrides contain no credentials and never rewrite the user's config file.
`enabled=true` wins over an inherited `mcp_servers.serena.enabled=false`, and
`required=true` makes a missing Serena runtime fail the run with the fixed next
action (`uvx` + `serena-agent==1.7.0`) instead of silently dropping its tools.

Both provider instances add one more fixed override:

```text
-c mcp_servers.serena.disabled_tools=["replace_content","replace_in_files","replace_symbol_body","insert_after_symbol","insert_before_symbol","rename_symbol","safe_delete_symbol","write_memory","edit_memory","delete_memory","rename_memory","activate_project"]
```

Serena's MCP tools run outside the Codex sandbox, so the fixed disable list and
the throwaway Serena home together stop inherited approvals or activation hooks:
a review stays read-only, and a patch run cannot leave its isolated worktree
through Serena. Writes then go only through the Codex sandbox in that worktree.
The override replaces any inherited `disabled_tools` list.

## Providers and target options

One row registers two instances with fixed names and permissions:

| Provider               | Sandbox           | Used for                                  |
| ---------------------- | ----------------- | ----------------------------------------- |
| `codex-subagent`       | `read-only`       | `review` and `answer` contracts           |
| `codex-subagent-write` | `workspace-write` | `patch` contracts in an isolated worktree |

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
  codex-write:
    provider: codex-subagent-write
    write: true
    model: gpt-6-astra
    reasoningEffort: xhigh
  codex-astra:
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

The setup's delegation rules use these values by default: `codex` and `codex-write` select
`gpt-6-astra` at `xhigh`, and `codex-astra` is the explicit strong target the manual advisor uses.
Override the target in the delegation config (not the provider row) to change a rule's model; keep
`codex-astra` strong if `codex` is made cheaper. The provider row's `model`/`reasoningEffort` remain
fallbacks for targets that set neither.

Invalid model or effort strings are passed to Codex and surface as a normal
non-completed run, which the delegation engine records as an ERROR for that
target.

A patch rule runs in the isolated worktree the rules engine creates; the fork
passes the sandbox and merges nothing. Review the returned diff and tests before
applying them.

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
verified against the bundled `@openai/codex` 0.164.0, including a completed
authenticated turn on the owner's `~/.codex` login:

- `initialize`/`initialized` and `thread/start` (ephemeral thread, approval
  policy, sandbox, target model, target effort) succeeded;
- `turn/start` accepted the prompt over stdin;
- the `agentMessage` `final_answer` notification and `turn/completed` completed
  the run, returning the model's answer;
- the fixed Serena `-c` overrides were accepted by the app-server.

The earlier not-signed-in behavior remains covered: a 401 becomes a
non-completed run with the login next action. If a future bundled Codex version
changes the protocol, patch the fork's adapter and re-run its tests and the live
acceptance. Do not fall back to another Codex version silently.

## Cost

Every delegation starts one app-server, creates one ephemeral thread, and runs
one turn on your Codex account: it costs a Codex request and tokens, and reviews
are slow by nature. Per-task reviews multiply the runs. The shipped delegation
targets select `gpt-6-astra` at `xhigh`, so every default Codex rule pays the
strong-model rate; override `codex`/`codex-write` for routine reviews and keep
`codex-astra` for the advisor. The rules engine's `task_progress` note runs no
model and is the cheap way to close a turn while a task is still in progress.

## License and maintenance

The package vendors MIT-licensed `@deepseek-ai/dsh-subagent-codex` 0.2.1-rc.3
code (Copyright (c) 2026 DeepSeek). The complete MIT text is the package
`LICENSE`; `NOTICE` records the upstream version, the local patch, and the
bundled `@openai/codex` 0.164.0 dependency (Apache-2.0, Copyright OpenAI). The
package [README](../packages/plugin-codex-subagent/README.md) records the rebase
procedure.

A DSH support-version change rebases the fork; a Codex version bump updates the
dependency, lockfile, status, NOTICE, docs, and the live acceptance together.
Only the fork package's vendored code changes, not the generic rules engine.

## Troubleshooting

| Symptom                                        | Next action                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Codex CLI not found` / `codexPath` error      | Reinstall dependencies for the bundled binary, set `codexPath`, or put `codex` on `PATH`; re-run `codex_subagent_status`. |
| `--version` failed or printed no version       | Run that command in the Harness environment; fix or pin `codexPath`.                                                      |
| Turn fails with HTTP 401                       | Run the reported `<resolved codex> login`, then retry. The provider writes no credentials.                                |
| Serena MCP tools missing / MCP startup failure | Install `uvx`, allow `serena-agent==1.7.0`, and re-run; the user's Codex config was not modified.                         |
| Turn fails with unsupported target option      | Use only `model` and `reasoningEffort`; other `agentOptions` entries are rejected before a run.                           |
| Patch target rejected by the rules engine      | Point the rule at `codex-subagent-write`; a read-only target is never silently escalated.                                 |
