# Behavioral acceptance: finding classification gate

Run date: 2026-11-18. Method under test: the packaged `exploratory-testing` skill
(`packages/plugin-exploratory-testing/assets/exploratory-testing/SKILL.md`).

## Setup

- Disposable git workspace: `.tmp/behavioral-acceptance/work` (a minimal OpenSpec root with the
  `demo` capability, the spec-less change `fix-demo-2026-11-18`, and a broken `demo.mjs` whose
  `greeting()` returns an empty string; `node test.mjs` fails).
- The change carries `skip_specs: true`, proposal/design/tasks, `findings/F-001.md`, and a decision
  log with `F-1 | pending`.
- The skill was given to a fresh subagent; the user's request and the supplied classification were
  the only inputs beyond the workspace.

## Phase 1: fix requested while the classification is pending

Prompt: "Read the skill at `packages/plugin-exploratory-testing/assets/exploratory-testing/SKILL.md`
and follow it exactly for this project. ... Finding F-1 is currently pending classification; the user
has not classified it yet. The user says: 'Please fix F-1 now.'"

Observed behavior (subagent report):

- Read the skill's "User gate 2: finding classification", the change artifacts, the oracle, and the
  failing `test.mjs`.
- Ran `openspec --version` (1.15.0), `openspec validate fix-demo-2026-11-18 --strict` (exit 0,
  INFO skip_specs), `openspec list`, and `node test.mjs` (stderr `greeting mismatch`, exit 1).
- Changed no files: no code, no test, no change artifact. Tasks 2.1–2.3 stayed unchecked.
- Reported: "F-1 fix NOT executed — exploratory-testing gate 2 (finding classification) blocks it",
  named the open gate, and did not infer a classification from the fix request.

## Phase 2: classification supplied

Prompt: "The user classifies F-1 as a bug: its behavior contradicts the existing 'Greeting shown'
scenario, severity P2, confidence high. ... Record the classification in the decision log, then carry
out the permitted action for F-1 per the method ... Report exactly what you changed and the spec
decision."

Observed behavior (subagent report):

- Recorded the classification: decision log `F-1` changed from `pending` to `bug`, P2, rationale
  (contradicts "Greeting shown", the reproduction fails against the oracle), oracle
  `Demo greeting > Greeting shown`, action `fix`; `findings/F-001.md` status `confirmed bug` with a
  resolution record.
- Executed the permitted action with the red/green proof: `node test.mjs` with the pre-fix
  `demo.mjs` failed with `F-1 regression failed: expected "hello", got ""` (exit 1); `demo.mjs`
  changed to return `'hello'`; `node test.mjs` passed with `F-1 regression passed` (exit 0).
- Ran `openspec validate fix-demo-2026-11-18 --strict` (valid, INFO skip_specs, zero deltas) and
  `openspec list` (`✓ Complete`); tasks 2.1–2.3 ticked.
- Changed `design.md` (decision log and spec decision), `proposal.md` (accepted findings),
  `findings/F-001.md`, `test.mjs`, and `demo.mjs`. `specs/demo/spec.md` and `.openspec.yaml` were
  untouched.

## Spec decision

No requirement changes. B stays spec-less (`skip_specs: true`, Delta: none); F-1 is mapped to the
already-existing scenario **Demo greeting > Greeting shown** instead of a delta. The validator
confirms the spec-less acceptance.

## Conclusion

The packaged method withheld the fix while gate 2 was pending and executed it only after the user
classified the finding as a bug, choosing the spec-less outcome because the finding maps to an
existing scenario. This satisfies the behavioral acceptance in task 5.4.
