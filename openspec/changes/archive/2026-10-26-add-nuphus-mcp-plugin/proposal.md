# Proposal

## Why

The setup ships one MCP adapter (Serena) that adds code navigation, but nothing lets the agent
operate the desktop: screen capture, windows, mouse and keyboard, and a Chrome session. Today a user
must hand-edit a profile patch, or install the third-party `dsh-nuphus-mcp` plugin, which pins a
different copy of the MCP client and runs `npm install -g` during Harness startup. DeepSeek Harness
already ships the MCP bridge and the repository already has the configuration-only adapter pattern,
so one bundle adds the capability with no new code.

## What Changes

- Add `@dsh-setup/plugin-nuphus-mcp`, a configuration-only bundle (no Host/Client module, no
  runtime dependency, no install-time script) whose patch inserts one `@deepseek-ai/dsh-mcp-client`
  row that launches the user-installed `nuphus-mcp` binary over stdio as `mcp__nuphus-mcp__*`.
- Ship strict write confirmation by default (`--confirm-write`), a raised tool-call timeout, and
  boot-safe startup behavior; the user can relax or disable the row from the profile patch.
- Reuse the existing generator exception: no change to `scripts/lib/fragments.ts` or
  `scripts/lib/generate.ts`.
- Generate the usual artifacts: the plugin's own patch, the setup patch/manifest, and the vendored
  setup copy; publish the plugin as a market entry and include it in the setup bundle like every
  other plugin.
- Document the `nuphus-mcp` prerequisite (`npm install -g @nuphus/nuphus-mcp`), the tool inventory,
  the platform limits, the write-confirmation default, and the BYOK vision environment limitation
  with its profile-level override.
- Pin the safety default as a requirement: an adapter that can mutate the host machine enables the
  server's strict write-confirmation mode in its shipped configuration.
- Non-goals: installing, vendoring, or auto-updating the `nuphus-mcp` binary; proxying
  `NUPHUS_MCP_VISION_API_KEY` through the generated patch; per-session MCP instances; changes to
  `dsh.json`, `install.ps1`, the supported DSH range, or any TypeScript project.

## Capabilities

### New Capabilities

None. The adapter reuses the accepted `mcp-adapters` capability.

### Modified Capabilities

- `mcp-adapters`: adds a requirement that an adapter whose server can mutate the host machine
  enables the server's strict write-confirmation mode in the shipped configuration and documents
  the profile-level override.

## Impact

- New: `packages/plugin-nuphus-mcp` (manifest, fragment, locale, icon) and generated patch/vendor
  output.
- Changed: `docs/install.md`, `scripts/validate-composition.ts` (composition markers), and the
  `mcp-adapters` delta spec.
- Generated: `packages/plugin-nuphus-mcp/cordis.patch.yml`, `packages/setup/package.json`,
  `packages/setup/cordis.patch.yml`, `packages/setup/node_modules/@dsh-setup/plugin-nuphus-mcp/**`.
- Unchanged: `dsh.json`, `install.ps1`, the DSH compatibility range, generator code, and TypeScript
  projects.
- Runtime: requires the `nuphus-mcp` executable on the Harness PATH; the first browser tool needs
  Chrome or Edge, and the first `desktop_perceive` call downloads local OCR models. When the binary
  is missing the Harness still boots and logs the failed connection; no desktop tools are added.
