# Verification

## Scope

Smoke-test the Serena adapter in a throwaway profile on the supported Harness version
(`0.2.1-rc.3`, Windows), then verify the shipped tool behavior directly.

## Harness-level connection

Commands, with the installed CLI (`0.2.1-rc.3`):

```sh
dsh --profile serena-smoke --from-default-profile headless --dump-config
dsh plugin --profile serena-smoke add <checkout>/packages/plugin-serena
dsh --profile serena-smoke "<prompt asking for mcp__serena__get_current_config, activate_project, get_symbols_overview>"
```

Observed:

- The profile composed the row `dsh-setup-serena` with `name: '@deepseek-ai/dsh-mcp-client'` and
  the expected `uvx --from serena-agent==1.7.0 ...` configuration.
- On boot the MCP client spawned Serena, which reported the built-in `vscode` context and
  `Number of exposed tools: 24` (`get_current_config`, `activate_project`, `get_symbols_overview`,
  ...), and the client completed a `ListToolsRequest`. Serena startup after the warm `uvx` cache was
  under one second.
- The model turn did not run: the headless template defaults to the API-key route and reports
  `MISSING_CREDENTIAL`; switching the throwaway profile to the account provider reports
  `ACCOUNT_SIGN_IN_REQUIRED`. Both are headless-credential limitations, not adapter failures.

## Direct MCP verification

A minimal MCP stdio client (`initialize` → `tools/list` → `tools/call`) was run against the exact
adapter command in a temporary workspace:

- `initialize` succeeded; `tools/list` returned the same 24 tools.
- `get_current_config` returned the current configuration.
- `activate_project` created and activated the temporary project.
- `get_symbols_overview` on a TypeScript file returned
  `{"Interface": ["Greeting"], "Class": ["Sample"]}`.
- The TypeScript language server installed on first use (7.2 s) and started in 7.4 s; the full
  direct smoke test took 9.8 s on this machine.

## Result

The adapter row, the MCP bridge, the Serena launch command, the `vscode` tool context, project
activation, and the symbolic tools are verified. A model-driven tool call in the desktop app remains
an owner check: restart the app so the linked setup recomposes with the new row, then ask the agent
to activate the current project with Serena. The headless CLI cannot perform that check on this
machine because it has no model credential.
