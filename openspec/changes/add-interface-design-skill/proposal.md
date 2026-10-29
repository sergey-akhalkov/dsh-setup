# Proposal

## Why

Design decisions repeat across every surface this repository ships: a client control, an installer
flag, a function signature, an error message, a skill description. The setup already states the
principle in one always-on line ("Do not make the reader think"), but it has no procedure, so each
surface is re-litigated. The first administrator indicator invented a look instead of reusing the
client primitives, and the installer documentation still asks for four lines of PowerShell where one
would do. The cost is paid by the owner and by every agent that has to rediscover the house pattern.

A community scan found useful MIT/Apache rubrics, but each covers one surface (a UI audit, or a CLI)
and none covers the repository's own UI primitives, installer contract, signatures, and agent-facing
skills together. The smallest complete fix is one first-party skill inside the existing guidance
bundle, not a new plugin.

## What Changes

- Add an on-demand `interface-design` skill to `@dsh-setup/plugin-working-principles`, listed in the
  skill catalog and loaded only when invoked.
- The skill body defines: the "don't make me think" law, the five-question first-time test, a
  five-cost matrix (recall, decision, prediction, interpretation, recovery) applied to UI,
  CLI/installer, API/signature, code, and skill/tool definitions; per-surface rules; red flags;
  repository anchors (client primitives and tokens, installer spec, skill packaging); and a review
  output with a Thinking Cost rating and severity.
- Ship reference files for UI, CLI/installer, API/code, and agent-facing definitions, plus a source
  record. Detail loads only when read.
- Adapt the useful community rubrics (Krug's lenses, the CLI four-surface model, interface copy
  rules) with attribution and a recorded adaptation; do not vendor them and do not copy the
  CC-BY-SA CLI guidelines text.
- Keep the existing always-on "Interface discipline" line and its budget unchanged; add no new
  always-on section, no new bundle, no new row.
- Update the skill provider catalog, package file list, package description, tests, the
  documentation that lists the bundle's skills, and the generated setup bundle copy.

**BREAKING**: none. The bundle gains one on-demand skill; no existing skill, row, always-on text,
installer behavior, or public contract changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-guidance`: the guidance bundle ships one additional on-demand skill with a defined
  content contract and an adaptation record; the always-on budget and the existing contributions do
  not change.

## Impact

- `packages/plugin-working-principles/assets/interface-design/**`: new skill body and references.
- `packages/plugin-working-principles/src/host/index.ts`: one catalog entry.
- `packages/plugin-working-principles/package.json`: the new assets in `files`, and the description.
- `packages/plugin-working-principles/test/skill-provider.test.ts`: the candidate list and asset map.
- `packages/plugin-working-principles/lib/**`: rebuilt and committed output.
- `packages/setup/**`: the generated vendor copy of the plugin and the setup manifest after
  `pnpm gen`.
- `README.md` and the documentation row that lists the bundle's skills.
- No installer, profile, `cordis.patch.yml`, dependency, `dsh.json`, or supported-DSH change.
