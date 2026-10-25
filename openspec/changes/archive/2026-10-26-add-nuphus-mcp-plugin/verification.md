# Verification

## Scope

Smoke-test the Nuphus adapter row and its confirmation gate on the supported Harness version
(`0.2.1-rc.3`, Windows) with the owner-installed `nuphus-mcp` `0.2.2`, then prove the row composes in
a throwaway profile.

## Composition

`pnpm validate:composition` initialized a throwaway `ci` profile from the `web` template, installed
`packages/setup` by absolute path, and found both shipped adapter markers — `dsh-setup-nuphus-mcp` and
`@deepseek-ai/dsh-mcp-client` — in the composed `--dump-config` output. All five checks passed.

## Direct MCP verification

A minimal MCP stdio client (`initialize` → `tools/list` → `tools/call`) ran the exact adapter command
from the shipped fragment, `nuphus-mcp --confirm-write`, resolved through the Windows PATH shim:

- `initialize` returned `{"name":"nuphus-mcp","version":"0.2.2"}`; the server logged
  `STRICT CONFIRM MODE: write tools require "confirm": true` on stderr.
- `tools/list` returned 38 tools. Read tools (`desktop_screen_size`, `desktop_windows_list`,
  `desktop_window_info`, `browser_list_tabs`, …) carry no confirmation parameter; machine-mutating
  tools are annotated `destructive` and expose a `confirm` parameter.
- `desktop_screen_size` returned `{"height":1440,"width":3440}`.
- `desktop_screenshot` without the argument failed as intended:
  `write operation 'desktop_screenshot' requires explicit confirmation: set "confirm": true in
  arguments (strict confirm mode)` with `isError: true`.
- `desktop_screenshot` with `"confirm": true` returned a PNG result, proving the confirm gate opens.
- The server exited cleanly on stdin EOF in every run.

## Not verified here

- **Harness-level boot with the row in this app.** The running Host keeps the composition it loaded at
  startup, and restarting the app from a shell it hosts is forbidden. Restart the desktop app, then
  confirm `mcp__nuphus-mcp__*` tools appear in a session.
- **Real input injection and browser automation.** Clicking, typing, or launching Chrome would act on
  the owner's live desktop, so those tools were not exercised; the confirmation rejection and a
  confirm-gated screenshot cover the gate and the transport without side effects.
- **BYOK vision.** No key was configured; the profile-level `env` override documented in
  `docs/install.md` is the untested path.
