# Design

## Context

The review runtime lives in `@dsh-setup/plugin-workflows`: the `review` executor, the review queue and
scheduler, the frozen task snapshots, and the `spec-review`, `task-review`, and `integration-review`
definitions. The delegation-rules plugin is gone; the Codex provider keeps its review-thread contract.

Three mechanisms decide today's behavior:

- **Reviewer identity.** The Codex provider reuses one app-server conversation per review key parsed
  from the prompt. It requires a `- Review key: review:...` line and a `- Digest:` line before the
  prompt's `## Context` section, and it confines a thread to its run's working directory and sandbox
  (persisted in `.dsh/delegation/codex-review-threads.json`). The workflows prompt renders the digest
  but no key, and a task review runs in `.dsh/workflows/snapshots/<runId>` — a new directory every
  round. Every round therefore starts a new thread; the store has 285 of them.
- **Review scope.** `reviewUnits` selects a section unit only when two or more checked tasks of one
  level-2 section lack a record; a single missing task is a per-task unit, and an `ERROR` record counts
  as coverage. `maxBlocks` is 3 for `task-review`/`spec-review` and 1 for `integration-review`; after
  the budget the gate allows the close as a `VIOLATION`, and a matching `ERROR` is provisional
  evidence for a review step. Whole-scope reviews read the live worktree under a mutation guard, so a
  write during a run discards the verdict as `reviewed-inputs-changed`.
- **Concurrency.** Every review passes through a profile-wide FIFO queue with `concurrency: 10`,
  `maxQueued: 16`, and `waitTimeoutMs: 2400000` (the setup row), while the scheduler serializes runs
  that share a conversation key. Review starts also count against the generic `maxRuns` limit
  (default 20). The queue's own history already produced `queue-timeout` failures when four section
  reviews competed for two slots on the installed profile.

The measured symptom: `retire-delegation-rules` ran 27 task reviews for 13 tasks with four `FINDINGS`
cycles on the same tasks and three blocked runs at the end; `add-exploratory-testing` ran five
whole-spec reviews, two cancelled by the user, three settled as `ERROR` with
`reviewed-inputs-changed`. The user's requirement is one reviewer per lane, re-asked until `PASS`,
with no round cap, all lanes and both whole-scope reviews in parallel, and no artificial queue.

## Goals

- One review unit per lane; the same reviewer thread owns it until a current `PASS`.
- No content-round cap; no `VIOLATION` close for a review; `FINDINGS` and `ERROR` never approve.
- Every due review starts immediately; parallelism is the default, and the only serialization is a
  shared reviewer thread.
- Whole-scope reviews are snapshot-bound, so writes cannot throw a verdict away.
- `integration-review` is required until `PASS`.
- Transport limits (timeout, start retries, backoff) stay and bound one attempt, not the loop.

## Non-Goals

- No change to the committed `reviews/<taskId>.json` format, the local record paths, the approval
  audit, or the archive eligibility fields.
- No approval revocation on a later edit: a `PASS` stays durable and a lane reopens on a new tick or a
  new section review, not on every write. Making a `PASS` tree-bound is a separate change.
- No per-lane reviewer target matrix. The "role" is the unit owner: the same `codex` target with one
  thread per unit. A profile can change the target, but not assign different roles per lane.
- No new queue UI. The status shows active runs, not positions.
- No change to the review instructions' P0/P1 rubric or the focused task re-review contract.

## Decisions

**D1 — The unit is the lane section, always.** A level-2 section that resolves and has at least one
checked task without a current `PASS` is one unit covering every checked task of the section;
per-task units remain only for a task outside a section or an unresolvable section. Rejected: keep the
"two or more missing" rule (a lane with one remaining task silently becomes per-task, which is the
observed fan-out); select sections only on an explicit selector (the gate would still fan out).
A section unit re-reviews already approved tasks in its coverage. That is intended: the lane owner
confirms the lane as a whole, and a section `PASS` preserves matching approvals byte-identically.

**D2 — Continuity through the existing key and a stable snapshot path.** The prompt renders
`- Review key: review:<change>:section:<key>` (or `:task:<id>`, `:whole:<phase>`) before `## Context`;
the Codex provider parses it (it already requires a key and a digest line). The snapshot directory is
derived deterministically from the key (a sanitized slug under `.dsh/workflows/snapshots/`) instead of
`<runId>`, and is discarded at settle and recreated for the next round. The provider's confinement
check compares the cwd, so a stable path is what makes `thread/resume` possible; the thread id is
persisted per workspace by the provider. Rejected: DSH subagent continuation via `send_message` (the
review executor starts a provider activation, not a continuable child); passing
`agentOptions.reviewKey` alone (the prompt key is the existing, provider-agnostic contract, and the
fork rejects an unknown target option on other providers); a fresh reviewer with findings and diff
(today's behavior, and the user's pain). If the snapshot path was removed or the thread is gone, the
provider starts a fresh thread and the round still succeeds; continuity is an optimization, not a
correctness requirement.

**D3 — No content-round cap; the waiting close.** At a turn close the engine advances every open
review run (a blocked `FINDINGS` step is re-requested at the new digest), starts every due unit that
has no live run, and then decides: if every due unit has a live review, the close is allowed as a
waiting close with a steer naming the runs and a no-writes request, and no `VIOLATION` is recorded;
otherwise the close is refused until every due unit is live. A run containing an owned review step is
never released by `maxBlocks`, and a matching `ERROR` is no longer provisional evidence for a close.
Only a current `PASS` clears a unit. Rejected: a synchronous close that blocks the host for the whole
review (5–30 minutes, no verdict delivery, host timeouts); refusing the close while a review is live
(the settlement starts a new turn, so a never-ending turn cannot receive the verdict — a deadlock);
keeping `maxBlocks` (the observed "three tries and a violation"). The transport `ERROR` path stays
retryable: a permanent start failure is refused and named, and the user's only escape is cancel or a
fix — the cost of "no limits".

**D4 — Whole-scope reviews use the snapshot; a reviewed spec stays reviewed.** A spec review
snapshots and binds only the change artifacts it read (proposal, design, delta specs, task text with
checkbox state normalized); the worktree is context, not a reviewed input, so parallel worktree work,
task ticks, and task approvals neither discard its verdict nor stale its record. An integration review
is the final worktree check: it snapshots the worktree and binds the worktree digest captured at
snapshot time, so a later worktree write makes its record stale. A write during either run no longer
discards the verdict as an input-change `ERROR`; the live mutation guard remains only for the fallback
when a snapshot cannot be built. The owner's rule is explicit: reviewed means reviewed for the reviewed
scope, and work outside that scope must not invalidate the verdict. Rejected: keep the live guard (the
`reviewed-inputs-changed` storm the owner hit in session `a3f3e385` while another change wrote the
worktree); start whole-scope reviews only when the tree is quiet (the engine cannot know, and the agent
keeps writing); accept the discard and retry (wasted paid runs). Tradeoff: a spec review still goes
stale when the plan artifacts themselves change, because that is the thing being reviewed.

**D5 — Parallel admission, no artificial queue.** Every distinct review is admitted immediately. The
queue keeps identity dedupe, per-run records, backoff/retry, and the off switch, but no longer counts
active runs, queues waiters, or times out an admission; `concurrency`, `maxQueued`, and
`waitTimeoutMs` are accepted and ignored (deprecated) so an existing profile still loads. Review
starts are exempt from the generic `maxRuns` limit because the number of due units is bounded by the
plan, not by the run history. The gate starts every due unit in one pass. The only serialization left
is a shared unit thread (two rules on one unit), which is a real provider constraint. When the
provider's own active-child limit defers a start, the attempt retries with backoff as a transient
failure; the platform bound is not turned into an engine queue. Rejected: keep `concurrency: 10`
(artificial, and four runs already timed out behind two installed slots); raise the number (still a
cap and a queue); a per-provider concurrency config (more surface for no gain).

**D6 — The gate dispatches, the model does not orchestrate.** The turn-close gate starts the due
units itself, through the same start path and identity dedupe as the trigger, and bypasses the
trigger's per-turn dedupe key. The `fs.change` trigger remains for the tick event. Rejected: rely on
the agent's `workflows start` (the observed sessions show it forgetting or duplicating); rely only on
the trigger (a code fix does not touch `tasks.md`, so no trigger fires and the unit waits for a tick).

**D7 — Integration review is required.** `integration-review` loses `nonCritical` and the soft
settlement, and the agent archive path requires its current `PASS` when the task list is complete.
The user-clicked archive stays the explicit human override. The parity report drops the legacy soft
integration entry as a declared, documented difference, and the report and template hashes are
regenerated. Rejected: keep the soft rule (contradicts "до PASS"); make the click require it (the
click is the user's override by design).

**D8 — Transport limits stay.** The review timeout (setup: 30 minutes), `maxAttempts` (3 per attempt),
backoff, and the retryable failure classes bound one attempt. The number of content rounds is
unbounded. Rejected: remove the transport limits (a dead provider would spin with no diagnostic and
no bounded attempt); treat them as round limits (the original bug).

**D9 — `maxBlocks` is optional and unused for review runs.** The settings schema keeps `maxBlocks` for
the non-review definitions and makes it optional with the default 3; the three shipped review
definitions omit it. The gate ignores any declared value when the run contains an owned review step,
including a local override that keeps `nonCritical: true`, so a local definition cannot weaken the
review obligation. Rejected: keep the field required with 3 on review definitions (a misleading limit
in the UI and on disk); remove the budget from the schema (breaks `retro`/`verify`).

**D10 — Key and path format.** The unit key is built from the change name and the unit: `section` plus
the engine's section key (heading number, normalized title, or `untitled`), `task` plus the task id,
or `whole` plus the phase. The snapshot slug is a deterministic sanitized rendering of the key (a
short hash plus a readable prefix), so two units never share a path and a path never contains a
separator or traversal. The prompt places the key line before `## Context`; the digest line already
exists.

## Risks and Mitigations

- **Settlement delivery under the waiting close.** If the provider settlement cannot start a turn from
  a closed-but-waiting session, the loop stalls with a visible live run. Mitigation: the acceptance
  test covers verdict delivery; recovery is `workflows resume`; the run and record stay visible.
- **Thread resume after the snapshot is recreated.** The provider resumes by path; a missing thread
  falls back to a new one. The round still runs; continuity is best-effort. The Codex live check
  reports `threadReuse=resumed` when it works.
- **Unbounded loop cost.** A reviewer that keeps finding issues burns Codex time and tokens until the
  user intervenes. That is the requested semantics; the steer names the unit and the run, and the
  user can cancel or correct the finding.
- **Provider child limit.** The runtime's active-child limit can defer starts; they retry. The engine
  adds no second queue, but the platform bound may still limit real parallelism; the status shows the
  retrying attempts.
- **Stale whole-scope records.** A write during a review forces another full round. The guidance says
  finish writes first; the snapshot prevents the discard.
- **Parity.** Retiring the soft integration entry changes a certified parity scenario. The report is
  release-bound; `workflows-parity --check` must pass with the regenerated report and the declared
  difference documented in `docs/openspec-status.md`.
- **Installed profile.** The live profile runs v0.42.0. The change takes effect only after the owner
  installs a release; no agent session installs into the desktop profile.

## Migration and Compatibility

- Records and committed approvals are unchanged; existing `PASS` records and audits stay valid.
- An interrupted review run resumes; the first round after the upgrade starts a fresh Codex thread
  (the old prompt carried no key), and later rounds resume it.
- A profile that still sets `reviewQueue.concurrency`, `maxQueued`, or `waitTimeoutMs` loads, and the
  fields have no effect. The shipped defaults and the generated setup patch drop them.
- A local review definition that still declares `maxBlocks` or `integration-review`'s `nonCritical`
  still loads; the gate ignores both for a run containing an owned review step.
- `docs/workflows.md`, `AGENTS.md` §5, and the shipped `task-lanes.md` guidance move to lane-parallel
  review and the waiting close in the same change; the repository gate (`pnpm check`, `gen:check`,
  `validate:repo`, parity) must stay green.

## Test Plan

- `review.test.ts`: the prompt carries the unit key; the same key across rounds; the focused task
  round; the whole-scope round is full.
- `review-snapshot.test.ts`: the stable unit path, discard and recreate, lease/sweep.
- `engine-gates.test.ts`: lane-first units (including one missing task), `ERROR` is not coverage, the
  gate starts every due unit, the waiting close, no budget release for a review run.
- `review-queue.test.ts` / `review-scheduler.test.ts`: immediate admission with N concurrent runs,
  identity dedupe, retired limits, transport retry.
- `review-host.test.ts` / `host-wiring.test.ts`: the gate dispatch path, whole-scope snapshot, stale
  whole-scope record, integration required, the archive refusal.
- `definitions.test.ts` / `review-config.test.ts`: optional `maxBlocks`, the shipped definitions omit
  it, the retired queue fields load and do nothing.
- Acceptance (`acceptance.test.ts` in a throwaway `DSH_HOME`): a fake change with two lanes and a
  scripted reviewer provider; both lanes start together, each keeps one key across a `FINDINGS` and a
  `PASS` round, the waiting close is allowed, no `VIOLATION` is recorded, approvals are written, and
  the integration review is required before archive.
- Spec-review durability: a concurrent worktree write during or after a spec review publishes and
  keeps the `PASS`; a task tick and a portable approval leave the normalized artifact digest
  unchanged; an edit to `proposal.md`, `design.md`, or `specs/**` stales it; the archive after all
  ticks accepts the creation `PASS`.
- Live Codex check (manual, read-only): a second round of one unit shows `threadReuse=resumed` in the
  provider's run metadata.
