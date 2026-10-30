---
name: delegation-rules
description: >
  Delegation rules: authored triggers, targets, result contracts, and the
  task-by-task review workflow. Load when authoring or debugging delegation
  rules, when a gate steers, when reviewing a completed task or spec, or when
  consulting, researching, or patching through a delegated model.
---

# Delegation rules

The engine turns delegation into configuration: a **rule** names a **trigger**, an optional
**target**, an **instruction**, a result **contract**, and a **gate**. Codex is one target, not
an assumption; any registered `ctx.subagents` provider can be used. Tools and the gate are the
enforcement points; this skill is the authoring and workflow guide.

## Tools

- `delegate(rule, change?, task?, context?, objective?)` runs one configured rule. The `rule`
  enum is generated from the config, so an unknown rule is rejected with the allowed ids. Write
  the smallest useful `context` (failing output, files, constraints); for `advisor`, pass the
  exact question, constraints, and decisive evidence. `objective` is required for the patch
  contract.
- `task_progress(task, status, reason)` records an explicit `in-progress`/`blocked` note for an
  unchecked task. It runs no model, costs nothing, and is the only non-tick way to close a
  code-changing turn.
- `delegation_status` lists providers/capabilities, targets, rules, each active change's
  involvement by this session, records, and active/stale notes, plus missing-target diagnostics.
  It never attributes a change.

Do not paste a delegation result as a "claim". Only a record written by the engine satisfies a
strict gate.

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
- `task_progress` and a review or patch `delegate` attribute the change explicitly; an `answer`
  `delegate` does not, even with a `change` argument.
- Legacy `.dsh/delegation/owners/` files are ignored; do not rely on them.

A session with no involvement is not steered for the change. To opt in, edit the change or call
`task_progress` or a review/patch `delegate`. `delegation_status` shows `this session: ...` or
`not involved`.

## Triggers

| Trigger | Fires when | Typical contract |
| --- | --- | --- |
| `manual` | No automatic condition; only `delegate` runs it. | `answer`, `patch` |
| `spec-ready` | A change this session created or whose spec artifacts it changed is review-ready and its whole-spec review has no matching PASS/ERROR for the current spec digest. | `review` scope `whole`, phase `spec` |
| `spec-task-ready` | A task this session checked has no task-review PASS/ERROR record. | `review` scope `task` |
| `implementation-work` | The turn changed implementation files in a change this session is involved in and has neither a newly checked-and-reviewed task nor a matching progress note for the current worktree digest. | `note` |
| `lane-boundary` | A task this session ticked in this turn completed the last unchecked task of a `tasks.md` lane, another non-`serial` lane with owned paths still has an unchecked task, and the turn started no parallel worker (`subagent`, `subagent_fork`, `spawn_teammate`, `workflow`). Satisfied by a worker start or by a matching progress note in a remaining lane. | `note` |
| `implementation-complete` | This session completed the change's task list and the optional integration review has no matching PASS/ERROR for the current worktree digest. | `review` scope `whole`, phase `integration` |
| `failure-streak` | The configured number of consecutive failed tool calls has no intervening success and no consultation attempt for that streak. | `answer` (soft) |

`manual` rules must use `gate: none`. `failure-streak` rules must not be `strict` (an `answer`
writes no record). `spec-*` and `implementation-complete` require `review` with the matching
scope; `implementation-work` and `lane-boundary` require `note`. A lane is the numbered tasks under
the nearest level-2 heading of `tasks.md`, its owned paths are the backticked segments of that
heading, and a heading containing `serial` is the integration tail and never counts as remaining
parallel work. The trigger fails open: no headings, a lane without owned paths, an unreadable
`tasks.md`, and a ticked task that no longer appears in it report nothing.

## Contracts

- **review** — computes a scope digest, runs the target with the bundled P0/P1 prompt, accepts
  exactly one fenced JSON verdict that echoes the digest, and writes an atomic record under
  `.dsh/delegation/<rule>/<change>/` (`<phase>.json` for whole scope, `tasks/<taskId>.json` for
  task scope). A task-scope review reads a frozen worktree snapshot taken when the call is made
  (`add-snapshot-task-review`), so a write after it starts does not invalidate it; a whole-scope
  review keeps the live-input guard.
  `PASS` needs zero P0/P1 findings; `FINDINGS` and `ERROR` are reported but do not
  pass a strict gate. A matching `PASS` is reused without another run; a `FINDINGS` record is
  reused only while the digest is unchanged; an `ERROR` is retried. Any session may run a review:
  the call attributes the change to that session, the record names the reviewing session, and
  records stay workspace-global.
- **answer** — read-only prompt for a blocker, research, or advisor question; returns the answer
  with evidence and, for research, sources, and, for an advisor, a recommendation, the strongest
  counterargument, risks, a next action, and confidence. Writes no gate record. A failed answer is
  reported and marks a consultation attempt so a soft failure-streak rule does not loop.
- **patch** — runs a write-capable target in an isolated git worktree under
  `.dsh/delegation/worktrees/`, returns the changed files, diff, and the target's test report,
  and never applies the diff to the session worktree. The target must be declared
  `write: true`.
- **note** — the `task_progress` note. See below.

## Task-by-task workflow

This is the intended loop for an OpenSpec change:

1. Implement the smallest reviewable task.
2. Mark that task `[x]` in `tasks.md`.
3. Run `delegate(rule: "task-review", change: "<change>", task: "<task id>")` immediately, before
   starting the next task. The gate names the explicit task id it wants; use it.
4. Fix every P0/P1 finding and re-run until the record is `PASS`. A task-scoped `PASS` is a
   historical snapshot: later tasks do not invalidate it.
5. If the turn must stop mid-task, call `task_progress` for that task instead of ticking it.
   The note records the current worktree digest and authorizes the close only while it still
   matches.

The gate refuses a code-changing turn unless a task was newly checked and reviewed, or a fresh
progress note matches the current worktree. Only the checked tasks this session attributed are
gated; another session's ticks are not imported. A checked task always requires its review
record; a note never counts as a PASS. Ticking tasks in a batch at the end defeats the per-task
chunk and is refused by the gate.

## Parallel writers

Two writers editing one checkout at the same time race on the same files and on the same worktree
digest. Before handing work to more than one write-capable agent at once:

- Name each writer's files. A writer may edit only the paths assigned to it; the assignment is part
  of the handoff, not left to inference.
- Isolate or serialize. If the file sets are disjoint and neither run reads the other's output, run
  them in parallel in separate worktrees. If they overlap, either serialize the writes in one
  checkout or give each its own worktree and merge after review.
- The patch contract already runs its target in an isolated worktree, so a `bug-fix` delegation
  needs no extra setup; this guidance applies to agents and teammates you start yourself.
- A single writer doing sequential work needs no worktree; adding one only makes the return path
  longer.

Triggers, records, and digests are unchanged by this section: it describes how to assign
write-capable work. The `lane-fanout` rule is what makes the assignment happen at a lane boundary;
when it steers, start one worker per remaining lane before continuing, or record the serial
decision with `task_progress`.

## Default rules

| Rule | Trigger | Contract | Gate |
| --- | --- | --- | --- |
| `spec-review` | `spec-ready` | review, whole, phase `spec` | strict |
| `task-review` | `spec-task-ready` | review, task | strict |
| `task-progress` | `implementation-work` | note | strict |
| `lane-fanout` | `lane-boundary` | note | strict |
| `blocker` | `failure-streak` | answer | soft |
| `research` | `manual` | answer | none |
| `advisor` | `manual` | answer | none |
| `bug-fix` | `manual` | patch | none |
| `integration-review` | `implementation-complete` | review, whole, phase `integration` | soft |

The shipped defaults target the installed-Codex provider and select `gpt-6-astra` at `xhigh` for
`codex` and `codex-write`; `codex-astra` is the explicit strong target the advisor uses. They are
data: override `targets` and `rules` in the profile's `cordis.patch.yml` (a patch replaces the
whole config object). A non-Codex target looks like this:

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
rejected with the capability error.

## When to consult the advisor

`advisor` is a manual, read-only second opinion, not a gate. Use it only when the decision is
expensive to reverse, security or data integrity is at stake, the design spans modules, or two
attempts have failed and the next step is unclear. Do not use it for routine edits, syntax,
lookups, or facts you can verify locally. One well-framed question per call, with constraints and
decisive evidence; at most three advisor calls per session. An advisor answer writes no record and
never satisfies a review.

## Authoring rules

- Rule and target ids are kebab-case and unique. A `delegate` rule id is the record directory.
- `instruction` is `bundled:<asset>` for one of the shipped prompts or inline text.
- A whole-scope review needs a kebab-case `phase`; a task-scoped review must not have one.
- A patch rule needs `isolation: worktree` and a target with `write: true`.
- Do not duplicate a strict gate for the same trigger/scope/phase: one record cannot satisfy two
  strict rules, so the config is rejected.
- New triggers or contracts are a code extension, not configuration. Use the documented
  vocabulary.

## Failure and opt-out

A strict gate keeps steering until a matching `PASS`/`ERROR` record exists; a target failure
writes an `ERROR` record so the turn can close with the failure visible. A soft rule steers once
per streak and a failed consultation does not trap the turn. The only bypass is disabling or
removing the `dsh-setup-delegation-rules` row; records, notes, worktrees, and change artifacts
remain. No in-session phrase bypasses an active gate.

## Cost and security

Reviews and answers consume the target's tokens and subscription; the progress note does not.
Per-task reviews multiply runs, so keep tasks small and sized for one review; set the optional
integration review to `soft` or `none` if it adds noise. The shipped `codex` and `codex-write`
targets select `gpt-6-astra` at `xhigh`, so every default Codex rule pays for the strong model;
override those targets for cheaper routine reviews and leave `advisor` on `codex-astra`. The
engine never starts a target from the turn-stopping listener, uses fixed-argument git calls with
no shell, and treats target output as untrusted data: only the declared fenced verdict is parsed
and nothing is executed. Records and notes are redacted of machine paths and obvious credentials.
Session involvement files are local scratch under `.dsh/` and are never committed. Records are a
process-integrity check, not anti-forgery: a model with full filesystem access could write a
record-shaped file.

## Troubleshooting

- **"target ... is not registered"** — install/enable that provider, or repoint the rule in the
  profile config; `delegation_status` lists the registered providers.
- **"does not support model/agent options"** — remove `model`/`reasoningEffort`/`agentOptions`
  from the target or use a provider with `agentOptions` capability.
- **"verdict digest does not match"** — the target answered about a different revision; re-run
  on the current artifacts.
- **"no fenced JSON verdict"** — the target returned prose or a malformed block; an `ERROR`
  record was written, so the gate can close with the failure visible.
- **The gate keeps steering** — a strict rule has no matching record for the current digest;
  run the exact `delegate` call in the steer message (it names the task id for a task review),
  or check the record path it names.
- **A change is not attributed** — the session never wrote to it or called an explicit tool, or
  the write used a tool or shell form the engine does not parse. Run `task_progress` or a
  review/patch `delegate` to opt in. Legacy `.dsh/delegation/owners/` files are ignored.
- **A note is stale** — the worktree changed after the note; refresh the note or tick the task
  and run its review.
