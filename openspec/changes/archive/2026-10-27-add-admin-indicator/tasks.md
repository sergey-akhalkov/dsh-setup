# Tasks

## 1. Plugin package and Host status

- [x] 1.1 Create `packages/plugin-admin-indicator` with its manifest, fragment, locale, icon, TypeScript project, root `tsconfig.json` reference, and minimal Host/Client entries; verify `pnpm install` and `pnpm build` produce `lib/index.js`, `lib/index.d.ts`, and `lib/client.js`.
- [x] 1.2 Implement the Host elevation detection and the read-only status route; add unit tests for the mandatory-label parser, the cached status, and the route response; verify with `pnpm exec vitest run packages/plugin-admin-indicator/test/elevation.test.ts` and `pnpm typecheck`.

## 2. Host shortcut action

- [x] 2.1 Implement the fixed administrator shortcut script, Desktop/app resolution, same-origin POST route, and result reporting; add unit tests for the script, the shortcut name, the executable guard, and the origin check; verify with `pnpm exec vitest run packages/plugin-admin-indicator/test/shortcut.test.ts`.

## 3. Client indicator and menu

- [x] 3.1 Implement the Client status fetch and the compact `conversation.input.left` badge with standard/administrator treatments, accessible label, and tooltip; add the client bundle test that checks the package id, the service inject list, and the `conversation.input.left` registration; verify with `pnpm exec vitest run packages/plugin-admin-indicator/test/client.test.ts` and `pnpm build`.
- [x] 3.2 Implement the badge menu with the native `Menu`/`Modal`/`Button` primitives, state explanation, “Create admin desktop shortcut” action, restart confirmation, composer command submission, and draft/reference/attachment protection; extend the client bundle test for the menu registration and verify with `pnpm exec vitest run packages/plugin-admin-indicator/test/client.test.ts` and `pnpm typecheck`.

## 4. Setup delivery

- [x] 4.1 Run `pnpm gen` and `pnpm build`; verify `pnpm gen:check`, the generated setup patch row `dsh-setup-admin-indicator`, and the vendored `packages/setup/node_modules/@dsh-setup/plugin-admin-indicator/lib/client.js` plus its `dsh.client` manifest.
- [x] 4.2 Install the generated setup into a throwaway Web profile, serve its Web UI, and verify in the browser that the composer shows the admin badge in `conversation.input.left` and that the menu opens. The setup delivery MUST succeed; an individually installed copy is only for diagnosis and must not replace this check.

## 5. Installer and documentation

- [x] 5.1 Add the administrator shortcut step and the `-NoDesktopShortcut` switch to `install.ps1`, resolve the app executable from the Start Menu shortcut with the per-user path fallback, skip on `-DryRun`, warn on a missing app, and pass `-NoDesktopShortcut` from `scripts/validate-installer.ts` and `scripts/dogfood.ts`; verify with `install.ps1 -DryRun` output and the updated installer exercise arguments.
- [x] 5.2 Update `README.md` (plugin count and table), `docs/plugins.md` (the Client-half package shape), and `docs/install.md` (administrator shortcut, UAC, quit-before-relaunch, `-NoDesktopShortcut`); verify with `pnpm lint` and the documented commands.

## 6. Administrator label and restart

- [x] 6.1 Add the visible “Standard User”/“Administrator” label with the permission control's compact narrow-width treatment and the “Create admin desktop shortcut” action: native `Menu`/`Modal`/`Button`/`Toast` components, leading icons, authenticated shortcut POST route, native success/error toast, no composer mutation, and the `restart` feature flag default disabled (its UAC-first helper and composer command remain dormant for later live verification); remove the action token; unit tests; regenerate the setup vendor; update the documentation; verify with the client/Host tests, `pnpm typecheck`, `pnpm gen:check`, and `pnpm validate:repo`. The owner has used the shortcut successfully; restart is intentionally hidden behind the default-off flag.

## 7. Integration checks

- [x] 7.1 Run `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, and `pnpm build`; verify the plugin tests, the client bundle, the generated setup files, and the installer skip path all pass, then inspect the worktree for unexpected files.
- [x] 7.2 Run the optional integration review on the completed worktree and fix any P0/P1 findings; the final record is `PASS` (digest `995667964b18`, zero findings).

## Workflow follow-up

- Owner restarts the linked live Desktop profile and confirms the composer badge label in standard mode, launches the administrator shortcut with UAC, and confirms the administrator state.
- Owner tests “Restart DSH as Administrator” from the standard Desktop app, accepts the UAC prompt, and confirms the new instance is administrator.
- Owner runs the documented installer from an external PowerShell window and confirms the Desktop shortcut is created automatically.
- Archive the change after the review requirements are satisfied.
