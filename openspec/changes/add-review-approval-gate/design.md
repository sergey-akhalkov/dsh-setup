# Design

## Context

See [proposal.md](proposal.md) for the v0.12.0 incident. The current engine records reviews only
under the workspace-local `.dsh/delegation/` tree, and its turn-stopping gate requires a review only
for the checked tasks this session attributed (`entry.tasks`). A shell tick or a subagent session
therefore leaves `tasks: []`; the archive skill moves the change with a plain `mv`; git has no review
check. The accepted [session-scoped trigger
requirement](../../specs/delegation-rules/spec.md#L700) is deliberate protection for parallel
writers and stays; the missing piece is a change-level boundary that reads the artifact instead of the
session.

The repository runs one DSH profile whose plugin is shipped through `@dsh-setup/setup`. The plugin is
global; this design must not change archive behavior in workspaces that did not opt in. The user
decided: portable records in the change, only checked tasks, an explicit v0.12.0 exception, and this
OpenSpec change.

## Goals / Non-Goals

**Goals:**

- A checked task is approved only by a task-review `PASS` that travels with the change.
- Approval is computed from the change's `tasks.md` and the committed records, independent of which
  session ticked what.
- The archive operation is refused before it runs in an opted-in workspace; a push of an unapproved
  archive is refused before it leaves the machine; CI repeats the check.
- The completion turn is steered when a session's tick finishes the task list without all approvals.
- The v0.12.0 three and the pre-cutoff historical archives are visible and auditable, not silently
  accepted.

**Non-Goals:**

- No per-task backfill of the three v0.12.0 changes or the pre-cutoff historical archives; both are
  reported, not rewritten.
- No change to the `integration-review` rule (it stays soft) and no new trigger vocabulary.
- No cryptographic signature or anti-forgery guarantee; the records are process integrity, the same
  trust model as today's `.dsh` records.
- No edit to the vendored `openspec-archive-change` skill; its operation guidance is the extension
  point.
- No turn-stop fallback that scans for archives made through unrecognized move forms; it would steer
  unrelated parallel sessions. The push check is the backstop there.
- No gate on repositories without the opt-in marker.

## Decisions

### D1. Portable approval record inside the change

Every task-review `PASS` writes a second, sanitized record at
`openspec/changes/<change>/reviews/<taskId>.json`, in addition to the local `.dsh` record. The local
record remains the turn gate and status source; the portable record is the approval that is committed
with the change and moves into `archive/` with it.

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

The record has no session id, run id, or machine path. It is written atomically before the `PASS` is
published; a failed portable write makes the run an `ERROR` and publishes no `PASS`. The change
artifact digest and the reviewed change-artifact inputs exclude `reviews/` (alongside
`.openspec.yaml`), so a task approval can never invalidate the whole-spec review it was reviewed
against. The directory name is reserved: a file under `reviews/` that is not a valid task record is
ignored by the digest, not treated as an artifact.

Alternatives considered: local `.dsh` only (rejected: a worktree review's PASS is stranded and the
2026-10-29 home wipe lost local state); an archive-time manifest generated from `.dsh` (rejected: a
review that ran in a worktree still has to be exported before the archive, and the manifest is
written later than the approval); committing `.dsh` (rejected: it contains sessions and is local
scratch).

### D2. Change-level coverage over checked tasks

The engine computes approval from the change, not from session involvement:

```text
checked = numbered [x] tasks in tasks.md
for each checked task:
  record = reviews/<taskId>.json
  approved iff record exists, is well formed, identifies this change/task,
               verdict == PASS, findings empty, and rule is the marker's strict task rule
unchecked tasks are reported but not required
```

A checked line that does not parse as a numbered task fails closed: the engine cannot prove what was
done. A task whose text is edited gets a new `taskId` and loses its approval. The status and audit
report `PASS`, `ERROR`, and `missing` separately; only `PASS` is approval. The existing turn gate may
still close a turn with an `ERROR` record (so a failed target does not trap the session); the archive
and push never accept it.

Alternative considered: use the session-scoped `entry.tasks` scope and make the boundary session
aware. Rejected because the three changes are exactly the case where no session owned both the work
and the tick; the artifact is the only reliable record.

### D3. Completion steer

When a session's checklist write makes the task list fully checked, its turn gate requires a PASS for
every checked task, not only the tasks it attributed. This is the only change to the existing
session-scoped trigger: before completion, each writer still reviews only its own tasks (the accepted
scenario), so parallel writers do not have to review each other's work. The completion steer is a
visible early warning; the archive gate and push check are the guarantee, because a subagent or a
shell tick may never reach this turn gate.

### D4. Archive approval gate

The repository opts in with a tracked marker, `openspec/review-approval.json`:

```json
{
  "version": 1,
  "archiveGate": true,
  "taskRule": "task-review",
  "cutoff": "v0.12.0",
  "grandfathered": {
    "add-goal-block-review": "post-hoc integration review PASS after fixes on review-v0-12-0; no per-task review",
    "adopt-agent-best-practices": "post-hoc integration review PASS after fixes on review-v0-12-0; no per-task review",
    "fix-delegation-review-build-inputs": "post-hoc integration review PASS after fixes on review-v0-12-0; no per-task review"
  }
}
```

The plugin reads `<openspec root>/review-approval.json`; without the marker, or with
`archiveGate: false`, nothing changes. With it, a `tools/pre-execute` listener recognizes the archive
operation and refuses it before any effect:

- `openspec archive <change>`;
- `mv`, `Move-Item`, or `git mv` whose source resolves to
  `openspec/changes/<change>` and whose destination is under `openspec/changes/archive/`.

The listener resolves the change, computes coverage, and denies with the change, every missing task
(number, text, task id), the expected record path, and the exact
`delegate(rule: "<taskRule>", change: "<change>", task: "<taskId>")` calls. The change remains active,
so nothing has to be restored. The listener applies to subagents too; only the turn-stopping gate
skips them. An unreadable `tasks.md`, a malformed record, a missing rule, or any evaluation failure
denies with the cause (fail closed); the existing plugin rule is that a gate failure is visible, not a
silent pass.

The guard does not claim to catch a move spelled in an unrecognized way (a script, an alias, a
compound command). The push check is the backstop for that; the guard covers the documented archive
skill and CLI forms. The archive skill's operation guidance (in `openspec/config.yaml`) tells the
agent to run the audit first; the guard is what enforces it.

Alternatives considered: a turn-stopping fallback that detects a newly archived directory (rejected:
a parallel session's archive would steer every other session in the workspace); a wrapper script only
(rejected: agents use the global archive skill, and the wrapper is easy to skip); patching the
vendored skill (rejected: generated and refreshed by `pnpm openspec:update`).

### D5. Push hook and CI

`.githooks/pre-push` is checked in and installed with `pnpm hooks:install` (`git config
core.hooksPath .githooks`). It runs `pnpm reviews:check --push`:

1. Read the pre-push refs from stdin; compute the commits the push adds
   (`remoteSha..localSha`, or the local commits not in any remote-tracking ref for a new branch).
2. Find archived changes added or modified in those commits; read their `reviews/` records and
   `tasks.md`.
3. Require the D2 coverage; the pre-cutoff historical baseline is reported without enforcement, the
   v0.12.0 exception applies only to the archived commits before the cutoff, and neither applies to a
   later modification of those changes.
4. Refuse with the change, commit, missing tasks, and the review command if anything is missing. If
   the range cannot be determined or a record cannot be read, fail closed and point at
   `pnpm reviews:check --all`.

CI runs the same audit (`pnpm reviews:check --all` or `--since v0.12.0`) in the validation workflow
and the release workflow, so a `--no-verify` push is still caught before merge. The local hook is a
convenience and an early stop, not the only boundary. A full audit accepts the pre-cutoff historical
baseline and the three grandfathered changes but prints them; a new archive after the cutoff, or a
later edit to any archive, fails.

Alternatives considered: a pre-commit hook (rejected: the push is the boundary the user asked for and
one hook is enough); CI only (rejected: the push would already have happened); a hook installed by an
install script (rejected: no install-time scripts and a local git config is an owner action).

### D6. The v0.12.0 exception and the historical baseline

The three changes are recorded in the marker and in [docs/openspec-status.md](../../../docs/openspec-status.md)
with their checked-task counts (17, 20, and 11; 48 total), the post-hoc integration review `PASS`
records (in the `review-v0-12-0` worktree's `.dsh`), and the fixes on branch `review-v0-12-0`. No
per-task records are created.

Archives older than the cutoff are the historical baseline: the full audit reports each one and its
checked tasks, prints that it has no retroactive portable records, and exits zero. The baseline is
computed from git history: an archived change whose first archive commit is an ancestor of the
v0.12.0 tag is baseline; the three changes in that tag are the explicit exception named in the
marker; a change archived after the tag, or a later modification to any archive, is checked under
the normal rule and fails without a portable PASS. `reviews:check --all` prints both the baseline and
the three exceptions; it does not hide either. This keeps the historical gap visible without
rewriting history or pretending the reviews happened.

### D7. Bootstrap and rollout

The plugin that writes the portable records is live only after the setup is released and the owner
installs it; an agent session cannot install into the desktop profile. This change therefore has a
bootstrap gap:

- Its own task reviews run through the installed engine and write only `.dsh` records. A
  `pnpm reviews:export --change add-review-approval-gate` command validates those PASS records
  (rule, change, task id, verdict) and writes the portable copies for the current change. It copies
  an existing PASS; it cannot invent one, and it does not run for the three exception changes.
- The change's own archive is protected by `pnpm reviews:check --change` and the installed pre-push
  hook, not by the live archive guard. The guard is live for the next change after the setup release
  and install.
- The owner live acceptance runs in a throwaway workspace with the marker: a checked task without a
  PASS is refused at archive, a PASS allows it, the push hook refuses, and the status reports the
  counts. The desktop profile is never installed into from an agent session.

The repository has no active changes today, so adding the marker does not suddenly block an
in-flight change. The `reviews/` directories of new changes are committed with them; the three
archived changes remain unchanged.

### D8. Status and failure messages

`delegation_status` and `reviews:check` report per change:

```text
add-goal-block-review: task-review PASS 0/17, ERROR 0, missing 17; archive-ready: no
  missing 1.1 "Extend ..." -> delegate(rule: "task-review", change: "...", task: "<id>")
  record: openspec/changes/add-goal-block-review/reviews/<taskId>.json
```

The archive deny and the push refusal use the same wording and the same review call, so a reader can
act on any of the three without decoding a second format. A missing `tasks.md`, a malformed record,
or a missing rule gets its own cause and next action, never a generic failure. The status is a tool
output, not an always-on prompt section; the plugin's model-facing budget is unchanged except for the
`delegate`/status descriptions that name the portable record.

### D9. Shared implementation module

The task parser, task-id hash, portable record shape, coverage, and archive-command recognition move
to a pure module under `packages/plugin-delegation-rules/src/shared/approval.ts` with no DSH imports.
The Host imports it, and `scripts/reviews-check.ts` imports the same file through Node 24's TypeScript
execution, so the engine and the git/CI audit cannot drift. The Host's existing parser and hash are
replaced by the shared functions; the record path, digest, and status use it. The `reviews:export`
mode and the marker schema live in the same module.

### D10. Known limitations

The guard recognizes the documented archive forms only; a deliberately obfuscated local move can
archive a change, but the push check sees the archive commit. The hook can be bypassed with
`--no-verify`; CI is the remote backstop. A record can be forged by an agent with filesystem access;
the same is true of the current `.dsh` records, and this change does not claim more. The owner can
disable the marker, the hook, or the plugin row; that is the documented opt-out, not a silent bypass.

## Risks / Trade-offs

| Risk                                                          | Mitigation                                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Unrecognized archive form archives locally                    | Pre-push check refuses the push; audit reports; docs state the limit                         |
| Hook bypass (`--no-verify`) or not installed                  | CI runs the same audit; `pnpm hooks:install` documented; CI is the remote boundary           |
| Portable record forged                                        | Process integrity, not anti-forgery; target/time and audit; same trust as `.dsh`             |
| Per-task review cost for large changes                        | v0.12.0 exception; size tasks for one review; completion steer early                         |
| `reviews/` name collision or accidental artifact              | Reserved directory; digest excludes it; malformed records ignored for artifacts; tested      |
| This change's own archive is not protected by the live guard  | `reviews:check` + pre-push hook; bootstrap export; live acceptance after install             |
| Worktree review evidence stranded                             | Portable record in the change; merge the branch; export mode for the current change          |
| CI full audit fails on historical archives                    | Pre-cutoff baseline is reported, not enforced; marker exception/cutoff; post-cutoff fails    |
| AGENTS.md exceeds its budget                                  | Add one line or condense an existing one; instruction-budget check in validation             |
| Git Bash cannot find pnpm/node                                | Hook fails closed with the manual audit command; no silent allow                             |
| Desktop profile update needs the owner                        | Owner installs from an external PowerShell; live acceptance is an explicit task              |

## Migration Plan

1. Land the shared module, portable-record write, digest exclusion, coverage, completion steer,
   archive gate, audit/export script, hook, CI step, marker, and docs; run the full local gate and
   commit the generated `lib/**` and the vendored setup copy.
2. Add `openspec/review-approval.json` with the three grandfathered changes and the v0.12.0 cutoff;
   the full audit reports pre-cutoff archives as the historical baseline. Install the hook with
   `pnpm hooks:install`.
3. Review this change's own tasks through the installed engine, export those `PASS` records with
   `pnpm reviews:export --change add-review-approval-gate`, run `pnpm reviews:check --change`, and
   archive; the pre-push hook validates the archive commit. The live archive guard is not yet active
   in the desktop profile.
4. Release the setup; the owner installs from an external PowerShell with the app closed; run the
   throwaway-workspace live acceptance. The next change uses the live guard.
5. Rollback: remove the marker to disable the archive gate, remove the hook/CI step, or disable the
   plugin row; the portable records remain harmless and the session-scoped gate is unchanged.

## Open Questions

None. The hook's exact new-branch fallback and the Windows runner path are implementation details
covered by the fail-closed rule; the marker schema, the cutoff, the exception, and the checked-task
scope are decided.
