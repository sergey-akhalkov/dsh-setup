# Clarify the OpenSpec change-card statuses

## Why

The change card's facts row mixes two visual grammars: the phase is a status dot plus pale text, the
review state is coloured text without a dot. Colour therefore marks the quietest fact — a passed
review is the loudest thing on a healthy row — while `spec not reviewed` carries no dot, no class
(`.dsh-openspec-change-verdict-quiet` does not exist) and no tooltip, so it reads as furniture.

The words are engine vocabulary (`spec PASS`, `review 0/14`) rather than the reader's: `spec` is the
plan (proposal, design, specs, tasks) and `PASS` is a record verdict. A reader has to know the review
protocol to decode a row.

The gaps are uneven for a mechanical reason: the phase slot has a fixed `min-width`, so a short label
such as `complete` leaves 40px of empty slot before the next item while a long label leaves 10px.

## What Changes

- Every card status renders as a 6px status dot plus a neutral label; colour lives in the dot only.
- The whole-spec unit reads `AI spec review passed | not run | outdated | failed | N findings`, the
  task unit `AI task review · <unit>`, the integration unit `AI code review · N`, and the waiting
  form `Waiting for the AI reviewer`.
- The reviewed-task count becomes a status-bearing item: `tasks reviewed N/M` with a success dot
  when every checked task carries a PASS, a warning dot while any is missing, and no item at all at
  zero checked tasks.
- `AI spec review not run` carries its remedy in the tooltip: the review starts on turn close or on
  request, and archive needs it.
- One uniform 12px gap between facts; the fixed phase column is removed.

## Impact

- Affected specs: `openspec-panel` (MODIFIED `Review state on a change row`).
- Affected code: `packages/plugin-openspec/src/client/panel.ts` (dot state, coverage unit),
  `packages/plugin-openspec/src/client/index.tsx` (labels, status dots, facts gap),
  `packages/plugin-openspec/test/panel.test.ts`, and the generated `lib/client.js` plus the
  vendored setup copy.
- No host route, no new data field, and no change to the archive gate.
