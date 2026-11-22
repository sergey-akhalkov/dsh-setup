# Proposal

## Why

The change card answers the owner's five questions — what is this, when did it last move, how much
work is done, has it been reviewed, what can I do with it — but it does so in six stacked micro-rows
and one oversized outlined button, about 247 px per card, so only three or four changes fit in the
sidebar and the list cannot be scanned. A redesign was prototyped in three versions and the owner
chose one of them: a numeric margin column holding the task count, a three-row body, and both actions
on the navigation row (chosen 2026-11-22, prototype `.tmp/design/dir-3.html`).

## What Changes

- The change card becomes a two-column card: a numeric gutter (`n/m` over `tasks`, or `—`) separated
  by a hairline from a body of four rows — name with recency, a two-line purpose, one facts row
  (phase, spec verdict, review coverage), and artifact navigation beside both actions.
- The card always renders **both** actions: `Apply` while the change is not complete and `Archive`
  once every task is done. The action that does not apply to the current state renders disabled with
  the reason, instead of being absent. No archive request is ever sent from a disabled action.
- The row no longer shows the last commit hash and date; the change detail header keeps them.
- The row no longer draws a task progress bar: the count in the gutter is the progress fact. The
  settled review-coverage bar is likewise replaced by `review n/m` text, and the verdict by a coloured
  word.
- The labels row added by the 2026-11-20 rework is removed; the phase becomes a dot plus a short label
  inside the facts row.
- Every value stays a design token: no new colour, font size, radius, or spacing is introduced, and
  the card is styled only with `--dsw-alias-*`, `--dsw-radius-*` and the existing font tokens.
- Capability cards, requirement cards, task checklists, history rows, **archived change cards** and the
  change detail header keep their current rendering; the new styling is scoped to active change rows.

## Capabilities

### New Capabilities

None. The card's behaviour is already covered by `openspec-panel`; this change restates three
requirements and adds one.

### Modified Capabilities

- `openspec-panel`: the decision-fact scenario of the default change list, the change row's anatomy,
  its two-action rendering, its provenance facts, and its visual-hierarchy rule (progress as a numeral
  in a gutter rather than a bar).

## Impact

- `packages/plugin-openspec/src/client/index.tsx`: `ChangeCard`, `CardLabels`, the label map, and the
  change-row part of `PANEL_CSS`.
- `packages/plugin-openspec/locale/en.json`: the catalog description names the two progress bars and
  must describe the new card.
- `packages/plugin-openspec/test/panel.test.ts`: row assertions.
- Generated output: `packages/plugin-openspec/lib/**` and the vendored setup tree
  (`packages/setup/node_modules/@dsh-setup/plugin-openspec/**`).
- No host route, wire shape, or OpenSpec CLI behaviour changes; the card reads the same change-row
  fields it reads today.
