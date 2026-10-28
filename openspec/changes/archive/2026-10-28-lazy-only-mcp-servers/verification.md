# Verification

## Scope

Live acceptance in the owner's Desktop session on Windows after a full Harness restart, on the
supported Harness version from `dsh.json`. The owner restarted the app; the agent performed the
checks from the new session and did not restart it.

## Live composition

- The Host config lists `dsh-setup-mcp-lazy`, `dsh-setup-nuphus-guidance` and
  `dsh-setup-serena-guidance`; no `dsh-setup-nuphus-mcp`, `dsh-setup-serena` or
  `@deepseek-ai/dsh-mcp-client` entry exists.
- The Plugins page showed the updated market descriptions; every visible plugin card was Running.
- The assembled prompt contains the Serena trigger and the catalog lists `nuphus-discipline` and
  `serena-discipline`.

## Lazy proxy

- The session tool list contains only `mcp_tools` and `mcp_call`; no `mcp__nuphus-mcp__*` or
  `mcp__serena__*` tool name is registered.
- `mcp_tools` returned the tool lists for the configured `nuphus-mcp` and `serena` servers.

## Serena path

- Loading `serena-discipline` returned the lazy-only skill body.
- `activate_project` through `mcp_call` reported the active project with a ready language server.
- `get_symbols_overview`, `find_symbol` and `find_referencing_symbols` returned symbol and caller
  data through `mcp_call`.
- A throwaway large-file refactor exercised the trigger path with the skill loaded: the helper
  `errorMessage` in the 3,900-line `packages/plugin-delegation-rules/src/host/index.ts` was located
  and its 17 references collected through `mcp_call`, then renamed across all 22 occurrences with
  `rename_symbol`; `pnpm typecheck` passed and the throwaway edit was reverted.

## Nuphus path

- `desktop_screenshot` without `confirm` failed with the strict-confirm error, and no file was
  written.
- The confirmed call wrote the PNG, and `read_image` read it back.

## Not covered

- The live one-home guard (task 6.4) needs a throwaway profile with a static adapter row and a model
  session; it remains covered by the unit and vendored-copy tests.
