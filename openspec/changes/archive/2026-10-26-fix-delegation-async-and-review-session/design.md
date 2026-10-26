## Context

The delegation engine runs a target inside the `delegate` tool call and returns only after the
target finishes, so a review blocks the turn. The Codex provider starts one app-server child and one
ephemeral thread per run, so the target has no memory of a previous review of the same task. The user
needs to hand several finished tasks to reviewers at once and wants repeated reviews of one task to
continue the same Codex conversation.

## Goals / Non-Goals

Goals: non-blocking review runs with a run id and status; explicit task selection for task reviews;
one reused Codex thread per review key; the existing records/gates unchanged; a review verdict bound
to the exact inputs it read.

Non-goals: changing the review prompt or verdict format, reusing threads across different changes or
tasks, or making the target's own internal reasoning resumable beyond what the Codex app-server
thread provides.

## Decisions

### D1: Review runs start asynchronously

A review `delegate` call validates the rule/target/change (and an explicit task when given), starts
the target, and returns a run id plus the record path immediately. The run continues in the
background; on completion it writes the same digest-bound `PASS`/`FINDINGS`/`ERROR` record as today.
The tool result says the run is pending; `delegation_status` lists running, completed, and failed
runs. The turn-stopping gate still uses the records, so a pending run's guidance points to the run
status and record path rather than starting another run.

A second call for an already-pending review identity returns the existing run handle instead of
starting a duplicate. Duplicate identity is rule + change + task/phase; the conversation key (change
+ task/phase) is separate, so two different rules reviewing the same task both run and write their own
records while sharing one Codex conversation. Distinct runs that share a key are serialized; a
superseded or late completion cannot replace the authoritative record for that identity (the first
accepted completion wins; later ones are reported as discarded). A failed run leaves the visible
error.

### D2: Task-scoped reviews accept an explicit task id

`delegate` accepts `task` for a task-scoped review rule. When present, the engine reviews that
checked task (validating that it is checked and matches the rule's task review) instead of selecting
the next checked task. Parallel task-review calls for different tasks therefore cannot collapse onto
one task; a missing task keeps the existing next-task behavior.

### D3: Codex reuses one thread per review key

The provider keys a review conversation by the change name plus the task id (or the whole-scope
phase). The first run starts an app-server thread and persists its thread id under `.dsh/delegation`
(or the provider's run state); later runs for the same key resume that thread instead of creating an
ephemeral one. The thread is still confined to the run's cwd, sandbox, Serena home, and disabled-tool
policy; a different key never resumes another key's thread. The persisted id is local scratch and is
cleaned with the delegation state. Only one active run per key exists; a queued duplicate returns the
pending handle (D1).

### D4: A verdict is bound to the inputs it read

The review digest is computed when the run starts. The background run reviews immutable inputs (an
immutable worktree snapshot or equivalent mutation tracking) bound to that digest; a digest re-check
alone is not sufficient because edit-read-restore can hide a change. If any reviewed input changes at
any time during the run, the verdict is discarded and an `ERROR`/retry is reported instead of
publishing a `PASS` for a digest that no longer matches the reviewed contents. A task-scoped record
therefore remains bound to the reviewed snapshot, not to later edits.

### D5: Tests and live acceptance

Unit tests: two background review runs complete independently and write separate records; a
duplicate pending call for the same rule/change/task returns the same handle and starts nothing;
two different rules on the same task both run and write their own records; overlapping completions
cannot replace the authoritative record; an explicit task id selects that task; parallel task
reviews do not collapse; a file edited, read, and restored during a delayed run yields no PASS; the
provider resumes the same thread id for the same key and starts a new one for a different key. Live:
three finished tasks started as three async reviews, all complete, and a second review of one task
continues its Codex thread (verified by the thread-id continuity and a target answer that depends on
the first review's context).

## Risks / Trade-offs

- **Background runs outlive the turn** -> the run id, status, and record path are the durable handle;
  a crash leaves a visible failed/pending state rather than a silent pass.
- **Thread reuse could leak context across tasks** -> the key includes change + task, and the prompt
  still states the exact scope/digest; a mismatched digest is rejected by the review contract.
- **Snapshot cost** -> an immutable snapshot may copy the worktree; this is the accepted cost for a
  verdict that cannot be invalidated by edit-read-restore.
- **App-server/thread lifetime** -> the provider keeps the thread state (or a resumable id) without
  keeping a child alive forever; a provider restart resumes from the persisted id.
- **Async tool result** -> a client that expects the final verdict in the tool result sees a pending
  handle and reads the record/status later; the tool description and docs are updated with the
  contract.
