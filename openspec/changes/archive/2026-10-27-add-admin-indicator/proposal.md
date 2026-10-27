# Proposal

## Why

DeepSeek Harness Desktop can be started with Windows administrator rights, but the app gives no persistent, trustworthy indication of the OS privilege level. The composer's “Full access” control is a per-session tool permission and is easily mistaken for OS elevation, so a user cannot tell whether tools, terminals, MCP servers, and subagents run elevated. The setup also provides no ergonomic administrator launch path.

## What Changes

- Add the `@dsh-setup/plugin-admin-indicator` bundle with a Host half and a Client half; the setup mounts it like every other plugin.
- The Host detects its own Windows token elevation (`whoami /groups`, mandatory-label SID), caches the result, and exposes it through a read-only `webServer` route; other platforms report an unknown state.
- The Client registers a compact shield in the supported additive `conversation.input.left` slot, immediately after the session permission control. The shield displays the visible label **Standard user** or **Administrator**, collapses to the shield at narrow widths, distinguishes the two states, carries an accessible label and a passive tooltip, and opens a small menu with the state explanation, a **Create admin desktop shortcut** button, and a **Restart DSH as Administrator** button. The buttons submit the fixed `/admin-shortcut` and `/admin-restart confirm` commands through the authenticated composer input directly; no manual submission is needed, and the commands remain available for manual use.
- The Host creates a fixed `DeepSeek Harness (Administrator).lnk` on the current user's Desktop through the DSH authenticated session with a fixed name and target and no client-supplied paths. The shortcut launches the installed app through UAC; the plugin never elevates the running process and exposes no unauthenticated HTTP action route.
- The confirmed **Restart DSH as Administrator** button executes `/admin-restart confirm` directly through the authenticated session, closes the running Desktop app, and immediately starts a new instance through UAC. The Host uses a fixed, detached Windows script because it has no Electron lifecycle API; the script targets only the owning Desktop process tree, the menu warns that the current session ends, and the action is unavailable when already administrator or outside the Desktop app.
- `install.ps1` creates the same administrator shortcut by default and reports it. `-DryRun` and `-NoDesktopShortcut` skip it, rerunning is idempotent, and a missing Desktop installation is a warning rather than a failed install.
- Document the difference between session permission and OS elevation, the quit-before-relaunch flow, the UAC prompt, the shortcut, the restart, and the installer switches; add the plugin's market locale and icon.
- No titlebar, preload, or foreign-DOM changes; no scheduled task or privileged service. The only app restart is the explicit, confirmed administrator restart action.

## Capabilities

### New Capabilities

- `admin-indicator`: Windows OS elevation status, the labeled compact composer indicator with its menu, the administrator desktop-shortcut action, and the confirmed administrator restart.

### Modified Capabilities

- `portable-setup`: the installer creates the administrator desktop shortcut by default, with explicit skip options for validation and unattended runs.

## Impact

- New package `packages/plugin-admin-indicator` (Host + Client), its build output, tests, market metadata, and setup vendoring.
- `install.ps1` gains a Desktop shortcut step and a `-NoDesktopShortcut` switch; the installer validation and dogfood paths pass the switch.
- Documentation: `README.md`, `docs/plugins.md`, `docs/install.md`.
- No breaking changes: the plugin is additive, Windows-only in behavior, and hidden on unsupported platforms.
