# Design

## Context

See `proposal.md` - Why for the measured cost that motivates the default change. The constraints:

- Row ownership: a plugin's `cordis.fragment.yml` is the only hand-edited source for its rows;
  `parseCompositionFragment` validates it and `renderBundlePatch`/`renderSetupPatch` render it into
  the plugin patch and the aggregated setup patch. `packages/setup/defaults.yml` deliberately cannot
  name plugin rows (the parser rejects the `dsh-setup-` prefix), so the fragment is the right owner
  of a shipped default.
- The Harness loader's `EntryOptions` already carries `disabled?: boolean | null`, so a generated
  patch entry with `disabled: true` mounts the row inactive, and a later layer can set
  `disabled: false` to enable it.
- The accepted specs currently require the opposite default: `session-guidance` says the setup
  ships the Serena guidance "enabled by default", and `mcp-adapters` assumes an installed adapter
  row makes its tools available. Both deltas ship with this change.

## Goals / Non-Goals

**Goals:**

- Ship the Serena bundle installed but inactive by default, with a one-line enable override.
- Keep one mechanism for shipped defaults: the fragment row.
- Document the default and the override wherever a user decides to install the plugin.

**Non-Goals:**

- Changing the plugin's runtime code, tool set, server version, or skill content.
- Removing the plugin from the setup manifest or the market.
- A setup-only disable list or profile-specific configuration.

## Decisions

### D1: Add `disabled` to the fragment row schema

Extend `FragmentRow` with `disabled?: boolean`; the parser accepts it only as a boolean, renders it
unchanged, and the tests pin both the accepted field and the rejection of a non-boolean. This is a
general composition capability (any bundle may ship a row inactive), not a Serena special case.

Alternatives: a setup-only disable list (rejected: defaults are reserved for shipped DSH rows and a
second generated mechanism would duplicate rendering, validation, and docs); a hand-written profile
patch on the owner machine (rejected: it changes one profile, not the shipped default).

### D2: Disable both Serena rows

The adapter row (`dsh-setup-serena`) and the guidance row (`dsh-setup-serena-guidance`) both ship
`disabled: true`. Enabling the adapter starts the MCP server and restores the tools; enabling the
guidance row restores the always-on rule and the skill. They stay independent and each override
carries no other configuration.

### D3: No runtime or generation-behavior changes beyond the flag

The plugin module, assets, server arguments, and vendor set stay as they are. Generation only passes
an optional field through. The superseded `improve-serena-usage` change is removed rather than
archived, because its premise no longer holds.

### D4: Document the default and the exact override

`docs/serena.md`, `docs/plugins.md`, `docs/setup-composition.md`, `AGENTS.md`, the plugin's
market-card locale, and the README row state that the plugin ships disabled and show the two
`disabled: false` entries a profile adds to enable it.

## Risks / Trade-offs

- **A market user enables nothing and sees no tools** -> the market card and docs open with the
  disabled default and the enable override; the plugin code is unchanged once enabled.
- **The linked live profile keeps the old composed Host until a full restart** -> `pnpm gen` updates
  the vendored patch; the owner restarts the application, and this session keeps its current tool
  surface until then.
- **The generic field could be misused** -> validation accepts booleans only, and the fragment tests
  cover it; a bundle that disables a row without documenting it violates its own docs contract.
- **The measured saving is per-request and client-specific** -> the proposal states the measured
  numbers as evidence for this default, not as a universal guarantee.
- **Two deltas change accepted specs** -> the change carries both delta files and the review gate
  covers them.

## Migration Plan

- No data migration. A release ships the fragment and generated patches; installing the setup on a
  fresh machine yields the rows disabled.
- Existing owner profile: after `pnpm gen` (already linked), a full application restart applies the
  disabled rows. Enabling later is a profile-patch edit plus a restart, like any row override.
- Rollback: remove `disabled` from the fragment and regenerate, or set `disabled: false` in a
  profile patch.
