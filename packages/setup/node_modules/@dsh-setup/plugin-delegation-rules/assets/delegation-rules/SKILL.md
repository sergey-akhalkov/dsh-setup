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

- `delegate(rule, change?, context?, objective?)` runs one configured rule. The `rule` enum is
  generated from the config, so an unknown rule is rejected with the allowed ids. Write the
  smallest useful `context` (failing output, files, constraints); `objective` is required for
  the patch contract.
- `task_progress(task, status, reason)` records an explicit `in-progress`/`blocked` note for an
  unchecked task. It runs no model, costs nothing, and is the only non-tick way to close a
  code-changing turn.
- `delegation_status` lists providers/capabilities, targets, rules, records, and active/stale
  notes, plus missing-target diagnostics.

Do not paste a delegation result as a "claim". Only a record written by the engine satisfies a
strict gate.

## Triggers

| Trigger | Fires when | Typical contract |
| --- | --- | --- |
| `manual` | No automatic condition; only `delegate` runs it. | `answer`, `patch` |
| `spec-ready` | An active, review-ready change exists and the whole-spec review has no matching PASS/ERROR for the current spec digest. | `review` scope `whole`, phase `spec` |
| `spec-task-ready` | A checked task in `tasks.md` has no task-review PASS/ERROR record. | `review` scope `task` |
| `implementation-work` | The turn changed implementation files and has neither a newly checked-and-reviewed task nor a matching progress note for the current worktree digest. | `note` |
| `implementation-complete` | Every task is checked and the optional integration review has no matching PASS/ERROR for the current worktree digest. | `review` scope `whole`, phase `integration` |
| `failure-streak` | The configured number of consecutive failed tool calls has no intervening success and no consultation attempt for that streak. | `answer` (soft) |

`manual` rules must use `gate: none`. `failure-streak` rules must not be `strict` (an `answer`
writes no record). `spec-*` and `implementation-complete` require `review` with the matching
scope; `implementation-work` requires `note`.

## Contracts

- **review** — computes a scope digest, runs the target with the bundled P0/P1 prompt, accepts
  exactly one fenced JSON verdict that echoes the digest, and writes an atomic record under
  `.dsh/delegation/<rule>/<change>/` (`<phase>.json` for whole scope, `tasks/<taskId>.json` for
  task scope). `PASS` needs zero P0/P1 findings; `FINDINGS` and `ERROR` are reported but do not
  pass a strict gate. A matching `PASS` is reused without another run; a `FINDINGS` record is
  reused only while the digest is unchanged; an `ERROR` is retried.
- **answer** — read-only prompt for a blocker or research question; returns the answer with
  evidence and, for research, sources. Writes no gate record. A failed answer is reported and
  marks a consultation attempt so a soft failure-streak rule does not loop.
- **patch** — runs a write-capable target in an isolated git worktree under
  `.dsh/delegation/worktrees/`, returns the changed files, diff, and the target's test report,
  and never applies the diff to the session worktree. The target must be declared
  `write: true`.
- **note** — the `task_progress` note. See below.

## Task-by-task workflow

This is the intended loop for an OpenSpec change:

1. Implement the smallest reviewable task.
2. Mark that task `[x]` in `tasks.md`.
3. Run `delegate(rule: "task-review", change: "<change>")` immediately, before starting the
   next task.
4. Fix every P0/P1 finding and re-run until the record is `PASS`. A task-scoped `PASS` is a
   historical snapshot: later tasks do not invalidate it.
5. If the turn must stop mid-task, call `task_progress` for that task instead of ticking it.
   The note records the current worktree digest and authorizes the close only while it still
   matches.

The gate refuses a code-changing turn unless a task was newly checked and reviewed, or a fresh
progress note matches the current worktree. A checked task always requires its review record;
a note never counts as a PASS. Ticking tasks in a batch at the end defeats the per-task chunk
and is refused by the gate.

## Default rules

| Rule | Trigger | Contract | Gate |
| --- | --- | --- | --- |
| `spec-review` | `spec-ready` | review, whole, phase `spec` | strict |
| `task-review` | `spec-task-ready` | review, task | strict |
| `task-progress` | `implementation-work` | note | strict |
| `blocker` | `failure-streak` | answer | soft |
| `research` | `manual` | answer | none |
| `bug-fix` | `manual` | patch | none |
| `integration-review` | `implementation-complete` | review, whole, phase `integration` | soft |

The shipped defaults target the installed-Codex provider. They are data: override `targets` and
`rules` in the profile's `cordis.patch.yml` (a patch replaces the whole config object). A
non-Codex target looks like this:

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
integration review to `soft` or `none` if it adds noise. The engine never starts a target from
the turn-stopping listener, uses fixed-argument git calls with no shell, and treats target output
as untrusted data: only the declared fenced verdict is parsed and nothing is executed. Records
and notes are redacted of machine paths and obvious credentials. Records are a process-integrity
check, not anti-forgery: a model with full filesystem access could write a record-shaped file.

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
  run the exact `delegate` call in the steer message, or check the record path it names.
- **A note is stale** — the worktree changed after the note; refresh the note or tick the task
  and run its review.
