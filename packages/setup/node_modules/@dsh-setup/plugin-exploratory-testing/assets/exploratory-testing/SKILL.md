---
name: exploratory-testing
description: >
  State-driven exploratory testing: rank the next area from project evidence, run
  timeboxed sessions inside a read-only cycle change, then turn classified findings
  into a reviewable outcome change with regression tests, spec corrections, and
  knowledge capture. Opt-in; use when asked to explore a project, hunt defects, or
  harden an area.
---

# Exploratory testing

Exploratory testing here is a method, not a test run: a state scan chooses the next area from
evidence, one OpenSpec cycle change drives timeboxed sessions, and a second outcome change carries
the classified findings, the tests, and the spec corrections. The chat is only the interface for the
user's two decisions. This skill is opt-in: invoke it, do not apply it to every change.

## When to use it

Use it when the user asks to explore, hunt defects, harden an area, or build real coverage. Do not
use it for a known bug with a reproduction, a routine feature, or a release checklist; those are
ordinary changes.

Preconditions, checked before any artifact is written:

- The OpenSpec CLI is available and the project has an `openspec/` root. Without the CLI, report the
  prerequisite and stop; do not fabricate a change. After any change, run
  `openspec validate <change> --strict`.
- If the project has no root, do not create one as a side effect. Only with explicit user approval
  may you run `openspec init --tools none` (never install project-local skills).
- Hindsight is optional. It is the durable memory bank when present; a project without it still
  keeps `brief.md` and `state.md` in the cycle change.
- The host project's review policy governs tasks. In projects with a task-review engine, checked
  tasks need their review records; this method never hardcodes that policy.

## State scan and focus register

Read the latest cycle change's `state.md` and `brief.md`, the latest outcome change's decision log and
delta, and the Hindsight digest. Then evaluate every candidate area (a capability with a spec, or a
product surface without one) with eight factors scored 0-3. Intermediate values are judgment calls
and must carry an evidence reference.

| Factor | Meaning | 0 | 3 |
| --- | --- | --- | --- |
| B | blast radius / criticality | secondary surface | data, security, availability, installer |
| K | knowledge gap | verified by a recent cycle | no brief, never explored |
| T | test gap | risk nodes have oracle-backed tests | no tests |
| C | churn | no changes since last cycle | rewrite or hotfix |
| D | defect history | none | open P0/P1 or an incident |
| A | ambiguity | unambiguous oracle | contradiction or no oracle |
| S | staleness | explored in the previous cycle | never explored |
| F | feasibility cost | local, cheap, safe | credentials, special environment, unsafe |

Ranking aid, not a truth: `score = B * (K + T + C + D + A + S) - F`.

Evidence sources:

- K: Hindsight pages, `brief.md`, prior cycle snapshots.
- T: test inventory mapped to areas, a coverage report when the project has one, mutation checks on
  the chosen area.
- C: `git log` since the last cycle or release.
- D: state snapshot, Hindsight, `git log` for fix/revert commits, the issue tracker when present.
- A: specs with gaps or contradictions, unresolved questions, missing oracles.
- S: the previous cycle change and outcome changes.
- F: environment availability, credentials, safety, expected effort.
- B: the criticality table in `brief.md`.

The register records every candidate with its eight values, its score, and its evidence, plus the
selected focus, its focus mode, and the rejected candidates. When no candidate has a justified gap,
report that no cycle is needed and create no change.

## Selection rules

- Hard overrides outrank the score and are exempt from repeat exclusion: an open P0/P1 defect or
  incident; a security or data risk; a critical spec contradiction. Select a hard-override area
  before any score-based candidate.
- Anti-repetition: exclude the previous cycle's focus unless it matches a hard override. When every
  candidate repeats and none is a hard override, change the focus mode and the heuristic family
  instead of repeating the same charter.
- Focus modes: `knowledge`, `coverage`, `defect`, `spec`. Heuristic families: state/data,
  failure/recovery, integration/contract, security/permissions, time/locale, upgrade/migration,
  scale/performance.
- WIP limit: one active cycle change A and one unclassified outcome change B. Start a new cycle only
  after B's decisions are recorded or B is explicitly deferred.

## User gate 1: focus approval

Present the focus register, the proposed charters, and the rejected candidates to the user. Do not
start any exploratory session until the user approves or replaces the focus. Record the approval, or
the user's choice and the overridden score, in the cycle change's `design.md`. Without a decision, the
cycle waits.

## Cycle change A

A is an ordinary OpenSpec change named `explore-<area>-<date>`. Set `skip_specs: true` in its
`.openspec.yaml`: it plans and records the cycle and changes no product behavior, so it must carry no
delta spec. Its artifacts come from `templates.md` in this package:

- `proposal.md` — why this area now, the state snapshot summary, scope, expected outcome, non-goals.
- `design.md` — the focus register, the focus mode, the charters, oracles, heuristics, environment,
  safety, severity rubric, classification protocol, and the approval decision.
- `state.md` — the full focus register with evidence, last explored, coverage state, open findings,
  used modes and heuristic families, and the next-cycle input.
- `brief.md` — project brief: stack, build/run/test commands, environments, data setup, safety
  boundaries, criticality table, oracle sources, review policy, tracker. Create it on the first
  cycle and refresh it when the project changes.
- `findings/F-*.md` — candidate findings with executed evidence.
- `tasks.md` — phase-level tasks: state, focus approval, sessions, triage, outcome, close.

Raw session notes and screenshots stay local in `.dsh/qa/sessions/` and are linked from the records;
a change is not a diary. A checked cycle task requires its phase artifact: the register, the approved
charters, the session evidence, the triage table, or the link to B. A closes when B exists or the
no-finding decision is recorded.

## Sessions

Run one or two sessions inside the approved focus. Each session has a charter: mission, risk
hypothesis, areas, oracles, heuristics, timebox, out-of-scope, and exit criteria. Explore freely
inside the charter; record evidence immediately, not from memory afterwards. Stop and report a P0
immediately; do not wait for the debrief.

## Triage and candidate findings

A finding is a candidate, not a verdict. Each record carries the observed behavior, the exact
build or commit and environment, a minimal reproduction, and an oracle link or an explicit statement
that no oracle exists. A suspicion from reading code without execution is marked as a hypothesis and
cannot be classified as a bug. Deduplicate, reproduce minimally, and assign a proposed severity,
confidence, and class.

Severity rubric, separate from confidence:

- P0 — data loss or corruption, security or privacy breach, unavailability or a core-path crash with
  no workaround; release blocker.
- P1 — core flow broken or a wrong result with no reasonable workaround, silent wrong data, in a
  supported environment.
- P2 — a workaround exists; secondary flow or edge case.
- P3 — cosmetic or documentation.

P0 and P1 require a reproduction.

## Outcome change B

When at least one candidate is actionable, create a spec-driven change named `fix-<area>-<date>` or
`harden-<area>-<date>`. Its first artifact is the findings table with the columns `ID | severity |
observed | expected / oracle | evidence | proposed class | confidence | action`, one
`findings/F-<n>.md` record per finding, and a decision log in `design.md` starting every finding as
`pending`. When no candidate is actionable, create no B and record why in A.

## User gate 2: finding classification

The user classifies every finding as one of: bug, feature, spec error, test gap, unknown. The agent
must not execute a fix task for a finding while its classification is pending, and must not apply
fixes before the user has classified the findings.

- bug — behavior contradicts a valid requirement, contract, or documented expectation; name the
  oracle.
- feature — intentional behavior the spec is silent about; document it, do not fix code.
- spec error — intentional behavior the spec states incorrectly; correct the spec.
- test gap — behavior is correct but untested; add an oracle-backed test.
- unknown — no oracle; ask, do not fix. This is the default when no oracle exists.

Record the class, severity, rationale, and any rejection in the decision log. The agent may
challenge with evidence; the user decides.

## Spec-less outcome change

When every accepted finding maps to an explicitly named existing scenario and no requirement
changes, B declares `skip_specs: true` and validates without a delta. It must never invent a
requirement or a delta to satisfy validation. When at least one accepted finding changes or adds a
requirement, B carries the corresponding delta instead. Implementation tasks follow the finalized
delta-or-spec-less decision, and B is then applied through the project's normal OpenSpec flow. The
whole-spec review runs on the plan either way, and the marker is part of the change digest: removing
or changing it invalidates a PASS.

## Evidence contract

- A confirmed bug gets a regression test that fails on the pre-fix code and passes after the fix.
  The red run is recorded in the finding or task evidence.
- A test gap gets an oracle-backed test plus a mutation check: deliberately break the behavior and
  confirm the test fails.
- Every accepted finding maps to a delta scenario or to an explicitly named existing scenario that
  already covers the contract. Silent fixes are not allowed.
- A dismissed finding leaves an oracle, a test, or a recorded rationale so the next cycle does not
  rediscover it.
- Tests live at the smallest public seam that reproduces the issue, and test names reference the
  finding ID. Line coverage and test counts are not goals; the register counts risk nodes with
  oracle-backed tests.

## Close and the next input

At cycle close, update `brief.md` and `state.md`, and write a durable Hindsight digest when Hindsight
is available: declarative statements about invariants, component behavior, oracles, traps, and
confirmed or refuted risks. Session transcripts are retained automatically; the digest is the compact
artifact the next scan reads. When Hindsight is unavailable, skip the digest and note it. A standalone
report must not be the only output of a cycle.

The next cycle reads the latest A's `state.md`/`brief.md`, B's decision log and delta or named
scenarios, and the digest before scoring candidates.

## Portability and safety

Discover the project's stack, commands, test tooling, environments, oracles, and review policy from
its own files. Never assume dsh-setup paths. Do not run destructive actions against production data
or a live Harness profile: use a throwaway `DSH_HOME` or the project's documented test environment,
and stop and ask when a safe environment cannot be established. In projects without a task-review
engine, both user gates remain user decisions and the project's own policy governs implementation.
