# Proposal

## Why

Exploratory testing is currently ad hoc: the next area is chosen by feel, sessions end in reports
instead of durable artifacts, and findings do not reliably become regression tests, spec
corrections, or project knowledge. A state-driven, change-driven process makes every cycle
auditable and every outcome reviewable and actionable.

## What Changes

- Add an opt-in packaged method, skill `exploratory-testing`, delivered by a small plugin bundle.
- Make spec-less changes first-class under the shipped workflow gates: the change-intake spec step,
  adoption, and user-click archive accept a change with `skip_specs: true` and three artifacts
  instead of requiring a `specs/**/spec.md` file, while the whole-spec review record stays mandatory.
- Add a state scan that ranks candidate areas from current evidence: knowledge gaps, test gaps,
  churn, defect history, ambiguity, staleness, criticality, and feasibility. Hard overrides and
  anti-repetition rules keep the focus current rather than habitual.
- Add two OpenSpec changes per cycle: an `explore-*` cycle change that plans and records the work
  (always spec-less) and a `fix-*`/`harden-*` outcome change that carries findings, decisions, tests,
  and spec corrections. The outcome change is spec-less when every accepted finding maps to an
  existing scenario and no requirement changes; otherwise it carries the delta.
- Add two user gates: approval of the focus before sessions, and classification of every finding as
  bug, feature, spec error, test gap, or unknown before any fix is applied.
- Add the test and spec contract: a confirmed bug needs a regression test that fails before the fix,
  and every accepted finding maps to a spec delta or an explicitly identified existing scenario.
- Add knowledge and state continuity: a project brief, a cycle state snapshot, and a Hindsight
  digest that the next cycle reads.
- Do not add an always-on prompt, a new tool, a dashboard, or a custom OpenSpec schema.

## Capabilities

### New Capabilities

- `exploratory-testing`: state-driven focus selection, the cycle and outcome change contract, the
  two user review gates, the test/spec outcome rules, knowledge continuity, and portability and
  safety boundaries.

### Modified Capabilities

- `openspec-workflows`: the contributed `change-intake` definition accepts a `skip_specs: true`
  change without a spec file and still runs the whole-spec review on the plan.
- `workflows`: adoption and user-click archive authorization accept a spec-less change with three
  artifacts plus the `skip_specs` marker, while the current whole-spec `PASS` record remains
  required.

## Impact

- New package `packages/plugin-exploratory-testing` containing one skill and its templates, with no
  runtime dependencies and no Client half.
- `packages/plugin-openspec/assets/workflows/change-intake.json`, its contribution test, and
  `packages/plugin-workflows` adoption and archive-authorization checks gain spec-less support, with
  tests and documentation updates.
- The setup generator vendors the package automatically; the root README plugin table gains a row,
  and the package ships one provider test.
- Spec-bearing changes keep their existing behavior. The OpenSpec CLI remains a machine prerequisite,
  as it is for the packaged OpenSpec skills.
- Once installed, the first cycle creates real `explore-*` and `fix-*` changes; this change only
  adds the method.
