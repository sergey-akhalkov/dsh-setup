# Proposal

## Why

The Serena bundle is installed in every profile of this setup and therefore mounts two rows: the MCP
adapter and the always-on guidance. Measured over the recorded sessions, 7 of 58 sessions used it,
94 of ~9,500 tool calls, while the 24 Serena tool schemas add 25,815 bytes (~6,454 tokens) to every
request plus a ~400-token always-on rule. The owner wants the plugin to remain shipped and
installable but **disabled by default**, so a default installation pays neither cost and enabling it
is a deliberate, one-line profile override.

This is a spec-level default change: `session-guidance` currently requires the setup to ship the
Serena guidance "enabled by default", and `mcp-adapters` assumes a shipped adapter row makes its
tools available on install. The deltas in this change flip those defaults.

## What Changes

- Extend the composition fragment row schema with an optional `disabled: true` field and let
  generation render it into the plugin patch and the aggregated setup patch. The Harness loader
  already accepts `disabled` on an entry, and a later profile patch re-enables the row with
  `disabled: false`.
- Mark both rows of `packages/plugin-serena/cordis.fragment.yml` as disabled, so installing the
  plugin bundle or the setup mounts the rows without starting the MCP server or the guidance.
- Document the new default and the exact enable override in the plugin documentation, the market
  card, the repository guide, and the setup composition docs.
- Remove the superseded `improve-serena-usage` change; its premise (more Serena use saves tokens)
  is not supported by the recorded sessions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-guidance`: the setup ships the Serena guidance bundle disabled by default; the
  always-on code-surface rule and the `serena-discipline` skill appear only after a profile enables
  the row.
- `mcp-adapters`: an adapter bundle MAY ship its rows disabled by default; the patch still mounts
  them, and the documentation and market card state the one-line override that enables the server.

## Impact

- `scripts/lib/fragments.ts` (row schema and parser), `scripts/test/fragments.test.ts` and
  `scripts/test/generate.test.ts`.
- `packages/plugin-serena/cordis.fragment.yml`, and the generated
  `packages/plugin-serena/cordis.patch.yml`, `packages/setup/cordis.patch.yml`, and vendored setup
  copies (via `pnpm gen`).
- `docs/serena.md`, `docs/plugins.md`, `docs/setup-composition.md`, `AGENTS.md`,
  `packages/plugin-serena/locale/en.json`, and the plugin row in `README.md`.
- `openspec/specs/session-guidance/spec.md` and `openspec/specs/mcp-adapters/spec.md` via this
  change's deltas.
- No plugin runtime code, dependency, DSH version, installer, or profile change.
