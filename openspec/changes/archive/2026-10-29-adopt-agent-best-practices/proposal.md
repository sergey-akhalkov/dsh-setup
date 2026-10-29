# Proposal

## Why

Both vendor guides (Claude Code best practices and the Codex/ChatGPT best practices) converge on
one rule: an instruction is either *model-read* advice or *harness-enforced* behaviour, and a rule
that is missed twice needs enforcement, not louder text. This setup is strong on the advice side —
9,595 bytes of budgeted always-on guidance plus on-demand skills — but almost nothing it promises is
enforced. The turn-stopping gate requires review records; it never requires that the repository's
own check ran. Our `verify-change` skill is 3,976 bytes of prose that a turn can ignore.

The same guides say the always-loaded instruction file must be the smallest artifact, carrying only
what the repository cannot say. Ours is the opposite: `AGENTS.md` is 52,053 bytes (~13,013 estimated
tokens), injected on every request — 5.4× the entire shipped guidance layer — and it describes
architecture, layering, and release procedure that `docs/` already states.

## What Changes

- **New bundle `@dsh-setup/plugin-verification-gate`** (Host-only). A turn that changed source files
  cannot close until one configured check command has succeeded *after* the last edit. It mirrors
  Claude Code's `Stop` hook: it blocks, then after `maxBlocks` (default 8) consecutive blocks inside
  one turn it allows the close and says so. Configured by a `commands` list in the profile; an empty
  list makes the gate inert, so the default behaviour is unchanged.
- **`AGENTS.md` becomes the fast path** (budget: 16,000 bytes, ~4,000 estimated tokens) and the moved
  detail lands in `docs/`. `pnpm validate:repo` fails above the budget and names the measured size,
  the way it already fails an oversized plugin contribution.
- **New on-demand skill `instruction-budget`** in `plugin-working-principles`: audits a workspace
  instruction file against the documented budget, lists lines that duplicate the repository or its
  docs, and proposes moves — it never deletes text without moving it.
- **Plan checkpoint** in the always-on working contract: a request that touches more than one file or
  has an unstated cause gets a written plan and a nod before the first edit; a one-line fix does not.
- **Parallel-writer isolation** in the `delegation-rules` skill body and documentation: writers that
  may touch the same files are serialized or isolated in a worktree instead of sharing one checkout.
- **Second-mistake rule** in the `verify-change` skill: when the same correction was needed twice,
  propose the durable fix — an instruction-file edit or a hook — and name which one.

Deliberately not included: path-scoped rules, an approval-mode classifier, a cost/usage dashboard,
auto-written memory, a custom slash-command library, and any edit to the vendored ponytail text.

## Capabilities

### New Capabilities

- `verification-gate`: the turn-close gate that binds a code-changing turn to a configured,
  successful check command, with its configuration, block budget, bypass notice, and inert default.

### Modified Capabilities

- `session-guidance`: adds the plan checkpoint clause, the second-mistake rule, and the workspace
  instruction-file budget with its audit skill; the always-on working contract stays within its
  documented 1,500 estimated-token budget.
- `delegation-rules`: adds the parallel-writer isolation guidance to the skill body and
  documentation contract; no change to the review records, triggers, or turn-stopping gate.

`portable-setup` needs no delta: its existing requirements already cover shipping a plugin package
through the setup bundle (dependency declaration, generated patch, prebuilt distribution), and the
new bundle satisfies them. It ships through the setup bundle only — the installer's shipped-bundle
lists select independent profile bundles before the setup is installed and stay unchanged.

## Impact

- New package `packages/plugin-verification-gate` (manifest, fragment, Host source, locale, icon,
  tests, docs page, README row) plus its `tsconfig.json` reference in the root project.
- Setup delivery: the regenerated `packages/setup` manifest, patch, and vendored tree. `dsh.json` and
  `install.ps1` are unchanged.
- `scripts/validate-repo.ts` and `scripts/lib/workspace.ts` gain the instruction-file budget check;
  `scripts/test/` gains its unit test.
- `AGENTS.md` restructured; new `docs/contributing.md` receives the moved repository detail.
- `packages/plugin-working-principles/assets/**` (contract clause, third skill) and
  `packages/plugin-delegation-rules/assets/**`, `docs/delegation-rules.md`.
- Risk: a repository whose check suite is slow or absent. An empty `commands` list keeps the gate
  inert; only `edit` and `write` tool results count as code writes, so a shell-mediated edit is not
  seen — documented as a known limit rather than guessed at.
