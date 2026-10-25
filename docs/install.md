# Install the setup

The setup is one DeepSeek Harness bundle plus the shipped bundles it expects. The primary installation
path is one command: [`install.ps1`](../install.ps1) enables the required bundles through the same
mechanism as the Plugins page, installs the setup bundle at the latest release, and restarts DeepSeek
Harness. It never edits your profile's own `cordis.patch.yml`, so machine-local preferences keep
winning.

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
2. Closes DeepSeek Harness (profile writes need the app fully quit) and saves a copy of the profile
   manifest under `$DSH_HOME/.dsh-setup-backups/`.
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

Individual plugins are listed as their own entries. Installing one mounts only that plugin; use either
the full setup or individual plugins for a given plugin, not both.

## Install without the market

The setup is an ordinary git-hosted bundle. Install a specific release commit directly (for example
when the market is unavailable or you want an exact pin):

```sh
dsh plugin --profile desktop add "git+https://github.com/sergey-akhalkov/dsh-setup.git#<commit>&path:/packages/setup"
```

Quit DeepSeek Harness completely before running that command, then start it again. The commit and
package directory are the same values the market index lists for the release.

## Update

The market has no in-place upgrade action. To update, install the newer version from its entry page
(or re-run the git specification with the newer commit), or rerun `install.ps1` after passing
`-SetupVersion`. The previous version is replaced; older listed versions remain installable if you
need to pin back.

## What is not included

- Credentials and provider keys: authenticate in the app; nothing secret is in the repository.
- Your profile's local overrides: these stay in the profile's own patch file.
- Agent skills and instructions: they live in `~/.agents` and are consumed independently.
