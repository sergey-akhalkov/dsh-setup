# Design: clarify the change-card statuses

## Context

`packages/plugin-openspec/src/client/index.tsx` renders one facts row per active card: the phase as a
`.dsh-openspec-change-dot` with `data-phase`, each review unit as a `.dsh-openspec-change-verdict`
with a `tone` class, and the reviewed-task count as a separate `.dsh-openspec-change-coverage` span.
`panel.ts` owns the unit labels and tones.

Three rules in one row, one of which was missing: the `quiet` tone that marks "not reviewed" never
got a CSS rule, so the label inherited the tertiary facts colour — the same colour as `2d ago`.

## Decisions

**D1 — Colour only in the dot, never in the label.** A 6px dot plus neutral text is the same
grammar the phase already used and the reader already read. It removes the green `spec PASS` text
that drew the eye to the row's least interesting fact. Colour therefore carries exactly four
meanings: success (done), warning (waits for you), error (failed), neutral (running or waiting).

**D2 — The dot vocabulary is the existing semantic tokens**, `--dsw-alias-state-success-primary`,
`-warn-primary`, `-error-primary`, and the tertiary label token for neutral. No new colour, no new
component: the card keeps its own 6px dot because the shipped `StateDot` is 10–14px and would change
the row's height.

**D3 — Words from the reader's world.** The user asked for `AI spec review`; the family extends to
`AI task review` and `AI code review` so one noun names one unit. `PASS` disappears from the card
labels and stays only in tooltips where the record itself is discussed.

**D4 — The reviewed-task count becomes a state.** `tasks reviewed N/M` with a dot answers "are the
tasks reviewed?" at a glance; previously it was plain text that looked like the gutter's task count.
Green when every checked task carries a portable PASS, amber while any is missing, absent at zero
checked tasks — the same guard the card already used.

**D5 — One 12px gap, no fixed column.** The fixed `min-width` on the phase slot bought vertical
alignment of the review dots but produced a different gap after every short phase label. The gap is
what the eye measures, so the slot goes. Trade-off accepted: dots no longer line up across cards.

**D6 — The pending state names its remedy.** A missing whole-spec record now carries a tooltip that
says the review starts on turn close (or on request) and that archive needs it. The panel offers no
start button: the host exposes no review-start route, and adding one is a separate change.

## Out of scope

`Archive` still enables on a complete card without a current PASS and refuses only after the click.
The reviewed alternative phrased the gate next to the button (`Archive needs the AI spec review`) and
disabled it; that is a behaviour change to the action row and stays a follow-up.

## Risks

- The `tone` field on `ReviewUnit` is replaced by `dot`; the type is internal to the package, so the
  risk is limited to this package's tests.
- Removing `.dsh-openspec-change-verdict-success|warning|danger|info` drops the coloured-text path
  entirely; a future surface that wanted coloured text must add its own rule rather than reuse one.
- The wording change is visible to every profile with the workflows engine. Without the engine the
  row renders exactly as before, which the additive requirement already covers.
