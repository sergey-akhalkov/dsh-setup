# Templates

Copy-ready sections for the refactoring method. Replace every `<placeholder>`; delete a section only
when its phase does not apply. The method body is in `SKILL.md` in this package.

## A: proposal.md

```markdown
# Proposal

## Why

Why this audit now: `<the hotspot, risk, or cost that triggered it, and the hard override if any>`.

## What Changes

- Audit only: this change records the state, the ROI register, and the selected path; it changes no
  product behavior and carries no delta spec (`skip_specs: true`).
- Expected decision: `<one path approved for a refactor change, or no path is justified>`.

## Scope

- In scope: `<areas, modules, or contracts examined>`
- Out of scope: `<what this audit does not examine and does not refactor>`

## Non-goals

- No production edit and no refactor in this change.
- `<anything else this audit must not do>`
```

## A: design.md

```markdown
# Design

## Audit method

`<the evidence sources used and how each factor was derived>`

## ROI register

| Path | H | C | D | A | M | B | E | R | F | ROI | Evidence |
| --- | - | - | - | - | - | - | - | - | - | --- | -------- |
| `<path>` | `<0-3>` | `<0-3>` | `<0-3>` | `<0-3>` | `<0-3>` | `<0-3>` | `<0-3>` | `<0-3>` | `<0-3>` | `<value> / <cost> = <ROI>` | `<links to findings/P-*.md and raw evidence>` |

Formula: `value = (H + 1) * (C + D + A + M) * (B + 1)`; `cost = (E + 1) * (R + F + 1)`;
`ROI = value / cost`.

## Hard overrides

`<active P0/P1, security or data risk, or critical contract contradiction, with evidence; "none" when absent>`

## Selection

- Selected path: `<path>` — path class: `<stabilize | deduplicate | boundary | seam | simplify | migrate>`
- Score: `<ROI>`; overridden by: `<hard override, or "none">`
- Rejected candidates: `<path — why it lost; path — why>`
- Previous cycle area: `<area; excluded or hard-override exempt>`
- WIP state: `<active audit and refactor changes, or "none">`

## Target and risk

- Target: `<the structure or rule the refactor should reach>`
- Risk: `<what makes this path risky, and the blast radius>`
- Safety-net plan: `<which oracles, mutation, and baseline this path needs>`

## Approval decision

- Decision: `<approved | replaced | pending>`
- By: `<user>`
- Rationale or overridden score: `<text>`
- Confirmed behavior: no production code is edited before this decision.

## Risks and open questions

- `<rank/evidence/feasibility caveat>`
```

## A: tasks.md

```markdown
# Tasks

## 1. Scan and register (planning only; owns no source path)

- [ ] 1.1 Write `brief.md` and `audit.md`: stack, commands, environments, contracts, churn, coupling,
      defects, and the baseline metrics.
- [ ] 1.2 Write one `findings/P-*.md` record per candidate path with the nine factor values and the
      evidence, then the ROI register in `design.md`.
- [ ] 1.3 Record the selection, the hard overrides, the rejected candidates, and the anti-repetition
      decision.

## 2. Decision and close (planning only)

- [ ] 2.1 Present user gate 1 and record the approval decision in `design.md`.
- [ ] 2.2 Create the `refactor-*` change for the approved path, or record why no path is justified.
- [ ] 2.3 Close this audit change with the decision recorded.
```

## A: path finding record (`findings/P-<n>.md`)

```markdown
# P-<n>: `<short title>`

- Path class: `<stabilize | deduplicate | boundary | seam | simplify | migrate>`
- Status: `<candidate | selected | rejected>`
- Evidence: `<commands, git ranges, links to audit.md, defect references>`

## Factors

| Factor | Value | Evidence |
| --- | --- | --- |
| H hotspot | `<0-3>` | `<churn and complexity evidence>` |
| C coupling, duplication, cycles | `<0-3>` | `<duplicate sites, cycle, change amplification>` |
| D defect and incident history | `<0-3>` | `<fix/revert commits, incidents, issue links>` |
| A architecture drag | `<0-3>` | `<boundary violations, god module, layer breach>` |
| M maintenance drag | `<0-3>` | `<dead code, size, build cost>` |
| B blast radius and criticality | `<0-3>` | `<data, security, availability, money>` |
| E effort | `<0-3>` | `<scope and expected hours>` |
| R verification risk | `<0-3>` | `<oracles present or missing, flakiness>` |
| F feasibility | `<0-3>` | `<reproducible environment, rollback>` |

- Score: `value = <value>`, `cost = <cost>`, `ROI = <roi>`

## Target

`<the structure or rule this path should reach>`

## Safety-net cost

`<which of the four proofs this path needs and why>`

## Risk

`<what can go wrong, and the mitigation>`

## Decision

`<selected / rejected and why; "pending" until user gate 1>`
```

## A: audit.md

```markdown
# Audit: `<area>`

Raw evidence appendix. Decision-relevant facts are summarized in `design.md`; this file holds the
measurements behind them.

## Architecture map

`<modules, layers, dependencies, entry points>`

## Churn and change coupling

`<git ranges and the commands used; per-file churn; files that change together>`

## Defect and incident history

`<fix/revert/hotfix commits, incidents, issue links>`

## Baseline metrics

| Metric | Value | Command or source |
| --- | --- | --- |
| `<files per representative change>` | `<n>` | `<command>` |
| `<cycles or boundary violations>` | `<n>` | `<command>` |
| `<duplicated tokens>` | `<n>` | `<command>` |
| `<build duration>` | `<n>` | `<command>` |
| `<test duration>` | `<n>` | `<command>` |

## Commands

- Test: `<command>`
- Lint and typecheck: `<command>`
- Duplication, dependency, or mutation check: `<command or "absent">`
```

## A: brief.md

```markdown
# Project brief

## Stack

`<languages, frameworks, runtime versions>`

## Commands

- Build: `<command>`
- Run: `<command>`
- Test: `<command>`
- Lint and typecheck: `<command>`

## Environments

`<local, CI, disposable environments, how to reproduce>`

## Contracts and criticality

| Contract or area | Criticality | Oracle |
| --- | --- | --- |
| `<API, CLI, config, data, database>` | `<high/medium/low>` | `<test, spec, or none>` |

## Oracle sources

`<specs, contracts, docs, prior behavior a refactor must preserve>`

## Review policy

`<the project's review and approval rules; gates this method must honor>`

## Tracker

`<issue tracker and how a discovered defect is filed>`
```

## B: proposal.md

```markdown
# Proposal

## Why

The audit `<audit-* change>` selected `<path>` at ROI `<value>`; this change executes that path and
changes no product behavior.

## What Changes

- Selected path: `<path>` — path class: `<class>` — scope: `<modules and seams>`
- Target structure: `<what the code looks like after>`
- Behavior preservation: no product behavior changes; the oracles that prove it are
  `<test names or suites>`.
- Safety net: `<the four proofs and where they are recorded>`
- Ratchet: `<the automated guard this change adds>`

## Non-goals

- No feature, bug fix, or contract change; a discovered behavior change is a separate change.
- `<out-of-scope areas named by the audit>`

## Result expected

`<the measured metric before and after, and the guard that keeps it>`
```

## B: design.md

```markdown
# Design

## Current structure

`<modules, seams, dependencies as they are today; link audit.md>`

## Target structure

`<the structure after the refactor>`

## Mikado graph

| Step | Preparatory | Depends on | Reverse edge |
| --- | --- | --- | --- |
| `<step>` | `<yes/no>` | `<step ids>` | `<how to undo>` |

## Step plan

- `<step 1 — one behavior-preserving transformation>`
- `<step 2 — ...>`

## Safety net

| Proof | Command or test | Environment | Result |
| --- | --- | --- | --- |
| Green baseline | `<command>` | `<commit, runner, environment>` | `<pass/fail, duration, known flakes>` |
| Behavior oracles | `<public seams and test names>` | `<...>` | `<pass on current code>` |
| Mutation proof | `<the deliberate break>` | `<...>` | `<oracle fails: yes/no>` |
| Performance or data baseline | `<p50/p95, throughput, memory, invariants>` | `<budget>` | `<measured>` |

Weak net: `<"none" when all four proved; otherwise the missing proof and the stop>`

## Safety-net approval

- Decision: `<approved | refused | pending>`
- By: `<user>`
- Recorded gap: `<the missing proof when refused>`

## Migration and rollback

`<Strangler Fig, Branch by Abstraction, Parallel Change, or "not a migration">`
Rollback: `<how to revert safely, verified or documented>`

## Verification contract

- Oracles: `<test names that must pass>`
- Public contract diff: `<the API/CLI/config/data/DB surface checked, expected empty>`
- Performance budget: `<metric and limit>`
- Full suite: `<command>`

## Before and after metrics

| Metric | Before | After | Budget |
| --- | --- | --- | --- |
| `<target metric>` | `<n>` | `<n>` | `<improve>` |
| `<guardrail metric>` | `<n>` | `<n>` | `<no regression beyond n>` |

## Ratchet

- Rule: `<dependency rule, API snapshot, duplication threshold, complexity threshold, architecture test, or characterization test>`
- Where: `<file, lint config, CI step, or test suite>`
- Baseline: `<pre-existing violations frozen, or "none">`
- New violation: `<fails how>`

## Decision log

| Date | Decision | Reason |
| --- | --- | --- |
| `<date>` | `<decision>` | `<why>` |
```

## B: tasks.md

```markdown
# Tasks

## 1. Safety net (owns `test/**`; no production path)

- [ ] 1.1 Record the green baseline: command, commit, environment, duration, and known flakes.
- [ ] 1.2 Add or confirm the behavior oracles at every public seam this change moves.
- [ ] 1.3 Record the mutation proof: break the behavior, observe the oracle fail, restore it.
- [ ] 1.4 Record the performance or data baseline and its budget, or record why it does not apply.

## 2. Gate 2 and the steps (owns `src/**`)

- [ ] 2.1 Record user gate 2 approval in `design.md`; no production edit precedes it.
- [ ] 2.2 Step 1: `<behavior-preserving transformation>`, then narrow suite, full suite, commit.
- [ ] 2.3 Step 2: `<the same records>`, or record why the path needs no further step.

## 3. Deduplication and deletion (owns the touched modules)

- [ ] 3.1 Collapse only behavior proven identical and verify every caller.
- [ ] 3.2 Delete proven-dead code or a proven-dead test only with its unreachability proof.

## 4. Ratchet and verification (owns the project's lint/test/CI configuration)

- [ ] 4.1 Land the ratchet in the project's existing check, with the baseline when violations exist.
- [ ] 4.2 Run the verification contract: oracles, empty contract diff, budget, full suite, metrics.
- [ ] 4.3 Record the rollback, the oracle rewrites, and the discovered defects as separate changes.

## 5. Close (planning only)

- [ ] 5.1 Record the close record, update the brief and state snapshot, and write the digest.
```

## B: safety-net record

```markdown
# Safety net: `<path>`

## Green baseline

- Command: `<command>`
- Commit: `<sha>`
- Environment: `<OS, runtime versions, data fixture>`
- Duration: `<n>`
- Known flakes: `<known flaky tests and how they were handled>`
- Result: `pass | fail`

## Behavior oracles

| Seam | Oracle | Proves |
| --- | --- | --- |
| `<public seam a step moves>` | `<test name>` | `<the behavior that must not change>` |

## Mutation proof

| Mutation | Oracle | Observed |
| --- | --- | --- |
| `<deliberate break>` | `<oracle>` | `<fails as expected: yes/no>` |

## Performance or data baseline

- Metric: `<p50/p95, throughput, memory, or data invariant>`
- Measured: `<value>`
- Budget for this change: `<value>`
- Method: `<how the measurement is taken>`

## Gate 2 decision

- Decision: `<approved | refused | pending>`
- By: `<user>`
- Missing proof when refused: `<proof>`
- No production edit before approval: `<confirmed>`
```

## B: step record

```markdown
## Step `<n>`: `<transformation>`

- Seam moved: `<public seam>`
- Transformation: `<one behavior-preserving change>`
- Narrow suite: `<command and result>`
- Full suite: `<command and result>`
- Commit: `<sha>`
- Mikado: `<preparatory: yes/no; depends on: step ids; reverse edge: how to undo>`
- Test removal: `<"none" | the proof of unreachability>`
- Behavior change discovered: `<"none" | the separate change it belongs to>`
```

## B: verification and ratchet record

```markdown
## Verification

- Oracles pass: `<command and result>`
- Public contract diff empty: `<surface checked and result>`
- Performance within budget: `<measured vs budget>`
- Full suite green: `<command and result>`
- Target metric improved: `<before -> after>`
- Guardrail metrics: `<before -> after, budget>`
- Rollback verified or documented: `<how>`
- Oracle rewrites justified: `<which oracle and why>`

## Ratchet landed

- Rule: `<rule>`
- Location: `<file, lint config, CI step, or test>`
- Baseline frozen: `<pre-existing violations, or "none">`
- New violation fails: `<demonstrated how>`
```

## Close record

```markdown
# Close

## Decision

- Outcome: `<refactored | no path justified | stopped>`
- Refactor change: `<refactor-* change, or "none" and why>`
- Path and class: `<path> — <class>`

## Metrics

| Metric | Before | After |
| --- | --- | --- |
| `<target metric>` | `<n>` | `<n>` |

## Knowledge capture

- `brief.md` updated: `<what changed>`
- State snapshot updated: `<where the next audit reads it>`
- Hindsight digest: `<the declarative statements written, or "unavailable">`
- Discovered defects: `<ids and their separate changes, or "none">`

## Next input

- `<what the next audit should weigh: residual duplication, open risks, the next hotspot>`
- `<follow-ups that are not refactors>`
```
