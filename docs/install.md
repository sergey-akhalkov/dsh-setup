# Install the setup

The setup is one DeepSeek Harness bundle plus the shipped bundles it expects. The primary installation
path is one command: [`install.ps1`](../install.ps1) enables the required bundles through the same
mechanism as the Plugins page, installs the setup bundle at the latest release, and restarts DeepSeek
Harness. It never edits your profile's own `cordis.patch.yml`, so machine-local preferences keep
winning.

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

## One command

Run this in PowerShell:

```powershell
$installer = Join-Path $env:TEMP 'dsh-setup-install.ps1'
Invoke-WebRequest https://raw.githubusercontent.com/sergey-akhalkov/dsh-setup/main/install.ps1 -OutFile $installer
& $installer
```

The script:

1. Reads the running CLI and DSH version and refuses an unsupported one.
2. Closes DeepSeek Harness (profile writes need the app fully quit) and saves copies of the profile
   manifest, patch, and composed root under `$DSH_HOME/.dsh-setup-backups/` before anything changes.
3. Enables the shipped bundles the setup expects by appending their names to `dsh.profile.bundles` —
   exactly the operation behind the **Plugins** toggles. The profile patch is not touched.
4. Installs `@deepseek-ai/dsh-subagent-codex` at the running DSH version with
   `dsh plugin --profile desktop add`, then installs the setup bundle from the pinned release commit.
5. Verifies the selection, the installed setup version, that the setup bundle is last in
   `dsh.profile.bundles` (so its defaults outrank the shipped layers), and that `cordis.patch.yml`
   is byte-identical to before.
6. Starts DeepSeek Harness again.

Running the command a second time is safe: it keeps existing selections, installs nothing new, and
reports the same profile state.

### Installer options

| Option                  | Meaning                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `-DryRun`               | Print the plan and change nothing.                                                     |
| `-Profile <name>`       | Profile to install into. Default `desktop`.                                            |
| `-DshHome <path>`       | Harness home. Default `$env:DSH_HOME`, else `~/.dsh`.                                  |
| `-DshCli <path>`        | CLI to use. Default `dsh` on PATH, else the Desktop CLI.                               |
| `-SetupVersion <x.y.z>` | Install that exact release instead of the newest one listed in the index.              |
| `-SetupSpec <spec>`     | Install an explicit package spec, for example a checkout's `packages/setup` directory. |
| `-NoStopApp`            | Abort instead of closing a running DeepSeek Harness; quit the app and rerun.           |
| `-NoRestart`            | Leave DeepSeek Harness closed after installing.                                        |
| `-IndexUrl <url>`       | Market index used to pin the release. Default: the published Pages index.              |

When the script is inside a full checkout of this repository it installs that checkout's
`packages/setup`; pass `-SetupVersion` or `-SetupSpec` to install a released bundle instead.

## Bundles the setup enables

These are shipped optional bundles in DSH `0.2.1-rc.3`. The installer selects them; the setup bundle
does not duplicate their rows or add them itself.

- **Agent Teams** — `@deepseek-ai/dsh-experimental-agent-team-profile`
- **Tool worktree** — `@deepseek-ai/dsh-experimental-tool-worktree`
- **Ralph** — `@deepseek-ai/dsh-experimental-ralph-bundle`
- **Custom plugin markets** — `@deepseek-ai/dsh-experimental-plugin-market-bundle`
- **Session search** — `@deepseek-ai/dsh-experimental-session-search`
- **Terminal** — `@deepseek-ai/dsh-experimental-terminal-bundle`
- **Codex subagent** — `@deepseek-ai/dsh-subagent-codex` (installed from the registry, not shipped)

The list is the single source in [`dsh.json`](../dsh.json) (`installBundles`); the standalone installer
contains its own copy, and repository validation fails if the two disagree.

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
   and the composer-clock plugin appears in the conversation composer dock.

The full setup also ships the packaged Ponytail prompt: its compact ruleset is always on by default
and its skill is available on demand. See [ponytail.md](ponytail.md) for the prompt cost, the
`alwaysOn: false` opt-out, and removal.

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
3. runs `install.ps1 -Profile owner-copy -NoStopApp -NoRestart` against this checkout's setup bundle;
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

The market has no in-place upgrade action. To update, install the newer version from its entry page
(or re-run the git specification with the newer commit), or rerun `install.ps1` after passing
`-SetupVersion`. The previous version is replaced; older listed versions remain installable if you
need to pin back.

## Serena MCP

The setup also ships the Serena adapter bundle, which adds Serena's symbol-level code tools through
the Harness MCP client. It is optional and can be disabled (see below).

Prerequisite: `uv`/`uvx` must be on the PATH of the Harness process. The adapter runs
`uvx --from serena-agent==1.7.0 serena start-mcp-server ...`; the first start downloads that pinned
release, so the first connection can be slow. If the tools do not appear after the first start,
restart DeepSeek Harness once, or pre-warm the download with
`uvx --from serena-agent==1.7.0 serena --version`. Without `uv`, the Harness still starts and logs the
failed connection; no Serena tools are added.

Serena works with a project: on first use, ask the agent to activate the current project with Serena
(the adapter's built-in instructions point it at `activate_project`). One Serena instance serves the
whole profile, so switching the active project in one session changes it for all sessions. Serena's
tools run in its own process and edit the activated project directly; the MCP tool call is the
approval gate.

To disable the adapter, add this to the profile's own `cordis.patch.yml`:

```yaml
- id: dsh-setup-serena
  disabled: true
```

## What is not included

- Credentials and provider keys: authenticate in the app; nothing secret is in the repository.
- Runtime prerequisites such as `uv` for the Serena adapter: install them yourself; the setup does not
  run system installers.
- Your profile's local overrides: these stay in the profile's own patch file.
- Your own agent skills and instructions: they live in `~/.agents` and are consumed independently.
  The setup does ship one packaged third-party prompt, Ponytail, whose vendored bytes and upstream pin
  are documented in [ponytail.md](ponytail.md).
