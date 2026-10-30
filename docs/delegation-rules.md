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
files, progress notes, worktrees, and change artifacts remain on disk. There is no in-session
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
- `when` — one of the six trigger primitives below.
- `to` — a configured target id (absent only for the `note` contract).
- `instruction` — `bundled:<asset>` for a shipped prompt, or inline text.
- `contract` — `review`, `answer`, `patch`, or `note`.
- `gate` — `strict`, `soft`, or `none`.
- `phase` — record key for a whole-scope review (required for `scope: whole`).
- `scope` — `whole` or `task` for the review contract.
- `isolation` — `worktree` for the patch contract.
- `threshold` — optional per-rule failure-streak threshold.

Validation rejects an unknown trigger, contract, gate, field, or target; a missing instruction;
a non-kebab id; a duplicate id; a whole review without a phase; a task review with a phase; a
note rule with a target; a patch rule without `isolation: worktree`; a patch target that is not
declared `write: true`; a strict gate on an answer rule; a gated manual rule; and two strict
rules for the same trigger/scope/phase. Errors name the rule/target and the next action. A
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
- `lane-boundary` — a task this session ticked in this turn completed the last unchecked task of a
  `tasks.md` lane, another non-tail lane still has an unchecked task, and the turn started no
  parallel worker; satisfied by a worker start or by a progress note in a remaining lane.
- `implementation-complete` — this session completed the change's task list and the optional
  integration review has no matching `PASS`/`ERROR` record for the current worktree digest.
- `failure-streak` — the configured number of consecutive failed tool calls with no intervening
  success and no consultation attempt for that streak.

The trigger vocabulary is fixed. `manual` rules must use `gate: none`; `failure-streak` rules
must not be strict (an answer writes no record).

The change-scoped triggers evaluate only for changes attributed to the current session. A session
is involved in a change when it created or modified it in this workspace; observation, a
`delegation_status` poll, and another session's edits never attribute. `spec-ready` applies only
when the session created the change or changed its spec artifacts, `spec-task-ready` only to the
tasks the session checked, `implementation-work` only to an involved change, and
`implementation-complete` only when the session completed the task list. Another session's ticks
are not imported into a creator's scope. `task_progress` notes, `answer` runs, and `patch` runs
remain available in every session; an explicit `task_progress` or review/patch `delegate` also
attributes the change.

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
shell form under-gates: the session can call `task_progress` or a review/patch `delegate` to opt
in. There is deliberately no attribution from the workspace diff, file mtimes, or a change
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
- task scope: `tasks/<taskId>.json`, with the task id derived from the normalized task text.

A task-scope `PASS` additionally writes the committed [portable approval](#portable-task-approvals)
inside the change.

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
pending review at its run instead of starting another. Answer and patch stay synchronous.

Several reviews can run at once. A duplicate request is identified by rule + change + task/phase: a
second call while that identity is pending returns the existing run handle. Different rules on the
same change/task queue over one conversation key and each writes its own record. Task-scoped reviews
accept an explicit `task` (id or task text), so parallel task reviews for different tasks do not
collapse onto the engine's next-task choice. A task-scoped run reviews an immutable snapshot of the
worktree: a detached checkout under `.dsh/delegation/snapshots/<runId>` built from the exact review
input set and the frozen change directory, so a write after the run starts neither invalidates it
nor enters its evidence. A whole-scope run reviews live inputs; any reviewed-input change during the
run (a git-visible worktree file, a tracked file that disappears, or an included change artifact,
including edit-read-restore) discards the verdict and reports a retry instead of publishing a
`PASS`. A task review whose snapshot cannot be built falls back to the live inputs and the same
guard.

**`answer`** is the read-only blocker/research/advisor contract. It returns the answer with evidence
and, for research, sources and dates, and, for an advisor, a recommendation, the strongest
counterargument, risks, a next action, and confidence. It writes no gate record; a failed answer is
reported and counts as a consultation attempt so a soft `failure-streak` rule does not loop.

**`patch`** runs a write-capable target in an isolated git worktree under
`.dsh/delegation/worktrees/` and returns the changed files, diff, and the target's test report.
It never applies the diff to the session worktree, and a patch run is never a review `PASS`.
The owner or agent reviews and merges manually.

**`note`** is written by `task_progress` and explained below.

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

### Targets

A target names a registered `ctx.subagents` provider and may add `model`, `reasoningEffort`, and
provider-supported `agentOptions`:

```yaml
targets:
  codex:
    provider: codex-subagent
    model: gpt-6-astra
    reasoningEffort: xhigh
  codex-write:
    provider: codex-subagent-write
    write: true
    model: gpt-6-astra
    reasoningEffort: xhigh
  codex-astra:
    provider: codex-subagent
    model: gpt-6-astra
    reasoningEffort: xhigh
```

The shipped `codex` and `codex-write` targets select `gpt-6-astra` at `xhigh`. `codex-astra` keeps
the same values as the explicit strong target the advisor uses, so a profile can make
`codex`/`codex-write` cheaper without weakening the advisor:

```yaml
targets:
  codex:
    provider: codex-subagent
  codex-write:
    provider: codex-subagent-write
    write: true
  codex-astra:
    provider: codex-subagent
    model: gpt-6-astra
    reasoningEffort: xhigh
```

Point a rule at `codex-astra` only when it must stay strong under such an override:

```yaml
rules:
  - id: spec-review
    when: spec-ready
    to: codex-astra
    contract: review
    phase: spec
    scope: whole
    gate: strict
    instruction: "bundled:review-spec"
```

The engine resolves the target at use time, passes `model`/`reasoningEffort`/`agentOptions` in the
DSH subagent start request, and lets the provider map them to its model and effort settings (the
Codex fork maps them to the app-server thread/config). A target with no options sends none, so the
provider applies its own default model/effort. Options are forwarded only when the provider declares
`agentOptions` support; otherwise the run is rejected before starting with the target id, provider
name, and the unsupported capability instead of silently dropping the option. `write: true` is a
declaration for the `patch` contract; the engine never silently escalates a target's permissions.
The provider owns its sandbox.

The engine keeps no provider slug vocabulary: the delta spec's `astra` is illustrative and any
string is passed through. The shipped example uses the model id verified live against the bundled
Codex (`docs/codex-subagent.md` records the current one). An unknown model or effort is rejected by
the provider at run time and recorded as an `ERROR` target failure, not silently replaced, and the
Codex provider rejects unsupported `agentOptions` keys before a process starts.

A non-Codex target uses the same rule shape:

```yaml
targets:
  dsh:
    provider: spawn
    model: deepseek-flash
    reasoningEffort: max
rules:
  - id: research
    when: manual
    to: dsh
    contract: answer
    gate: none
    instruction: "bundled:research"
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
| `task-review`        | `spec-task-ready`         | review, task                       | strict |
| `task-progress`      | `implementation-work`     | note                               | strict |
| `lane-fanout`        | `lane-boundary`           | note                               | strict |
| `blocker`            | `failure-streak`          | answer                             | soft   |
| `research`           | `manual`                  | answer                             | none   |
| `advisor`            | `manual`                  | answer                             | none   |
| `bug-fix`            | `manual`                  | patch                              | none   |
| `integration-review` | `implementation-complete` | review, whole, phase `integration` | soft   |

`advisor` is a manual, read-only second opinion. Use it only when the decision is expensive to
reverse, security or data integrity is at stake, the design spans modules, or two attempts have
failed and the next step is unclear. Do not use it for routine edits, syntax, lookups, or facts you
can verify locally. One well-framed question per call, with constraints and decisive evidence; at
most three advisor calls per session. It writes no gate record and never satisfies a review.

Override `targets`/`rules` in the profile's `cordis.patch.yml`; a patch replaces the whole config
object, so restate every target and rule the session needs. Do not edit the fragment for
machine-local values.

## Task-by-task workflow

The gate exists to make incremental review the normal path:

1. Implement the smallest reviewable task.
2. Mark that task `[x]` in the change's `tasks.md`.
3. Run `delegate(rule: "task-review", change: "<change>")` immediately, before starting the next
   task.
4. Fix every P0/P1 finding and re-run until the record is `PASS`.
5. If the turn must stop mid-task, call `task_progress` for that task instead of ticking it.

A task-scoped `PASS` is a historical snapshot: later tasks do not invalidate it. The optional
integration review covers the current combined worktree, because a later task can regress an
earlier one.

The task review takes its snapshot when the call is made: the reviewer reads the task's completion
state, and a write after that point neither invalidates the run nor enters its evidence. Keep
implementing while it runs; the turn still cannot close until every checked task this session
attributed has a record.

The turn-stopping gate refuses a code-changing turn close unless:

- every checked task that this session attributed (the task ids in its involvement file) has a
  task-review `PASS`/`ERROR` record;
- when the session's tick makes the task list fully checked, every checked task in the change has a
  portable task-review `PASS` (not only the tasks this session attributed); before completion the
  per-task scope is unchanged, so parallel writers do not review each other's work early;
- the turn has a newly checked-and-reviewed task or a progress note matching the current worktree
  digest;
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
explicit review/patch `delegate`. Legacy `.dsh/delegation/owners/` files from the previous
ownership model are ignored and may be deleted.

### The task progress note

```text
task_progress(task: "2.1 Extract the parser", status: "in-progress", reason: "half of the callers migrated")
```

`task_progress` writes `.dsh/delegation/task-progress/<change>.json` with the task id, status
(`in-progress` or `blocked`), reason, current worktree digest, and time. It runs no model and
writes no `PASS`. The note authorizes a code-changing turn to close only while its digest still
matches the worktree and the task is still unchecked. Any further file change makes it stale, so
the next turn must refresh the note or tick the task and run its review. A checked task never
accepts a note and a note never counts as a task-review `PASS`. A note may be written from any
session, and it attributes the change to that session; task lookup skips an unrelated change whose
`tasks.md` is unreadable and validates the selected readable task.

## Parallel writers

More than one write-capable agent on one checkout races on the same files and on the same worktree
digest, so decide ownership before the work starts:

- **Name the files each writer owns.** The handoff states the paths; a writer does not edit outside
  them.
- **Isolate concurrent writers in separate worktrees** when their file sets are disjoint and neither
  consumes the other's output, then review and merge the results.
- **Serialize overlapping writers in one checkout** (one finishes before the next starts), or isolate
  each in its own worktree as above.
- **The patch contract already isolates itself:** a `bug-fix` run executes in its own worktree. This
  section governs agents and teammates you start directly.
- **A single writer doing sequential work needs no worktree.** Isolation is for concurrency, not a
  default ceremony.

The review records, digests, triggers, and turn-stopping gate are unchanged by this guidance; it
describes how to assign write-capable work. The `lane-boundary` rule below is what makes the
assignment happen at the moment the work is split, rather than at the start of the change.

### The lane boundary

A long goal tends to parallelize once, while the spec is being cut, and then run serially for the
rest of its life: the loop only ever asks for the next unchecked task, so a lane that becomes free
never shows up as a decision. The `lane-boundary` trigger turns a completed lane into that decision
point.

A lane is the set of numbered tasks under the nearest preceding level-2 heading of `tasks.md`, and
its owned paths are the backticked segments of that heading — the shape the task-lane guidance in
`openspec-propose` already asks for:

```markdown
## 1. Plugin package (lane 1, owns `packages/plugin/**`)

- [ ] 1.1 Add the parser
```

The trigger reports at turn close only when all of these hold:

- a task this session ticked in this turn was the last unchecked task of its lane;
- at least one other lane still has an unchecked task and is not the serial tail;
- the turn started no parallel worker — a successful `subagent`, `subagent_fork`,
  `spawn_teammate`, or `workflow` tool result settles it;
- no `task_progress` note names a task in a remaining lane and matches the current worktree digest.

The steer names each remaining lane, its owned paths, a ready `subagent` call that takes the lane
in its own worktree and branch, and the `task_progress` call that records a serial decision. The
payload also prints a checkpoint commit: a new checkout contains only commits, so the session that
fans out commits the current plan and worktree first, force-adding the change directory so a change
that matches a Git ignore rule still reaches the worker. Owned paths come from the change and no
machine path is printed, because the child inherits the working directory. The serial escape is the
ordinary progress note: writing it records _why_ the lane stays serial, and the note is what makes
the decay auditable after the fact.

A heading containing `serial` (case-insensitive) is the integration tail and never counts as
remaining parallel work, because generated output and the full repository gate cannot run
concurrently. The trigger fails open: an unreadable `tasks.md`, a change without level-2 headings,
any remaining lane without owned paths, a completion task that no longer appears in `tasks.md`, a
lane reopened before the turn closes, a renamed lane, and a write that only deletes a lane's last
unchecked task all report nothing. A completion therefore stands only while the plan still holds
the lane complete and every task that carried it. Mid-lane turns never report, so a change reaches
only a handful of
boundaries.

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
  (`git ls-files --cached --others --exclude-standard`) minus `.dsh/` and `.tmp/`. Each file is
  signed by size plus nanosecond mtime/ctime; a git-listed path that cannot be stat'ed is recorded
  as changed instead of failing the run. Build output and other scratch trees MUST therefore be
  gitignored: an unignored `target/` or `dist/` folder lets a concurrent build invalidate a review.
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

## Manual delegation

```text
delegate(rule: "research", objective: "Which helper owns file locking?", context: "failing test in packages/fs")
delegate(rule: "advisor", context: "Question: keep the approval gate in this plugin? Constraints: standalone install, DSH 0.2.1-rc.3. Evidence: packages/plugin-delegation-rules/src/shared/approval.ts")
delegate(rule: "blocker", context: "three failed attempts: <commands and output>; current plan: <plan>")
delegate(rule: "bug-fix", objective: "fix the stale-cache crash", context: "repro: <command>")
```

`research` answers with evidence and sources; `advisor` gives a bounded recommendation, the strongest
counterargument, risks, a next action, and confidence; `blocker` recommends a next action with
evidence; `bug-fix` returns an isolated worktree, diff, and test report for manual review. A failing
target is reported; for the soft `failure-streak` rule it marks the consultation attempt and does
not repeat.

## Model-facing cost and security

The plugin adds no always-on prompt text. Its model-facing policy is the three tool descriptions
plus the skill catalog line, and the full workflow is loaded only when the skill is invoked.

- Measured: three tool descriptions plus the skill catalog description are 2656 UTF-8 bytes
  (~664 estimated tokens at bytes / 4), against the 900 estimated tokens budget.
- Measured: the skill body is 14389 UTF-8 bytes, against the 24,000 UTF-8 bytes budget.
- Reviews and answers consume the target's tokens/subscription; the progress note is free.
  Per-task reviews multiply runs, so keep tasks sized for one review; set the optional
  integration review to `soft` or `none` if it adds noise. The shipped `codex` and `codex-write`
  targets select `gpt-6-astra` at `xhigh`, so every default Codex rule pays for the strong model;
  override those targets for cheaper routine reviews and leave `advisor` on `codex-astra`.
- The engine validates rule ids, change names, task ids, and record paths before effects; git is
  invoked with fixed arguments; target output is untrusted data, parsed for the declared contract
  and never executed. Patch results stay isolated until a human or agent reviews and applies
  them.

## Troubleshooting

- **"target ... names provider ..., which is not registered"** — install or enable that provider,
  or repoint the rule in the profile config. `delegation_status` lists the registered providers
  and missing-target diagnostics.
- **"does not support model/agent options"** — remove `model`, `reasoningEffort`, or
  `agentOptions` from that target, or use a provider with `agentOptions` capability.
- **"verdict digest does not match"** — the target answered about a different revision; re-run on
  the current artifacts.
- **"reviewed inputs changed during the run"** — a whole-scope review, or a task review that fell
  back to the live worktree, saw a git-visible file or one of the reviewed change's artifacts change
  while it ran; the error names the count and paths. Finish the writes, then re-run the review. A
  snapshot task review is immune. Gitignore build output so a concurrent build does not count as a
  reviewed input.
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
  call. Edit the change, call `task_progress`, or run a review/patch `delegate` to opt in. A write
  through an unrecognized tool or an unparsed shell form does not attribute. Legacy
  `.dsh/delegation/owners/` files are ignored; delete them if a clean status is wanted.
- **A note is stale** — the worktree changed after the note; refresh the note or tick the task
  and run its review.
- **Configuration rejected** — the error names the rule/target and the next action; a patch
  replaces the whole config, so include every target and rule the session needs.

The package is installable on its own with any registered DSH subagent provider; the setup bundle
delivers it with the default targets above. See `openspec/specs/` for the accepted requirements
and `docs/plugins.md` for the bundle/install mechanics.
