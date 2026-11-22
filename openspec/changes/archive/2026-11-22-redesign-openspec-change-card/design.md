# Design

## Context

See `proposal.md` — Why. The change card is a function `ChangeCard` plus a block of `PANEL_CSS` inside
`packages/plugin-openspec/src/client/index.tsx`; it reads a `ChangeRow` the host already returns
(`completedTasks`, `totalTasks`, `why`/`summary`, `modified`, `presence`, `requirementCount`,
optional `review`, optional `commit`) and renders it with the host's primitives and dark/light
tokens. The same file renders capability cards from the same `.dsh-openspec-card` class, and both
surfaces share `PANEL_CSS`. No host route, wire shape, or OpenSpec CLI call changes.

The owner reviewed three prototypes on 2026-11-22 — a borderless ledger, a boxed instrument row with
an inline meter, and a numeric-margin card — and chose the third. The prototype is not committed; the
decisions below are the durable record.

## Goals / Non-Goals

**Goals**

- Halve the row's height at the sidebar's real width while keeping every fact the row states today
  except commit provenance.
- Keep the card readable as a card: same hairline surface, same radius token, same hover and focus
  contract as the rest of the panel.
- Make both actions visible and honest: the unavailable one present, disabled, and explained.
- Introduce no colour, font size, radius or spacing literal where the host ships a token.

**Non-Goals**

- No change to capability cards, requirement cards, task checklists, history rows, the archive list
  or the change detail header layout.
- No new field, no new host read, no persistence, no new i18n locale — only new keys in the existing
  English map.
- Not a responsive redesign: the row degrades by wrapping, and the sidebar's narrowest supported
  width stays supported, but no separate mobile layout is designed.

## Decisions

**D1 — Two columns: a fixed numeric gutter and a body.** The left column (~52 px) states `n/m` over
`tasks`, or `—` when no tasks exist. The body carries name + recency, the two-line purpose, one facts
row, and one navigation row. *Why:* the count is the one fact a reader wants across all rows, and a
fixed column lets the eye scan a single vertical line of numbers; an inline meter (the rejected
instrument variant) aligned its numbers only within one row. *Alternative rejected:* a borderless
ledger (the other prototype) packed tighter but lost the card silhouette the panel uses everywhere,
and its progress bar, drawn as the row divider, read as a selection underline when full.

**D2 — The gutter numeral is the progress; the row draws no bar.** *Why:* with the count already in
the widest type on the row, a tracking bar repeats the same value in a second channel and costs a
row of height. The detail header keeps its progress bars, so the graphic form is still available one
click away. *Alternative rejected:* a 2 px bar under the navigation row — it added a fourth visual
layer and made a 100 % card look selected.

**D3 — The gutter numeral uses `--dsw-font-s-strong-14`, not a larger literal.** The prototype set the
numeral at 15 px, which no token matches; 14 px/500/22 px is the strongest shipped type token that
still scans as a number. The 1 px difference is invisible next to the hierarchy gain of using the
host's own scale.

**D4 — Commit facts leave the row and stay in the detail header.** The row's `modified` fact already
answers "when did this move", and the hash answers "what touched it" — a question of the detail view.
*Alternative rejected:* keeping the hash as a chip in the navigation row, which costs width on the
narrowest column for a fact that is rarely read in the list.

**D5 — Both actions render; the inapplicable one is disabled and inert.** *Why:* a button that moves
between cards cannot be learned, and a disabled `Archive` states the archive gate before the click
instead of after it. Availability follows task completion only, because that is the gate the host
enforces first — `archiveBody`/the archive route refuse an incomplete change by task count before the
engine's archive gate runs, and a missing task-review approval explicitly does not refuse a click. So
each disabled control states its own reason: `Archive` on an incomplete change says every task must be
complete, and `Apply` on a complete change says the change is complete. Neither claims a missing
task-review PASS, which would be false on an approved-but-unfinished change. *Alternative rejected:*
keeping today's conditional action and relying on the detail header to explain the gate.

**D6 — The redesign is scoped to active rows, and to them by class.** `ChangeCard` gains a
`dsh-openspec-change-row` class and its own CSS block; the existing `.dsh-openspec-card` rules stay for
capability cards and for the archived branch. The archived rendering — archive date, task completion,
purpose, last commit, no actions — is left byte-for-byte in place, because `archiveBody` and the
empty-state recents call the same component and their facts are history, not a decision. *Why:* the
two surfaces share both the component and `PANEL_CSS`; restyling the shared path would silently
redesign the Specs tab and break the archive facts the `Archived changes are browsable` requirement
pins. *Alternative rejected:* one layout for every row, which would have to drop or re-place the
archive's date and commit.

**D7 — Navigation entries are text buttons, not `Tag`s.** The artifact entries become 12 px ghost
buttons with a hover fill, keeping `onOpenArtifact` and the existing stop-propagation so a click never
opens the card. *Why:* a `Tag` is a label, and these are controls; the hover fill is what the panel's
existing ghost controls do. The requirement count folds into one `specs N` entry whose description
names N requirements.

**D8 — Labels are keys in the existing English map.** New keys: the short artifact labels and the
disabled-archive reason. Existing keys (`phase.*`, `change.tasksNotWritten`, `review.*`) are reused
where their text still fits. *Why:* the panel has one label map and no locale files to regenerate.

## Risks / Trade-offs

- **An all-zero list leaves the gutter visually empty** (every row `0/N`) → the `tasks` label under the
  count keeps the column legible, and the dash case is explicit; the owner accepted this when choosing
  the direction.
- **A disabled action can read as broken** → it is rendered as plain text, not an outlined button, and
  its description names the reason for its own state; the enabled action is the only one with a hover
  fill.
- **A hidden commit in the active list can cost a glance** ("who touched this change") → one click
  opens the change, where the header states hash, date and subject; the archive list keeps its commit
  column untouched.
- **Two card layouts now live in one component** (active rows and archived rows) → the archived
  subtree is kept verbatim, and task 2.4 asserts an archived row still states its date and commit, so a
  later refactor cannot quietly fold the two together.
- **Token-only type changes the prototype's rhythm** (22 px instead of 20 px title line, 20 px instead
  of 19 px body line) → the card grows by a few pixels; accepted for conformance. Measured in the live
  throwaway web host at a 570 px column: **128 px** per active card against the 247 px baseline the
  proposal records (119 px, 48 % less); the same card is 148 px at 400 px and 172 px at 360 px, where
  the navigation row wraps as designed and no surface scrolls horizontally.
- **Two-line purpose clamping hides text** → the full string stays on the element's title, as the
  current card already does through its tooltip.

## Migration Plan

UI-only, no data, no persisted state, no configuration: ship it in a normal release. Rollback is
reverting the commit; nothing outside the plugin's client bundle and its tests is affected. The live
profile is updated by the owner from an external PowerShell, as always.

## Open Questions

None. The one open detail — whether the gutter should widen at the sidebar's widest supported width —
is a visual tweak that changes no requirement or task, so it is left to implementation review.
