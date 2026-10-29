# Install the setup

The setup is one DeepSeek Harness bundle plus the shipped bundles it expects. The primary installation
path is one command: [`install.ps1`](../install.ps1) enables the required bundles through the same
mechanism as the Plugins page, installs the setup bundle at the latest release, provisions the local
Hindsight runtime when its prerequisites are available, and restarts DeepSeek Harness. It never edits
your profile's own `cordis.patch.yml`, so machine-local preferences keep winning. A runtime that is
already configured and healthy is skipped without prompting, so rerunning for plugin updates stays
non-interactive.

Run the installer from an ordinary PowerShell window, not from a terminal hosted inside DeepSeek
Harness (an agent turn or the in-app terminal). Installing into the `desktop` profile closes and
restarts the app, which kills the process tree behind that terminal and aborts the turn; a reset of
the Harness home while the app runs is worse still, because the running session's file can be removed
from under it (`This turn failed ENOENT`). The installer refuses a `desktop` target when the calling
shell lives inside the app. To verify this checkout on the current machine without touching the live
profile, use [`pnpm dogfood`](#dogfood-on-the-current-machine) instead.

## Prerequisites

- Windows with DeepSeek Harness Desktop installed. Start it once and quit: the first launch creates
  the `desktop` profile the installer writes to.
- PowerShell 5.1 or newer (PowerShell 7 recommended).
- Network access to GitHub and the plugin registry.
- A supported DSH version. The current window is recorded in [`dsh.json`](../dsh.json); the installer
  refuses an unsupported version before changing anything.
- `uv` on `PATH` for the local Hindsight runtime. When it is missing, the installer warns and skips
  only that phase; the setup does not install system tools.
- A DeepSeek API key for Hindsight: `DEEPSEEK_API_KEY`, `%USERPROFILE%\.hindsight\deepseek.key`, an
  existing Hindsight profile, or a secure prompt during the Hindsight phase.

## One command

Run this from an ordinary PowerShell window:

```powershell
irm https://raw.githubusercontent.com/sergey-akhalkov/dsh-setup/main/install.ps1 | iex
```

The command downloads and executes the installer in one pipeline: it prints its plan, closes
DeepSeek Harness while it writes the profile, provisions the local Hindsight runtime when possible,
and leaves the window open with the run's exit status.
The pipeline needs no execution-policy change, because a downloaded expression is not a script file.
From `cmd.exe`, wrap it the same way as other installers:

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/sergey-akhalkov/dsh-setup/main/install.ps1 | iex"
```

The script resolves the setup version from the published market index and falls back to the newest
`v*` release tag when that index cannot be read.

The pipeline form runs with the default options. For `-DryRun`, `-Profile`, `-SetupVersion`, or
`-SetupSpec`, download the script and run the file:

```powershell
$installer = Join-Path $env:TEMP 'dsh-setup-install.ps1'
Invoke-WebRequest https://raw.githubusercontent.com/sergey-akhalkov/dsh-setup/main/install.ps1 -OutFile $installer
& $installer -DryRun
```

The script:

1. Reads the running CLI and DSH version and refuses an unsupported one.
2. Closes DeepSeek Harness (profile writes need the app fully quit) and saves copies of the profile
   manifest, patch, and composed root under `$DSH_HOME/.dsh-setup-backups/` before anything changes.
3. Enables the shipped bundles the setup expects by appending their names to `dsh.profile.bundles` —
   exactly the operation behind the **Plugins** toggles. The profile patch is not touched.
4. Installs the setup bundle from the pinned release commit.
5. Creates the administrator desktop shortcut unless `-NoDesktopShortcut` is set; a missing Desktop
   app is a warning rather than a failed install.
6. Verifies the selection, the installed setup version, that the setup bundle is last in
   `dsh.profile.bundles` (so its defaults outrank the shipped layers), and that `cordis.patch.yml`
   is byte-identical to before.
7. Runs the Hindsight phase after the profile verification: when the runtime is not configured, it
   asks for the DeepSeek key and the export location, installs or updates the pinned
   `hindsight-embed`, starts the daemon, registers the logon task, and verifies a retain/recall
   round-trip. A configured, healthy runtime is skipped with no prompt; a missing `uv` or key warns,
   skips the phase, and still exits successfully. A failure once the phase starts exits non-zero and
   states that the profile was installed.
8. Starts DeepSeek Harness again.

Running the command a second time is safe: it keeps existing selections, installs nothing when the
resolved version is already current, fails the verification when the installed version is not the
resolved one, and skips the Hindsight phase when the runtime is already configured and healthy.

### Installer options

Options apply to the downloaded-file form; the pipeline form runs with the defaults.

| Option                  | Meaning                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `-DryRun`               | Print the plan and change nothing.                                                     |
| `-Profile <name>`       | Profile to install into. Default `desktop`.                                            |
| `-DshHome <path>`       | Harness home. Default `$env:DSH_HOME`, else `~/.dsh`.                                  |
| `-DshCli <path>`        | CLI to use. Default `dsh` on PATH, else the Desktop CLI.                               |
| `-SetupVersion <x.y.z>` | Install that exact release instead of the newest index entry or tag.                   |
| `-SetupSpec <spec>`     | Install an explicit package spec, for example a checkout's `packages/setup` directory. |
| `-NoStopApp`            | Abort instead of closing a running DeepSeek Harness; quit the app and rerun.           |
| `-NoRestart`            | Leave DeepSeek Harness closed after installing.                                        |
| `-NoDesktopShortcut`    | Do not create the administrator desktop shortcut.                                      |
| `-IndexUrl <url>`       | Market index used to pin the release. Default: the published Pages index.              |
| `-NoHindsight`          | Install or update the profile only; skip the Hindsight phase.                          |
| `-HindsightOnly`        | Run only the Hindsight phase; no DSH profile is read, written, or restarted.           |
| `-RepairHindsight`      | Run the Hindsight phase even when the runtime is already configured and healthy.       |
| `-DeepSeekApiKey <key>` | Hindsight key for scripted runs; prefer `DEEPSEEK_API_KEY` or the key file.            |
| `-ExportDir <path>`     | Hindsight export directory (a local folder or an existing Git repository).             |
| `-ExportRemote <url>`   | Private export remote; `-` removes it and keeps the export local.                      |
| `-ApiPort <port>`       | Local Hindsight API port. Default `8888`.                                              |
| `-Model <name>`         | DeepSeek model for Hindsight extraction. Default `deepseek-chat`.                      |
| `-NoLogonTask`          | Do not register the Hindsight logon task.                                              |
| `-SkipVerify`           | Skip the Hindsight key, push-access, and retain/recall checks.                         |

When the script is inside a full checkout of this repository it installs that checkout's
`packages/setup`; pass `-SetupVersion` or `-SetupSpec` to install a released bundle instead.

## Administrator desktop shortcut and restart

The installer creates `DeepSeek Harness (Administrator)` on the current user's Desktop unless
`-NoDesktopShortcut` or `-DryRun` is set. The shortcut starts the installed Desktop app through the
Windows UAC prompt; it does not elevate the current app. Close DeepSeek Harness before using it, and
keep the normal shortcut for everyday work.

The `@dsh-setup/plugin-admin-indicator` bundle adds a shield and the visible label **Standard User** or
**Administrator** next to the composer permission control; the label collapses to the shield on narrow
windows. Its “Create admin desktop shortcut” menu action calls the fixed authenticated route and shows a
native success or error toast; it never reads or changes the composer draft and works alongside
attachments. The `/admin-shortcut` command remains available for manual use. The restart action is
behind the row feature flag `restart`, disabled by default; when enabled it asks for confirmation and
requests UAC first, then the elevated helper closes the current app and starts the new elevated
instance. The current session ends; declining UAC leaves the current app running. The actions are
unavailable outside the Desktop app and when DSH already runs as administrator.

"Full access" in the composer is a per-session tool permission, not OS administrator rights. Running
the whole app as administrator gives every session, tool, terminal, MCP server, and subagent the
elevated token, so use administrator mode only when the task needs it. The app restart uses a
detached Windows script: it targets only the owning Desktop process tree, asks the window to close,
force-closes the remaining processes after a short grace, and starts the new instance.

## Bundles the setup enables

These are shipped optional bundles in DSH `0.2.1-rc.3`. The installer selects them; the setup bundle
does not duplicate their rows or add them itself.

- **Agent Teams** — `@deepseek-ai/dsh-experimental-agent-team-profile`
- **Tool worktree** — `@deepseek-ai/dsh-experimental-tool-worktree`
- **Ralph** — `@deepseek-ai/dsh-experimental-ralph-bundle`
- **Custom plugin markets** — `@deepseek-ai/dsh-experimental-plugin-market-bundle`
- **Session search** — `@deepseek-ai/dsh-experimental-session-search`
- **Terminal** — `@deepseek-ai/dsh-experimental-terminal-bundle`

Codex subagents come from the setup bundle's `@dsh-setup/plugin-codex-subagent`; the stock
`@deepseek-ai/dsh-subagent-codex` bundle is not selected by the installer.

The list is the single source in [`dsh.json`](../dsh.json) (`installBundles`); the standalone installer
contains its own copy, and repository validation fails if the two disagree.

### Setup-provided plugin bundles

In addition to the shipped DSH bundles above, the setup bundle mounts its own `@dsh-setup/plugin-*`
rows; the root `README.md` plugin table lists them all. The verification gate is inert until an owner
configures it:

- **Verification gate** — `@dsh-setup/plugin-verification-gate` (row `dsh-setup-verification-gate`).
  It refuses to close a code-changing turn until one exact check command succeeds after the last
  edit. The shipped row has no `commands`, so every turn closes as before. To use it, name the check
  in the profile's `cordis.patch.yml` (a patch replaces the whole config, so restate it):

  ```yaml
  - id: dsh-setup-verification-gate
    config:
      commands:
        - pnpm check
  ```

  `maxBlocks` defaults to 8. See [verification-gate.md](verification-gate.md).

## Manual install

Use this path when you cannot run the installer, for example on a CLI-only machine.

1. Open **Plugins** and enable the same bundles listed above. The **Custom plugin markets** toggle adds
   the **Discover** tab.
2. In **Discover**, select **Add index source** and enter:

   ```text
   https://sergey-akhalkov.github.io/dsh-setup/index.json
   ```

3. Select the **dsh-setup** market, open the **dsh-setup** entry, and select **Install**.
4. Confirm the version and its source. The bundle is added to the running profile, its patch applies,
   and the setup rows and owner defaults appear in the composed config.

The full setup also ships two guidance bundles. The packaged Ponytail prompt is always on by default
with its skill available on demand, and the first-party working contract is always on by default with
two skills on demand. See [ponytail.md](ponytail.md) and [principles.md](principles.md) for the prompt
cost, the `alwaysOn: false` opt-outs, and removal.

Individual plugins are listed as their own entries. Installing one mounts only that plugin; use either
the full setup or individual plugins for a given plugin, not both. The Ponytail entry behaves the same
way whether it arrives with the setup or on its own.

## Install without the market

The setup is an ordinary git-hosted bundle. Install a specific release commit directly (for example
when the market is unavailable or you want an exact pin):

```sh
dsh plugin --profile desktop add "git+https://github.com/sergey-akhalkov/dsh-setup.git#<commit>&path:/packages/setup"
```

Quit DeepSeek Harness completely before running that command, then start it again. The commit and
package directory are the same values the market index lists for the release.

## Dogfood on the current machine

From a checkout, `pnpm dogfood` verifies the installer against this machine's own profile **without
changing it**:

1. snapshots the live `desktop` profile's manifest, patch, composed root, and workspace file under
   `.tmp/dogfood-snapshot-*` and hashes the live files it checks;
2. copies `package.json`, `cordis.patch.yml`, `cordis.yml`, `pnpm-workspace.yaml`, and, when present,
   the lockfile and `.npmrc` into a throwaway Harness home as a profile named `owner-copy` (`desktop`
   is never a dogfood target, so the installer cannot take its stop/restart path);
3. runs `install.ps1 -Profile owner-copy -NoStopApp -NoRestart -NoHindsight` against this checkout's
   setup bundle, so dogfood never touches the live Hindsight runtime;
4. composes the copy with the installed CLI and checks that the installer appended only the setup
   bundle and kept it last, the profile patch copy is byte-identical, the installed setup version
   matches the checkout, the setup rows and defaults compose, and every row the owner patched keeps
   its effective config;
5. proves the live profile files are byte-identical afterwards.

The running app is never stopped or restarted and the live profile is never written, so the command is
safe from an agent session or the in-app terminal. It exits non-zero on a failed check, keeps the live
snapshot for recovery, and keeps the throwaway home with `DSH_KEEP=1` for inspection. The owner home
and profile default to the running ones; `DSH_HOME`, `DSH_PROFILE`, and `DSH_CLI` override them.

To install on this machine for real, run the one-command installer from an external PowerShell window:
it closes and restarts DeepSeek Harness itself, after the dogfood run has shown the checkout installs
cleanly against the current profile.

## Update

Rerun the same one command. It resolves the newest released setup version, installs it over the
current one, and fails the verification when the installed version is not the resolved one. When the
resolved version is already current, the run changes nothing and reports that version. The Hindsight
phase is skipped when the runtime is configured and healthy; `-RepairHindsight` forces it.

To pin an exact version or install a checkout, use the downloaded-file form with `-SetupVersion` or
`-SetupSpec`; older listed versions remain installable if you need to pin back.

## Apply local changes from a linked checkout

Check the profile's `dependencies."@dsh-setup/setup"` in `profiles/<name>/package.json` under the
Harness home. When it is `link:<absolute checkout>/packages/setup`, the app reads that checkout
directly; no release or reinstall is involved. After changing an asset or manifest, run `pnpm gen`
(and `pnpm build` for Host/Client code), then **fully quit and relaunch** DeepSeek Harness. A page
reload or a new chat is not enough for an always-on rule: the Host registers it at startup, the
current session keeps the prompt it started with, and new sessions get the new text. A linked
profile also sees uncommitted generated changes on the next restart; settle the checkout before
relaunching if that is not wanted.

When the dependency is a `git+...` or version spec, restarting changes nothing. Commit and push (or
release), then install the new spec with the app fully closed from an external PowerShell; verify the
installer against a copy of the profile with `pnpm dogfood` first. Do not run the live install from a
shell hosted by the running app.

## Serena MCP

The setup configures Serena's symbol-level code tools as a lazy MCP server: `serena` is one of the two
servers in the `dsh-setup-mcp-lazy` row, reached through `mcp_tools` and `mcp_call` (see
[lazy-mcp.md](lazy-mcp.md)). No static adapter row is mounted, so no `mcp__serena__*` tool schema is
sent in each request. The `@dsh-setup/plugin-serena` bundle ships the always-on trigger and the
`serena-discipline` skill that describe the lazy path; see [Serena code guidance](serena.md) for the
rule, its prompt cost and its opt-out.

Prerequisite: `uv`/`uvx` must be on the PATH of the Harness process. The lazy entry runs
`uvx --from serena-agent==1.7.0 serena start-mcp-server ...`; the first call starts the server and
downloads that pinned release, so it can be slow. If a call fails, retry once the download finishes,
or pre-warm it with `uvx --from serena-agent==1.7.0 serena --version`. Without `uv`, the call fails
naming the server and the cause; the Harness and the other lazy servers keep working.

Serena works with a project: the trigger directs the agent to call `get_current_config` first and
`activate_project` on the session's working directory when no project is active. One Serena instance
serves the whole profile, so switching the active project in one session changes it for the others,
and a restarted server starts with no project. Serena's tools run in its own process and edit the
activated project directly; the MCP tool call is the approval gate.

To stop the Serena server, override the lazy row without `serena`; a patch replaces the whole
`servers` list, so restate the entries you keep:

```yaml
- id: dsh-setup-mcp-lazy
  config:
    servers:
      - serverName: nuphus-mcp
        transport: stdio
        command: nuphus-mcp
        args: ["--confirm-write"]
        toolCallTimeoutMs: 120000
```

To keep the server but drop only the always-on trigger, set `alwaysOn: false` on the
`dsh-setup-serena-guidance` row in the same file; the `serena-discipline` skill stays cataloged.

## Nuphus MCP

The setup ships Nuphus behind the lazy MCP proxy: `nuphus-mcp` desktop automation (screen
and window control, mouse and keyboard, accessibility-driven UI actions, local OCR plus BYOK vision,
and a Chrome/Edge session over CDP) is reached through `mcp_tools` and `mcp_call` with
`server: nuphus-mcp`. No `mcp__nuphus-mcp__*` tool schema is sent in each request, and the setup
mounts no static adapter row. The bundle also ships a `nuphus-discipline` skill for the lazy path. It
is optional and can be turned off (see below).

Prerequisite: install the server yourself and keep its command on the PATH of the Harness process:

```sh
npm install -g @nuphus/nuphus-mcp
nuphus-mcp   # prints nothing and exits on stdin EOF — that is the expected smoke test
```

Without the binary the Harness still starts: the lazy row starts nothing until a call targets it,
and that first `mcp_tools`/`mcp_call` fails naming the server and the cause. The setup does not
install, pin, or update the server: it launches whichever `nuphus-mcp` the PATH resolves (tested with
0.2.2), so a server upgrade changes the tool set.

The tools act on the machine that runs the Harness, in its interactive session: a remote `dsh web`
and a Desktop window control the machine hosting the Host process, not the viewer's. Browser tools
need Chrome or Edge. Platform support follows the server: full desktop control on Windows,
accessibility plus mouse and keyboard on macOS (grant Accessibility permission), partial on Linux.
One server instance serves the whole profile, so concurrent sessions share the same browser and input
state. The first lazy call pays the server's startup; later calls reuse that process until the plugin
unloads. The first `desktop_perceive` also downloads the local OCR models, so it can exceed the
two-minute tool-call timeout — retry once the download finishes. `desktop_screenshot` without a
`path` returns an image, which the lazy proxy does not project in this version; pass `path`, save the
PNG, and read it with `read_image`.

Write tools confirm by default: the setup's lazy entry passes `--confirm-write`, so a machine-mutating
tool call needs the call's explicit confirmation argument and is rejected otherwise. To relax that,
override the lazy row in the profile's own `cordis.patch.yml` and restate the complete `servers` list —
a patch replaces the `config` object rather than merging it:

```yaml
- id: dsh-setup-mcp-lazy
  config:
    servers:
      - serverName: nuphus-mcp
        transport: stdio
        command: nuphus-mcp
        args: []
        toolCallTimeoutMs: 120000
      - serverName: serena
        transport: stdio
        command: uvx
        args:
          - "--from"
          - "serena-agent==1.7.0"
          - serena
          - start-mcp-server
          - "--context=vscode"
          - "--enable-web-dashboard=false"
          - "--enable-gui-log-window=false"
        toolCallTimeoutMs: 120000
```

The BYOK vision key is not inherited from the Harness environment, because the MCP client scrubs
credential-shaped variables before it spawns the server. Add `env` to the `nuphus-mcp` entry in the
complete `servers` list from [lazy-mcp.md](lazy-mcp.md#configuration):

```yaml
- serverName: nuphus-mcp
  # … the rest of the Nuphus entry …
  env:
    NUPHUS_MCP_VISION_API_KEY: !!js process.env.NUPHUS_MCP_VISION_API_KEY
```

To use the static adapter instead of the lazy entry, insert an `@deepseek-ai/dsh-mcp-client` row in
the profile's own patch and remove the Nuphus entry from the lazy list (restate the remaining
servers):

```yaml
- insert:
    - id: dsh-setup-nuphus-static
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: nuphus-mcp
        transport: stdio
        command: nuphus-mcp
        args: ["--confirm-write"]
        toolCallTimeoutMs: 120000
        failOnStartupError: false
```

To keep Nuphus off, remove its entry from the lazy list and restate the servers you keep — the Serena
entry, or an empty list:

```yaml
- id: dsh-setup-mcp-lazy
  config:
    servers: []
```

A profile that adds a static row and leaves the lazy Nuphus entry in place has two homes: the lazy
call fails with a one-home error naming the adapter row or the conflicting tool and starts no second
process. The setup never edits the profile patch, and a stale override on the retired
`dsh-setup-nuphus-mcp` or `dsh-setup-serena` row is a no-op because that row no longer exists.

Do not install the upstream `dsh-nuphus-mcp` plugin together with the setup: both would mount a row
that spawns the same server. The same one-home rule applies inside the profile.

## OpenSpec

The setup ships the six core OpenSpec skills from `@dsh-setup/plugin-openspec`. The catalog lists them
in every session, a skill body loads only when invoked, and the skills work on the workspace's own
`openspec/` root.

Prerequisite: the `openspec` CLI must be on the PATH of the Harness process. Install the pinned
release yourself; the setup does not install runtime prerequisites:

```sh
npm install -g @fission-ai/openspec@1.15.0
```

Without the CLI, the skills stay listed and every command fails with a "command not found" error.
First use in a workspace runs `openspec init --tools none` at the workspace root. If the workspace
already has `.dsh/skills/openspec-*` copies from an earlier skill-installing init, delete them so the
packaged definitions win. See [openspec.md](openspec.md) for the full workflow and update contract.

## Hindsight memory

The setup ships `@dsh-setup/plugin-hindsight`, which mounts the official native
`@vectorize-io/hindsight-coding-agents@0.8.2` DSH entry point and defaults it to a local
`hindsight-embed` daemon at `http://127.0.0.1:8888`. The one-command installer provisions that local
runtime as a second phase, after the profile is installed and verified. The runtime is machine-level
and lives under `%USERPROFILE%\.hindsight`; the setup bundle only mounts the row.

Prerequisites: Windows PowerShell 5.1+, `uv` on `PATH`, network access, and a DeepSeek API key. The
key comes from `-DeepSeekApiKey`, `DEEPSEEK_API_KEY`, `%USERPROFILE%\.hindsight\deepseek.key`, the
existing Hindsight profile, or a secure prompt. The phase installs or updates the pinned
`hindsight-embed`, configures the daemon and TLS trust, registers the logon start, writes the
machine-local coding-agent configuration, and verifies a retain/recall round-trip.

The phase runs only after the profile phase and its verification, so a plugin update never asks for
the key or the export location before the plugins are installed. It is skipped, with no prompt and
no write, when the runtime is already configured and healthy: the default profile and API version
are current, the pinned tool is installed, a key resolves without prompting, the coding-agent
configuration and TLS bundle exist, and `/health` reports a healthy connected database. The logon
task and the export configuration are optional for that decision.

When `uv` or a key source is missing, the installer warns, skips the phase, leaves the plugins
installed, exits successfully, and prints the next action. A failure once the phase starts (a
rejected key, an invalid export location, a foreign listener, a failed daemon or retain/recall
check) exits non-zero and states that the profile was installed; DeepSeek Harness is still
restarted. The phase is idempotent and never discards memory data.

The Hindsight-only path remains available for repairs and for `restore-hindsight.ps1`:
`setup-hindsight.ps1` is a thin forwarder to `install.ps1 -HindsightOnly`, and the documented
Hindsight-only URL still works. Use `-NoHindsight` to skip the phase, `-HindsightOnly` to run only
it, and `-RepairHindsight` to force it past the readiness check. See [Hindsight](hindsight.md) for
the options, data locations, opt-out, costs, and the official-installer alternative that must not
be combined with this row.

## What is not included

- Credentials and provider keys: authenticate in the app; nothing secret is in the repository.
- Runtime prerequisites such as `uv` for the Serena lazy server and the local Hindsight runtime,
  `@nuphus/nuphus-mcp` for the Nuphus lazy server, or `@fission-ai/openspec` for the OpenSpec
  skills: install them yourself; the setup does not run system installers. The installer's Hindsight
  phase starts the local daemon when `uv` and a key are available; a missing prerequisite warns and
  skips that phase.
- Your profile's local overrides: these stay in the profile's own patch file.
- Your own agent skills and instructions: they live in `~/.agents` and are consumed independently.
  The setup does ship packaged third-party content: the Ponytail prompt, whose vendored bytes and
  upstream pin are documented in [ponytail.md](ponytail.md), and the OpenSpec core skills, documented
  in [openspec.md](openspec.md).
