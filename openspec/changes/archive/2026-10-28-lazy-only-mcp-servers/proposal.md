# Proposal

## Why

The setup still mounts static `@deepseek-ai/dsh-mcp-client` adapter rows for Nuphus and Serena even though the lazy MCP proxy exists: Nuphus is mounted twice (the static row is disabled while the lazy entry is active), and Serena ships both rows disabled, so the profile shows two unused static adapter cards and keeps a second MCP path the setup no longer prefers. The owner wants one MCP home: both servers reached through `mcp_tools`/`mcp_call`, no static adapter rows, and the Serena guidance narrowed to the measured use case (large files and cross-file refactors), because the recorded sessions showed 1% usage, no symbol edits, and a 6.45k-token schema tax per request.

## What Changes

- **BREAKING**: the setup no longer mounts any `@deepseek-ai/dsh-mcp-client` row. The `dsh-setup-mcp-lazy` row carries both configured servers (`nuphus-mcp` and `serena`), so a session sees only `mcp_tools`/`mcp_call`; the `mcp__nuphus-mcp__*` and `mcp__serena__*` tool schemas disappear.
- `@dsh-setup/plugin-nuphus-mcp` and `@dsh-setup/plugin-serena` become guidance-only bundles: each keeps one enabled `dsh-setup-*-guidance` row (skill and/or always-on rule) and drops its adapter row, its `disabled` flags and its setup disable default. The `@deepseek-ai/dsh-mcp-client` adapter capability remains available to standalone or future bundles, but the setup stops using it.
- The Serena guidance becomes a narrow always-on trigger: use the lazy `serena` server only for large-file or cross-file refactor work where exact callers matter; load `serena-discipline` first; ordinary reads, searches, text, configuration and generated files stay on `grep`, `glob`, `read` and `edit`. The skill carries the lazy invocation (`mcp_tools`, `mcp_call`, `activate_project`), the symbol tool names, the call bounds, and the fallback. The rule budget drops from 400 to at most 200 estimated tokens.
- The Nuphus guidance skill and docs describe the lazy path; the strict `--confirm-write` flag and the 120000 ms tool timeout live in the lazy entry.
- No shipped row is disabled: the guidance rows are enabled in their fragments and no setup default disables a row. The optional `disabled` fragment/default capability remains for future standalone bundles.
- Remove the obsolete static-adapter docs, examples, tests and composition assertions; update README, AGENTS, market locales, the prompt-cost tables, and the generated setup patch/vendor tree.
- No new dependency, DSH version, installer, or profile change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-guidance`: the Serena always-on requirement changes from an enabled-by-profile code-surface rule on a static adapter to a shipped, enabled trigger on the lazy server; the rule is narrowed to large-file/cross-file refactors, the procedure moves to `serena-discipline`, and the per-step budget drops.
- `lazy-mcp`: the setup's shipped lazy configuration changes from one server (Nuphus) plus a disabled static adapter to two servers (Nuphus and Serena) with no static adapter rows; the shipped guidance bundles are the skills/rules, and the docs keep the one-home, confirmation and migration contracts.
- `portable-setup`: the shipped defaults, the Nuphus migration reconciliation, and the non-destructive owner-profile verification no longer carry a static Nuphus adapter row; the stale-override reconciliation and the dogfood retired-row exception change.

## Impact

- `packages/plugin-nuphus-mcp` and `packages/plugin-serena`: fragments (one guidance row), package/locale descriptions, Serena `rules.md` and `SKILL.md`, the Nuphus skill, Host/unit tests; no runtime dependency change.
- `packages/setup`: `defaults.yml` (lazy servers, no disables), generated `package.json`/`cordis.patch.yml`/vendored tree; `packages/plugin-mcp-lazy/locale/en.json`.
- `scripts/validate-composition.ts`, `scripts/dogfood.ts`, `scripts/lib/dogfood.ts`, and `scripts/test/{adapter-guidance,fragments,generate,dogfood}.test.ts`.
- `docs/{serena,lazy-mcp,install,plugins,setup-composition,principles,rtk,codex-subagent}.md`, `README.md`, `AGENTS.md`.
- `openspec/specs/session-guidance/spec.md`, `openspec/specs/lazy-mcp/spec.md`, and `openspec/specs/portable-setup/spec.md` via the deltas; the `mcp-adapters` capability and its spec remain unchanged.
- Standalone installs of the two guidance bundles no longer provide the MCP server; their market cards and docs state that the server lives in the lazy plugin (or the setup). The live `desktop` profile needs a full restart by the owner after implementation.
- The in-progress `add-goal-continuity` change already modifies the generated setup files; implementation must sequence or isolate the two changes so each commit stays scoped.
