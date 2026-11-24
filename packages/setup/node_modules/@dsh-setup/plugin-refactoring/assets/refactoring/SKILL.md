---
name: refactoring
description: >
  State-driven, behavior-preserving refactoring: a read-only audit change ranks
  candidate paths by evidence and ROI, the user approves one path, four proofs
  build a test safety net before the first production edit, and small green
  steps restructure the code and leave an enforceable ratchet. Opt-in; use when
  asked to refactor, deduplicate, or pay down architecture debt.
---

# Refactoring

Refactoring here is a method, not a cleanup sprint: evidence ranks the next path, one read-only
OpenSpec change records the audit, the user approves the path, four proofs build the test safety net
before the first production edit, one green step at a time restructures the code, and the change
closes with an enforceable ratchet. Refactoring never changes product behavior; a behavior change is
a separate change. This skill is opt-in: invoke it, do not apply it to every change.

## When to use it

Use it when the user asks to refactor, deduplicate, pay down architecture debt, remove cycles or dead
code, or reduce the cost of future changes. Use it when a hotspot, a duplicated fact, or a contract
contradiction is suspected and the next target must be chosen from evidence rather than intuition.

Do not use it for a feature, a bug fix with a reproduction, a dependency upgrade, a release checklist,
or a big-bang rewrite. Those are ordinary changes; a refactor that would change behavior is not a
refactor.

## Prerequisites

Check these before writing any artifact:

- The OpenSpec CLI is available and the project has an `openspec/` root. Without the CLI, report the
  prerequisite and stop; do not fabricate a change. After any artifact change, run
  `openspec validate <change> --strict`.
- The per-run changes need spec-less change support (`skip_specs: true` in intake, adoption, and
  archive), delivered by the `add-exploratory-testing` platform work. When it is absent, report the
  prerequisite and stop: do not edit the platform and do not add a fake delta.
- If the project has no `openspec/` root, do not create one as a side effect. Only with explicit user
  approval may you run `openspec init --tools none` (never install project-local skills).
- A safe environment exists: a reproducible checkout, the project's own test and lint commands, and
  no dependency on production data or a live consumer profile. When it does not, stop and ask.
- The host project's review policy governs tasks. Where a task-review engine exists, checked tasks
  need their review records; this method never hardcodes that policy. Hindsight is optional.

## Cycle at a glance

1. Audit: read-only change A (`audit-*`, spec-less) records the brief, the baseline, the candidates,
   the ROI register, and the selected path.
2. User gate 1: the user approves or replaces the path.
3. Safety net: the refactor change B proves the green baseline, the behavior oracles, the mutation
   proof, and the performance or data baseline.
4. User gate 2: the user approves the net before the first production edit.
5. Execution: small green behavior-preserving steps, one per commit.
6. Verification and ratchet: oracles pass, the contract diff is empty, the metric improved, and at
   least one automated guard landed.
7. Close: update the brief and the state snapshot, digests and decisions recorded.

## Audit sources and baseline

Read the project as it is, not as its documentation claims. The default evidence sources are the
project's own files and tools:

- `git`: churn per file and module, change coupling (files that change together), defect history
  (fix, revert, and hotfix commits), and the age of the last real change.
- The compiler, type checker, and language server: dependency direction, unused exports, and
  unreachable code.
- The test runner: which seams have oracles, where the suite is slow, and which suites are skipped or
  flaky.
- The project's lint, dependency, duplication, and mutation tools, when they already exist.
- Specs, contracts, and docs: the requirements a boundary or a duplicate is supposed to honor.
- The issue tracker and incident notes, when the project has them.

Record the baseline in `audit.md` (raw evidence appendix) and summarize every decision-relevant fact
in `design.md`. A factor value without an evidence reference is not accepted: the candidate stays
out of selection until the evidence exists. When no candidate has a justified gap, record that no
refactor is needed, create no refactor change, and close A.

Write or refresh `brief.md` on the first cycle and when the project changes: stack, build/run/test
commands, environments, contracts and criticality, oracle sources, review policy, tracker.

## ROI register and the nine factors

Every candidate path gets nine values scored 0-3, each with an evidence reference. Intermediate
values are judgment calls and must name their evidence.

| Factor | Meaning | 0 | 3 |
| --- | --- | --- | --- |
| H | hotspot: change frequency × complexity | cold and simple | changed weekly and complex |
| C | coupling, duplication, cycles | one source of truth | change amplification, clones, cycles |
| D | defect and incident history | none | recurring P0/P1 |
| A | architecture drag | clean boundary | cycle, layer violation, god module |
| M | maintenance drag | small and simple | large, dead, slow build |
| B | blast radius and criticality | cosmetic | data, security, availability, money |
| E | effort | hours, local | weeks, cross-team |
| R | verification risk | strong oracles, fast tests | no tests, hidden or dynamic behavior |
| F | feasibility | reproducible, rollback exists | environment unavailable, no rollback |

```text
value = (H + 1) * (C + D + A + M) * (B + 1)
cost  = (E + 1) * (R + F + 1)
ROI   = value / cost
```

The formula is a ranking aid, not truth. Anchors, evidence, hard overrides, and the user gate keep it
honest, and the register records rejected candidates so the next cycle does not re-litigate them.
Red CI or a red suite is a blocker, not a path: the first change is a `stabilize` path or a separate
fix, never a refactor on a red baseline.

## Selection rules

- Select the highest-ROI eligible candidate. Record the rejected candidates and why they lost.
- Hard overrides outrank the score and are exempt from repeat exclusion: an active P0/P1 defect or
  incident, a security or data risk, or a critical contract contradiction. Select a hard-override
  path before any score-based candidate.
- Anti-repetition: exclude the previous cycle's area unless a hard override applies. When every
  candidate repeats, rotate the path class and the area.
- WIP limit: one active audit A and one active, unclassified refactor B. Start no new audit while
  either is active.
- Path classes: `stabilize`, `deduplicate`, `boundary`, `seam`, `simplify`, `migrate`. One primary
  class per refactor change; preparatory steps belong in its Mikado graph.

## User gate 1: path approval

Present the register, the selected path, the rejected candidates, the target, the risk, and the
safety-net plan. Do not edit production code and do not create the refactor change until the user
approves or replaces the path. Record the approval, or the user's choice and the overridden score, in
A's `design.md`. Without a decision, no refactor change starts and no production code is edited.

## Audit change A

A is an ordinary OpenSpec change named `audit-<area>-<date>`. Set `skip_specs: true` in its
`.openspec.yaml`: it plans and records the audit and changes no product behavior, so it carries no
delta spec. Its artifacts come from `templates.md` in this package:

- `proposal.md` — why this audit now, scope, expected decision, non-goals.
- `design.md` — audit method, sources, factor anchors, the full ROI register summary, selection and
  rejected candidates, approval record, risks. This is the reviewed decision record.
- `audit.md` — raw baseline evidence appendix: architecture map, churn and coupling tables, metrics,
  commands.
- `brief.md` — project profile appendix: stack, commands, environments, contracts, criticality.
- `findings/P-*.md` — one candidate path per file: evidence, the nine factor values, the score, the
  proposed class, the target, the safety-net cost, and the risk. The whole-spec review reads these
  records.
- `tasks.md` — scan, register, user gate 1, create B or record the no-path decision, close.

The review-safe layout is deliberate: every decision-relevant fact lives in `proposal.md`,
`design.md`, `tasks.md`, or a `findings/P-*.md` record. `audit.md` and `brief.md` hold the raw
evidence and are linked, not required for the verdict. A change is not a diary: raw logs stay local
and are linked.

A closes when the refactor change B exists or the no-path decision is recorded. A checked task
requires its phase artifact: the scan evidence, the register, the approval record, or the link to B.

## Refactor change B

After path approval, create exactly one separate OpenSpec change named `refactor-<area>-<date>`. Its
artifacts come from `templates.md`:

- `proposal.md` — the selected path, ROI evidence, scope, non-goals, and the behavior-preservation
  statement.
- `design.md` — current and target structure, the Mikado graph, the step plan, the safety-net
  summary, migration and rollback, the verification contract, before/after metrics, and the ratchet.
- `specs/<capability>/spec.md` — only a real delta: a changed contract or a new enforceable rule.
- `findings/` — discovered defects, which are not fixed inside the refactor, and path-specific
  evidence.
- `tasks.md` — safety net first, user gate 2, small green steps, dedup or delete, ratchet, verify,
  close.

B names exactly one path and its scope. It states that no product behavior changes and names the
oracles that prove it. No path approval means no `refactor-*` change.

## Spec-less refactor change

Refactoring by definition preserves behavior, so a product requirement delta is usually absent.
Declare `skip_specs: true` when the path only restructures code and adds no enforceable architecture
rule or contract; it then validates without a delta. Carry a delta only when a requirement or an
enforceable rule actually changes. Never invent a requirement, or a delta, to satisfy validation, and
never add one solely because an existing scenario already covers the behavior. The marker is part of
the change digest: changing or removing it invalidates a review PASS.

## Safety net: four proofs

Before the first production edit, the refactor change proves all four and records them in `design.md`
and the task evidence:

1. Green baseline — the relevant suite passes on the current commit; the command, environment,
   duration, and known flakes are recorded. Fix a red baseline first or block the refactor.
2. Behavior oracles — characterization, contract, golden, or property tests at the public seams the
   refactor moves; they pass on the current code. Assert public behavior: no private-method or
   call-order assertions.
3. Mutation proof — deliberately break the behavior and show the oracle fails. Use a mutation tool
   only when the project already has one; otherwise record the manual mutation.
4. Performance or data baseline — for hot or stateful paths: p50/p95, throughput, memory, and the data
   invariants, with a budget set before the change.

A weak net is refused: when an oracle cannot fail, or the baseline is red, no production edit starts.
A test that must change means implementation coupling (rewrite at the seam, justify it, re-prove) or a
behavior change (stop and split).

## User gate 2: safety-net approval

Present the four proofs to the user and do not edit production code until the user approves the net.
Record the decision in B's `design.md`. A refusal leaves the missing proof recorded and the refactor
stopped; a pending decision leaves the refactor waiting.

## Green steps

Execute one behavior-preserving transformation per green commit. Before a step, name the seam it
moves and the oracle that proves it; after the step, run the narrow suite, then the relevant full
suite, and commit only when both pass. Revert a red step instead of pushing through it. Large paths
use a Mikado graph: each preparatory step that can stand alone is committed and its reverse edge is
recorded.

Before deleting code, apply Chesterton's Fence: find the history, the tests, the callers, and the
documentation that explain why it exists. Dead code is proven dead before deletion.

### Test removal

Never delete a test that encodes live behavior. Remove a test for proven-dead code only with a
recorded proof of unreachability. A test that fails because the implementation moved is rewritten at
the same public seam, justified, and re-proven.

## Behavior-change stop rule

A refactor must not change product behavior. When a behavior change is discovered, stop and handle it
in a separate change:

- A test reveals a defect: pin the current behavior with a characterization test marked as a known
  defect, continue the refactor only if that is safe, and fix the defect in a separate
  red-test-first change.
- A changed contract or behavior is needed: stop the refactor and split the change.
- The defect makes the refactor unsafe: fix it first in its own change and resume after.

The refactor reports and waits; it never improvises a behavior change, and it never smuggles one in as
a refactor step.

## Deduplication rule

Unify only behavior proven identical by tests or contract; then collapse it to one source of truth
and verify every caller. Do not create an abstraction for merely similar code. One source of truth
per fact is the goal, not zero textual duplication. When two implementations look similar but have
different behavior or owners, keep them separate and record the reason. When a proposed abstraction
would couple unrelated concepts, reject it and keep the duplication.

## Migration patterns

A migration path is a refactor too, and keeps the same safety net:

- Strangler Fig — build the new path beside the old one and move callers over in slices.
- Branch by Abstraction — add an abstraction over the old implementation, then replace the
  implementation behind it.
- Parallel Change — expand the interface, migrate the callers, then contract it, in that order.
- Feature flags, canary, and shadow traffic where the project already supports them; never introduce
  a flag system the project does not have.
- Every migration has a rollback plan, and the rollback is verified or documented before close.

## Verification and the ratchet

Before B closes, all of the following are recorded:

- The behavior oracles pass, and a rewritten oracle is justified and re-proven.
- The public contract diff is empty: API, CLI, config, data, and database contracts.
- Performance is within the recorded budget.
- The full suite is green.
- The targeted measured metric improved without another metric regressing beyond its budget.
- At least one automated ratchet guards the target architecture.
- Rollback is verified or documented, and the knowledge capture is written.

A ratchet is a dependency rule, a public API snapshot, a duplication threshold, a complexity
threshold, an architecture test, or a characterization test, living in the project's existing
lint, test, or CI. A refactor that cannot leave a guard is either a pure move or not finished.

Metrics are evidence, not goals: files or modules per representative change, cycles and boundary
violations, duplicated tokens, build and test duration, defect-fix density. Coverage percentage and
line count alone are not accepted.

## Ratchet baseline

When the target rule already has violations, freeze them in a baseline and fail only on new
violations. The baseline records each pre-existing violation, the check passes on them, and any new
violation fails the check. Never widen the baseline to make a new violation pass.

## Close and continuity

At close, update `brief.md` and the state snapshot the next audit reads, and write a durable Hindsight
digest when Hindsight is available: declarative statements about invariants, oracles, traps, and
confirmed or refuted risks. When Hindsight is unavailable, skip the digest and note it. A standalone
report must not be the only output of a cycle: leave the audit change and, when actionable, the
refactor change, or record the no-path decision.

The next audit reads the latest audit's register, `brief.md`, the state snapshot, the previous
refactor's decision record and ratchet, and the digest before scoring candidates.

## Portability and safety

Discover the host project's stack, build/run/test commands, test tooling, environments, oracles, and
review policy from its own files. Never assume dsh-setup paths. Do not run destructive actions against
production data or a live Harness profile: use a throwaway environment or the project's documented
test environment, and stop and ask when a safe environment cannot be established. No history rewrite,
no production migration, no destructive data step.

When the OpenSpec CLI or the spec-less platform support is unavailable, report the prerequisite and do
not fabricate change artifacts. In projects without a task-review engine, both user gates remain user
decisions and the project's own review policy governs implementation.

## Optional tool adapters

The project's existing tools are the default evidence sources. Serena is optional: use it only for
symbol-level work on large files or cross-file refactors, through its documented discipline, and
record the evidence it produced. Its callers and rename operations do not replace the hotspot,
duplication, or architecture metrics of the audit.

Do not require CodeGraph and do not install a new tool without the user's approval. When the project
lacks a code-graph, duplication, or mutation tool, use the available evidence and record the gap
instead of installing a dependency.
