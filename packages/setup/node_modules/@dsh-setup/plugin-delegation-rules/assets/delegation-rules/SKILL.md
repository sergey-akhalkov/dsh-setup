---
name: delegation-rules
description: >
  Delegation rules: authored triggers, targets, result contracts, and the
  task-by-task review workflow. Load when authoring or debugging delegation
  rules, when a gate steers, or when reviewing a completed task or spec through
  a delegated model.
---

# Delegation rules

The engine turns delegation into configuration: a **rule** names a **trigger**, an optional
**target**, an **instruction**, a result **contract**, and a **gate**. Codex is one target, not
an assumption; any registered `ctx.subagents` provider can be used. Tools and the gate are the
enforcement points; this skill is the authoring and workflow guide.

## Tools

- `delegate(rule, change?, task?, section?, context?, objective?)` runs one configured review
  rule. The `rule` enum is generated from the config, so an unknown rule is rejected with the
  allowed ids. Write the smallest useful `context` (failing output, files, constraints) and, when
  it matters, the `objective` the review checks the task against.
- `task_progress(task, status, reason)` records an explicit `in-progress`/`blocked` note for an
  unchecked task. It runs no model and costs nothing; with a profile `task-progress` rule it is the
  only non-tick way to close a code-changing turn.
- `delegation_status` lists providers/capabilities, targets, rules, each active change's
  involvement by this session, records, and active/stale notes, plus missing-target diagnostics.
  It never attributes a change.

Do not paste a delegation result as a "claim". Only a record written by the engine satisfies a
strict gate. For ad-hoc work outside the review runtime, use the first-party `subagent`,
`codex_subagent`, and `create_worktree` tools instead of a delegation rule.

## Session involvement

The gate applies only to changes the current session created or modified. The state is
per-session (`.dsh/delegation/sessions/<hash>.json`), not per-change, so two sessions can work
on one change without an exclusive owner.

- A successful first-party `edit`/`write` with a path under `openspec/changes/<change>/`
  attributes that change. A successful shell `openspec new change <name>` attributes it as
  created; a shell write under the change directory attributes it without task ids. A read,
  search, `delegation_status`, or `openspec list/show/status/validate` does not attribute.
- A `tasks.md` write attributes only the checkboxes it transitions, read from that write's own
  before/after contents. A checkbox-only tick is not a spec change; a substantive task-plan edit
  or a newly supplied `tasks.md` is. A brand-new change records created and spec-changed but does
  not import another session's checked tasks.
- `task_progress` and a review `delegate` attribute the change explicitly.
- Legacy `.dsh/delegation/owners/` files are ignored; do not rely on them.

A session with no involvement is not steered for the change. To opt in, edit the change or call
`task_progress` or a review `delegate`. `delegation_status` shows `this session: ...` or
`not involved`.

## Triggers

| Trigger | Fires when | Contract |
| --- | --- | --- |
| `manual` | No automatic condition; only `delegate` runs it. | `review` |
| `spec-ready` | A change this session created or whose spec artifacts it changed is review-ready and its whole-spec review has no matching PASS/ERROR for the current spec digest. | `review` scope `whole`, phase `spec` |
| `spec-task-ready` | A task this session checked has no task-review PASS/ERROR record. | `review` scope `task` |
| `implementation-work` | The turn changed implementation files in a change this session is involved in and has neither a newly checked-and-reviewed task nor a matching progress note for the current worktree digest. | `note` |
| `lane-assignment` | A readable `tasks.md` in a change this session is involved in has at least two non-serial lanes with tasks (a completed lane still counts), the turn ticked a task or changed implementation files, and an unassigned non-current lane with unchecked tasks names owned paths and has neither a tagged worker start nor a serial note. | `note` |
| `lane-boundary` (deprecated) | A task this session ticked in this turn completed the last unchecked task of a `tasks.md` lane, another non-`serial` lane with owned paths still has an unchecked task, and the turn started no parallel worker (`subagent`, `subagent_fork`, `spawn_teammate`, `workflow`). Satisfied by a worker start or by a matching progress note in a remaining lane. Kept for existing profiles; use `lane-assignment` for new rules. | `note` |
| `implementation-complete` | This session completed the change's task list and the optional integration review has no matching PASS/ERROR for the current worktree digest. | `review` scope `whole`, phase `integration` |

`manual` rules must use `gate: none`. `spec-*` and `implementation-complete` require `review` with
the matching scope; `implementation-work`, `lane-assignment`, and `lane-boundary` require `note`.
A lane is the numbered tasks under the nearest level-2 heading of `tasks.md`, its owned paths are
the backticked segments of that heading, and a heading containing `serial` is the integration tail
and never counts as remaining parallel work. The lane triggers fail open: no headings, a lane
without owned paths, an unreadable `tasks.md`, and a ticked task that no longer appears in it
report nothing. `lane-boundary` is deprecated and accepted only for existing profiles.

## Contracts

- **review** — computes a scope digest, runs the target with the bundled P0/P1 prompt, accepts
  exactly one fenced JSON verdict that echoes the digest, and writes an atomic record under
  `.dsh/delegation/<rule>/<change>/` (`<phase>.json` for whole scope, `tasks/<taskId>.json` for
  task scope, `sections/<hash>.json` for a section). A task-scope review reads a frozen worktree
  snapshot taken when the call is made (`add-snapshot-task-review`), so a write after it starts
  does not invalidate it; a whole-scope review keeps the live-input guard.
  `PASS` needs zero P0/P1 findings; `FINDINGS` and `ERROR` are reported but do not
  pass a strict gate. A matching `PASS` is reused without another run; a `FINDINGS` record is
  reused only while the digest is unchanged; an `ERROR` is retried. Any session may run a review:
  the call attributes the change to that session, the record names the reviewing session, and
  records stay workspace-global.
  A task-scope review also accepts `section`: the `tasks.md` level-2 heading number (`1`), its
  `1.x` form, the normalized title, or `untitled`. One run then reviews every checked task in that
  section with one prompt, one frozen snapshot, and one verdict, and publishes the existing
  per-task `reviews/<taskId>.json` approvals for each covered task. `task` and `section` are
  mutually exclusive; unchecked tasks are out of scope and are never approved; a newly checked
  task changes the section digest and needs a new section or task review. Every section finding
  names the affected task's number or text, so the one verdict is still actionable per task. A
  section `ERROR` writes an ERROR record for each covered task and publishes no approval.
- **note** — the `task_progress` note. See below.

## Review queue

A review `delegate` call returns a run id and record path before the target finishes; the run is
admitted through the profile's review queue, continues in the background, and writes its
digest-bound record when it settles. The turn can continue while it runs.

- `delegation_status` shows each run as queued or running, its queue position, and the record path
  it will publish; wait for that run instead of starting a duplicate review.
- A full waiting list refuses admission with `review queue full` and writes an `ERROR` record; let
  the current reviews settle, then start the review again.
- A queue-limit, timeout, or target failure settles as `ERROR`, so a turn can close with the failure
  visible and the cause named. Fix the cause and re-run; a matching `PASS` is reused without another
  run.
- `reviewQueue` controls `enabled`, `concurrency`, `maxQueued`, `maxAttempts`, and the backoff; the
  detailed contract is in the plugin documentation.

## Task-by-task workflow

This is the intended loop for an OpenSpec change:

1. Implement the smallest reviewable task.
2. Mark that task `[x]` in `tasks.md`.
3. Run `delegate(rule: "task-review", change: "<change>", task: "<task id>")` immediately after
   the tick. The gate names the explicit task id it wants; use it. Keep implementing an independent
   task while the run uses a frozen snapshot. When the run reports the live worktree, a write can
   discard its verdict: restore snapshot support and re-run, or defer writes until the run settles.
   No blocking sleep.
   For a group of related tasks, implement the whole `tasks.md` section, tick its tasks, then run
   `delegate(rule: "task-review", change: "<change>", section: "1")` once (or `section: "1.x"`, the
   normalized title, or `untitled`). The run covers every checked task in that section with one
   verdict and publishes one per-task approval each; unchecked tasks stay out of scope, and a task
   checked after the PASS needs a new section or task review.
4. Fix every P0/P1 finding and re-run until the record is `PASS`. A task- or section-scoped `PASS`
   is a historical snapshot: later tasks do not invalidate it.
5. If the turn must stop mid-task and a profile `task-progress` rule is configured, call
   `task_progress` for that task instead of ticking it. The note records the current worktree
   digest and authorizes the close only while it still matches.

The shipped defaults configure no `implementation-work` rule, so a code-changing turn is not
refused for an unticked task, and a default session may pause mid-task through the goal-continuity
`work-checkpoints` capability (one `work_checkpoint` call at the pause). A profile that configures
an `implementation-work` rule refuses a code-changing turn until a task was newly checked and
reviewed, or a fresh progress note matches the current worktree. Only the checked tasks this
session attributed are gated; another session's ticks are not imported. A checked task always
requires its review record, and a note never counts as a PASS. When that rule is configured,
ticking tasks in a batch at the end defeats the per-task chunk and is refused by the gate.

## Parallel writers

Two writers editing one checkout at the same time race on the same files and on the same worktree
digest. Before handing work to more than one write-capable agent at once:

- Name each writer's files. A writer may edit only the paths assigned to it; the assignment is part
  of the handoff, not left to inference.
- Isolate or serialize. If the file sets are disjoint and neither run reads the other's output, run
  them in parallel in separate worktrees. If they overlap, either serialize the writes in one
  checkout or give each its own worktree and merge after review.
- A writer that needs an isolated checkout uses `create_worktree` plus a write-capable `subagent`;
  no delegation contract provides isolation or applies a diff. This guidance applies to agents and
  teammates you start yourself.
- A single writer doing sequential work needs no worktree; adding one only makes the return path
  longer.

Triggers, records, and digests are unchanged by this section: it describes how to assign
write-capable work. The shipped strict `lane-fanout` rule makes the assignment happen at the first
unassigned lane; when it steers, start one tagged worker per reported lane before continuing, or
record the serial decision with one `task_progress` note per lane. The goal-continuity
`work-checkpoints` capability still owns the pause-time parallel decision and requires a
`work_checkpoint` call before the turn closes.

## Lane assignment

The shipped strict `lane-fanout` rule uses the `lane-assignment` trigger. It reports the lanes that
still need an owner on an implementation turn and stays quiet once each lane is assigned, serial,
current, or complete.

It fires only when all of these hold:

- `tasks.md` is readable and has at least two non-serial lanes with tasks; a completed lane still
  counts toward the threshold;
- the turn ticked a task or changed implementation files;
- an unassigned non-serial lane with unchecked tasks is not a lane this session ticked in the turn,
  names owned paths, and has neither a tagged worker start nor a serial note.

A plan with exactly one non-serial lane, or whose remaining work is a hot-file, generated-output, or
serial-gate lane (a heading containing `serial`), reports nothing.

- **Tagged worker call** — for each reported lane the steer prints one
  `subagent(description: "Lane: <title>", prompt: "lane-tag: <change>#<n>. ...")` call with the
  exact `lane-tag: <change>#<n>` in the prompt, `<n>` being the lane's 1-based position in
  `tasks.md`. The worker resolves the repository root, creates a sibling worktree and branch
  (`git worktree add ../wt-<change>-<n> -b lane-<change>-<n>`), works only inside the lane's owned
  paths, and does not tick `tasks.md`.
- **Session ledger** — per session, change, and lane. A successful `subagent`, `subagent_fork`,
  `spawn_teammate`, or `workflow` start whose arguments contain the exact tag assigns that lane; an
  untagged, failed, or unrelated start assigns nothing. The lane this session ticked in the turn is
  current and is never stored. A lane that disappears, completes, or is renamed loses its decision,
  and a Host restart clears the ledger.
- **Per-lane serial escape** — one `task_progress` note marks only one lane serial and leaves the
  others gated. Name the work constraint in its reason: a shared hot file, generated output, or a
  serial gate. The task-review or archive process is not a work constraint.
- **Worker-assigned checkpoint lanes** — when a task lane was assigned to a tagged worker, the
  matching `continue` checkpoint lane that covers the work MUST name an owner other than `lead`. A
  bottleneck whose targets fall inside that lane MUST use `worker_start` or `user_decision`;
  `lead_action` is refused. A missing checkpoint lane for a worker-assigned task lane is refused and
  the steer names the lane; an unreadable checkpoint or task-lane plan fails open.
- **Fail-open** — an unreadable `tasks.md`, a plan without level-2 headings, an unassigned lane
  without owned paths, and a turn with no tick or implementation change report nothing.

`lane-boundary` is deprecated: it is still accepted for existing profiles with its completion
boundary behavior, but new rules use `lane-assignment`.

## Default rules

| Rule | Trigger | Contract | Gate |
| --- | --- | --- | --- |
| `spec-review` | `spec-ready` | review, whole, phase `spec` | strict |
| `task-review` | `spec-task-ready` | review, task | strict |
| `integration-review` | `implementation-complete` | review, whole, phase `integration` | soft |
| `lane-fanout` | `lane-assignment` | note | strict |

The shipped set includes the strict `lane-fanout` rule and intentionally omits an automatic
`task-progress` rule. The `implementation-work` and `lane-assignment` triggers and the `note`
contract remain available to profile rules; the deprecated `lane-boundary` alias still works for
existing profiles, and the goal-continuity `work-checkpoints` capability owns the pause-time
progress and parallel decision and requires a `work_checkpoint` call at each substantial pause.

The shipped default target is the installed-Codex provider and selects `gpt-6-astra` at `xhigh` for
the `codex` target. Targets are data: override `targets` and `rules` in the profile's
`cordis.patch.yml` (a patch replaces the whole config object). A non-Codex target looks like this:

```yaml
targets:
  dsh:
    provider: spawn
    model: deepseek-flash
rules:
  - id: spec-review
    when: spec-ready
    to: dsh
    contract: review
    phase: spec
    scope: whole
    gate: strict
    instruction: bundled:review-spec
```

`provider` is the registered subagent provider; `model`, `reasoningEffort`, and `agentOptions`
are passed only when the provider declares `agentOptions` support, otherwise the target is
rejected with the capability error. Removed configuration fails load with its replacement named:
`contract: answer` and `contract: patch`, `when: failure-streak`, `isolation`, `failureStreak`, a
target `write`, and the `reviewLearning` block are rejected.

## Authoring rules

- Rule and target ids are kebab-case and unique. A `delegate` rule id is the record directory.
- `instruction` is `bundled:<asset>` for one of the shipped prompts or inline text.
- A whole-scope review needs a kebab-case `phase`; a task-scoped review must not have one.
- Do not duplicate a strict gate for the same trigger/scope/phase: one record cannot satisfy two
  strict rules, so the config is rejected.
- New triggers or contracts are a code extension, not configuration. Use the documented
  vocabulary.
- For ad-hoc delegation outside the review runtime, call `subagent` (provider, model, effort) or
  `codex_subagent`, and `create_worktree` for an isolated checkout; no rule contract does either.

## Failure and opt-out

A strict gate keeps steering until a matching `PASS`/`ERROR` record exists; a target failure
writes an `ERROR` record so the turn can close with the failure visible. A soft rule steers once
per turn. The only bypass is disabling or removing the `dsh-setup-delegation-rules` row; records,
notes, snapshots, and change artifacts remain. No in-session phrase bypasses an active gate.

## Cost and security

Reviews consume the target's tokens and subscription; the progress note does not. Per-task reviews
multiply runs, so keep tasks small and sized for one review; set the optional integration review to
`soft` or `none` if it adds noise. The shipped `codex` target selects `gpt-6-astra` at `xhigh`, so
every default review pays for the strong model; override the target for cheaper routine reviews.
The engine never starts a target from the turn-stopping listener, uses fixed-argument git calls with
no shell, and treats target output as untrusted data: only the declared fenced verdict is parsed
and nothing is executed. Records and notes are redacted of machine paths and obvious credentials.
Session involvement files are local scratch under `.dsh/` and are never committed. Records are a
process-integrity check, not anti-forgery: a model with full filesystem access could write a
record-shaped file.

## Troubleshooting

- **"target ... is not registered"** — install/enable that provider, or repoint the rule in the
  profile config; `delegation_status` reports each configured target as available or MISSING.
- **"does not support model/agent options"** — remove `model`/`reasoningEffort`/`agentOptions`
  from the target or use a provider with `agentOptions` capability.
- **"the answer contract was removed" / "the patch contract was removed"** — use `subagent` or
  `codex_subagent` and `create_worktree`; no delegation contract provides those paths.
- **"verdict digest does not match"** — the target answered about a different revision; re-run
  on the current artifacts.
- **"no fenced JSON verdict"** — the target returned prose or a malformed block; an `ERROR`
  record was written, so the gate can close with the failure visible.
- **The gate keeps steering** — a strict rule has no matching record for the current digest;
  run the exact `delegate` call in the steer message (it names the task id for a task review),
  or check the record path it names.
- **A change is not attributed** — the session never wrote to it or called an explicit tool, or
  the write used a tool or shell form the engine does not parse. Run `task_progress` or a
  review `delegate` to opt in. Legacy `.dsh/delegation/owners/` files are ignored.
- **A note is stale** — the worktree changed after the note; refresh the note or tick the task
  and run its review.
