# Proposal

## Why

Refactoring is currently ad hoc: the next area is chosen by intuition, work starts without a
trustworthy behavioral safety net, and the result is not measured. Duplicated implementations,
dependency cycles, hidden coupling, and dead code therefore survive; every new change costs more than
it should; and a refactor can silently change behavior, turning maintenance into an incident. The
repository already ships opt-in methods as on-demand skills and is adding the spec-less change path, so
a repeatable audit → ROI → safety net → small steps → ratchet method can travel as one small plugin.

## What Changes

- Add an opt-in packaged method, skill `refactoring`, delivered by a small Host-only plugin bundle.
- Add the read-only audit change A (`audit-*`, spec-less): a project brief, baseline evidence, a
  nine-factor ROI register, candidate path records, hard overrides, anti-repetition, and a WIP limit.
- Add the refactor change B (`refactor-*`): one selected path, a behavior-preservation statement, a
  safety-net proof (green baseline, behavior oracles, mutation proof, performance/data baseline), small
  green steps, verification, before/after metrics, and an enforceable ratchet.
- Add two user gates: approval of the path after the audit, and approval of the safety net before the
  first production edit.
- Add a behavior-change stop rule: a discovered behavior change is a separate red-test-first change,
  never smuggled into the refactor.
- Add tool-agnostic evidence: git hotspots and change coupling, the host project's test/lint/dependency/
  duplication tools, and optional Serena for symbol-level work; no mandatory new tool, no CodeGraph.
- Do not add an always-on prompt, a tool, a Client surface, a config schema, a dashboard, a custom
  OpenSpec schema, or a runtime dependency.
- Do not modify the `add-exploratory-testing` platform files; depend on its shipped spec-less support.

## Capabilities

### New Capabilities

- `refactoring`: the state audit and ROI selection, the two-change cycle, the two user gates, the
  mandatory test safety net, behavior-preserving execution, verification and the ratchet, knowledge
  continuity, portability, safety, and optional tool adapters.

### Modified Capabilities

- None. The per-run audit and refactor changes are spec-less when no requirement changes, using the
  path delivered by `add-exploratory-testing`; this change adds a new capability only.

## Impact

- New package `packages/plugin-refactoring` with one skill and its templates, no runtime dependencies,
  and no Client half.
- Root `tsconfig.json` reference, README plugin row, locale and icon metadata, provider and content
  tests, and the generated bundle patch and vendored setup tree.
- The setup generator vendors the package automatically; no installer selection changes.
- No changes to existing plugins or platform files. The method depends on the spec-less support from
  `add-exploratory-testing`; if it is absent, the skill reports the prerequisite and stops.
- Spec-bearing changes keep their existing behavior. The OpenSpec CLI remains a machine prerequisite.
- Once installed, the first real audit/refactor cycle creates ordinary `audit-*` and `refactor-*`
  changes; this change only adds the method.
