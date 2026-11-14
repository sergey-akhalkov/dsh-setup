# Delegation rules

`@dsh-setup/plugin-delegation-rules` is a model-agnostic delegation engine. Rules, targets,
instructions, result contracts, and gate policies are configuration; the Host code only
evaluates triggers, runs a registered DSH subagent provider, parses the declared result, and
writes digest-bound records. Codex is one possible target, not a dependency: the engine module
contains no provider name at all.

The plugin adds three tools (`delegate`, `task_progress`, `delegation_status`), one on-demand
`delegation-rules` skill, and an `agent/turn-stopping` gate. It registers no always-on
system-prompt section.

## Row opt-out and removal

Disabling or removing the `dsh-setup-delegation-rules` row removes the tools, the gate, and the
skill, and stops all enforcement. Delegation records (`.dsh/delegation/`), session involvement
files, progress notes, and change artifacts remain on disk. There is no in-session
bypass: the only opt-out is disabling the row. Records are a process-integrity check, not
anti-forgery — a model with full filesystem access could write a record-shaped file.

## The rule model

A rule is data:

```yaml
rules:
  - id: spec-review
    when: spec-ready
    to: codex
    contract: review
    phase: spec
    scope: whole
    gate: strict
    instruction: "bundled:review-spec"
```

- `id` — unique kebab-case; the record directory and the `delegate` tool's enum value.
- `when` — one of the seven trigger primitives below.
- `to` — a configured target id (absent only for the `note` contract).
- `instruction` — `bundled:<asset>` for a shipped prompt, or inline text.
- `contract` — `review` or `note`.
- `gate` — `strict`, `soft`, or `none`.
- `phase` — record key for a whole-scope review (required for `scope: whole`).
- `scope` — `whole` or `task` for the review contract.

Validation rejects an unknown trigger, contract, gate, field, or target; a missing instruction;
a non-kebab id; a duplicate id; a whole review without a phase; a task review with a phase; a
note rule with a target or on any trigger other than `implementation-work`, `lane-assignment`, or
`lane-boundary`; a manual rule that is not `gate: none`; and two strict rules for the same
trigger/scope/phase. A profile that still declares a removed contract, trigger, or target field
fails validation with the replacement named. Errors name the rule/target and the next action. A
missing **provider** is deliberately not a validation error: the profile still composes, and the
tools and `delegation_status` report the missing target.

Adding a rule on an existing trigger and contract is configuration only. A new trigger source or
result contract is a code extension.

### Triggers

- `manual` — no automatic condition; only `delegate` runs the rule.
- `spec-ready` — a change this session created or whose spec artifacts it changed is review-ready
  and the whole-spec review has no matching `PASS`/`ERROR` record for the current spec digest.
- `spec-task-ready` — a task this session checked has no task-review record.
- `implementation-work` — this session's turn changed implementation files in an involved change
  and has neither a newly checked-and-reviewed task nor a `task_progress` note matching the
  current worktree digest.
- `lane-assignment` — an involved change has a readable `tasks.md` with at least two non-serial
  lanes with tasks (a completed lane still counts toward the threshold), the turn ticked a task or
  changed implementation files, and an unassigned non-serial lane with unchecked tasks that is not
  current names owned paths and has neither a tagged worker start nor a serial note; satisfied per
  lane by a `lane-tag` worker start or a matching `task_progress` note.
- `lane-boundary` (deprecated) — a task this session ticked in this turn completed the last
  unchecked task of a `tasks.md` lane, another non-tail lane still has an unchecked task, and the
  turn started no parallel worker; satisfied by a worker start or by a progress note in a remaining
  lane. Accepted for existing profiles; new rules use `lane-assignment`.
- `implementation-complete` — this session completed the change's task list and the optional
  integration review has no matching `PASS`/`ERROR` record for the current worktree digest.

The trigger vocabulary is fixed. `manual` rules must use `gate: none`; `lane-boundary` is
deprecated and kept only for existing profiles. The shipped defaults configure the strict
`lane-fanout` rule on `lane-assignment`; the `implementation-work` and `lane-assignment` triggers
remain available to profile rules, and no shipped rule uses the deprecated `lane-boundary` trigger.

The change-scoped triggers evaluate only for changes attributed to the current session. A session
is involved in a change when it created or modified it in this workspace; observation, a
`delegation_status` poll, and another session's edits never attribute. `spec-ready` applies only
when the session created the change or changed its spec artifacts, `spec-task-ready` only to the
tasks the session checked, `implementation-work` only to an involved change, and
`implementation-complete` only when the session completed the task list. Another session's ticks
are not imported into a creator's scope. `task_progress` notes and explicit review runs remain
available in every session; an explicit `task_progress` or review `delegate` also attributes the
change.

### Session involvement

Attribution is per session, under `.dsh/delegation/sessions/`:

```json
{
  "session": "session-...",
  "changes": {
    "change-a": {
      "created": false,
      "specChanged": true,
      "tasks": ["<task-id>"],
      "completed": false
    }
  }
}
```

The file name is `sha256(session).slice(0, 16)` plus `.json`, so path characters and Windows
device names cannot collide and two sessions never write one file. The content keeps the raw
session id. Writes are atomic; a missing or malformed file reads as empty and is reported as a
warning by `delegation_status` without blocking the turn. The file lives at the OpenSpec workspace
root, so a nested working directory shares it, and it is local scratch: a fresh checkout or a new
machine starts with no involvement.

Attribution comes only from session-attributable write evidence captured from a successful
`tools/result`:

- a first-party `edit`/`write` with a resolved `file_path` under
  `openspec/changes/<change>/`; the canonical path from the tool result is used, and a `tasks.md`
  write uses that write's own canonical `before`/`after` contents, never an independent read;
- a successful shell call whose command creates the change (`openspec new change <name>`) or
  writes a file under the change directory; the change is attributed, but a shell `tasks.md`
  write cannot yield task ids or decide whether the edit was substantive;
- a nested `run_code` dispatch only when it surfaces its own `tools/result` with the calling
  agent.

A read, `grep`, `glob`, `delegation_status`, `openspec list/show/status/validate`, or any
unrecognized tool is not write evidence. A write through an unrecognized tool or an unparsed
shell form under-gates: the session can call `task_progress` or a review `delegate` to opt in.
There is deliberately no attribution from the workspace diff, file mtimes, or a change
directory timestamp, because those identify content but not the writer.

At turn-stopping, the pre-step baseline and the turn-end snapshot are compared only for changes
that have evidence; without a baseline, nothing is attributed. For an evidenced change:

- a new change plus creation evidence records `created` and `specChanged`, and never imports task
  ids from the snapshot;
- an existing change plus a write outside `tasks.md` records `specChanged`;
- a `tasks.md` write derives the checkbox transitions from its own `before`/`after` contents and
  records `specChanged` only when those contents differ beyond checkbox state, so a checkbox-only
  tick is not a spec change while a substantial task-plan edit or a newly supplied `tasks.md` is;
- `completed` is recorded only when the session's addition made the whole list checked.

### Contracts

**`review`** computes a digest, runs the target with the bundled P0/P1 prompt, accepts exactly
one fenced JSON verdict that echoes the digest, validates the severities, and writes an atomic
record under `.dsh/delegation/<rule>/<change>/`:

- whole scope: `<phase>.json`;
- task scope: `tasks/<taskId>.json`, with the task id derived from the normalized task text;
- section scope: `sections/<hash>.json` for the one section verdict, plus a `tasks/<taskId>.json`
  for every covered checked task.

A task-scope `PASS` additionally writes the committed [portable approval](#portable-task-approvals)
inside the change. A section-scope `PASS` writes one portable approval per covered checked task.

A `PASS` requires zero P0/P1 findings. `FINDINGS` and `ERROR` records are reported but do not
satisfy a strict gate. A matching `PASS` is reused without another run; a `FINDINGS` record is
reused only while the digest is unchanged; an `ERROR` is retried on the next run. Stale records
never authorize a handoff. A malformed verdict (prose only, several fenced blocks, an invalid
severity, or a digest mismatch) writes no `PASS`; it writes an `ERROR` record and reports the
failure, so the turn can close with the failure visible.

A review may run in any session. The explicit `delegate` call attributes the change to that
session; the record names the reviewing session alongside the other fields. Records stay
workspace-global and are keyed by rule/change/task, so a `PASS`/`ERROR` written by any session
satisfies the task or rule.

A review runs **asynchronously**: `delegate` validates the rule/target/change (and task), waits for
the target to start, and returns a run id, state, and record path while the verdict is produced in
the background. Use `delegation_status` (or the record path) for completion; the gate points a
pending review at its run instead of starting another. A `note` rule starts no target, so it has no
run and no record.

A review started on an **external** provider is also cataloged in the Session's subagent list as an
external child labelled `delegation:<rule>`; the service assigns the child name. The entry is a leaf
— not openable, no token or duration metrics, no follow-up input — and the verdict arrives as a
settlement notice that starts a new turn. The record, the gates, and the queue are unchanged.
In-process providers keep the service's existing local-child catalog behavior: their local children
are always cataloged and continuable where supported, and the engine's delivery choice only decides
whether the settlement notice is delivered.

A review run is bounded by the per-contract timeout: 20 minutes for `review`. A profile overrides it
through `timeouts`; a timed-out review writes an `ERROR` record and the error names the contract to
widen.

Several reviews can run at once. A duplicate request is identified by rule + change + task/phase plus
the prepared digest and the resolved reviewer: a second call while that identity is pending returns
the existing run handle, and a changed input or reviewer is a distinct run that waits behind the same
conversation key. Different rules on the same change/task queue over one conversation key and each
writes its own record. Task-scoped reviews
accept an explicit `task` (id or task text), so parallel task reviews for different tasks do not
collapse onto the engine's next-task choice. A task-scoped run reviews an immutable snapshot of the
worktree: a detached checkout under `.dsh/delegation/snapshots/<runId>` built from the exact review
input set and the frozen change directory, so a write after the run starts neither invalidates it
nor enters its evidence. A whole-scope run reviews live inputs; any reviewed-input change during the
run (a git-visible worktree file, a tracked file that disappears, or an included change artifact,
including edit-read-restore) discards the verdict and reports a retry instead of publishing a
`PASS`. A task review whose snapshot cannot be built falls back to the live inputs and the same
guard, and its run detail names the bounded cause (`live worktree: <reason>`); a missing `.dsh/`
ignore rule is named with the fix. The reviewed change's `reviews/` approval directory is engine
output and is never a reviewed input, so a portable task approval written by one review does not
invalidate another.

### Section-scoped task review

A task-review `delegate` call may pass `section` instead of `task`; they are mutually exclusive
and either one is rejected on a non-review or whole-scope rule before a target starts. The
selector is a `tasks.md` level-2 heading:

- its number — `section: "1"`;
- its wildcard form — `section: "1.x"` (equivalent to `"1"`);
- its normalized title, or `untitled` for tasks before the first heading.

An unknown, empty, ambiguous, or unchecked-only section is rejected with the available sections.
The `delegate` tool description and `delegation_status` also name the sections of the change the
engine last inspected, so a selector can be chosen before the first call.
The level-2 heading shape is the same one the lane guidance asks for:

```markdown
## 1. Section review engine (lane 1, owns `packages/plugin-delegation-rules/**`)

- [x] 1.1 Add the selector
```

One call starts one run over every checked task in that section: one prompt naming the section
title, each checked task, and the unchecked tasks as out of scope; one frozen worktree snapshot;
and one PASS/FINDINGS/ERROR verdict. The reviewer instruction asks every finding to name the
affected task, so the one verdict stays actionable per task. A section PASS publishes the existing
per-task `openspec/changes/<change>/reviews/<taskId>.json` approval for each covered checked task,
so `pnpm reviews:check` and the archive gate are unchanged: one PASS per checked task, and
unchecked tasks are never approved. A matching approval is kept byte-identical; the publication writes all
temporaries before any rename and restores every replaced destination byte-identically on failure,
so a failed publication approves nothing. Per-task and section publications share the
rule/change publication lock: the later completion discards when an authoritative PASS exists,
and a superseded section identity discards its whole publication.

The section identity is rule + change + section key + digest + reviewer; the digest covers the
section key and title, the sorted checked task ids and normalized texts, the frozen change-artifact
digest, and the snapshot content tree. An unchanged section reuses a FINDINGS record; a newly
checked task, an unchecked task, or a changed covered task text changes the digest and requires a
new section or task review. A section ERROR writes a local ERROR record for each covered task with the
failure class preserved and publishes no new approval; existing valid approvals remain, so the
archive gate reports only covered tasks without one. While a section run is queued or running, the
turn gate points at that run instead of starting duplicate per-task reviews.

Limits: a section review is only as precise as its prompt, so use it for related tasks and keep a
risky task on its own per-task review; sections are bounded by the author's `tasks.md` grouping.
The live profile only gets the mode after the owner installs the regenerated setup, because it
runs the installed engine, not this checkout.

### Review queue contract

`reviewQueue` bounds concurrent review targets per profile. Defaults:

| Option          | Default  | Meaning                                                                                                                                                         |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`       | `true`   | `false` removes the global admission limit, the acceptance deadline, and automatic retries; deduplication and same-key waiting stay.                            |
| `concurrency`   | `2`      | Live review targets per profile; a whole number from 1 to 4, below the DSH active-child limit.                                                                  |
| `maxQueued`     | `16`     | Unique waiting runs allowed before admission is refused with `review queue full` and an `ERROR` record. A same-key follower behind an active review counts too. |
| `maxAttempts`   | `3`      | Original attempt plus retries for transient failures.                                                                                                           |
| `baseDelayMs`   | `5000`   | Base delay of the exponential backoff with full jitter.                                                                                                         |
| `maxDelayMs`    | `60000`  | Backoff cap; a provider `retry-after` is honored up to this cap.                                                                                                |
| `waitTimeoutMs` | `300000` | Acceptance deadline for a queued run; expiry writes a `queue-timeout` `ERROR` without starting a target.                                                        |

Admission is a bounded queue: an admitted run starts immediately and a same-key (one conversation)
run waits behind its predecessor. The queue selects the first eligible run in submission order (FIFO
among eligible runs), while runs under different conversation keys complete independently. A
duplicate request (same rule + change + task/phase + prepared digest + resolved reviewer) returns the
existing run handle instead of starting another target. A queued `delegate` handle names the run, its
state, and its queue position; `delegation_status` adds
the queue summary (`enabled`, `concurrency`, `active`, `queued`, `depth`) and bounded per-run facts
(`position`, `queuedAt`, `waitMs`, `attempts`, `failureClass`, `lastRetryAt`) — never credentials,
provider output, or machine paths.

A failure is classified as `child-limit`, `provider-not-started`, `timeout`,
`reviewed-inputs-changed`, `invalid-output`, `config`, `permission`, or `unknown`. Transient classes
are `child-limit`, `provider-not-started`, and `timeout`; the rest are permanent. A timeout retries
only when cancellation is confirmed. An unconfirmed teardown settles a terminal `ERROR` while the run
keeps its key, capacity slot, and snapshot until teardown succeeds, so same-key followers wait.
`queue-full`, `queue-timeout`, and `queue-internal-error` are recorded as `ERROR` outcomes. A
queue-internal fault starts one direct target when ownership is safe and otherwise reports an `ERROR`
the task gate does not treat as a review. Only the settled attempt publishes a record: retries and
timeouts publish no intermediate `PASS`/`FINDINGS`/`ERROR`, and a retry that finds a newer
authoritative record is discarded instead of overwriting it.

The settlement observer fires exactly once per run after it leaves the pending set; retries and
queue admissions never fire it early. On restart, active run files are reconciled once per
workspace from the records on disk: a matching `PASS`/`FINDINGS` completes, a matching `ERROR`
fails, a newer record discards the older run, and a run without a matching record is marked
`interrupted` — never synthesized as a `PASS`. The gate always reads records, not run status. To
turn the queue off, set `reviewQueue: { enabled: false }`: deduplication and same-key waiting stay,
while the global concurrency/shape limits, the acceptance deadline, and automatic retries are
bypassed.

**`note`** starts no target and writes no review record: `task_progress` writes the progress note,
and a gated note rule such as `lane-fanout` is settled by a tagged worker start or a serial note.

### Portable task approvals

A task-scope `PASS` also writes a committed approval record inside the change:

```text
openspec/changes/<change>/reviews/<taskId>.json
```

```json
{
  "rule": "task-review",
  "change": "add-goal-block-review",
  "scope": "task",
  "taskId": "3ce0a99c131a4a42",
  "digest": "<task review digest>",
  "worktreeDigest": "<worktree digest at review time>",
  "verdict": "PASS",
  "findings": [],
  "target": { "provider": "codex-subagent" },
  "time": "2026-10-29T08:55:43.317Z"
}
```

The record carries only those sanitized fields: no session id, run id, machine path, or error
text. It is written atomically **before** the local `.dsh` record is published, so a failed write
reports the failure and publishes no `PASS` (the local record becomes `ERROR`). The local record
stays the turn-gate and status source; the portable record is the approval that travels with the
change into `archive/` and that a fresh clone can audit without the local `.dsh` state.

`reviews/` is reserved. It is excluded from the change artifact digest and from a review's reviewed
change-artifact inputs, alongside `.openspec.yaml`: writing an approval can never stale the
whole-spec review it was produced under, and a malformed file under `reviews/` is ignored by the
digest rather than treated as an artifact.

For a change whose task reviews ran before the portable write existed, copy the existing local
`PASS` records once:

```sh
pnpm reviews:export --change <name>
```

The export copies only a local task-scope `PASS` whose rule, change, and task id match the checked
task; it refuses `ERROR`/`FINDINGS`, a foreign change, and a task-id mismatch, and it cannot invent
an approval.

### Gate-only retirement switch

`gates.workflowOwned: false` moves enforcement of the task-review turn-stopping rule and the archive
guard to the workflow definitions, while the review runtime stays exactly as documented here. The
`delegate` tool, the review queue, runs, records, `task_progress` notes, the rule data, the
whole-spec `spec-review` rule, and the task-progress and lane-assignment/lane-boundary gates remain.
Only two signals stop: the task-review rule that refuses a close for a checked task without a
`PASS`/`ERROR` record (including the completion-coverage branch for a freshly completed list), and
the archive guard that refuses `openspec archive`/`mv`/`Move-Item`/`git mv` without a portable
`PASS`. The goal-complete guard below is not part of the flip: no workflow definition owns goal
completion. A `defer` `task-review` definition beside `gates.workflowOwned: false` is refused at
load; the
`spec-review` signal stays enabled, so `change-intake` keeps its deferred spec-review step and a
missing spec review still steers. The default is `true`. Rollback is one config flip: set
`gates.workflowOwned: true` and return the definition to `defer`; records, queue state, and notes are
never rewritten. The tracked parity report at
`packages/plugin-workflows/assets/parity/retire-legacy-gates.json` must pass
(`node scripts/workflows-parity.ts --check`; the release gate wires the `pnpm workflows:parity`
alias) before the switch is
flipped in a shipped profile.

### Migration and settings

Migrate in this order: the tracked parity report passes for the current and the retired behavior;
flip the two gate-only switches, disable the `dsh-setup-verification-gate` row, and set the three
definitions to `own` in one config change (the loader refuses `own` while its signal is enabled and
`defer` while it is disabled, so a half-flipped state fails loudly); keep the legacy provider rows
installed for one release so rollback is a config flip; delete only the retired rows after a clean
release, keeping the providers the retained spec-review and lane gates use. The workflows row carries
the mirrored settings:
`checkpointApplicability` (`minToolCalls`, `requireWrite`, `bottleneckAge`, `stepInterval`,
`enforceParallel`) and `verify.commands`/`verify.maxBlocks`. The parity settings matrix must cover at
least two non-empty command lists and two positive caps with one above 128. The release gate runs
`node scripts/workflows-parity.ts --check` (the `pnpm workflows:parity` alias is wired with the
release job). Rollback is per signal as described above; the whole-spec `spec-review`, task-progress,
and lane gates are never part of the flip.

### Change-level approval and the archive gate

`delegation_status` and `pnpm reviews:check` compute approval from the change, not from the session
that wrote it. Every checked `tasks.md` task needs a committed `reviews/<taskId>.json` PASS whose
rule, change, and task id match; `ERROR`, `FINDINGS`, a missing or malformed record, and a checked
line that is not a numbered task are unapproved, while unchecked tasks are reported but not
required. The status line is
`task-review PASS x/y, ERROR z, missing n; archive-ready: yes|no`, followed by each missing task's
number, text, task id, expected record path, and exact review call.

A repository opts in with a tracked `openspec/review-approval.json`:

```json
{
  "version": 1,
  "archiveGate": true,
  "taskRule": "task-review",
  "cutoff": "v0.12.0",
  "grandfathered": { "<change>": "<reason it is reported, not enforced>" }
}
```

With `archiveGate: true`, a `tools/pre-execute` guard refuses `openspec archive <change>` and
`mv`/`Move-Item`/`git mv` from `openspec/changes/<change>` into `changes/archive/` **before** the
command runs: it names every missing task and the exact `delegate` calls and leaves the change
active. It applies to subagents too, and it fails closed on an unreadable `tasks.md` or record, an
invalid marker rule, or any evaluation failure. Without the marker, or with `archiveGate: false`,
nothing changes. The guard recognizes the documented forms only; the push audit and CI are the
backstop for another form.

Audit commands:

- `pnpm reviews:check --change <name>` — one active change;
- `pnpm reviews:check --all` — every archived change, reporting the marker's exception and the
  pre-cutoff historical baseline without enforcing either;
- `pnpm reviews:check --push` — the archived changes a push adds or modifies (read from stdin; the
  pre-push hook runs this and fails closed on an unknown range).

### Goal-complete gate

`update_goal` with `action: "complete"` is refused while any active change has a checked task without
its portable task-review `PASS`; the refusal is the same coverage report, with each missing task's
record path and exact `delegate` call, and the goal stays active. It needs no
`openspec/review-approval.json` marker and is independent of `gates.workflowOwned`: no workflow
definition owns goal completion, so a session that never started a run cannot complete its goal
unreviewed. A profile that declares no strict `spec-task-ready` task-scope review rule has no
obligation, and a change without a checked task is not part of the check; an unreadable `tasks.md`
fails closed. The way out is the review itself, or archiving the change, which keeps its own gate.

### Finding classification

Every review finding carries a `class` from a fixed vocabulary: `spec-ambiguity`,
`missing-test`, `path-boundary`, `state-persistence`, `stale-input`, `api-contract`,
`plan-shape`, `docs-drift`, `security`, `other`. The review instructions request it, the verdict
parser stores a valid class, and an absent or unknown class is stored as `other` — a malformed
class never rejects a verdict. A `PASS` record carries no findings, so the portable approval is
unchanged. The finding history is gone; read the review records in `.dsh/delegation/<rule>/<change>/`
for the findings, and use Hindsight for durable lessons.

### Targets

A target names a registered `ctx.subagents` provider and may add `model`, `reasoningEffort`, and
provider-supported `agentOptions`:

```yaml
targets:
  codex:
    provider: codex-subagent
    model: gpt-6-astra
    reasoningEffort: xhigh
```

The shipped `codex` target selects `gpt-6-astra` at `xhigh`. Override the target in the profile
patch to change a rule's model or effort; a target that sets neither keeps the provider's own
default:

```yaml
targets:
  codex:
    provider: codex-subagent
```

The engine resolves the target at use time, passes `model`/`reasoningEffort`/`agentOptions` in the
DSH subagent start request, and lets the provider map them to its model and effort settings (the
Codex fork maps them to the app-server thread/config). A target with no options sends none, so the
provider applies its own default model/effort. Options are forwarded only when the provider declares
`agentOptions` support; otherwise the run is rejected before starting with the target id, provider
name, and the unsupported capability instead of silently dropping the option. The provider owns its
sandbox.

The engine keeps no provider slug vocabulary: any model id string is passed through. The shipped
example uses the model id verified live against the bundled Codex (`docs/codex-subagent.md` records
the current one). An unknown model or effort is rejected by the provider at run time and recorded as
an `ERROR` target failure, not silently replaced, and the Codex provider rejects unsupported
`agentOptions` keys before a process starts.

A non-Codex target uses the same rule shape:

```yaml
targets:
  dsh:
    provider: spawn
    model: deepseek-flash
    reasoningEffort: max
rules:
  - id: spec-review
    when: spec-ready
    to: dsh
    contract: review
    phase: spec
    scope: whole
    gate: strict
    instruction: "bundled:review-spec"
```

The shipped defaults target the installed-Codex provider with `gpt-6-astra` at `xhigh`. They are
data; one target can select a different model/effort and the same rule contract and gate apply. The
engine has no Codex dependency, so a standalone install composes with any provider and reports
Codex-targeted rules as unavailable until a target is configured.

## Default rules

The shipped defaults live in this package's composition fragment:

| Rule                 | Trigger                   | Contract                           | Gate   |
| -------------------- | ------------------------- | ---------------------------------- | ------ |
| `spec-review`        | `spec-ready`              | review, whole, phase `spec`        | strict |
| `task-review`        | `spec-task-ready`         | review, task, section supported    | strict |
| `integration-review` | `implementation-complete` | review, whole, phase `integration` | soft   |
| `lane-fanout`        | `lane-assignment`         | note                               | strict |

The shipped set includes the strict `lane-fanout` rule: a multi-lane change must start one tagged
worker per unassigned lane or record a per-lane serial note before the turn closes. It ships no
rule on the `implementation-work` or deprecated `lane-boundary` triggers; the goal-continuity
`work-checkpoints` capability still owns the pause-time progress and parallel decision and requires
a `work_checkpoint` call at each substantial pause.

Override `targets`/`rules` in the profile's `cordis.patch.yml`; a patch replaces the whole config
object, so restate every target and rule the session needs. Do not edit the fragment for
machine-local values.

## Task-by-task workflow

The gate exists to make incremental review the normal path:

1. Implement the smallest reviewable task.
2. Mark that task `[x]` in the change's `tasks.md`.
3. Run `delegate(rule: "task-review", change: "<change>")` immediately after the tick, then keep
   working. Keep implementing an independent task while the run uses a frozen snapshot. When the run
   reports the live worktree, a write can discard its verdict: restore snapshot support and re-run,
   or defer writes until the run settles. No blocking sleep.
   For a related group of tasks, tick the whole section and run it once with
   `delegate(rule: "task-review", change: "<change>", section: "1")` (or `"1.x"`, the normalized
   title, or `untitled`). One verdict covers every checked task in the section and publishes one
   per-task approval each; unchecked tasks stay out of scope, and a task checked after the PASS
   needs a new section or task review.
4. Fix every P0/P1 finding and re-run until the record is `PASS`.
5. If the turn must stop mid-task and a profile `task-progress` rule is configured, call
   `task_progress` for that task instead of ticking it; otherwise the goal-continuity
   `work-checkpoints` checkpoint covers the pause.

A task-scoped `PASS` is a historical snapshot: later tasks do not invalidate it. The optional
integration review covers the current combined worktree, because a later task can regress an
earlier one.

The task review takes its snapshot when the call is made: the reviewer reads the task's completion
state, and a write after that point neither invalidates the run nor enters its evidence. A review
whose snapshot cannot be built reads live inputs, where a write invalidates the verdict as the
numbered step says. The turn still cannot close until every checked task this session attributed
has a record.

The turn-stopping gate refuses a code-changing turn close unless:

- every checked task that this session attributed (the task ids in its involvement file) has a
  task-review `PASS`/`ERROR` record;
- when the session's tick makes the task list fully checked, every checked task in the change has a
  portable task-review `PASS` (not only the tasks this session attributed); before completion the
  per-task scope is unchanged, so parallel writers do not review each other's work early;
- the turn has a newly checked-and-reviewed task, or a progress note matching the current worktree
  digest when a profile configures the `task-progress` rule;
- every non-serial lane with unchecked tasks in a plan with at least two non-serial lanes is the
  lane this turn ticked, carries a tagged worker start, or has a serial note, when a profile
  configures the `lane-fanout` rule (the shipped defaults do);
- every strict whole-spec rule applies with a matching record for the current spec digest when
  this session created the change or changed its spec artifacts;
- the optional integration rule is met when this session's work completed the task list.

The gate evaluates only involved changes. A session that did not create or modify a change is not
steered for it and does not inherit a blocking digest issue from it, even when a foreign change
has a missing `tasks.md`. When the gate refuses, it steers with the rule id, trigger, digest,
record path, and the exact `delegate`/`task_progress` call; a task-review steer names the explicit
task id so it cannot select another session's checked task. Only a record satisfies the gate; a
text claim does not. A soft rule steers once per streak and never traps the turn; a target failure
writes an `ERROR` record so the turn can close with the failure visible. A missing or unreadable
planning file in an involved change is a per-change problem, not a worktree failure: the gate
names the change and the session, points at the unreadable file, and does not report
`the worktree digest could not be computed`.

There is no livelock escape inside a session other than satisfying the rule, disabling or removing
its row, or making the change part of this session's work through an edit, `task_progress`, or an
explicit review `delegate`. Legacy `.dsh/delegation/owners/` files from the previous ownership
model are ignored and may be deleted.

### The task progress note

```text
task_progress(task: "2.1 Extract the parser", status: "in-progress", reason: "half of the callers migrated")
```

`task_progress` writes `.dsh/delegation/task-progress/<change>.json` with the task id, status
(`in-progress` or `blocked`), reason, current worktree digest, and time. It runs no model and
writes no `PASS`. When a profile configures a `task-progress` rule on `implementation-work`, the note
authorizes a code-changing turn to close only while its digest still matches the worktree and the
task is still unchecked. Any further file change makes it stale, so
the next turn must refresh the note or tick the task and run its review. A checked task never
accepts a note and a note never counts as a task-review `PASS`. A note may be written from any
session, and it attributes the change to that session; task lookup skips an unrelated change whose
`tasks.md` is unreadable and validates the selected readable task. A successful note also records a
serial decision for the task's lane in this session's lane ledger (see
[the lane assignment gate](#the-lane-assignment-gate)); one note covers one lane.

## Parallel writers

More than one write-capable agent on one checkout races on the same files and on the same worktree
digest, so decide ownership before the work starts:

- **Name the files each writer owns.** The handoff states the paths; a writer does not edit outside
  them.
- **Isolate concurrent writers in separate worktrees** when their file sets are disjoint and neither
  consumes the other's output, then review and merge the results.
- **Serialize overlapping writers in one checkout** (one finishes before the next starts), or isolate
  each in its own worktree as above.
- **Create the isolated checkout explicitly:** `create_worktree` gives a write-capable subagent its
  own branch and worktree, and the delegation engine no longer provides worktree isolation. This
  section governs agents and teammates you start yourself.
- **A single writer doing sequential work needs no worktree.** Isolation is for concurrency, not a
  default ceremony.

The review records, digests, triggers, and turn-stopping gate are unchanged by this guidance; it
describes how to assign write-capable work. The shipped `lane-fanout` rule described below makes the
assignment happen at the first unassigned lane, rather than only when a lane completes.

### The lane assignment gate

A long goal tends to parallelize once, while the spec is being cut, and then run serially for the
rest of its life: the loop only ever asks for the next unchecked task, so a lane that becomes free
never shows up as a decision. The `lane-assignment` trigger turns every implementation turn into
that decision point until each lane has an owner; the shipped defaults configure it as the strict
`lane-fanout` rule.

A lane is the set of numbered tasks under the nearest preceding level-2 heading of `tasks.md`, and
its owned paths are the backticked segments of that heading — the shape the task-lane guidance in
`openspec-propose` already asks for:

```markdown
## 1. Plugin package (lane 1, owns `packages/plugin/**`)

- [ ] 1.1 Add the parser
```

The trigger reports when all of these hold:

- the change is attributed to this session, its `tasks.md` is readable, and it has at least two
  non-serial lanes with tasks; a completed lane still counts toward the threshold;
- the turn ticked a task or changed implementation files;
- at least one unassigned non-serial lane with unchecked tasks is not the lane this session ticked
  in this turn (all lanes ticked this turn are current) and names owned paths.

A lane is satisfied by a successful tagged worker start or by a serial note; a lane that is complete,
disappeared, or renamed no longer carries a decision. The state is a session-scoped ledger, so another
session's worker start or note never settles this one, and a Host restart re-arms the decision for
lanes that already had a worker.

**The tag is the evidence.** Each worker call the steer prints carries `lane-tag: <change>#<n>`,
where `<n>` is the lane's 1-based position in `tasks.md`. Only a successful `subagent`,
`subagent_fork`, `spawn_teammate`, or `workflow` start whose arguments contain that exact tag assigns
the lane; an untagged, failed, or unrelated start assigns nothing. The tag is a coordination label,
not a secret or a bypass.

**The serial escape is per lane.** A successful `task_progress` note for a task in a lane marks only
that lane serial in this session's ledger. It keeps that decision after later worktree changes,
because it is a plan decision rather than a digest fact; other lanes remain unassigned and still
report. One note therefore cannot silence the whole change. Name the work constraint in the reason:
a shared hot file, generated output, or a serial gate. The task-review or archive process is not a
work constraint.

The steer names each unassigned lane, its owned paths, a ready `subagent` call with the lane tag that
takes the lane in its own worktree and branch, and the `task_progress` call that records a serial
decision for that lane. The payload prints a checkpoint commit before the worker calls: a new
checkout contains only commits, so the session that fans out commits the current plan and worktree
first, force-adding the change directory so a change that matches a Git ignore rule still reaches the
worker. Owned paths come from the change and no machine path is printed, because the child inherits
the working directory. Workers do not tick `tasks.md`; the session integrates their branches and
reviews the tasks.

A heading containing `serial` (case-insensitive) is the integration tail and never counts as
parallel work, because generated output and the full repository gate cannot run concurrently; the
same serial title covers a hot file and a serial gate. The trigger fails open: an unreadable
`tasks.md`, a change without level-2 headings, an unassigned lane without owned paths, and a turn
that neither ticked a task nor changed implementation files report nothing. A change with exactly
one non-serial lane in the plan reports nothing, and so does a plan whose remaining work is a
hot-file, generated-output, or serial-gate lane. The trigger and the `lane-fanout` rule shape remain
available to profile rules; the shipped defaults configure the strict `lane-fanout` rule.

`lane-boundary` is deprecated. It remains accepted for existing profiles and keeps its documented
completion-boundary behavior (a completed lane plus a per-turn worker start or a matching note), but
no shipped rule uses it and its per-turn boolean forgets a worker started in an earlier turn. A
profile that needs a different boundary configures `lane-fanout` with `lane-assignment`.

### Worker-assigned checkpoint lanes

A tagged worker assignment binds the reflection plan. When a task lane was assigned to a tagged
worker, the `continue` `work_checkpoint` lane that covers that work MUST name an owner other than
`lead`, and a bottleneck whose targets fall inside that lane MUST use `worker_start` or
`user_decision`; a `lead_action` targeting it is refused. A missing checkpoint lane for a
worker-assigned task lane is refused and the steer names the lane, while an unreadable checkpoint or
task-lane plan fails open. The goal-continuity owner rule still applies independently.

## Digests and records

- The whole-spec digest hashes every file in the change directory except `.openspec.yaml` and the
  root `reviews/` approval directory, with
  `tasks.md` checkbox state normalized so ticking tasks does not invalidate a spec review. It is
  computed independently of task parsing, so a partial change whose `tasks.md` is missing still has
  an artifact digest and a write that makes it readable is detectable. A per-change artifact error
  stays a per-change hint and is never reported as a worktree digest failure.
- The worktree digest hashes `git status --porcelain=v1 -z --untracked-files=all`, the binary
  diff against `HEAD`, and untracked file bytes, ignoring `.dsh/` and `.tmp/`. Git runs with
  fixed argument arrays and no shell; a git failure becomes a visible gate issue, not a silent
  pass.
- The live inputs a whole-scope review tracks are exactly the git-visible set
  (`git ls-files --cached --others --exclude-standard`) minus `.dsh/`, `.tmp/`, and the reviewed
  change's `reviews/` approval directory, whose writes are engine output rather than review input.
  Each file is signed by size plus nanosecond mtime/ctime; a git-listed path that cannot be stat'ed
  is recorded as changed instead of failing the run. Build output and other scratch trees MUST
  therefore be gitignored: an unignored `target/` or `dist/` folder lets a concurrent build
  invalidate a review.
- A task-scope digest is `task-review-v2` over the task id and text, the frozen change-artifact
  digest, and the snapshot's content tree; the record's worktree digest is derived from that tree.
  The tree is content-addressed, so unchanged content reuses the same digest and an unchanged
  `FINDINGS` record is reused without another run.
- A task-scope review reviews the snapshot's content tree: tracked paths from the real index
  (including a path staged with `git add -f`), untracked non-ignored files, and a frozen copy of the
  change directory, with `.dsh/`, `.tmp/`, and the change directory excluded from the tree and a
  deleted path skipped. A whole-spec review tracks exactly the change artifacts. Do not edit a
  change artifact while a whole-scope review is pending — the edit invalidates that verdict by
  design; a task review is immune because it reads the frozen copy.
- A task review's snapshot worktree, its lease, and its scratch index live under `.dsh/delegation/`
  (Git-ignored) and are removed when the run settles. A crashed Host leaves an expired lease; the
  next snapshot in that workspace sweeps the leftover of an expired lease, and of a lease-less
  directory older than its grace period, then runs `git worktree prune`. The engine never runs a
  repository-wide `git gc`/`prune`: snapshot objects are content-addressed and collected by the
  repository's own garbage collection.
- A whole-scope record is valid only while its digest matches; a task-scope record is keyed by
  the stable task id and remains historical.
- Records contain the rule, change, scope, phase, task id when task-scoped, digest, verdict,
  findings, target identity, time, and the reviewing session. Findings are sanitized of machine
  paths and obvious credentials; records are parsed as data, never executed. The committed
  `reviews/<taskId>.json` copy of a task `PASS` is the sanitized subset described under
  [Portable task approvals](#portable-task-approvals).
- Session involvement lives in `.dsh/delegation/sessions/<sha256(session).slice(0,16)>.json` and
  is written atomically. It is the inverse of the old owner map: a session reads and writes only
  its own file, so concurrent sessions never contend. A missing or malformed file reads as empty;
  `delegation_status` reports the malformed state as a warning. Legacy
  `.dsh/delegation/owners/` files are ignored and have no effect; no migration imports them,
  because the first observer was often not the session that did the work.

## Migration from removed delegation paths

The `answer` and `patch` result contracts are gone, and with them the shipped `research`, `advisor`,
`blocker`, `worker-fast`, `worker-deep`, and `bug-fix` rules and the `worker-fast`, `worker-deep`,
`codex-astra`, and `codex-write` targets; review learning is retired as well, so its lesson tools,
the `/review-retro` command, the lesson store, the finding history, and its config block no longer
exist. Each removed delegation path has one documented replacement: call `subagent`
when the provider, model, reasoning effort, or prompt must be chosen
(`high` effort for mechanical work, `max` for ambiguous analysis); call `codex_subagent` for an
ad-hoc second opinion on the registered Codex provider, which takes only a prompt and uses its
provider row's model and effort; and use `create_worktree` for an isolated checkout that a
write-capable `subagent` then edits, reviewing the returned diff and tests before applying it. A
profile that still declares a removed contract, trigger, target, or target field fails validation
with the replacement named. Use Hindsight for durable lessons; review findings stay in the review
records.

## Model-facing cost and security

The plugin adds no always-on prompt text. Its model-facing policy is the three tool descriptions
plus the skill catalog line, and the full workflow is loaded only when the skill is invoked.

- The model-facing budget is 900 estimated tokens for the three tool descriptions plus the skill
  catalog description, and 24,000 UTF-8 bytes for the skill body. The `delegate` description may
  append at most 400 bytes of discovered section labels; the total stays inside the same budget.
- A review consumes the target's tokens/subscription; the progress note is free. Per-task reviews
  multiply runs, so keep tasks sized for one review; a section review covers a related group in one
  run; set the optional integration review to `soft` or `none` if it adds noise. The shipped
  `codex` target selects `gpt-6-astra` at `xhigh`, so every default Codex review pays for the
  strong model; override the target for cheaper routine reviews.
- The engine validates rule ids, change names, task ids, worktree paths, and git arguments before
  effects; git is invoked with fixed arguments; records and progress notes keep no credentials,
  secrets, or machine paths; target output is untrusted data, parsed for the declared contract and
  never executed. A write-capable subagent's worktree diff stays isolated until a human or agent
  reviews and applies it.

## Troubleshooting

- **"target ... names provider ..., which is not registered"** — install or enable that provider,
  or repoint the rule in the profile config. `delegation_status` reports each configured target as
  `available` or `MISSING` with the provider it names.
- **"does not support model/agent options"** — remove `model`, `reasoningEffort`, or
  `agentOptions` from that target, or use a provider with `agentOptions` capability.
- **"verdict digest does not match"** — the target answered about a different revision; re-run on
  the current artifacts.
- **"reviewed inputs changed during the run"** — a whole-scope review, or a task review that fell
  back to the live worktree, saw a git-visible file or one of the reviewed change's artifacts change
  while it ran; the error names the count and paths. Finish the writes, then re-run the review. A
  snapshot task review is immune, and a portable `reviews/<taskId>.json` approval written by another
  review is engine output, not a reviewed input. Gitignore build output so a concurrent build does
  not count as a reviewed input.
- **The run detail says `live worktree: ...`** — the task review could not build its snapshot and
  the reason follows. When it names the missing `.dsh/` ignore rule, add `.dsh/` to `.gitignore` or
  `.git/info/exclude` to restore snapshots; the current review still runs under the live guard.
- **Snapshot leftovers** — a task review keeps a disposable checkout under
  `.dsh/delegation/snapshots/<runId>` and a `<runId>.lease` beside it; both go away when the run
  settles. After a crashed Host the lease expires and the next snapshot in that workspace sweeps the
  leftover after its throttle window; `git worktree prune` clears stale metadata. The engine never
  runs a repository-wide `git gc`/`prune`.
- **"no fenced JSON verdict"** — the target returned prose or an invalid block; an `ERROR` record
  was written, so the gate can close with the failure visible and a later run retries.
- **The gate keeps steering** — a strict rule has no matching record for the current digest; run
  the exact `delegate` call in the steer message (it names the task id for a task review), or
  inspect the record path it names with `delegation_status`.
- **A change is not involved** — the session did not write to it and made no explicit change-scoped
  call. Edit the change, call `task_progress`, or run a review `delegate` to opt in. A write
  through an unrecognized tool or an unparsed shell form does not attribute. Legacy
  `.dsh/delegation/owners/` files are ignored; delete them if a clean status is wanted.
- **A note is stale** — the worktree changed after the note; refresh the note or tick the task
  and run its review.
- **Configuration rejected** — the error names the rule/target and the next action; a patch
  replaces the whole config, so include every target and rule the session needs.

The package is installable on its own with any registered DSH subagent provider; the setup bundle
delivers it with the default targets above. See `openspec/specs/` for the accepted requirements
and `docs/plugins.md` for the bundle/install mechanics.
