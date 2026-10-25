# Proposal

## Why

The setup currently ships exactly one policy contribution: Ponytail, as byte-identical third-party
content pinned from upstream. That covers the shape of a change but not the working contract around
it. The failure modes DSH's own prompt does not enforce therefore recur in every session: scope
laundered through the agent's own plan ("create a spec" read as approval for additions buried in it),
completion claimed from a status label instead of an observed run, and a regression declared fixed by
a run in which the original trigger stopped firing.

The owner's other repository, `codex-harness`, holds roughly 64k tokens of agent guidance that was
written and tested in daily use. Most of it is the operating manual of a different runtime. About
1.7% of it is worth paying for on every model step; the audit that separated the two is recorded in
this change's `design.md`.

## What Changes

- Add `@dsh-setup/plugin-working-principles`: an always-on system-prompt section carrying the
  distilled working contract (~1.1k tokens) with an `alwaysOn: false` opt-out, plus two on-demand
  skills beside it, `working-principles` (the elaborated text) and `verify-change` (reproduce before
  fixing, reduce one dimension at a time, judge a run by whether its trigger fired).
- Add `@dsh-setup/plugin-rust`: one on-demand `rust` skill with two load-on-demand references,
  installable on its own and independent of the ruleset bundle.
- Convert the two MCP adapter bundles into code-bearing bundles that keep their adapter row and
  additionally register one guidance skill each: `serena-discipline` in `packages/plugin-serena` and
  `nuphus-discipline` in `packages/plugin-nuphus-mcp`.
- Relax the generation rule that currently forbids the combination above. An approved adapter row may
  sit beside a package's own row; unapproved foreign names and additional foreign rows stay rejected,
  so the narrow trust boundary is unchanged.
- Record the delivered first-party guidance as its own capability. It is editable source in this
  repository with a written adaptation record, not pinned upstream bytes: there is no verbatim or
  provenance obligation, and no upstream license to ship.
- Do not ship the rest of the source corpus (~63k tokens): `team-lead`, `board-workflow`,
  `self-improvement-loop`, `skill-evolution`, `skills-usage-analysis`, `executor-model`, both
  `*-self-reflection` skills, `harness-deploy`, `windows-disk-reclaim`, `serena-setup`, the
  `global/roles/*` personas, `token-efficient-workflow`, `tokenomics`, `structured-codex-run` and
  `project-memory`. They document executors, tabs, a board, RTK, a token-audit CLI and a dispatch
  transport that DSH does not have.

## Capabilities

### New Capabilities

- `session-guidance`: first-party prompt content the setup delivers to sessions — the always-on
  ruleset contribution and its opt-out, on-demand skill bodies and their catalog cost, domain packs
  installed independently, the recorded adaptation of source text, and freshness rules for content
  that names tool versions.

### Modified Capabilities

- `mcp-adapters`: `Approved adapter targets` changes from "a package that declares a Host entry
  alongside a foreign row MUST be rejected" to "an approved adapter row MAY be declared alongside the
  package's own row; unapproved names and a second foreign row remain rejected".

## Impact

- New packages: `packages/plugin-working-principles`, `packages/plugin-rust` — manifest, fragment,
  `src/host` skill provider, tsconfig, unit test, vendored assets, icon, locale metadata.
- Converted packages: `packages/plugin-serena`, `packages/plugin-nuphus-mcp` gain `main`/`types`,
  `src/host`, tsconfig, a host test and a second fragment row; `files` gains the skill asset paths.
- `scripts/lib/generate.ts` and `scripts/lib/fragments.ts`: the adapter-row check stops treating an
  approved adapter row as a violation on a code-bearing package; a validation test covers both the
  accepted and the still-rejected shapes.
- Generated output moves: `pnpm gen` rewrites the four patches, the setup patch/manifest and the
  vendored tree; `pnpm build` adds `lib/**` for two new and two converted packages. Every package and
  the set move to one new version.
- No `dsh.json` or `install.ps1` change is needed: `installBundles` lists Harness-provided bundles,
  while `@dsh-setup/plugin-*` packages reach users through the generated setup bundle and the market.
- `docs/` gains a page for the guidance plugin beside `docs/ponytail.md`, and the two adapter pages
  gain their new skill.
- Prompt cost is permanent: a profile with the row active pays roughly 1.1k tokens per model step on
  top of Ponytail's ~0.7k, which is why the content is bounded by a spec requirement.
