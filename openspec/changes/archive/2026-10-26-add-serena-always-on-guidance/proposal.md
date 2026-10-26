# Proposal

## Why

The setup ships Serena's symbol-level tools plus an on-demand `serena-discipline` skill. In the
owner's recorded sessions the skill was never loaded and Serena was almost never called; the one
Serena-heavy session was the session that installed the adapter. A rule the model does not see does
not bind, and the first symbol call fails while no project is active, so the fallback to whole-file
reads wins by default. The previous feedback analysis counted 15 Serena calls (0.68% of 2,219 tool
calls in the 20 sessions where the tools were available), no symbol edit, and no skill load.

## What Changes

- Add an always-on code-surface rule to the Serena guidance row: when Serena is the right surface,
  how to activate the project, how to read and edit through symbols, how to bound calls, where text
  search stays, and how to suspend it for a session.
- Strengthen the `serena-discipline` skill body with the activation-first sequence, the reason the
  symbol path is cheaper and safer, the generated-output boundary, and the text-search boundary that
  keeps `rg`/`grep` work off Serena.
- Add the `alwaysOn: false` row switch, mirroring the other guidance bundles.
- Add a budget test that pins the always-on rule at 400 estimated tokens, and document its measured
  size.
- Amend the `session-guidance` budget requirement for the third always-on contribution; refresh the
  prompt-cost tables in the three docs that carry them.

## Capabilities

### Modified Capabilities

- `session-guidance`: the bounded-cost requirement names the Serena rule at 400 estimated tokens,
  and a new requirement defines the always-on code-surface rule and its boundaries.

## Impact

- `packages/plugin-serena`: new `assets/serena-discipline/rules.md`, rewritten host module that
  registers a system-prompt section beside the skill provider, a new `alwaysOn` row option, section
  and budget tests, a larger skill body, and the prompt section added to `files`.
- Generated output moves: `pnpm build` rewrites `lib/**`; `pnpm gen` rewrites this package's patch,
  the setup patch/manifest and the vendored copy, including the new asset.
- `docs/`: a Serena guidance page, the install page link and activation note, and corrected
  prompt-cost tables in this page, `docs/rtk.md` and `docs/principles.md`.
- No `dsh.json`, `install.ps1` or composition change: the adapter row and its configuration are
  untouched.
