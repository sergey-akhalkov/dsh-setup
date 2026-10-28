# RTK token workflow

`@dsh-setup/plugin-rtk` makes every session in a profile with the row active route supported bulk-output
shell commands through the [RTK](https://github.com/rtk-ai/rtk) CLI. It is a guidance plugin, not a
runtime adapter: it registers a short always-on rule and an on-demand `rtk` skill, and the model runs
the CLI through the ordinary `pwsh` tool.

## What the plugin ships

- **An always-on routing rule, enabled by default.** The rule is a system-prompt section, so a session
  receives it without loading a skill. It names the hot commands and their rtk forms explicitly,
  applies to subagents, keeps the `read`, `grep`, and `glob` tools for file inspection, and states the
  native fallback when rtk is missing or a command is unsupported.
- **One on-demand skill.** `rtk` carries the command groups, the fallback, the full-output recovery
  route, and the `rtk trust` security boundary. It is listed in the catalog and costs nothing until
  invoked.
- **No other contribution.** The package ships no rtk binary, no installer, no Client half, no shell
  patch, no tool hook, and no result filter. It makes no network request at installation or runtime.

## Why this is guidance rather than an adapter

DSH `0.2.1-rc.3` has no pre-tool command-rewrite hook: `tools/pre-execute` can only allow, deny, cancel,
or ask, and it deliberately excludes input rewriting because the arguments are already logged and
presented. `tools/execute` wrappers may replace only `exec.signal`, and `tools/post-execute` runs after
the command. A transparent rtk hook would therefore need a private patch of the shell service, which
would make the executed command differ from the logged one and break replay and audit.

The supported integration is agent guidance. The model calls `rtk git diff` instead of `git diff`; the
command runs once, stderr and exit codes stay meaningful, and the session log records exactly what the
model ran. A post-execute filter is a possible later addition for commands whose raw output format
matches an rtk pipe filter, but it cannot reproduce rtk's command-specific invocation and is not part
of this bundle.

## Install rtk first

The plugin does not install rtk. Install the CLI from the project's
[installation guide](https://github.com/rtk-ai/rtk#installation): winget on Windows, Homebrew on
macOS/Linux, or the project's install script. Verify:

```sh
rtk --version
rtk gain
```

`rtk gain` must show the savings dashboard, not "command not found". If rtk is missing, the plugin still
composes and starts; the guidance tells the agent to run the native command.

## Install the plugin

The plugin is part of the full setup bundle, so `install.ps1` or installing `@dsh-setup/setup` from
Discover enables it. To install only this plugin, use its own entry in the Discover tab, or install a
commit-pinned git specification with the application fully quit:

```sh
dsh plugin --profile desktop add "git+https://github.com/sergey-akhalkov/dsh-setup.git#<commit>&path:/packages/plugin-rtk"
```

Use either the full setup or the individual plugin for this package, never both: installing both mounts
the same row twice.

## Prompt cost

The always-on rule is a hard budget, not a preference. The package test measures
`assets/rtk/rules.md` as `UTF-8 bytes / 4` and fails above `300` estimated tokens.

| Contribution                         | Size        | Cost per model step |
| ------------------------------------ | ----------- | ------------------- |
| Packaged lazy-dev ruleset (Ponytail) | 2,721 bytes | ~0.7k tokens        |
| Working contract                     | 5,257 bytes | ~1.3k tokens        |
| RTK routing rule                     | 884 bytes   | ~0.2k tokens        |
| Serena code-surface trigger          | 733 bytes   | ~0.2k tokens        |
| **All four, active**                 |             | **~2.4k tokens**    |

The `rtk` skill body is 3,618 bytes and loads only when invoked, so it is not in the per-step table.
The measured values come from the package budget test and the asset files; update this table when the
assets change.

## What the agent is told

The always-on rule names the hot forms; the skill carries the full table:

- Git inspection and changes: `rtk git status`, `rtk git diff`, `rtk git log`, `rtk git add`,
  `rtk git commit`, `rtk git push`.
- Tests: `rtk pnpm test`, `rtk npm test`, `rtk vitest`, `rtk jest`, `rtk cargo test`, `rtk pytest`,
  `rtk go test`, `rtk dotnet test`, `rtk playwright`.
- Build and lint: `rtk tsc`, `rtk lint`, `rtk ruff check`, `rtk prettier`, `rtk mypy`, `rtk go build`.
- Search: `rtk grep`, `rtk find`. (`rtk rg` and `rtk fd` are native fallbacks, not filters.)
- Infrastructure: `rtk docker`, `rtk kubectl`, `rtk aws`, `rtk psql`.
- Shell file commands: `rtk read`, `rtk ls`, `rtk tree`.

The rule states those forms are mandatory for the listed hot commands, says tests and build logs are
the biggest wins, applies to subagents, and notes that rtk keeps errors and exit codes.

The installed CLI is the authority: `rtk --help` and `rtk <command> --help` list the current surface.
If a command has no rtk equivalent, the agent runs the native command and keeps its errors.

## Turn off the always-on rule

Keep the skill but drop the system-prompt section by overriding the row in the profile's
`cordis.patch.yml`:

```yaml
- id: dsh-setup-rtk
  config:
    alwaysOn: false
```

A patch replaces the whole `config` object for the row, so restate every option the row needs; this row
only has `alwaysOn`. Restart DeepSeek Harness after editing the profile patch.

## Suspend in a session

Say "stop rtk routing" to suspend only this rule for the rest of the session. It does not suspend
Ponytail or the working contract; those keep their own suspension phrases. The section deliberately
names no slash command because the Harness does not provide one.

## Remove the plugin

Disable the row in the profile patch:

```yaml
- id: dsh-setup-rtk
  disabled: true
```

or uninstall the plugin bundle. Either removes the rule and the skill; no other configuration changes.

## Precedence and overrides

The skill name is `rtk`. A project or user skill with the same name (for example a workspace
`.dsh/skills/rtk/SKILL.md`) takes precedence over the packaged one. The always-on rule is governed by
the row configuration, not by skill-name precedence.

## Measure the effect

`rtk gain` reports savings for commands that actually ran through rtk. `rtk gain --history` shows the
recent commands, and `rtk gain --project` limits the summary to the current project. The DSH token meter
shows the model-visible effect, which is the authoritative measure for a session.

Read the numbers as rtk itself describes them: they cover shell output, and shell output is one
contributor to input tokens, which is one part of the bill. A 60–90% reduction on a command's output is
not a 60–90% reduction in the session cost. Compare the same task with and without the rule, and do not
attribute a difference to rtk without a session-log observation.

Under a confined DSH sandbox, rtk may be unable to write its statistics because its state lives outside
the workspace. The filtering still works; use the DSH token meter when the `rtk gain` record is missing.

## Limits and security

- **Compact output can omit detail.** The skill names `rtk proxy <command>` for a raw, tracked run and
  tells the agent not to rerun a mutating command just to recover output. Errors and non-zero exits are
  preserved; a compact result is not permission to hide a failure.
- **PowerShell-only commands are not rewritten.** `Get-ChildItem`, `Select-String`, and other native
  cmdlets stay native; the rule forbids prefixing them. `rtk run` is not used on Windows because it goes
  through `sh -c`.
- **`rtk trust` is a security boundary.** Do not trust project-local filters in a repository you do not
  trust; they are code. The skill forbids it.
- **rtk is local and offline for this workflow.** It reads the command's output and prints a compact
  version; it does not need the network. Telemetry is off by default; the plugin does not enable it.
- **No secrets in examples or command lines.** The plugin ships no credentials, private paths, or session
  data.

## Version freshness

The command guidance was checked on 2026-10-26 against the installed CLI and intentionally does not
assert a version as current. Run `rtk --version` for the installed version and `rtk --help` for the
current command surface. When the surface changes materially, refresh the skill text and this date; do
not pin a version.
