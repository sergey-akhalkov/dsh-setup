# Review approval

This page is the repository-level approval boundary for OpenSpec changes: a change is archived,
pushed, or merged only when every checked task carries a committed task-review `PASS`. The engine
that produces and evaluates the records is described in
[delegation-rules.md](delegation-rules.md); this page is the repository rule and its enforcement.

## The approval rule

- A checked numbered `tasks.md` task is approved only by a committed
  `openspec/changes/<change>/reviews/<taskId>.json` task-review `PASS` whose `rule`, `change`,
  `taskId`, and `verdict` match and whose findings are empty.
- `ERROR`, `FINDINGS`, a missing or malformed record, and a checked line that is not a numbered task
  are not approval. Unchecked tasks are reported but not required.
- The task id is `sha256(<whitespace-normalized task text>)` truncated to 16 hex characters, so
  editing a checked task's text loses its approval and requires a re-review.
- The engine computes approval from the change, independent of which session ticked a task. A
  session whose tick makes the task list fully checked must obtain a `PASS` for every checked task;
  before completion each writer only reviews its own ticked tasks. An `ERROR` record can still close
  a turn with the failure visible, but it never approves an archive or a push.

## The portable record

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

The record carries only those sanitized fields: no session id, run id, machine path, or error text.
The engine writes it atomically **before** the local `.dsh` record is published, so a failed write
publishes no `PASS`. The local `.dsh` record stays the turn-gate state; the committed record is the
approval that travels with the change into `archive/` and that a fresh clone can audit without local
state. `reviews/` is excluded from the change artifact digest and the reviewed change-artifact
inputs, so an approval written later never stales the whole-spec review it was produced under.

A task review that runs in a worktree writes the record into that worktree's change; merging the
branch carries the approval into the main workspace. A `PASS` that exists only under `.dsh` is not
visible from another clone: run `pnpm reviews:export --change <name>` once for a change reviewed
before the portable write was installed. The export copies only a local task-scope `PASS` whose rule,
change, and task id match; it refuses `ERROR`/`FINDINGS`, a foreign change, and a task-id mismatch,
and it cannot invent an approval.

## Audit commands

```sh
pnpm reviews:check --change <name>   # one active change
pnpm reviews:check --all             # every archived change, cutoff and exception reported
pnpm reviews:check --push            # the archived changes a push adds or modifies (stdin refs)
pnpm reviews:export --change <name>  # copy existing local .dsh PASS records into the change
pnpm hooks:install                   # select the checked-in .githooks as core.hooksPath
```

Each audit prints the per-change coverage and names every gap with its exact review call:

```text
add-goal-block-review: task-review PASS 0/17, ERROR 0, missing 17; archive-ready: no
  missing 1.1 "Extend ..." -> delegate(rule: "task-review", change: "add-goal-block-review", task: "<id>")
  record: openspec/changes/add-goal-block-review/reviews/<id>.json
```

`archive-ready` is `yes` only when every checked task has a matching `PASS`. `--all` reports the
marker's exception and the pre-cutoff historical baseline without enforcing either; a post-cutoff
archive, or a later modification of any archive, is checked under the normal rule. `--push` reads
the pre-push refs from stdin, audits the archived changes added or modified by those commits (from
the pushed commit tree, not the working directory, including deletions and merge diffs), and fails
closed with `pnpm reviews:check --all` when it cannot determine the range or read the evidence.

## The marker and the opt-in boundary

A repository opts in with a tracked `openspec/review-approval.json`:

```json
{
  "version": 1,
  "archiveGate": true,
  "taskRule": "task-review",
  "cutoff": "v0.12.0",
  "grandfathered": { "<change>": "<why it is reported, not enforced>" }
}
```

`taskRule` must name a configured strict task-scoped review rule. `cutoff` names the tag before
which archives are the historical baseline. `grandfathered` lists changes that are reported as an
explicit exception. Without the marker, or with `"archiveGate": false`, nothing changes: the plugin
is global, and a workspace that did not opt in keeps its archive behavior. A malformed marker, an
unreadable `tasks.md`/record, or a `taskRule` that is missing, not task-scoped, or not strict refuses
the archive with the cause (fail closed).

The repository's own marker sets the `v0.12.0` cutoff and grandfathers the three v0.12.0 changes;
[openspec-status.md](openspec-status.md) records the post-hoc integration review `PASS` and the
`review-v0-12-0` fixes evidence. `pnpm reviews:check --all` prints both the exception and the
pre-cutoff baseline.

## The archive gate

With `archiveGate: true`, the delegation engine's `tools/pre-execute` guard recognizes:

- `openspec archive <change>` (also through `pnpm exec`/`npx`);
- `mv`, `Move-Item`, or `git mv` whose sources are active change directories and whose destination
  is under `openspec/changes/archive/` — every source of a multi-source move is evaluated.

It refuses the command **before** it runs, listing every missing task (number, text, task id), the
expected record path, and the exact `delegate` calls; the change remains active, so nothing has to be
restored. It applies to subagents too (only the turn-stopping gate skips them). On success it lets
the command run unchanged. It is a guard, not a sandbox: a deliberately obfuscated move can archive
locally, and the push audit is the backstop for that.

## Push and CI

`.githooks/pre-push` is checked in and selected by `pnpm hooks:install`
(`git config core.hooksPath .githooks`). It runs `pnpm reviews:check --push`; a missing approval
refuses the push and names the change, the commit, the missing tasks, and the review calls. If the
hook cannot determine the pushed range or find `pnpm`, it fails closed with
`pnpm reviews:check --all` as the manual command. A hook can be skipped with `git push --no-verify`,
and the hook does not cover an archive form the guard and the push audit do not recognize.

Both CI workflows (`.github/workflows/validate.yml` and `release.yml`) run
`pnpm reviews:check --all` on `windows-latest` with full git history and tags, so the merge gate
catches an archive a `--no-verify` push let through. The full local check is:

```sh
pnpm reviews:check --all
```

## Known limits

- The guard recognizes the documented archive forms only; another spelling archives locally and is
  caught by the push audit, not before the move.
- The pre-push hook is a local convenience; `--no-verify`, a missing hook, or a Git client without
  `pnpm` on `PATH` relies on CI, which is the remote boundary.
- Records are process integrity, not anti-forgery: a model with filesystem access can write a
  record-shaped file, exactly as it can write a `.dsh` record. The audit checks that the record is
  well formed, identifies its change and task, and is committed with the change.
- The archive gate is live only after the setup release is installed in the workspace; before that,
  `pnpm reviews:check` and the pre-push hook are the enforcement.
