# Design

## Context

See `proposal.md` for motivation and `specs/refactoring/spec.md` for the behavior contract. The
repository already ships opt-in methods as on-demand skills inside tiny Host-only bundles;
`plugin-exploratory-testing` is the closest precedent. OpenSpec changes are the working artifact for
every behavior change, and the shipped workflow gates require a completed intake, a current whole-spec
`PASS`, and a task-review `PASS` per checked task.

Two constraints shape the approach:

- Per-run audit and refactor changes need the spec-less path (`skip_specs: true`) that
  `add-exploratory-testing` is delivering. This change depends on it and must not duplicate it.
- The current whole-spec review reads `proposal.md`, `design.md`, delta specs, `tasks.md`, and
  `findings/**/*.md`; it does not read arbitrary extra markdown. Decision-relevant evidence therefore
  lives in the reviewed artifacts, with raw evidence in appendices.

The method rides these primitives: a packaged skill for the method, OpenSpec for the artifacts, the
host project's git/test/lint tooling for evidence, and the existing review gates. It adds no runtime
service, UI, storage layer, or mandatory code-analysis product.

## Goals / Non-Goals

**Goals:**

- Make the next refactoring path a product of current evidence rather than intuition or the loudest
  complaint.
- Make the improvement safe by proving a behavioral safety net before the first production edit.
- Keep each refactor small, green, reversible, and honest about behavior preservation.
- Leave the architecture harder to erode: an enforceable ratchet, less duplication, explicit
  boundaries, and a smaller maintainable surface.
- Keep the method portable and cheap: one skill, no new engine, no mandatory tool.

**Non-Goals:**

- A big-bang rewrite, a framework migration, or any product behavior change inside a refactor.
- A dashboard, metrics service, scheduler, new OpenSpec schema, or universal scanner.
- Coverage percentage or line count as the goal.
- Shipping or requiring CodeGraph, or installing any new tool without explicit approval.
- Replacing the project's test suite, CI, review policy, or issue tracker.

## Decisions

### D1. One skill in one small Host-only plugin

Ship skill `refactoring` in `packages/plugin-refactoring`, shaped like `plugin-exploratory-testing`:

```text
packages/plugin-refactoring/
├─ package.json                 # engines.dsh, dsh.bundle, files incl. assets
├─ cordis.fragment.yml          # row dsh-setup-refactoring
├─ src/host/index.ts            # registers the skill provider only
├─ test/skill-provider.test.ts  # catalog entry + body load + no always-on
├─ test/skill-content.test.ts   # requirement coverage
├─ assets/refactoring/
│  ├─ SKILL.md                  # the method
│  └─ templates.md              # copy-ready A/B, register, safety net, step, verify
├─ locale/en.json
├─ icon.svg
└─ tsconfig.json
```

No Client half, no config schema, no tool, no always-on system-prompt contribution. The skill is
model- and user-invocable at bundled rank 600. A project-local skill of the same name keeps precedence,
so a repository can specialize the method without uninstalling the bundle.

Alternatives: a project-local skill only (does not travel, drifts); a workflow definition (turns
judgment into a checkbox gate); a new tool/dashboard (adds the maintenance cost the method fights).

### D2. Two changes per cycle with a review-safe artifact layout

**A — `audit-<area>-<date>`** is read-only and declares `skip_specs: true`:

- `proposal.md` — why this audit now, scope, expected decision, non-goals.
- `design.md` — audit method, sources, factor anchors, the full ROI register summary, selection and
  rejected candidates, approval record, risks. This is the reviewed decision record.
- `audit.md` — raw baseline evidence appendix (architecture map, metrics, commands).
- `brief.md` — project profile appendix (stack, commands, environments, contracts, criticality).
- `findings/P-*.md` — one candidate path per file: evidence, factors, score, proposed class, target,
  safety-net cost, risk. These records are read by the whole-spec review.
- `tasks.md` — scan, register, user gate 1, create B or record no-path, close.

**B — `refactor-<area>-<date>`** is the reviewable path change:

- `proposal.md` — selected path, ROI evidence, scope, non-goals, behavior-preservation statement.
- `design.md` — current/target structure, Mikado graph, step plan, safety-net summary, migration and
  rollback, verification contract, before/after metrics, ratchet. This is the reviewed decision record.
- `specs/<capability>/spec.md` — only a real delta: a changed contract or a new enforceable rule.
- `findings/` — discovered defects (not fixed inside the refactor) and path-specific evidence.
- `tasks.md` — safety net first, user gate 2, small green steps, dedup/delete, ratchet, verify, close.

Why two: A has no honest delta before the path is chosen; B has one only when a requirement or
architecture rule actually changes. Splitting keeps `openspec validate` truthful and makes the two user
decisions unambiguous. A single-change variant would flip `skip_specs` mid-life and mix audit noise with
the product contract.

The appendices are not dead weight: they hold the raw evidence behind the reviewed summary. If the
review scope is later broadened, they can become first-class reviewed artifacts without changing the
method.

### D3. ROI register and selection

Nine factors scored 0–3, each with evidence:

| Factor | Meaning | 0 | 3 |
| --- | --- | --- | --- |
| H | hotspot: change frequency × complexity | cold and simple | changed weekly and complex |
| C | coupling, duplication, cycles | one source of truth | change amplification, clones, cycles |
| D | defect and incident history | none | recurring P0/P1 |
| A | architecture drag | clean boundary | cycle, layer violation, god module |
| M | maintenance drag | small and simple | large, dead, slow build |
| B | blast radius and criticality | cosmetic | data, security, availability, money |
| E | effort | hours, local | weeks, cross-team |
| R | verification risk | strong oracles, fast tests | no tests, hidden/dynamic behavior |
| F | feasibility | reproducible, rollback exists | environment unavailable, no rollback |

```text
value = (H + 1) * (C + D + A + M) * (B + 1)
cost  = (E + 1) * (R + F + 1)
ROI   = value / cost
```

Hard overrides outrank the score and are exempt from repeat exclusion: an active P0/P1 defect or
incident, a security or data risk, or a critical contract contradiction. Red CI or no green baseline is
a blocker, not a path: the first refactor is `stabilize` or a separate fix.

Anti-repetition excludes the previous area unless a hard override applies or the previous refactor
failed verification. When all candidates repeat, the method rotates the path class and area. WIP limit:
one active A and one active B. Path classes: `stabilize`, `deduplicate`, `boundary`, `seam`, `simplify`,
`migrate`; one primary class per change, preparatory steps in the Mikado graph.

The formula is a ranking aid, not truth. Anchors, evidence, hard overrides, and the user gate keep it
honest; the register records rejected candidates so the next cycle does not re-litigate them.

Alternatives: a single static-analysis score (ignores churn and runtime risk); cyclomatic complexity
alone (not ROI); a cost-of-delay/WSJF formula (borrowed from portfolio planning and too coarse for a
single codebase). The chosen model is simple, auditable, and grounded in hotspots and change coupling.

### D4. Mandatory safety net before the first production edit

Four proofs, recorded in B's `design.md` and task evidence:

1. **Green baseline** — the relevant suite passes on the current commit; command, environment,
   duration, and known flakes are recorded. A red baseline is fixed first or the refactor is blocked.
2. **Behavior oracles** — characterization, contract, golden, or property tests at the public seams
   the refactor moves; they pass on the current code. No private-method or call-order assertions.
3. **Mutation proof** — deliberately break the behavior and show the oracle fails; a mutation tool is
   used only when already present, otherwise the manual mutations are recorded.
4. **Performance/data baseline** — for hot or stateful paths: p50/p95, throughput, memory, and data
   invariants; a budget is set before the change.

User gate 2 approves the net before the first production edit. Tests that encode live behavior are not
deleted during the refactor; a test for proven-dead code may be removed only with proof of
unreachability. A test that must change means either implementation coupling (rewrite at the seam,
justify and re-prove) or a behavior change (stop and split).

A discovered defect is not fixed inside the refactor. Pin the current behavior with a characterization
test marked as a known defect, finish the refactor if safe, then create a separate red-test-first
change. If the defect makes the refactor unsafe, fix it first in that separate change.

### D5. Execution and behavior-preservation stop rule

One path per change; one behavior-preserving transformation per green commit. Each step runs the narrow
suite then the relevant full suite; a red step is reverted, not pushed through. Large paths use a
Mikado graph. Before deleting code, apply Chesterton's Fence: history, tests, callers, documentation.
Migrations use Strangler Fig, Branch by Abstraction, or Parallel Change with feature flags, canary/shadow
where possible, and a rollback plan.

Stop conditions: red tests, a discovered behavior change, scope beyond the approved path, a performance
regression beyond budget, a security/data risk, or no rollback. The method reports and waits; it never
improvises a behavior change into the refactor.

### D6. Verification and ratchet

Definition of done: the behavior oracles pass; the public contract/API/CLI/config/data/DB diff is empty;
performance is within budget; the full suite is green; the targeted metric improves without another
metric regressing beyond its recorded budget; at least one automated ratchet guards the target; rollback
is verified or documented; before/after metrics and knowledge capture are recorded.

The ratchet is the durable part: dependency rule, public API snapshot, duplication threshold,
complexity threshold, architecture test, or characterization test in the project's existing
lint/test/CI. Existing violations are frozen in a baseline and only new violations fail (Packwerk todo
and Google new-warning posture). A refactor that cannot leave a guard is either a pure move or
incomplete.

Metrics are evidence, not goals: files/modules per representative change, cycles and boundary
violations, duplicated tokens, build/test duration, defect-fix density. Coverage percentage and line
count alone are not accepted.

### D7. Tooling: native first, Serena optional, CodeGraph not shipped

The default evidence sources are `git` (churn, change coupling, defect history), the compiler/LSP, the
test runner, and the project's existing lint/dependency/duplication/mutation tools. The skill discovers
what exists; it never installs a tool without approval.

Serena is already configured and is used lazily for exact callers, rename, and safe delete on large or
cross-file work, following the `serena-discipline` rules. It does not provide hotspot/duplication/
architecture metrics, so it complements but does not replace the audit.

CodeGraph is not shipped: `codegraph-engine` is source-available with a commercial production licence,
adds 97 MCP tools and a SQLite index, and its benchmark claims are self-reported. It remains an
optional, separately approved adapter or spike; the method works without it.

No universal scanner script: it would be brittle across stacks and a new maintenance surface. A
capability table in the skill names common native tools per stack, but the method does not install them.

### D8. Portability and safety

Discover the host project's stack, build/run/test commands, environments, oracles, and review policy
from its own files. Never assume dsh-setup paths. OpenSpec is a prerequisite; without it, report and
stop rather than fabricate artifacts. Hindsight is optional; the brief and state snapshot make the cycle
self-contained. No production data, no destructive operations, no history rewrite. In this repository,
acceptance uses a throwaway `DSH_HOME`/workspace and `pnpm dogfood`; the desktop profile is
owner-installed. Projects without the task-review engine keep both user gates as decisions and follow
their own review policy.

### D9. Platform dependency, not duplication

Per-run A/B changes need `skip_specs: true` support in intake, adoption, and archive. That is the
`add-exploratory-testing` platform work; this change verifies it and reports the prerequisite if absent.
It does not edit the platform files and does not add a fake delta to avoid the dependency. The
review-safe artifact layout (D2) is compatible with either the current `findings/**` scope or a later
broadened scope.

### D10. Packaging and acceptance

The setup generator vendors the package automatically; the root README gets a plugin row, the root
`tsconfig.json` gets the project reference, and `pnpm gen`/`pnpm build` regenerate the bundle patch,
`lib/**`, and the vendored setup tree. No installer selection changes. Acceptance: provider and content
tests, `pnpm check`, `pnpm validate:repo`, `pnpm validate:composition`, `pnpm gen:check`, `pnpm dogfood`,
and a dry run in a disposable workspace. The live desktop profile is not modified. The first real
audit/refactor cycle is a separate follow-up, not part of this change.

## Risks / Trade-offs

- **Two changes per cycle add overhead** → A is thin and timeboxed; B is the only product change. If it
  proves too heavy, collapse later, but do not lose the honest audit boundary now.
- **The ROI score is judgment** → anchors, evidence links, hard overrides, anti-repetition, and the user
  gate keep it honest; the register records rejected candidates.
- **Tests may be vacuous** → mutation proof; gate 2 refuses a weak net; tests target public seams.
- **Deduplication may create a wrong abstraction** → only proven-identical behavior is unified;
  duplication across bounded contexts may remain with a recorded reason.
- **Scope creep** → one path, stop conditions, Mikado graph, user gate.
- **Static analysis blind spots** → runtime/contract proof, not graph-only; Packwerk's retrospective
  shows a clean dependency graph can still fail at runtime.
- **The spec-less platform may not be installed** → report the prerequisite; do not fabricate.
- **Concurrent platform work may change the review scope** → the artifact layout is compatible either
  way; appendices can become reviewed artifacts without changing the method.
- **The agent may delete code it does not understand** → Chesterton's Fence and the test safety net.
- **Performance or data regression** → baseline, budget, rollback, canary for risky paths.

## Migration Plan

No migration: this is a new, opt-in plugin. After release and installation, the skill appears in the
catalog; no existing row or configuration changes. Rollback is disabling the row or uninstalling the
bundle; the method's artifacts remain ordinary OpenSpec changes. The first real audit/refactor cycle is
a separate change created after installation.

## Open Questions

None blocking. The first dry run may tune the factor anchors and the default timebox; those are process
tuning decisions that do not change the specs, the approach, or the task breakdown. If the whole-spec
review scope broadens to read the appendices, D2 records that they can become first-class reviewed
artifacts without changing the method.
