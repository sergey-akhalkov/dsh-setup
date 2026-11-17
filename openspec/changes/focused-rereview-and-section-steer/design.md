# Design

## Context

See `proposal.md` for the measured loop and why now. The relevant current state after Release A
(`move-review-runtime-into-workflows`):

- The native review executor in `packages/plugin-workflows/src/host/review.ts` renders the bundled
  instruction with the rule, change, scope, task or section, digest, snapshot marker, and caller
  context (`renderReviewPrompt`), and parses exactly one fenced verdict with `digest`, `verdict`, and
  `findings` (`parseReviewVerdict`). The local `ReviewRecord` carries the digest, `worktreeDigest`
  (a hash, not a tree SHA), findings, target, session, run id, and time; the committed approval is
  the subset in `portableApprovalOf`.
- The shipped `task-review` definition is task-scoped. The host starts one run per newly checked
  task from the `tasks.md` `fs.change` event (`index.ts`, the `task-review` start path). Section
  review exists as a prepared `SectionReview` (`review.ts`), a section digest
  (`sectionReviewDigest`), a section record id, and the per-task publication path; it is currently
  reached through the deprecated `delegate(..., section)` alias.
- A prior `FINDINGS` record is only reused at the exact digest. A fix changes the snapshot tree, so
  the next run prepares a new digest and renders the same full prompt with no memory of the prior
  findings.
- `tasks.md` level-2 headings are already parsed as sections (`readTaskLanes`,
  `resolveTaskSection`).

## Goals / Non-Goals

**Goals:**

- A re-review after a fix confirms the prior findings and reviews the change since the last
  reviewed tree, instead of re-discovering the task from scratch.
- A related group with two or more missing records is one review unit, not N.
- Keep the zero-P0/P1 bar, the per-task approvals, the archive gate, and the committed approval
  bytes unchanged.

**Non-Goals:**

- A review-round cap or budget (a separate decision; this change makes each round converge, it does
  not stop the loop).
- Changing the dormant legacy runtime or its prompt; it is deleted in Release B.
- Whole-spec focused re-review; the spec digest has no stored tree to diff.
- Changing `reviewQueue`, `timeouts.review`, reviewer configuration, or setup defaults.

## Decisions

### D1 — A focused re-review is the same review unit, not a new review kind

The focused prompt applies when the unit's latest authoritative record is `FINDINGS`, its digest
differs from the prepared digest, and the record covered the same checked-task set; a section whose
coverage grew is a full review, because a newly checked task may have existed before the prior
reviewed tree and its defects would fall outside the focused diff. The unit is the existing identity:
definition, change, and task id or section record id. A prior `PASS` is reused as today; a prior
`ERROR` is a dispatch retry with a fresh prompt; a matching `FINDINGS` follows the existing
same-digest path. The unit's scope, the reviewer, the queue, and the verdict outcome set are
unchanged.

Rejected: a separate "verification" executor or definition (duplicates the queue, record, and gate
paths); a verification run that skips the task scope (accepts a regression outside the diff without
a full review).

### D2 — The local record stores the reviewed tree; the diff is computed from it

`ReviewRecord` gains an optional `reviewedTree` (the snapshot's `write-tree` SHA). `baseRecord`
writes `prepared.tree` when the review runs from a snapshot. `portableApprovalOf` does not include
it, so the committed `reviews/<taskId>.json` keeps its field set and order byte-for-byte. The
snapshot worktree is disposable, but the tree object stays in the repository object database, so
`git diff <priorTree> <currentTree>` works after the run.

The prompt receives the changed-path list and a bounded unified patch (default cap: 400 lines and
32 KiB total, configurable only in code). When the patch is truncated, the prompt says so and names
the current snapshot checkout the reviewer can read. The prior-finding inventory is complete: every
finding is rendered with its id, severity, title, evidence, and fix, with no count or byte
truncation; only the diff is bounded. If the complete inventory exceeds the prompt's hard safety
limit (default hard cap: 256 KiB of rendered prior-finding text) the attempt settles as an `ERROR`
naming the cause and writes no `PASS`, rather than dropping entries the reviewer must confirm.

When `reviewedTree` is absent (records written before this change), the tree object is missing, or
git fails, the prompt carries the findings and states that the diff is unavailable; the review still
starts. Falling back to a full-scope prompt would silently reintroduce the loop, so the focused
confirmation remains the contract.

Rejected: storing a copy of the prior snapshot (disk cost); deriving a diff from finding evidence
(not a real diff); persisting the run's snapshot commit (the run file is queue scratch and the
commit is not the reviewed tree identity).

### D3 — The verdict confirms every prior finding

On a focused re-review the parsed JSON gains an optional `previous` array:

```json
"previous": [{ "id": "f1", "status": "closed" | "open" }]
```

The id is the prior record's finding position (`f1`..`fn`), stable for that record and unique even
when two findings share a sanitized title or two titles collide after `sanitizeReviewText`. An
`open` prior finding is repeated by exactly one finding that carries `"previousId": "f1"`; a
`closed` id must not be named by a finding. Validation: one entry per prior id; missing, duplicate,
or unknown ids are invalid output. `PASS` requires every entry `closed` and zero findings.
`FINDINGS` requires at least one finding, and every `open` prior id has exactly one finding with
that `previousId`. The local record stores the confirmations; the committed approval never contains
them.

The id is the join key because a valid prior record can contain duplicate sanitized titles and
sanitization can make two different titles collide; position is stable within the record the
reviewer is confirming. Rejected: the exact title as the key; a content hash (collides less often
and still needs a tie-break); a prose confirmation before the JSON block (not parsed, not
authoritative); a `resolved` flag on each re-reported finding without the prior list (cannot prove
coverage when titles repeat).

### D4 — Section-first selection is one pure selection rule shared by start and steer

A pure function over the parsed plan and the active owner's record store returns the review unit:

- group checked tasks without a matching `PASS`/`ERROR` record by their level-2 section;
- a section with two or more missing tasks is one unit covering **every checked task in the
  section**;
- a section with one missing task, a task outside any section, and a section with no missing task
  keep the per-task unit.

The host applies the rule in the native `task-review` start path (one section run with the existing
`SectionReview` context, `recordId`, and section digest) and in the turn-close steer and status. The
per-task path is unchanged. The existing live-run and queue dedupe extend to the section identity,
so a pending section run suppresses per-task and second section starts for its covered tasks.

A section run covers approved tasks in the section too. That is the shipped section contract: one
verdict; a `PASS` preserves a matching per-task approval byte-identically and publishes only the
missing or nonmatching approvals, while a `FINDINGS` reopens the covered tasks it names. Selecting
only the missing subset would create a new scope outside
`SectionReview`/`sectionReviewDigest` and would need a different publication path, so it is
rejected. The steer names the missing tasks and the section, so the owner sees why the unit is
larger than the missing set; an explicit per-task `delegate` call remains available for a lone or
risky task.

The steer names the start action for the current tool surface. While the deprecated `delegate`
alias exists, the action is `delegate(rule: "task-review", change: "<change>", section: "<key>")`;
the requirement stays worded as "the start action that covers them" so Release B can move it
without a spec rewrite.

Rejected: a text-only steer (the native gate starts runs; a suggestion would leave the per-task
runs in place); grouping only on the `tasks.md` delta (misses missing records from failed or older
runs); grouping by lane (lanes are planning ownership, sections are the shipped review grouping).

### D5 — The change is pinned between Release A and Release B

The preconditions are `move-review-runtime-into-workflows` archived (the native executor is the
owner) and `retire-delegation-rules` not yet applied (the alias still exists). The MODIFIED
"Owned task-review gate" block is based on Release A's target text; the apply flow re-reads the
archived requirement and reconciles the block before touching code. Release B must move the steer
from the alias to the workflows start action; it is a documented follow-up, not a task here.

### D6 — Documentation follows the behavior in the same change

`AGENTS.md` section 5 becomes section-first for a related group and keeps the per-task review for a
lone or risky task. `docs/workflows.md` documents the focused prompt, the confirmation verdict, the
diff fallback, and the selection rule. `docs/delegation-rules.md` already documents the
`delegate(..., section)` option and is not edited before Release B deletes it. A behavior change that
leaves the apply guide telling agents to review one task at a time would keep the measured loop
alive.

### D7 — The executor's instruction copy is the only prompt edited

`review.ts` resolves `assets/reviews` first, so
`packages/plugin-workflows/assets/reviews/review-task.md` is the prompt the native executor renders.
The legacy copy under `packages/plugin-delegation-rules/assets/**` is not edited: the package is
deleted in Release B, and the legacy verdict parser has no `previous` contract, so a flipped legacy
switch must keep its own runtime with its own pre-focus prompt. Release A's byte-equality check
(`packages/plugin-workflows/test/assets.test.ts`) existed only while both files were the same
instruction; it is retired here, keeping the shipped-id list, the P0/P1 rubric checks, and the legacy
`bundled:` resolution check that Release B deletes with the package. The stale legacy copy is a
deliberate divergence, not drift to police.

## Risks / Trade-offs

- **A focused re-review narrows new findings to the diff** → the reviewer may still read the whole
  current snapshot; the instruction scopes new P0/P1 to the change since the prior tree and requires
  evidence, so a pre-existing issue outside the fix is not re-reported. The task's own zero-P1 PASS
  from the full first review remains the baseline.
- **Confirmation rubber-stamping** → each status is bound to a prompt id and the diff is in the
  prompt; a closed confirmation with no supporting change is visible in the audit. A stricter
  evidence field per confirmation is a possible follow-up, not needed for the contract.
- **Diff truncation hides part of a fix** → the changed-path list is always present, the prompt
  names the truncation, and the reviewer can read the current snapshot checkout.
- **Prior tree object pruned** → the findings-only fallback keeps the review focused on the prior
  findings; the prompt names the cause instead of silently resetting.
- **Section-first reopens an approved task** → a section verdict is the shipped unit; a `FINDINGS`
  that names an approved task is a real regression signal, and a `PASS` preserves the matching
  approval byte-identically and publishes only the missing or nonmatching one. The owner can request
  a per-task review explicitly.
- **MODIFIED base drifts while Release A is in flight** → the precondition task reconciles the block
  with the archived requirement before the lanes start.
- **The two review prompts differ until Release B** → intended: a profile that flips the legacy
  task-review switch back gets the old runtime with its old prompt, and the focused contract stays
  engine-only; Release B deletes the legacy package, its prompt copy and manifest entry, and the
  remaining legacy `bundled:` assertion.

## Migration Plan

1. Wait for Release A's archive; reconcile this change's MODIFIED requirement with the archived text.
2. Land the executor fields and prompt/verdict first (lane 1), then the selection (lane 2), then the
   serial docs/gate.
3. No data migration: the new local record fields are optional and older records fall back to
   findings-only; committed approvals are untouched.
4. Rollback is a revert. The legacy runtime ignores the new local fields and keeps its own
   instruction copy, and every committed approval remains valid because its format did not change.

## Open Questions

None. The selection threshold, the fallback, and the confirmation contract are decided above; a
review-round cap remains a separate future change.
