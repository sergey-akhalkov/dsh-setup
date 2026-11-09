# Design

## Context

See proposal.md — Why. The delegation engine reviews one checked task per run, keys the record by the
normalized task text, snapshots the worktree, and publishes one portable record per task; the archive
gate and `reviews:check` require one portable PASS per checked task. The review queue, finding history,
prompt injection, and `delegation_status` operate on that task scope.

## Goals / Non-Goals

**Goals:**

- One review run and one verdict for a `tasks.md` section, covering all its checked tasks.
- Keep the archive gate and the portable record schema unchanged by publishing one per-task PASS per
  covered task from the single section run.
- Reuse the existing snapshot, queue, dedupe, retry, finding-history, and prompt-injection machinery.

**Non-Goals:**

- Changing the archive gate, the per-task record schema, or the whole-spec review.
- Approving unchecked tasks or tasks added to the section after the run.
- Replacing per-task review; a single-task review still works exactly as today.
- A new package, row, dependency, DSH version, or profile config.

## Decisions

1. **A section is a level-2 task group.** Resolve the selector against the same `tasks.md` parser the
   gate uses: the heading number (`1`, `1.x`) or its normalized title, with the untitled leading group as
   a stable fallback. Reuse `parseTaskLanes`; no second parser. An explicit `task` and a `section` are
   mutually exclusive; a missing or empty section is a tool error naming the available sections.
2. **One run, one prompt, one verdict.** The section run uses the existing snapshot and prompt assembly,
   with a header naming the section, its heading title, and every checked task's number and text. The
   reviewer returns one PASS/FINDINGS/ERROR for the section. Unchecked tasks are listed as out of scope,
   never reviewed as done. The reviewer instruction asks for findings that name the affected task.
3. **Section identity and digest.** The identity is rule + change + section key + digest + reviewer.
   The digest covers the section key, the sorted checked task ids and normalized texts, the frozen
   change-artifact digest, and the snapshot content tree. An unchanged section reuses a FINDINGS record;
   checking a new task changes the digest and requires a new section or task review. The existing queue
   identity/dedupe, retry, quarantine, and settlement paths are reused with the section key in place of
   the task id.
4. **Publish per-task approvals as a transaction.** A section PASS writes the existing per-task portable
   record for each covered checked task whose current record does not satisfy the approval checks. A
   matching record is kept byte-identical; a nonmatching record (for example a different reviewer) is
   replaced only by this transaction. The publisher creates every temporary file before renaming any
   destination, under the existing publication lock. If any write or rename fails, it restores every
   replaced or removed destination byte-identically and removes only the destinations it created; no
   approval survives a failed publication. The portable schema is unchanged (no new field), so
   `reviews:check` and the archive gate need no change. The local `.dsh` record keeps the section key
   and covered task ids for status and debugging.
5. **Shared publication arbitration.** Per-task and section publications share that lock and the
   existing per-task authority check. A per-task run publishing after a section keeps its own record and
   the section skips it or discards on a stale identity; a per-task run publishing after the section
   sees the authoritative PASS and discards. A section run whose identity was superseded discards its
   entire publication and approves no task, so partial or stale section evidence can never approve.
6. **Section ERROR is visible, never a new approval.** A settled section ERROR writes a local ERROR
   record for each covered task with the section's failure class preserved and publishes no new portable
   approval. The turn gate therefore sees an ERROR on each covered task and may close on an eligible
   failure; existing valid approvals remain, and only covered tasks that lack a valid prior approval
   are reported missing for archive. The PASS-only boundary does not change. The existing classifier,
   retry, quarantine, and finding-history rules apply to the section run.
7. **Gate and status read the per-task records.** A covered task is approved exactly like a per-task
   PASS. While a section run is pending, the gate suggests waiting for its record from the queue state
   instead of starting per-task runs. `delegation_status` and the audit report the per-task portable
   records as today; the local section record adds the coverage detail.
8. **Finding history is appended once per section.** The finding history and lesson prompt use the same
   classifier and bounds; the history entry carries the section key and the covered task ids in place of
   a single task id. The repeat metric and retro report stay keyed by finding class and title.
9. **Docs and prompts.** The `delegate` tool description, the task-review prompt asset, the
   delegation-rules skill text, and `docs/delegation-rules.md` describe section mode, the `1.x` selector,
   the one-verdict rule, the per-task approval publication, and the limits (unchecked tasks, changes
   after the PASS, and the archive gate still needing one PASS per checked task).

## Risks / Trade-offs

- A section review can miss one task's defect that a dedicated review would catch → the prompt names
  each task and asks for task-specific findings; per-task review remains available for risky tasks.
- A large section increases review cost per run → sections are bounded by the author's `tasks.md`
  grouping; 3-6 tasks per section is the intended shape.
- Partial approval publication could leave inconsistent records → the atomic temp-then-rename publisher
  and the all-or-nothing rule above.
- A section PASS could silently cover a later checked task → the digest includes the checked set, so a
  later check requires a new review; the archive gate would report it missing.
- The live profile runs the installed engine, so the mode becomes active only after the owner installs
  the updated setup → the workflow follow-up records that install and one real section review.

## Migration Plan

No migration: existing per-task records and changes remain valid, and calls without `section` behave as
before. After the change is implemented and released, the owner installs the generated setup; a section
review then writes per-task approvals exactly where the archive gate expects them. Rollback is using
per-task reviews; no data format changes.

## Open Questions

None.
