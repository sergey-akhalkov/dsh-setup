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
- When the marker declares a reviewer, the record's `target.provider` must match and, when declared,
  so must `target.model`. A mismatch is an approval error whose detail names the expected and actual
  values; it is not a missing record. The live archive gate, the live task gate, `delegation_status`,
  and every `pnpm reviews:check` mode apply the same binding. A marker without the fields keeps the
  previous provider-agnostic behavior.
- A cached local record is reused only when its target matches the declared reviewer. A record from
  another provider is treated as unreviewed, so `nextTaskForReview` selects that task and the
  prescribed `delegate` call starts the required reviewer instead of returning the old `PASS`.

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
pnpm reviews:check --staged          # the archived changes this commit stages
pnpm reviews:export --change <name>  # copy existing local .dsh PASS records into the change
pnpm hooks:install                   # select the checked-in .githooks as core.hooksPath (once per clone)
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
`--staged` reads `git diff --cached --name-status` and audits every archived change the index adds,
modifies, copies, or renames into `openspec/changes/archive/`; a commit that stages no archive path
passes without an archive audit, and an unreadable staged range or unreadable evidence fails closed
with the same `pnpm reviews:check --all` hint. It reads the worktree, so an index-only edit that has
no worktree file is reported as unreadable and the committed audit remains the authority.

## The marker and the opt-in boundary

A repository opts in with a tracked `openspec/review-approval.json`:

```json
{
  "version": 1,
  "archiveGate": true,
  "taskRule": "task-review",
  "reviewerProvider": "codex-subagent",
  "reviewerModel": "<optional model pin>",
  "cutoff": "v0.12.0",
  "grandfathered": { "<change>": "<why it is reported, not enforced>" }
}
```

`taskRule` must name a configured strict task-scoped review rule. `reviewerProvider` and
`reviewerModel` pin the reviewer identity: a record whose `target.provider` (and, when declared,
`target.model`) differs is unapproved, and the detail names both values. Both fields are optional;
omitting them keeps the provider-agnostic behavior for standalone and other repositories. `cutoff`
names the tag before which archives are the historical baseline. `grandfathered` lists changes that
are reported as an explicit exception. Without the marker, or with `"archiveGate": false`, nothing
changes: the plugin is global, and a workspace that did not opt in keeps its archive behavior. A
malformed marker, an unreadable `tasks.md`/record, or a `taskRule` that is missing, not task-scoped,
or not strict refuses the archive with the cause (fail closed).

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

When `delegation.gates.workflowOwned` is `false`, this legacy guard does not run. The workflow
`task-review` definition (`own`) then owns the same four command forms through its pre-execute
archive gate and reads the same `reviews/<taskId>.json` portable PASS records, including the
marker's reviewer binding; the refusal names the missing tasks and the review calls. The legacy
switch and the definition flip are one config change, and the tracked parity report
(`assets/parity/retire-legacy-gates.json`) covers the four move forms before either ships.
Rollback is the reverse pair: `gates.workflowOwned: true` and the definition back to `defer`.

## Hooks, push, and CI

Two tracked hooks live in `.githooks/`, and `pnpm hooks:install` selects the directory by setting this
repository's local `core.hooksPath` (`.githooks`). Run it **once per clone**: the hook files are
tracked, but the Git configuration that activates them is local, so a fresh clone has no active hooks
until that command runs. The installer checks that both hook files exist and reports the local
configuration it wrote.

- `.githooks/pre-commit` runs `pnpm reviews:check --staged`, so a manual move, an editor rename, or a
  `run_code` move into `changes/archive/` is audited before the commit exists.
- `.githooks/pre-push` runs `pnpm reviews:check --push`; a missing approval refuses the push and names
  the change, the commit, the missing tasks, and the review calls.

If a hook cannot find `pnpm`, determine the range, or read the evidence, it fails closed with
`pnpm reviews:check --all` as the manual command. A hook can be skipped with `--no-verify`
(`git commit --no-verify`, `git push --no-verify`): that bypass is visible only locally and the
pre-push/CI audit still checks the committed tree, so it is a convenience, not an approval.

Both CI workflows (`.github/workflows/validate.yml` and `release.yml`) run
`pnpm reviews:check --all` on `windows-latest` with full git history and tags, so the merge gate
catches an archive a `--no-verify` commit or push let through. The full local check is:

```sh
pnpm reviews:check --all
```

## Known limits

- The guard recognizes the documented archive forms only; another spelling archives locally and is
  caught by the pre-commit staged audit, the push audit, or CI, not before the move.
- The hooks are local conveniences; a missing hook, `--no-verify`, or a Git client without `pnpm` on
  `PATH` relies on CI, which is the remote boundary.
- Records are process integrity, not anti-forgery: a model with filesystem access can write a
  record-shaped file, exactly as it can write a `.dsh` record. The reviewer binding and the audits
  check that the record is well formed, identifies its change and task, and names the configured
  reviewer; a hand-written `codex-subagent` `PASS` still passes. Signed records or CI attestation are
  a different threat model and are out of scope; branch protection and CI are the remote boundary.
- The archive gate is live only after the setup release is installed in the workspace; before that,
  `pnpm reviews:check` and the hooks are the enforcement.
