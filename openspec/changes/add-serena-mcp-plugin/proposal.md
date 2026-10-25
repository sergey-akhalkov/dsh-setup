# Proposal

## Why

The portable setup has no MCP server of its own, so every user who wants Serena's symbol-level
code tools must hand-edit a profile patch and keep the launch command in sync. DeepSeek Harness
already ships the `@deepseek-ai/dsh-mcp-client` bridge and supports configuration-only bundles, so
a single installable bundle can add Serena without new Host or Client code. Adding it now keeps the
setup's promise that installing a bundle is enough and that machine-local configuration stays out
of the repository.

## What Changes

- Add `@dsh-setup/plugin-serena`, a configuration-only bundle (no Host/Client module, no runtime
  dependency, no install-time script) whose patch inserts one `@deepseek-ai/dsh-mcp-client` row
  that launches Serena over stdio.
- Let a composition fragment name the Harness-provided MCP client for a configuration-only package;
  normal plugin fragments still mount only their own package.
- Pin the tested Serena release (`serena-agent==1.7.0`) and start it with the generic IDE tool
  context, a disabled web dashboard, and a raised first-call timeout; the agent activates the
  session workspace at runtime.
- Generate the usual artifacts: the plugin's own patch, the setup patch/manifest, and the vendored
  setup copy; publish the plugin as a market entry and include it in the setup bundle like every
  other plugin.
- Document the `uv` prerequisite, the first-run download, project activation, and the
  one-instance-per-profile limit.
- Non-goals: installing `uv` or Serena for the user, vendoring Serena, per-session MCP instances,
  and changes to `dsh.json`, `install.ps1`, or the supported DSH version.

## Capabilities

### New Capabilities

- `mcp-adapters`: configuration-only bundles that expose an external MCP server through the
  Harness-provided MCP client, including external runtime prerequisites and runtime project
  activation.

### Modified Capabilities

- `portable-setup`: the `Dependency-contained plugins` requirement distinguishes repository plugin
  packages from Harness-provided adapter targets, and the composition requirements cover an adapter
  row generated from a fragment.

## Impact

- New: `packages/plugin-serena` (manifest, fragment, locale, icon) and generated patch/vendor
  output.
- Changed: `scripts/lib/fragments.ts` and its tests (adapter row name), `scripts/lib/generate.ts`
  (configuration-only check), `scripts/validate-composition.ts` (row markers), `docs/plugins.md`,
  `AGENTS.md`, `docs/install.md`.
- Generated: `packages/setup/package.json`, `packages/setup/cordis.patch.yml`,
  `packages/setup/node_modules/@dsh-setup/plugin-serena/**`.
- Unchanged: `dsh.json`, `install.ps1`, the DSH compatibility range, and the setup bundle selection.
- Runtime: requires `uv`/`uvx` on the Harness PATH; the first start downloads the pinned Serena
  package; the Harness still boots when the prerequisite is missing.
