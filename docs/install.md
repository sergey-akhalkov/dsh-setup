# Install the setup

The setup is one DeepSeek Harness bundle. Installing it from the plugin market adds every plugin
package to your profile, mounts their rows, and applies the owner defaults. Installing it does not
edit your profile's own `cordis.patch.yml`, so machine-local preferences keep winning.

## Prerequisites

- DeepSeek Harness Desktop (or the `dsh` CLI) at a supported version. The current support window is
  recorded in [`dsh.json`](../dsh.json); a bundle whose `engines.dsh` does not match is refused by
  Harness at install time.
- The **Custom plugin markets** experimental bundle enabled: open **Plugins**, find the experimental
  bundles, and switch on **Custom plugin markets**. The **Discover** tab appears beside **Installed**.

## One-time experimental bundles

The setup expects the same shipped experimental capabilities the owner uses. Enable each one once in
**Plugins** before or after installing the setup; these are profile-level bundle selections that no
third-party bundle may add on your behalf:

- **Agent Teams** — `@deepseek-ai/dsh-experimental-agent-team-profile`
- **Ralph** — `@deepseek-ai/dsh-experimental-ralph-bundle`
- **Session search** — `@deepseek-ai/dsh-experimental-session-search`
- **Tool worktree** — `@deepseek-ai/dsh-experimental-tool-worktree`
- **Custom plugin markets** — `@deepseek-ai/dsh-experimental-plugin-market-bundle`
- **Codex subagent** (optional) — `@deepseek-ai/dsh-subagent-codex`

Capabilities that belong to a disabled bundle are simply absent; the setup still installs and
composes.

## Install from Discover

1. Open **Plugins** and select **Discover**.
2. Select **Add index source** and enter:

   ```text
   https://sergey-akhalkov.github.io/dsh-setup/index.json
   ```

3. Select the **dsh-setup** market, open the **dsh-setup** entry, and select **Install**.
4. Confirm the version and its source in the confirmation dialog. Installation is live: the bundle
   is added to the running profile, its patch applies, and the composer-clock plugin appears in the
   conversation composer dock.

Individual plugins are listed as their own entries. Installing one mounts only that plugin; use
either the full setup or individual plugins for a given plugin, not both.

## Install without the market

The setup is an ordinary git-hosted bundle. Install a specific release commit directly (for example
when the market is unavailable or you want an exact pin):

```sh
dsh plugin --profile desktop add "git+https://github.com/sergey-akhalkov/dsh-setup.git#<commit>&path:/packages/setup"
```

Quit DeepSeek Harness Desktop completely before running that command, then start it again. The
commit and package directory are the same values the market index lists for the release.

## Update

The market has no in-place upgrade action. To update, install the newer version from its entry page
(or re-run the git specification with the newer commit). The previous version is replaced; older
listed versions remain installable if you need to pin back.

## What is not included

- Credentials and provider keys: authenticate in the app; nothing secret is in the repository.
- Your profile's local overrides: these stay in the profile's own patch file.
- Agent skills and instructions: they live in `~/.agents` and are consumed independently.
