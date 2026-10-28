# Proposal

## Why

Every enabled MCP adapter pays its complete tool-schema block in every model request, whether or not
the session ever calls that server. Measured across 61 recorded sessions: 90 tools exposed on
average, 7 used (median), and 89% of the schema characters belong to tools that session never called.
The live composition carries 62 MCP tools. Disabling a server is a profile edit plus a full relaunch,
so the real choice today is "always on" or "not available", and every added MCP server raises the
per-request cost of all future sessions.

## What Changes

- Add a new bundle `@dsh-setup/plugin-mcp-lazy` with one Host row and no client half. Its row config
  lists MCP servers that stay **dormant**: same field names as the Harness MCP client
  (`serverName`, `transport`, `command`, `args`, `env`, `cwd`, `toolCallTimeoutMs`), so a stdio
  server definition moves between a static adapter row and this bundle unchanged.
- Support stdio servers in this version. An entry that names another transport is rejected when the
  configuration is composed, with an error naming the server and the transport, instead of being
  accepted and failing on the first call.
- Register exactly two tools for the whole bundle, regardless of how many servers are configured:
  `mcp_tools` (list a server's tools with their JSON schemas, optionally filtered) and `mcp_call`
  (invoke one tool). No per-server tools are ever registered, so the model-facing tool set does not
  change at runtime.
- Start a server's process on its first `mcp_tools` or `mcp_call`, reuse it for the rest of the
  plugin's lifetime, and terminate every started process when the plugin unloads.
- Accept the server argument only as a name from the configured list. Commands, arguments, and
  environment are never model-supplied; the configured ones (including a server's confirmation flags)
  apply unchanged.
- Ship the first migration as a setup default: `packages/setup/defaults.yml` configures
  `dsh-setup-mcp-lazy` with the Nuphus stdio entry and disables the static `dsh-setup-nuphus-mcp`
  row. A fresh setup therefore carries Nuphus dormant: the request schema contains only
  `mcp_tools`/`mcp_call` for it, and the guidance skill describes both the static and lazy access
  paths. The lazy plugin's own fragment stays empty, and a profile patch can restore the static
  adapter.
- A server SHALL be either a static adapter row or a lazy entry, never both, because both mount the
  same `mcp__<serverName>__<tool>` names.
- Document the bundle, its configuration, and the trade-off against a static adapter row; add the
  plugin's market card and README row.

Out of scope: registering a server's tools as native typed tools at runtime (a larger variant that
changes the tool set mid-session), remote (streamable-http) transports, projecting image or
resource results, any automatic trigger that mounts a server without a model call, migrating other
static adapters (Serena), and automatically converting a profile that deliberately keeps Nuphus
static.

## Capabilities

### New Capabilities

- `lazy-mcp`: dormant MCP servers reachable through a fixed two-tool proxy, with process lifecycle,
  name-only server selection, and mutual exclusion against static adapter rows.

### Modified Capabilities

None. A static adapter row keeps its present behavior; this change adds an alternative way to reach a
server and does not alter the adapter contract in `mcp-adapters`.

## Impact

- New package `packages/plugin-mcp-lazy` (manifest, `cordis.fragment.yml`, Host module, tests,
  locale, icon) and its `tsconfig.json` reference.
- New runtime dependency `@modelcontextprotocol/client` (MIT, the same library and version the
  Harness MCP client already uses) hoisted through the setup manifest by `pnpm gen`.
- Generated output: `packages/plugin-mcp-lazy/cordis.patch.yml`, `packages/setup/package.json`,
  `packages/setup/cordis.patch.yml`, and the vendored copy under `packages/setup/node_modules`.
- `docs/plugins.md` and a new `docs/lazy-mcp.md`; the root `README.md` plugin table.
- Setup defaults schema: an entry may carry `disabled` and may target a setup-contributed row; the
  generator and `validate:repo` accept both. `packages/setup/defaults.yml` gains the Nuphus lazy
  entry and the static-adapter disable, and `validate:composition` asserts them.
- The Nuphus guidance skill, its locale text, and the Nuphus install documentation describe the lazy
  default and how to restore the static adapter.
- No change to existing bundles' own defaults, profiles, or the owner's shipped bundle selection.
