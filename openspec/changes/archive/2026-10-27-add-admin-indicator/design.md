# Design

## Context

See `proposal.md` for motivation. The current DSH 0.2.1-rc.3 surface relevant to this change:

- The composer tool row renders `[+]`, the session permission control, the plan control, the additive `conversation.input.left` list, then the trailing model/activity/submit group. `conversation.input.left` is a supported list slot with `replaceRisk: none` and is empty today.
- The Desktop window is a 40 px caption strip drawn by Electron. Its `Application / Edit` menu is injected by the preload into a shadow root; the sidebar toggle is Web UI. There is no supported Web slot between them.
- The Host serves the Web UI and exposes the `webServer` service, whose `register` accepts exact routes. The Host is a child of the Desktop main process, so it inherits the app's Windows token. The app's single-instance lock is claimed by the first process at boot.
- The setup currently ships only Host-only plugins. The build already supports Client halves, but the setup has never delivered one through its vendored tree.
- `install.ps1` has `-DryRun`, `-NoStopApp`, and `-NoRestart`; repository validation and dogfood invoke it on throwaway profiles.

## Goals / Non-Goals

**Goals:**

- Make the OS privilege level visible next to the session permission control without confusing the two.
- Provide a discoverable administrator shortcut creation action and create the same shortcut from the installer.
- Offer a confirmed restart into administrator mode that closes the current app and starts a new elevated instance.
- Keep the running app's privilege level unchanged in place; elevation happens only in a new process after UAC.
- Add no dependency on titlebar/preload internals and no new third-party UI package; reuse the app's existing primitives.

**Non-Goals:**

- Scheduled tasks, privileged services, persistent elevated helpers, or per-command elevation.
- Replacing the session permission control or the shell titlebar.
- Administrator indicators on macOS or Linux.
- Changing the single-instance lock or the profile lifecycle.

## Decisions

### D1: Indicator placement is the composer’s additive `conversation.input.left` slot

The badge is a list entry in `conversation.input.left`, ordered after the permission and plan controls, so it renders in the same row on the right of “Full access”. This is a supported additive slot with no replacement risk; it avoids the preload menu, the caption-strip CSS variables, and foreign DOM. The badge is shown only with a session, exactly like the permission control it sits next to.

Alternative rejected: titlebar overlay plus a shifted caption menu. It uses internal layout values and can break on DSH updates.

### D2: The Host is the source of truth for the OS state

The Host runs `whoami.exe /groups` on the first status request, matches the mandatory-label SID (`S-1-16-12288` High or `S-1-16-16384` System), caches the result for the process lifetime, and serves `GET /plugins/dsh-setup-admin-indicator/status`. The SID is locale-independent even though the label text is localized. The response states only the platform, the elevation state, and whether the Desktop actions are available; it carries no secret and needs no authentication. Outside Windows, or on a detection failure, the state is `unknown` and the Client hides the indicator.

Alternative rejected: injecting a global into the index HTML. The elevation detection is asynchronous and the index event is synchronous; a route lets the Client await the result and retry cleanly.

### D3: Shortcut creation is a fixed authenticated action

The shortcut action is a fixed same-origin POST route. The Client calls it from the menu; the Host authenticates the request through the DSH connection service (`connection.requestRejection`), which validates the Host/Origin fence and live browser credential, and accepts no client-supplied path, name, or executable. The action does not read or modify the composer, so it works with any draft or attachment. The `/admin-shortcut` command remains available for manual use. The Host resolves the executable itself and passes no client value into the script. The action reports success or a sanitized failure as a native toast and is available only when the running process is the Electron-owned Desktop Host. The shortcut targets Windows PowerShell with `Start-Process -FilePath <app> -Verb RunAs`, so the launch shows the standard UAC prompt and starts an elevated app. The running app is not restarted.

Alternative rejected: setting the native `SLDF_RUNAS_USER` shortcut flag through COM interop. It makes a cleaner direct shortcut, but adds a large interop surface; it can be a later polish without changing the command contract.

### D4: The installer creates the same shortcut by default

`install.ps1` gains a `-NoDesktopShortcut` switch and creates the same shortcut after the setup install. It resolves the executable from the existing DeepSeek Harness Start Menu shortcut, then from the default per-user installation path. A missing app is a warning, not a failed install. `-DryRun` and `-NoDesktopShortcut` skip the step; repository validation and dogfood pass the switch so they never touch the real Desktop. Rerunning replaces the same file and does not touch the profile.

### D5: The Client UI reuses the native Harness primitives

The badge itself is inline SVG styled with the composer's existing tokens, matching the permission trigger. The menu, confirmation, and result feedback reuse the app's existing `@deepseek-ai/dsh-client-ui-primitives` components (`Menu`, `Button`, `Modal`, `Toast`), declared in `dsh.client.external`; the primitive package is already loaded by the app because the session permission surface uses it. The menu therefore gets the exact native surface, menu rows, icons, hover/focus treatment, keyboard walk, anchoring, and dismissal behavior as the permission control. The confirmation uses the native modal and buttons; the shortcut result uses the native success/error toast. The badge trigger mirrors the permission trigger's 28 px control, 13 px label, hover fill, focus ring, and container-query label collapse. There is no hand-built popup or button styling left to drift from the Harness design.

Alternative rejected: the earlier hand-built menu and buttons. They required custom portal, positioning, focus, and surface CSS, and the result did not match the existing permission menu.

### D6: No in-process elevation

Neither the indicator nor the shortcut action changes the running process. The status is a report; the shortcut is an external launch path. The separate restart action (D9) closes the current app only after an explicit confirmation and starts a new elevated process through UAC; the running process is never elevated in place. The docs and menu state that the current app must be closed before launching the administrator shortcut, because the Desktop single-instance lock and mixed integrity levels are not a supported handoff.

### D9: The administrator restart is a confirmed, UAC-first elevated helper

The restart action is behind a row feature flag named `restart`, default disabled; while disabled the menu offers only the shortcut and the Host registers no restart command. When enabled, the menu submits `/admin-restart confirm` through the authenticated composer input after confirmation; the action is enabled only when the composer has no draft, no inline reference, no attachment, and is not submitting. The Host validates the Electron-owned Desktop Host identity, spawns a detached PowerShell launcher from a fixed template, and returns. The launcher only requests UAC and starts the fixed elevated payload; because the payload is created through the UAC broker, it is outside the Desktop job and survives the app it closes. The Host is spawned by the Electron main, so the payload roots at the Host's parent PID—the owning Desktop process—and acts only on that tree; it never walks above that parent, so an independent Web-profile or CLI ancestor/sibling sharing the executable name survives. It asks the current Desktop window to close, force-closes the remaining tree after a short 2-second grace, and starts the installed executable from the already-elevated payload. Declining UAC leaves the current app running. The Client requires an explicit confirmation, warns that the current session ends, and the command reports the Host result. The action is unavailable outside the Desktop app and when the state is already `administrator`.

Alternatives rejected: the Host has no Electron quit/relaunch API; a scheduled task or privileged service would silently elevate; killing the app from the Host itself would die with the app. An unelevated detached script is killed with the Desktop job before it can start the replacement, so the UAC-first helper is required.

### D8: The badge carries a visible state label

The shield is followed by the visible label “Standard user” or “Administrator” while the composer has room; at narrow widths the label collapses to the shield, matching the permission control, and the accessible name and tooltip carry the state. The native menu's state label repeats it. The label is visible in both states, not only in administrator mode, so the badge reads as a status control rather than an alarm.

### D7: The setup vendor and Web client delivery are verified as part of the change

The plugin declares `dsh.client` and ships `lib/client.js`; `pnpm gen` vendors it into the setup and `pnpm build` emits the wrapped module. Because this is the setup’s first Client half, implementation includes a verification step: install the generated setup into a throwaway profile, serve its Web UI, and confirm the `conversation.input.left` occupant and the badge render. If the vendored Client half is not discovered, the setup delivery fails: fix the vendored discovery and repeat the setup check. An individually installed copy is for diagnosis only and must not replace this check.

## Risks / Trade-offs

- **Whole-app administrator mode widens the blast radius.** Every tool, terminal, MCP server, subagent, and browser action inherits the Host token; a prompt injection becomes administrator-level execution. Mitigation: the indicator names the state, the docs warn, and the standard shortcut remains the default daily launch.
- **First Client half through the vendored setup.** The setup has no precedent for delivering a Client bundle. Mitigation: the throwaway-profile Web UI check in the implementation tasks; fallback to an individually installed plugin if the setup path fails.
- **The Client half depends on the app's primitives module.** The menu, modal, buttons, and toast come from `@deepseek-ai/dsh-client-ui-primitives`. Mitigation: the app's own permission surface uses the same module, the dependency is version-pinned, and the client bundle marks it external rather than bundling a second copy.
- **Mixed-elevation single-instance behavior is not a supported handoff.** The shortcut and the restart script close the current app before starting the elevated instance; the script force-closes remaining owner-tree processes after a short grace. Mitigation: the restart warns that the session ends and the user confirms; the docs keep the quit-first flow.
- **The detached restart can lose the current session.** The script cannot invoke Electron's graceful quit; it asks the main window to close and force-closes the owner tree after 2 seconds. Mitigation: the confirmation and warning; the session data DSH already persists; the action is opt-in per click.
- **A declined UAC after restart leaves DSH closed.** Mitigation: the menu warns; the user can relaunch DSH manually; no elevated process starts.
- **UIPI and shell integration.** An elevated Electron window may reject file drag-and-drop from Explorer and some shell actions. Mitigation: document it as a known cost of administrator mode; it does not affect the standard mode.
- **The shortcut launcher depends on Windows PowerShell and the app path.** The shortcut uses the installed executable and a fixed name; an app reinstall at another path needs recreation, and the indicator menu can repair it. Mitigation: the menu action is the repair path; the native RunAs flag remains a later option.
- **The installer writes a user-visible file.** Mitigation: `-NoDesktopShortcut` for validation and unattended runs; `-DryRun` reports without writing; a missing app only warns.
- **The composer badge is session-scoped.** The OS state is app-wide but the badge appears with a session, like the permission control. Mitigation: the menu explains the scope; a global header placement can be added later without changing the status contract.

## Migration Plan

1. Add the plugin package, Host routes, Client badge, tests, locale, and icon.
2. Run `pnpm install`, `pnpm gen`, and `pnpm build`; commit the generated setup manifest, patch, vendored tree, and `lib/` output as the repository requires.
3. Add the installer shortcut step and `-NoDesktopShortcut`; update the installer exercise and dogfood invocations.
4. Update the documentation and the plugin count.
5. Verify the generated setup in a throwaway profile, run the full check suite, and have the owner restart the linked live profile to see the composer badge.
6. Rollback is removing the plugin package, its setup patch row/vendored copy, the installer shortcut step, and the docs; the shortcut on the Desktop is a user file and can be deleted manually.

## Open Questions

None blocking. The mixed-elevation instance behavior is a verification item, not a design choice: the design does not attempt the handoff and documents the quit-first flow.
