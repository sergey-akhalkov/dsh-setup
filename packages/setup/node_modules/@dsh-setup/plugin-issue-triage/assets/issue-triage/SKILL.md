---
name: issue-triage
description: >
  Issue triage: turns open GitHub issues into evidence-backed verdicts, closes
  duplicates and already-fixed issues with a comment, clusters the valid ones
  into at most three change drafts, and reports one summary table. Opt-in;
  lead-only GitHub writes. Needs the gh CLI and the OpenSpec CLI.
---

# Issue triage

Issue triage is one run over the open issue backlog: check the tools, read the issues, attach
evidence to one verdict each, close only what is provably done, cluster the rest into a bounded set
of change drafts, and report. It never implements a fix and never opens a change on its own: the
owner promotes a draft, and the normal intake decides the spec.

## When to use it

Use it when the user asks to triage the issue backlog, decide what is still open, find duplicates,
close what a release already fixed, or turn open issues into a short list of changes.

Do not use it for one known issue (fix it or leave it), for implementing a fix, for pull-request
review, or as a scheduled job. Triage is judgement: it runs interactively, under the lead's eye.

## Preconditions

Check both before any inventory call, and stop with one line naming the remedy when either is
missing:

- `gh auth status` succeeds. Otherwise stop with exactly:
  ``gh is not authenticated: run `gh auth login`, then rerun the triage.``
- The workspace has an OpenSpec root: `openspec list --json` returns a `root` object. Otherwise stop
  with exactly: ``no OpenSpec root: run `openspec init --tools none` here, then rerun the triage.``

Also record `gh repo view --json nameWithOwner` in the report header. Nothing is written to GitHub
and nothing in the repository changes during preflight or inventory.

## The run

1. Preflight: the two checks above.
2. Inventory: `gh issue list --state open --limit 100 --json number,title,labels,createdAt,updatedAt`,
   then `gh issue view <n> --json number,title,body,state,labels,comments` for every issue.
3. Existing links: `openspec list --json` for the active changes, `git grep -n "Fixes #<n>" -- openspec/changes/`
   for each issue, and the issue's comments for an existing triage marker. An issue already owned by
   a change is `tracked`; it is never drafted twice.
4. Verdicts: exactly one per issue, decided by the lead from evidence. A worker never decides a
   verdict.
5. Closes: only `duplicate`, `fixed`, and `shipped` close, each with one comment.
6. Clusters: group the `needs-change` issues whose touched paths overlap, cap the result at three,
   and give one worker per cluster its draft brief.
7. Write-back: one link comment per drafted or tracked issue, one deferral comment per issue beyond
   the cap. The lead does all of it.
8. Report: the two tables, the decisions the owner must make, and nothing else.

## Verdicts

Every issue gets exactly one of these, and its evidence column carries the proof.

| Verdict       | Meaning                                                  | Evidence it must carry                                                     |
| ------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `tracked`     | an active change already owns it                         | that change's name, from its `Fixes #<n>` line                             |
| `shipped`     | a released version already contains the fix              | the tag or version, and the change that shipped it                         |
| `fixed`       | the working tree contains the fix and no release has it  | the command that reproduced the symptom and that command's passing output  |
| `duplicate`   | the same defect as a canonical open issue                | the canonical issue number                                                 |
| `invalid`     | not a defect, or not this repository's problem           | the reason, and the owner's recorded answer before any close               |
| `needs-info`  | cannot be judged from what is written                    | the one missing fact and the question that obtains it                      |
| `deferred`    | valid, but beyond this run's cap or waiting on the owner | the cap or the dependency that defers it                                   |
| `needs-change` | a real defect worth a change                            | the paths the fix will touch, and the cluster that carries it              |

A verdict MUST NOT rest on a text claim alone: an issue comment saying "fixed", a commit subject, or
a merged pull-request title is not evidence. An issue that reads fixed but has no command and
passing output is `needs-info`, not `fixed`. Only `duplicate`, `fixed`, and `shipped` are closeable
in a run; `tracked`, `needs-change`, `needs-info`, `invalid`, and `deferred` stay open.

## Evidence

Each verdict names the read-only command that supports it:

- `tracked`: `openspec list --json` plus `git grep -n "Fixes #<n>" -- openspec/changes/`. The `Fixes #`
  line is the commitment; a `Refs #` line informs without closing and does not make an issue tracked.
- `shipped`: `git log --oneline -S "<the fix>" -- <path>` or the release notes, plus the tag that
  contains it. The project closes issues at release; a shipped fix is a close.
- `fixed`: the project's own reproducer or test, run now, with its passing output. Name the exact
  command in the report.
- `duplicate`: both bodies and the comments; the canonical issue must be open. When the pair is
  otherwise identical, the issue that no artifact references is the duplicate.
- `needs-change`: `git grep -n "<symptom>" -- <paths>` (or `rg`), and the paths a fix would touch.
  The paths are part of the verdict because they drive clustering.
- `needs-info`: the exact missing fact and one question. A CI failure that was never rerun is
  `needs-info` with the rerun as the next step, not `needs-change`.

"What might have fixed it" is not evidence. If the command cannot run here, the verdict is
`needs-info` and the next step names the command.

## Closes

Close a `duplicate` with `gh issue close <n> --reason "not planned"` after one comment that names the
canonical issue; the triage reason is `duplicate`. Close a `fixed` or `shipped` issue with
`gh issue close <n> --reason completed` after one comment naming the command and its passing output
(for `shipped`, also the version). Do not edit the body.

Never close an `invalid` issue, a "won't fix" out-of-scope item, or anything else without the owner's
recorded answer; ask the owner, keep the issue open, and record the question and answer in the
report. Closing is idempotent: an already-closed issue is skipped and the report says so. Never
delete an issue, never edit a body, never close a pull request.

## Clustering and the cap

Group only `needs-change` issues. Two issues belong to one cluster when the paths they touch
overlap: the same file, module, workflow, or test. Two issues that would edit the same files become
one proposal, because two parallel changes would conflict.

Propose at most three changes per run. Rank by severity: gate-breaking, data loss, or security first;
then visible breakage; then a flake or polish. The cap is three even when the evidence would support
more. An issue beyond the cap gets the `deferred` verdict, a deferral comment, and stays open.

A proposal is a draft, not a change. Write `requirements.md` (users, problem, outcomes, non-goals,
constraints, and acceptance criteria), `architecture.md` (the architecture and its decisions, with
alternatives and trade-offs), `interface.md` (the exact commands, paths, inputs, outputs, and failure
shapes), `proposal.md`, `design.md`, `specs/<capability>/spec.md`, and `tasks.md` under
`.dsh/workflows/drafts/<name>/`, and write nothing under `openspec/changes/`. Each draft's
`proposal.md` carries one `Fixes #<n>` line per issue, on its own line; that line is what closes the
issue at the later release.

## Subagent brief

One worker per cluster, never one per issue. A worker writes only its own draft directory. Send this
brief, filled in:

```text
You are preparing one change draft for the issue-triage run.
Cluster: <cluster name>. Issues: #<n>, #<n>.
Lead's evidence (do not re-verify GitHub): <verdicts and the commands behind them>.
Read-only inputs: the issue bodies below, the repository, and the existing `openspec/specs/`.
Write exactly these files under `.dsh/workflows/drafts/<name>/`:
- requirements.md: users, problem, outcomes, non-goals, constraints, and acceptance criteria (at least 200 bytes).
- architecture.md: the architecture and the decisions that shape it, with alternatives and their trade-offs.
- interface.md: the exact commands, paths, inputs, outputs, and failure shapes.
- proposal.md: Why, What Changes, Capabilities, Impact, with one `Fixes #<n>` line per issue.
- design.md: the decisions and the rejected alternatives.
- specs/<capability>/spec.md: ADDED requirements with WHEN/THEN scenarios.
- tasks.md: level-2 lanes that name their owned paths, then one serial integration tail.
Forbidden: any `gh` command, any GitHub write, any comment or close, any edit outside your draft
directory, any file under `openspec/changes/`, and any implementation of the fix.
Return: the draft directory path, the touched paths, the risk, and the one decision the owner must
make.
```

A worker that reports a comment or a close has failed the brief; discard its GitHub action and
report the failure. The lead reviews each draft before posting anything.

## Write-back

Only the lead writes to GitHub: one comment per issue, and the closes above. Every triage comment
carries the marker `<!-- dsh-setup:change=<change-name> -->`, so the next run finds it. A comment that
names no change (a duplicate close or a cap deferral) carries `<!-- dsh-setup:change=none -->`
instead. Before commenting, read the issue's comments and skip the comment when the marker (or the
same template text) is already there: a rerun must not post a second triage comment.

Copy-ready templates:

```text
<!-- Template 1: change link (tracked or drafted) -->
<!-- dsh-setup:change=<change-name> -->

Tracked in `<change-name>`. Scope: <one line>. Next step: <promotion or release closeout>.
```

```text
<!-- Template 2: duplicate close -->
<!-- dsh-setup:change=none -->

Duplicate of #<canonical>. Closing this one; the canonical issue carries the fix.
```

```text
<!-- Template 3: fixed or shipped close -->
<!-- dsh-setup:change=<change-name> -->

Fixed by `<change-name>`; no release contains it yet. Proof: `<command>` → `<passing output>`.
-- or, when the verdict is `shipped` --
Shipped in `<version>`: `<change-name>`. Proof: `<command>` → `<passing output>`.
```

```text
<!-- Template 4: deferral beyond the cap -->
<!-- dsh-setup:change=none -->

Deferred: the triage run drafts at most three changes. Verdict `deferred`; rank <severity rank>.
This issue stays open and is next in line when a slot frees.
```

Promotion is the owner's decision, taken after the report. The agent then invokes
`openspec new change <name>` through the Harness shell tool, because that call is what the intake
gate matches; a direct CLI invocation outside the Harness session does not start the intake and is
not the promotion path. The intake's approval decides the spec before implementation.

## Report

End with two tables. The main table has exactly the columns `Issue`, `Verdict`, `Evidence`, `Change or
draft`, and `Next step`, one row per issue, ordered by severity like the cap. The second table,
`Items closed in this run`, has the columns `Issue`, `Verdict`, `Comment`, and `Close command`.

Under the tables, state the repository slug, the counts (`N of M need changes; D drafted, F
deferred, C closed`), and the decisions the owner must make: which drafts to promote, which
`invalid` or `needs-info` issues need an answer.

## Safety

- One comment per issue, no body edits, no deletions, no pull-request closes, no force-push, no tag
  moves, and nothing about a release.
- No GitHub write while an issue is still being judged, and never a write from a worker.
- No credentials, tokens, session logs, or machine paths in a comment, an issue, or a draft.
- No implementation inside the run: a fix is a promoted change, never an ad-hoc edit.
- Do not open a change for an `invalid`, `needs-info`, or `deferred` issue, and do not close an
  `invalid` one without the owner's recorded answer.
- A draft lives under `.dsh/workflows/drafts/` until the owner promotes it; deleting it is safe and
  never touches a change.

## Failure modes

| Symptom                                   | What to do                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `gh auth status` fails                    | stop before inventory; one line naming `gh auth login`                        |
| No OpenSpec root                          | stop before inventory; one line naming `openspec init --tools none`           |
| Zero open issues                          | report the empty table and stop; write nothing                               |
| More valid issues than the cap            | draft three, defer the rest with deferral comments                            |
| The marker already exists                 | skip the comment; the run is idempotent                                       |
| A worker proposes a change directory      | discard it; drafts live only under `.dsh/workflows/drafts/`                   |
| Intake refuses the promotion              | record the refusal; the owner's approval decides the spec, not the run        |
| A verdict rests on a text claim           | downgrade to `needs-info` and name the missing command                        |
| A duplicate's canonical issue is closed   | keep it open as `needs-change` and name the release that fixed it, or ask     |

## Worked example

An evidence-shaped template, filled from the commands above. Each row is derived from the run; the
draft rows are the observed clusters, never more than three, and nothing here preselects which issue
goes to which draft.

```markdown
| Issue | Verdict      | Evidence                                                          | Change or draft        | Next step                    |
| ----- | ------------ | ----------------------------------------------------------------- | ---------------------- | ---------------------------- |
| #<n>  | needs-change | `<command>` fails on `<path>`; the guard is missing               | draft `<cluster-slug>` | promote `<cluster-slug>`     |
| #<n>  | needs-change | same `<path>` as one above; one change edits it once             | draft `<cluster-slug>` | promote `<cluster-slug>`     |
| #<n>  | duplicate    | same reproduction as #<canonical>, which is open                  | —                      | closed in this run           |
| #<n>  | tracked      | `Fixes #<n>` in `openspec/changes/<change>/proposal.md`           | `<change>`             | wait for the release closeout |
| #<n>  | needs-info   | no command reproduces it; the failing run was not rerun           | —                      | rerun `<run id>`, verdict again |
```

The rules the example encodes: every verdict cites a command or a canonical number; the draft count
is the observed count up to the cap of three; a deferred issue appears with verdict `deferred` and a
reason, never as a silent omission; and every issue appears in exactly one row.
