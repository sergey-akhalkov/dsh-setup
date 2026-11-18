# Design

## Context

See `proposal.md` for motivation. This repository already ships opt-in methods as on-demand skills
inside tiny plugin bundles (`plugin-rust` is the minimal Host-only shape), and uses OpenSpec changes
as the working artifact for every behavior change. Hindsight gives each repository a memory bank, but
it is machine-local configuration, not something a plugin can ship.

The process must therefore ride existing primitives: a packaged skill for the method, OpenSpec for
the artifacts, the project's own test and git tooling for evidence, and Hindsight when present for
durable knowledge. It must not add a new runtime service, UI, or storage layer.

Constraints:

- Artifacts are written in English; `openspec/config.yaml` requires it.
- No always-on prompt: the method is opt-in and loaded on demand.
- No runtime dependencies and no Client half.
- The setup generator vendors every package's declared files automatically, so a new package needs
  no manual setup edits beyond generation.
- The live desktop profile is owner-installed; acceptance uses a throwaway profile or `pnpm dogfood`.

## Goals / Non-Goals

**Goals:**

- Make the next exploratory area a product of current evidence, not habit.
- Make every cycle produce reviewable OpenSpec artifacts and, when actionable, a concrete outcome
  change with tests and spec corrections.
- Keep exploration free-form inside a phase while making the phase contract, decisions, and evidence
  durable.
- Leave the project better oriented for the next cycle through a brief, a state snapshot, and a
  Hindsight digest.

**Non-Goals:**

- A dashboard, metrics service, scheduler, or new OpenSpec schema.
- Automatically fixing findings before the user classifies them.
- Replacing the regression suite, CI, or the project's code review policy.
- A generic state-scanner script that understands every stack.

## Decisions

### D1. One skill in one small plugin

The method is delivered as skill `exploratory-testing` in
`packages/plugin-exploratory-testing`, a Host-only bundle shaped like `plugin-rust`:

```text
packages/plugin-exploratory-testing/
├─ package.json                 # engines.dsh, dsh.bundle, files incl. assets
├─ cordis.fragment.yml          # row dsh-setup-exploratory-testing
├─ src/host/index.ts            # registers the skill provider only
├─ test/skill-provider.test.ts  # catalog entry + body load
├─ assets/exploratory-testing/
│  ├─ SKILL.md                  # the method
│  └─ templates.md              # A/B/finding/session templates
├─ locale/en.json
├─ icon.svg
└─ tsconfig.json
```

No `dsh.client`, no config schema, no tool, no always-on system-prompt section. The skill is
`modelInvocable` and `userInvocable`, rank 600 like the other bundled skills. A project-local skill
of the same name keeps precedence, so a repository can specialize the method without uninstalling
the bundle.

Alternatives considered: a project-local skill only (does not travel, drifts), a workflow engine
definition (turns exploration into a checkbox gate), a new tool/dashboard (state is already
OpenSpec + markdown), a custom OpenSpec schema (not portable and not needed; extra files inside a
normal change are enough).

### D2. Two changes per cycle: cycle change A and outcome change B

**A — `explore-<area>-<date>`** is the driver and the record:

- `.openspec.yaml` sets `skip_specs: true`: the cycle plans and records, it changes no product
  behavior. This avoids inventing requirements before evidence exists.
- `proposal.md`: why this area now, the state snapshot, scope, expected outcome.
- `design.md`: focus register, focus mode, charters, oracles, heuristics, environment, safety,
  severity rubric, classification protocol.
- `state.md`: the full focus register with evidence and the next-cycle input.
- `brief.md`: project brief (commands, environments, test map, criticality, review policy); created
  on the first cycle, refreshed when the project changes.
- `findings/F-*.md`: candidate findings with executed evidence; raw session notes stay in
  `.dsh/qa/sessions/` so a change does not become a diary.
- `tasks.md`: phase-level tasks (state, focus approval, sessions, triage, outcome, close).

**B — `fix-<area>-<date>` or `harden-<area>-<date>`** is the reviewable product change:

- `proposal.md`: findings summary and the classification decision requested from the user.
- `design.md`: per-finding record (observed, expected/oracle, evidence, severity, confidence, blast
  radius, proposed class, action options) and the decision log.
- `findings/F-*.md`: detailed finding records, one per candidate.
- `specs/<capability>/spec.md`: delta added only when an accepted finding changes a requirement;
  when every accepted finding maps to an existing scenario, `.openspec.yaml` sets `skip_specs: true`
  instead.
- `tasks.md`: a review task first, then per-finding `red test -> fix/spec -> green` tasks.

Why two: A has no honest spec delta before findings exist; B has one only after a finding actually
changes a requirement. Both changes can be spec-less, and D11 makes that path first-class under the
shipped workflow gates. Splitting keeps `openspec validate` truthful in both and makes the user's
review surface unambiguous. The cost is one extra thin change per cycle; A closes as soon as B
exists. A single-change variant was rejected because it would flip `skip_specs` mid-life and mix
exploration noise with the product delta.

### D3. State register, score, and selection

The scan evaluates candidate areas (OpenSpec capabilities, or product surfaces where no spec exists)
with eight factors. Anchors are 0–3; intermediate values are judgment calls recorded with evidence.

| Factor | Meaning | 0 | 3 |
| --- | --- | --- | --- |
| B | blast radius / criticality | secondary surface | data, security, availability, installer |
| K | knowledge gap | verified by a recent cycle | no brief, never explored |
| T | test gap | risk nodes have oracle-backed tests | no tests |
| C | churn | no changes since last cycle | rewrite or hotfix |
| D | defect history | none | open P0/P1 or incident |
| A | ambiguity | unambiguous oracle | contradiction or no oracle |
| S | staleness | previous cycle | never explored |
| F | feasibility cost | local, cheap, safe | credentials, special environment, unsafe |

Ranking aid, not a truth:

```text
score = B * (K + T + C + D + A + S) - F
```

Evidence sources:

- K: Hindsight pages, project brief, prior cycle snapshots.
- T: test inventory mapped to areas, coverage report if the project has one, mutation checks on the
  chosen area.
- C: `git log` since the last cycle or release.
- D: state snapshot, Hindsight, `git log` for fix/revert commits, the issue tracker if present.
- A: specs with gaps or contradictions, unresolved questions, missing oracles.
- S: last cycle and outcome changes.
- F: environment availability, credentials, safety, expected effort.
- B: criticality table in the project brief.

Hard overrides: open P0/P1 or incident; security or data risk; critical spec contradiction. Every
hard-override category is exempt from repeat exclusion and outranks the score.

Anti-repetition: the previous cycle's focus is excluded unless it matches a hard override. If every
candidate repeats and none is a hard override, the next cycle must change the focus mode and heuristic
family. Focus modes: `knowledge`, `coverage`, `defect`, `spec`. Heuristic families: state/data,
failure/recovery, integration/contract, security/permissions, time/locale, upgrade/migration,
scale/performance.

The selected register is presented to the user for approval (D5). The register and the rejected
candidates are recorded, so the choice is auditable and the user can override it.

WIP limit: one active A and one unclassified B. A new cycle starts after B's decisions are recorded
or B is explicitly deferred.

### D4. Cycle change A lifecycle

1. Scan state, build the register, select a primary focus and optional secondary.
2. Create A with `openspec new change`, set `skip_specs: true` in `.openspec.yaml`, write
   proposal/design/tasks/state/brief.
3. Ask the user to approve or replace the focus. Record the decision in `design.md`.
4. Run one or two timeboxed sessions. Each session has a charter (mission, risk hypothesis, areas,
   oracles, heuristics, timebox, out-of-scope, exit criteria) and records evidence immediately.
5. Triage: dedupe, reproduce minimally, assign proposed severity/class, and create B when at least
   one candidate is actionable.
6. Write the Hindsight digest, update the state snapshot, close A.

A task is checked only when its phase artifact exists: register, approved charters, session
evidence, triage table, B link. Raw notes and screenshots stay in `.dsh/qa/` and are linked.

In this repository, checked tasks follow the task-review gate. Grouping the cycle into a few
phase-level sections (plan, explore/triage, outcome/close) keeps the section-review rule useful; the
skill follows the host project's policy rather than assuming dsh-setup's.

### D5. Outcome change B and the decision gate

B is created after triage, before any fix. Its first artifact is a findings table:

```text
ID | severity | observed | expected / oracle | evidence | proposed class | confidence | action
```

Each finding also has `findings/F-<n>.md` with the full record. The decision log in `design.md`
starts with every finding `pending`.

The user classifies each finding:

- **bug** — behavior contradicts a valid requirement, contract, or documented expectation.
- **feature** — intentional behavior the spec is silent about; document it, do not fix code.
- **spec error** — intentional behavior the spec states incorrectly; correct the spec.
- **test gap** — behavior correct, but untested.
- **unknown** — no oracle; ask, do not fix. This is the default when no oracle exists.

The method must not execute a fix task until that finding's decision is recorded. After decisions,
B's spec delta is written only for findings that change a requirement; when every accepted finding
maps to an existing scenario, B declares `skip_specs: true` instead. Implementation tasks follow the
finalized delta-or-spec-less decision, then B is applied through the normal OpenSpec flow. If no
candidate is actionable, B is not created and A records why.

### D6. Classification and evidence protocol

A finding is a candidate, not a verdict. The record must contain observed behavior, the exact
build/commit and environment, a minimal reproduction, and an oracle link or an explicit statement
that no oracle exists. A suspicion from reading code without execution is marked as a hypothesis
and cannot be classified as a bug.

The user can reject or reclassify any finding; the decision log records the rationale. The agent may
challenge with evidence, but the user decides.

Severity rubric:

- **P0** — data loss/corruption, security or privacy breach, unavailability or core-path crash with
  no workaround; release blocker.
- **P1** — core flow broken or wrong result with no reasonable workaround; silent wrong data;
  supported environment.
- **P2** — workaround exists; secondary flow or edge case.
- **P3** — cosmetic or documentation.

Severity and confidence are separate. P0/P1 require a reproduction.

### D7. Test and spec outcome contract

- A confirmed bug gets a regression test that fails on the pre-fix code and passes after the fix.
  The red run is recorded in the finding or task evidence.
- A test gap or a risk without a known defect gets an oracle-backed test plus a mutation check:
  deliberately break the behavior, the test must fail.
- Every accepted finding maps to either a delta scenario/requirement or an explicitly named existing
  scenario that already covers the contract. Silent fixes are not allowed.
- B is spec-less when every accepted finding maps to an existing scenario and no requirement changes;
  it carries a delta when at least one finding changes or adds a requirement. A fake requirement is
  never added to make B validate.
- A dismissed finding leaves an oracle, a test, or a recorded rationale; otherwise the next cycle
  rediscovers it.
- Tests live at the smallest public seam that reproduces the issue, so refactors do not delete the
  proof. Test names reference the finding ID.
- Line coverage and test count are not goals. The state register counts risk nodes with
  oracle-backed tests.

### D8. Knowledge and state continuity

- `brief.md` in A: stack, build/run/test commands, environments, data setup, safety boundaries,
  criticality table, oracle sources, review policy, tracker.
- `state.md` in A: the focus register with evidence, last explored, coverage state, open findings,
  used modes and heuristic families.
- Hindsight digest at close: declarative statements about invariants, component behavior, oracles,
  traps, and confirmed or refuted risks. Session transcripts are retained automatically; the digest
  is the compact, reliable retrieval artifact.
- The next scan reads the latest A's `state.md`/`brief.md`, B's decision log and deltas, and the
  Hindsight digest. No separate ledger file.

When Hindsight is unavailable, the brief and state snapshot still make the cycle self-contained; the
digest step is skipped with a note.

### D9. Skill content and templates

`SKILL.md` carries the method, not a script:

- preconditions and when not to use the method;
- state scan and evidence sources;
- factor anchors, formula, overrides, anti-repetition, modes;
- A and B artifact contracts and the two gates;
- session charters and evidence standard;
- triage, classification, severity;
- test/spec proof rules;
- knowledge/state capture;
- portability and safety.

`templates.md` carries copy-ready sections for A's proposal/design/tasks/state/brief, B's
proposal/design/finding record/decision log, and the session record. The skill references templates
by section; nothing is generated by code.

### D10. Portability and prerequisites

- The skill discovers the stack from project files and existing instructions; it never hardcodes
  dsh-setup paths.
- OpenSpec is the default artifact system. If the CLI is absent, the skill reports the prerequisite
  and does not fabricate changes; it may propose `openspec init --tools none` only with the user's
  approval.
- Hindsight is optional; git, the test runner, and the specs are the required evidence sources.
- Safety: no production data, no destructive operations on the live Harness profile. For this
  repository, use a throwaway `DSH_HOME` and `pnpm dogfood`; the desktop profile is owner-installed.
- In projects without the task-review engine, the two gates remain user decisions; the project's own
  review policy governs implementation.

### D11. Spec-less changes are supported end to end

OpenSpec 1.15.0 accepts `skip_specs: true` in a change's `.openspec.yaml`, but the shipped workflow
gates predate it: the change-intake spec step requires a `specs/**/spec.md` file, and adoption and
the user-click archive verifier require a spec file. Without this platform change, cycle A and a
spec-less outcome B cannot finish intake or be adopted/archived, regardless of the method.

The change extends four contracts:

- `change-intake` spec step: accept either a spec file or `skip_specs: true`; still run
  `openspec validate --strict`; still run the whole-spec review on proposal/design/tasks and, when
  present, the finding records. The review is a plan review for a spec-less change, not a skipped
  gate.
- Whole-spec review scope: include every `findings/**/*.md` when present and assess the recorded
  evidence and proposed classification, so a spec-less outcome with findings is not approved on the
  proposal and design alone.
- Adoption: verify proposal/design/tasks plus the marker when spec-less; still require the current
  whole-spec PASS record.
- User-click archive: the same artifact rule; still require the current whole-spec PASS.
- Digest and eligibility freshness: the change artifact digest includes the effective `skip_specs`
  declaration; archive authorization and adoption recheck that the change still has a spec file or
  `skip_specs: true` after the record check. Changing or removing the marker after a PASS makes the
  record stale and refuses archive or adoption, including while an adoption confirmation is open.

The archive gate still needs a completed intake or receipt and a current whole-spec PASS, but its
evidence set now binds the marker: removing `skip_specs` without adding a spec invalidates the PASS.
No step is skipped, and no fake spec delta is created. Tests cover the spec-less path through intake,
adoption, click authorization, a whole-spec review on a three-artifact plan, and marker removal after
PASS.

Alternatives considered: skip the whole-spec review for spec-less changes (rejected: the plan still
needs independent review); require a placeholder spec (rejected: dishonest and would need a fake
requirement); keep A outside the workflow gates (rejected: then A cannot be adopted or archived, and
the process would depend on bypassing its own gates).

### D12. Review loop and input stability

A whole-spec review is bound to the change digest it prepared. A frozen whole-scope review preserves
its verdict despite concurrent code writes; only a change to the plan artifacts (`proposal.md`,
`design.md`, delta specs, `tasks.md`) makes the record stale and requires another round. Code-only
worktree edits do not invalidate a spec review. An ERROR `reviewed-inputs-changed` means the plan was
not judged: the record stays, and a new plan digest triggers a fresh review. The live fallback is
tested against its actual reviewed scope, which is the plan, not the whole worktree. The installed
0.43.0 engine provides the frozen whole-scope snapshot; the acceptance verifies it against this plan.
The method never deletes or hand-edits a review record.

## Risks / Trade-offs

- **Two changes per cycle add overhead** → A is thin and closes as soon as B exists; B is the only
  product change. If the overhead proves real, collapse them later, but do not lose the honest
  `skip_specs` boundary now.
- **The score is a judgment aid, not an objective truth** → anchors, evidence links, hard overrides,
  anti-repetition, and the user's focus approval keep it honest. The register records rejected
  candidates.
- **The agent may over-report "bugs"** → no oracle means unknown, not bug; user classification is a
  hard gate; the decision log records the rationale.
- **The agent may write tests that cannot fail** → red proof for bugs and mutation proof for test
  gaps; tests target public seams.
- **A's checked tasks hit this repository's task-review gate** → phase-level sections keep the
  section-review unit cheap; the skill follows the host project's policy and does not hardcode it.
- **The skill body becomes too long** → keep templates in `templates.md`, load on demand, and keep
  the method to the decisions and gates rather than a scripted test plan.
- **OpenSpec CLI unavailable** → the method stops at the prerequisite instead of inventing artifacts.
- **A cycle finds nothing** → no B is created; the negative result, coverage, and knowledge digest
  are still recorded. The method must not manufacture a change to look productive.
- **A P0 is found mid-session** → stop the session, report immediately, and create B (or an urgent
  fix) only after the user classifies it; do not wait for the full debrief.
- **Desktop profile install is owner-owned** → the method's acceptance uses a throwaway profile; the
  owner installs the setup release.
- **Spec-less support touches two existing plugins** → the intake asset, adoption, and click
  authorization get targeted tests; the existing spec-bearing paths are unchanged. If the platform
  change proves too large, split it into a prerequisite change, but do not let cycle A float outside
  the gates.

## Migration Plan

No migration: this is a new, opt-in plugin. After release and installation, the skill appears in the
catalog; no existing row or configuration changes. Spec-bearing changes keep their current path;
changes with `skip_specs: true` become adoptable and archivable under the existing whole-spec PASS
requirement. Rollback is disabling the row or uninstalling the bundle; the method's artifacts remain
ordinary OpenSpec changes.

## Open Questions

None blocking. The first real cycle will show whether A needs a smaller task set or the section
review needs a dedicated policy; that is a process tuning decision, not a change to the approach.
