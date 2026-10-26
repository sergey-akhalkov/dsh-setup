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
skill, and stops all enforcement. Delegation records (`.dsh/delegation/`), progress notes,
worktrees, and change artifacts remain on disk. There is no in-session bypass: the only opt-out
is disabling the row. Records are a process-integrity check, not anti-forgery — a model with
full filesystem access could write a record-shaped file.

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
- `spec-ready` — an active review-ready OpenSpec change exists and the whole-spec review has no
  matching `PASS`/`ERROR` record for the current spec digest.
- `spec-task-ready` — a checked task in the change's `tasks.md` has no task-review record.
- `implementation-work` — the turn changed implementation files and has neither a newly
  checked-and-reviewed task nor a `task_progress` note matching the current worktree digest.
- `implementation-complete` — every task is checked and the optional integration review has no
  matching `PASS`/`ERROR` record for the current worktree digest.
- `failure-streak` — the configured number of consecutive failed tool calls with no intervening
  success and no consultation attempt for that streak.

The trigger vocabulary is fixed. `manual` rules must use `gate: none`; `failure-streak` rules
must not be strict (an answer writes no record).

The change-scoped triggers (`spec-ready`, `spec-task-ready`, `implementation-work`,
`implementation-complete`, and a configured integration review) evaluate only in the change's
**owning thread**. The owner is the first DSH thread to observe the change; it is recorded under
`.dsh/delegation/owners/` and reused across threads and engine restarts. Another thread reports the
owner in `delegation_status` and is not steered for that change. `task_progress` notes, `answer`
runs, and `patch` runs remain available in every thread.

### Contracts

**`review`** computes a digest, runs the target with the bundled P0/P1 prompt, accepts exactly
one fenced JSON verdict that echoes the digest, validates the severities, and writes an atomic
record under `.dsh/delegation/<rule>/<change>/`:

- whole scope: `<phase>.json`;
- task scope: `tasks/<taskId>.json`, with the task id derived from the normalized task text.

A `PASS` requires zero P0/P1 findings. `FINDINGS` and `ERROR` records are reported but do not
satisfy a strict gate. A matching `PASS` is reused without another run; a `FINDINGS` record is
reused only while the digest is unchanged; an `ERROR` is retried on the next run. Stale records
never authorize a handoff. A malformed verdict (prose only, several fenced blocks, an invalid
severity, or a digest mismatch) writes no `PASS`; it writes an `ERROR` record and reports the
failure, so the turn can close with the failure visible.

A change-scoped review runs only in the change's owning thread. A `delegate` call from a foreign
thread fails before the target starts and names the owning thread; run the review there. The record
stores the owning thread alongside the other fields.

A review runs **asynchronously**: `delegate` validates the rule/target/change (and task), waits for
the target to start, and returns a run id, state, and record path while the verdict is produced in
the background. Use `delegation_status` (or the record path) for completion; the gate points a
pending review at its run instead of starting another. Answer and patch stay synchronous.

Several reviews can run at once. A duplicate request is identified by rule + change + task/phase: a
second call while that identity is pending returns the existing run handle. Different rules on the
same change/task queue over one conversation key and each writes its own record. Task-scoped reviews
accept an explicit `task` (id or task text), so parallel task reviews for different tasks do not
collapse onto the engine's next-task choice. A run reviews stable inputs bound to its digest; any
reviewed-input change during the run (including edit-read-restore) discards the verdict and reports
a retry instead of publishing a `PASS`.

**`answer`** is the read-only blocker/research contract. It returns the answer with evidence and,
for research, sources and dates. It writes no gate record; a failed answer is reported and
counts as a consultation attempt so a soft `failure-streak` rule does not loop.

**`patch`** runs a write-capable target in an isolated git worktree under
`.dsh/delegation/worktrees/` and returns the changed files, diff, and the target's test report.
It never applies the diff to the session worktree, and a patch run is never a review `PASS`.
The owner or agent reviews and merges manually.

**`note`** is written by `task_progress` and explained below.

### Targets

A target names a registered `ctx.subagents` provider and may add `model`, `reasoningEffort`, and
provider-supported `agentOptions`:

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

`codex-astra` is the shipped per-target example: it selects a specific Codex model and reasoning
effort while the default `codex`/`codex-write` targets keep the provider defaults. Point a rule at
it, or copy the two option lines onto an existing target:

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

The shipped defaults target the installed-Codex provider because that is the owner's strongest
current target. They are data; one target can select `astra`/`xhigh` and another a different
model/effort, and the same rule contract and gate apply. The engine has no Codex dependency, so a
standalone install composes with any provider and reports Codex-targeted rules as unavailable until
a target is configured.

## Default rules

The shipped defaults live in this package's composition fragment:

| Rule                 | Trigger                   | Contract                           | Gate   |
| -------------------- | ------------------------- | ---------------------------------- | ------ |
| `spec-review`        | `spec-ready`              | review, whole, phase `spec`        | strict |
| `task-review`        | `spec-task-ready`         | review, task                       | strict |
| `task-progress`      | `implementation-work`     | note                               | strict |
| `blocker`            | `failure-streak`          | answer                             | soft   |
| `research`           | `manual`                  | answer                             | none   |
| `bug-fix`            | `manual`                  | patch                              | none   |
| `integration-review` | `implementation-complete` | review, whole, phase `integration` | soft   |

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

The turn-stopping gate refuses a code-changing turn close unless:

- every checked task has a task-review `PASS`/`ERROR` record;
- the turn has a newly checked-and-reviewed task **or** a progress note matching the current
  worktree digest;
- every strict whole-spec (and configured strict integration) rule has a matching record for the
  current digest.

These checks apply in the change's owning thread; a foreign thread treats the change as not its own,
gets no steer, and does not inherit a blocking digest issue from it. When the gate refuses, it steers
with the rule id, trigger, digest, record path, and the exact `delegate`/`task_progress` call. Only a
record satisfies the gate; a text claim does not. A soft rule steers once per streak and never traps
the turn; a target failure writes an `ERROR` record so the turn can close with the failure visible.
There is no livelock escape inside a session other than satisfying, disabling, or removing the rule's
row; if the owning thread is gone, delete the change's owner file under
`.dsh/delegation/owners/` and re-observe the change from the thread that should own it.

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
thread; it is workspace state, not ownership state.

## Digests and records

- The whole-spec digest hashes every file in the change directory except `.openspec.yaml`, with
  `tasks.md` checkbox state normalized so ticking tasks does not invalidate a spec review.
- The worktree digest hashes `git status --porcelain=v1 -z --untracked-files=all`, the binary
  diff against `HEAD`, and untracked file bytes, ignoring `.dsh/` and `.tmp/`. Git runs with
  fixed argument arrays and no shell; a git failure becomes a visible gate issue, not a silent
  pass.
- A whole-scope record is valid only while its digest matches; a task-scope record is keyed by
  the stable task id and remains historical.
- Records contain the rule, change, scope, phase, task id when task-scoped, digest, verdict,
  findings, target identity, time, and owning thread. Findings are sanitized of machine paths and
  obvious credentials; records are parsed as data, never executed.
- Owners live in `.dsh/delegation/owners/<sha256(change).slice(0,16)>.json` (one file per change,
  written with an exclusive create) and resolve against the OpenSpec workspace root, so a nested
  working directory cannot create a competing owner and concurrent runtimes cannot overwrite one.
  A corrupt owner file is not auto-reclaimed: the gate fails visibly with its path, and deleting
  that file (or `.dsh/delegation/owners/`) re-claims the change.

## Manual delegation

```text
delegate(rule: "research", objective: "Which helper owns file locking?", context: "failing test in packages/fs")
delegate(rule: "blocker", context: "three failed attempts: <commands and output>; current plan: <plan>")
delegate(rule: "bug-fix", objective: "fix the stale-cache crash", context: "repro: <command>")
```

`research` answers with evidence and sources; `blocker` recommends a next action with evidence;
`bug-fix` returns an isolated worktree, diff, and test report for manual review. A failing target
is reported; for the soft `failure-streak` rule it marks the consultation attempt and does not
repeat.

## Model-facing cost and security

The plugin adds no always-on prompt text. Its model-facing policy is the three tool descriptions
plus the skill catalog line, and the full workflow is loaded only when the skill is invoked.

- Measured: three tool descriptions plus the skill catalog description are 2179 UTF-8 bytes
  (~545 estimated tokens at bytes / 4), against the 900 estimated tokens budget.
- Measured: the skill body is 8688 UTF-8 bytes, against the 24,000 UTF-8 bytes budget.
- Reviews and answers consume the target's tokens/subscription; the progress note is free.
  Per-task reviews multiply runs, so keep tasks sized for one review; set the optional
  integration review to `soft` or `none` if it adds noise.
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
- **"no fenced JSON verdict"** — the target returned prose or an invalid block; an `ERROR` record
  was written, so the gate can close with the failure visible and a later run retries.
- **The gate keeps steering** — a strict rule has no matching record for the current digest; run
  the exact `delegate` call in the steer message, or inspect the record path it names with
  `delegation_status`.
- **A review is refused with an owning thread** — the change belongs to another thread; run the
  exact `delegate` call there. If that thread is gone, delete the change's file under
  `.dsh/delegation/owners/` (the error names it) and re-observe the change from the thread that
  should own it.
- **A note is stale** — the worktree changed after the note; refresh the note or tick the task
  and run its review.
- **Configuration rejected** — the error names the rule/target and the next action; a patch
  replaces the whole config, so include every target and rule the session needs.

The package is installable on its own with any registered DSH subagent provider; the setup bundle
delivers it with the default targets above. See `openspec/specs/` for the accepted requirements
and `docs/plugins.md` for the bundle/install mechanics.
