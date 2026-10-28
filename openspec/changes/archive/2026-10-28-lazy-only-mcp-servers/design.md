# Design

## Context

See `proposal.md` - Why for the motivation. The constraints that shape the approach:

- The setup already ships `@dsh-setup/plugin-mcp-lazy`; its row (`dsh-setup-mcp-lazy`) is enabled and the setup's `defaults.yml` configures `nuphus-mcp` while the static Nuphus adapter row is disabled. The lazy plugin's own fragment ships an empty `servers` list; only the setup carries a deliberate server list.
- A plugin fragment may declare `disabled: true`, and a setup default may disable a setup-inserted row; both are rendered into the generated setup patch. The Loader supports `disabled` but a disabled row is still mounted and visible in the plugin UI.
- The two MCP bundles are code-bearing guidance bundles: the Host module registers a skill (`nuphus-discipline`, `serena-discipline`) and, for Serena, an always-on prompt section. The adapter row is the only part that mounts the Harness MCP client.
- The measured Serena history (`docs/serena.md`, archived `2026-10-28-ship-serena-disabled`) found 1% of tool calls, no symbol edits, and a 6.45k-token schema block per request; the value is limited to large-file/cross-file refactors. The always-on rule that shipped is broader than that evidence.
- The live `desktop` profile links to this checkout; generated setup files are already modified by the in-progress `add-goal-continuity` change. Implementation must keep that change's files out of this change's commit.

## Goals / Non-Goals

**Goals:**

- One MCP home in the setup: `nuphus-mcp` and `serena` are reached only through the lazy proxy.
- No static `@deepseek-ai/dsh-mcp-client` row and no disabled row in the shipped setup composition.
- Keep the Nuphus and Serena guidance (skill and, for Serena, the always-on trigger) without re-introducing the static tool-schema cost.
- Make the Serena guidance match the measured use case and the lazy invocation, with a small, bounded prompt contribution.
- Preserve the strict Nuphus confirmation and the lazy plugin's one-home and timeout contracts.

**Non-Goals:**

- Removing the `@deepseek-ai/dsh-mcp-client` adapter capability, the `lazy-mcp` proxy, or the `mcp-adapters` capability from the repository. A standalone or future bundle may still mount a static adapter row.
- Changing the Codex subagent's fixed Serena MCP configuration; it remains a separate app-server process.
- Changing DSH versions, dependencies, the installer, or a profile's own patch.
- Adding a setup-level row-exclusion mechanism or splitting the guidance bundles into separate adapter/guidance packages.
- Live installation or a Desktop restart from an agent session.

## Decisions

### D1: The setup uses the lazy row as the only server home

The setup's `dsh-setup-mcp-lazy` config lists both servers. `plugin-nuphus-mcp` and `plugin-serena` drop their `@deepseek-ai/dsh-mcp-client` rows and keep only their guidance row. This gives one path for the model (`mcp_tools`/`mcp_call`), removes the two static Off cards, and keeps the guidance/skills. The `portable-setup` requirements for the shipped defaults and the Nuphus migration reconciliation are amended at the same time: the setup no longer ships the static row, and a profile override that still targets `dsh-setup-nuphus-mcp` is a stale no-op that the migration docs tell the owner to remove.

Alternatives considered:

- Keep the static rows disabled (the current state): rejected because it leaves the second path mounted and the Off cards in the UI, and the owner asked for lazy-only.
- Add a setup-only row exclusion so the standalone bundles keep their adapter rows: rejected as new generator complexity with no current consumer; the plugins would still carry a second configuration path for the same server.
- Split each bundle into a guidance-only package and a separate standalone adapter package: rejected as two extra packages for a path the setup no longer uses.

### D2: The lazy config carries the full server definitions

`defaults.yml` restates the entire `servers` list because a config patch replaces the object: `nuphus-mcp` with `nuphus-mcp --confirm-write` and `toolCallTimeoutMs: 120000`, and `serena` with the pinned `uvx --from serena-agent==1.7.0 serena start-mcp-server --context=vscode --enable-web-dashboard=false --enable-gui-log-window=false` and `toolCallTimeoutMs: 120000`. The lazy plugin's one-home guard stays; a profile that mounts a static row for either server gets the documented conflict instead of a second process.

Alternatives considered: dropping the confirmation flag (rejected: the strict machine-write contract); using a `cwd`/`--project` for Serena (rejected: the lazy command is shared by the profile and the session working directory is not known at composition time; the skill performs `activate_project` at runtime); moving the server definitions into the bundles' own fragments (rejected: the lazy plugin's own fragment is deliberately empty, and two bundles cannot each own the shared `servers` list).

### D3: Guidance rows ship enabled; no shipped disabled row

Each fragment has exactly one row, the guidance row, without `disabled`. `defaults.yml` no longer disables `dsh-setup-nuphus-mcp` and does not touch the Serena guidance row. The optional `disabled` fragment/default capability remains for a future standalone bundle, but the setup's composed patch contains no disabled row.

Alternatives considered: keep the guidance row disabled and enable it through a setup default (rejected: same result with an extra layer and a disabled row in the plugin's standalone patch); keep the static rows disabled and only remove the Nuphus one (rejected: the owner wants no static adapter rows and both servers lazy).

### D4: Serena becomes a trigger plus an on-demand skill

The Serena `rules.md` becomes a short always-on trigger, not the procedure. It states: Serena is for large-file or cross-file refactor work where exact callers matter; load `serena-discipline` before the first call; ordinary source reads, literal text, regex, configuration, documents and generated files stay on `grep`, `glob`, `read` and `edit`; `search_for_pattern` is a fallback. The skill carries the lazy invocation (`mcp_tools` for the tool list when needed, `mcp_call` for `activate_project` and the symbol tools), the activation step, the symbol operation names, the bounded-call rule, the small-file `read` guidance, and the unavailable-server fallback. The rule budget drops from 400 to 200 estimated tokens; the skill stays on demand.

Why this split: the recorded sessions loaded the skill zero times when it was the only carrier, while the 400-token rule was broad and names the static `mcp__serena__*` tools that do not exist through the lazy proxy. The trigger fixes discoverability; the skill carries the procedure and costs nothing per step. The lazy path adds one or two calls per use, so the trigger is intentionally limited to work where the step-saving value exists.

Alternatives considered: keep the full rule and only change the tool names (rejected: it remains broad and expensive); make the skill the only carrier (rejected: measured zero loads); put the whole lazy procedure in the rule (rejected: it is not "short" and pays the procedure on every step).

### D5: Nuphus guidance describes the lazy-only setup

The `nuphus-discipline` skill and the docs describe `server: nuphus-mcp` through `mcp_tools`/`mcp_call`, including the strict confirmation argument and the 120000 ms timeout. The static `mcp__nuphus-mcp__*` path is no longer shipped; if a profile manually adds a static row, the skill may keep the generic direct-tool branch, but the lazy one-home guard makes the two paths mutually exclusive. The Nuphus guidance row remains enabled.

Alternatives considered: leave the static-path prose as the primary text (rejected: it would describe a row the setup does not mount); remove the skill (rejected: the lazy proxy has no per-server tool descriptions; the skill is the server-specific guidance).

### D6: Verification stays layered

- Unit/generation tests: both guidance fragments have one row; the setup patch has the two lazy entries and no `@deepseek-ai/dsh-mcp-client` row and no `disabled`; the generated patch matches `gen:check`; the Serena rule/skill budgets pass.
- Composition: `validate:composition` asserts both lazy servers, both guidance rows, no static adapter row, and the confirmation flag.
- Dogfood: `checkOwnerRowsPreserved` treats `dsh-setup-nuphus-mcp` and `dsh-setup-serena` as explicitly retired rows that may disappear, while every other owner-patched row must still survive; regression tests use synthetic dumps, and the live profile stays untouched.
- Live (owner): full Desktop restart; `mcp_tools` lists both servers; no `mcp__nuphus-mcp__*`/`mcp__serena__*` schema appears; a Nuphus write without confirmation fails; the Serena trigger fires on a large-file/refactor prompt, loads the skill, and `activate_project` through `mcp_call` makes the first symbol call work; a small-file read stays on `read`; a screenshot is saved to a path and read with `read_image`.
- The `add-goal-continuity` work is committed or isolated before this change's generated setup run; the final diff is reviewed for mixed rows.

## Risks / Trade-offs

- **Standalone guidance bundles lose the server** -> the market cards and docs state that the server is configured by `plugin-mcp-lazy` (or the setup); a standalone user installs the lazy plugin and adds the entry, or adds a static adapter row manually (the one-home guard applies).
- **No static fallback and no native image results for Nuphus** -> the lazy proxy drops image content; the docs tell the model to save screenshots to a path and read them; a profile that needs native images can add a static row manually and empty the lazy list, accepting the schema cost.
- **The lazy path adds one or two calls per use, and Serena activation is still required** -> the trigger limits Serena to large-file/cross-file refactors and tells the agent to load the skill first; the skill carries activation; a live check covers the first call.
- **The narrow trigger may still not fire, or may overfire** -> the rule is explicit about "large file/cross-file refactor only" and the skill keeps small files on `read`; the usage should be re-measured after a real period.
- **A profile patch replaces the whole lazy `servers` list** -> docs restate the complete list in the override example; the setup never rewrites the profile patch.
- **The generated setup files are already dirty from `add-goal-continuity`** -> implement after that change is committed, or in a separate worktree, and inspect the final generated diff.
- **The live profile needs a full restart, not a page reload** -> the owner restarts the Desktop app; an agent session does not.
- **The market still publishes two guidance bundles whose server comes from another bundle** -> the package descriptions and docs say so; the market card is not a full setup description.

## Migration Plan

1. Remove the adapter rows and update the two fragments, package/locale descriptions, and skills.
2. Update `defaults.yml` with both lazy servers, remove the Nuphus disable, run `pnpm gen`, and inspect the generated setup patch/vendor tree.
3. Update the Serena rule/skill and their budget/section tests; update the Nuphus skill and docs.
4. Update the validators, tests, docs, README, AGENTS, and the `lazy-mcp`/`session-guidance` deltas.
5. Run the repository gate: `pnpm build`, `git diff --exit-code`, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:repo`, and `pnpm validate:composition`.
6. Commit with the in-progress goal-continuity work isolated; the owner restarts the Desktop app and performs the live acceptance.
7. Rollback: revert this change. A profile that wants the old static path adds a `@deepseek-ai/dsh-mcp-client` row manually and empties the lazy `servers` list; the lazy one-home guard fails the lazy call until the duplicate is removed.

## Open Questions

None; the owner chose lazy-only for both servers and a new change.
