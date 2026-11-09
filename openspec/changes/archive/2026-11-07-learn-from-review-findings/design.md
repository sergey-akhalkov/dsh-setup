# Design

## Context

See `proposal.md` - Why. The review engine already has the raw material:

- `ReviewFinding` in `src/shared/approval.ts` is `{ severity: 'P0' | 'P1', title, evidence, fix }`. It has no class.
- `reviewPrompt()` in `src/host/index.ts` assembles the bundled instruction, the delegated review header, the digest, and the output contract. It is the single place where a lessons section can be added before the contract.
- The local review records under `.dsh/delegation` carry FINDINGS; the portable `openspec/changes/<change>/reviews/<taskId>.json` carries only a PASS and no findings, so the local records are the learning source.
- The review instructions (`review-spec.md`, `review-task.md`, `review-integration.md`) request `{ severity, title, evidence, fix }`; they must request the class too.
- The host already has the `userQuestions` service and the `commands` registry, so a real user decision and a manual command need no new surface.

## Goals / Non-Goals

**Goals:**

- Give every blocking finding a stable class so repetition can be measured without a model.
- Turn repeated classes into a small, user-approved lesson store that is injected into later reviews.
- Keep the loop cheap: one deterministic report, no new log, no extra reviewer, no automatic file edits.
- Preserve the P0/P1 rule, the approval gate, and the existing review records, including when the learning store or history write fails.

**Non-Goals:**

- Learning from P2 or non-blocking observations; the review contract does not report them.
- Automatic acceptance, automatic code changes, or a model grading its own lesson.
- A new package, a new store service, or a new telemetry stream.
- The workflow trigger and the visual editor; `add-workflow-obligations` wraps `review_retro` as a step.

## Decisions

### 1. Class is a record field with a fixed vocabulary and a safe default

Vocabulary: `spec-ambiguity`, `missing-test`, `path-boundary`, `state-persistence`, `stale-input`, `api-contract`, `plan-shape`, `docs-drift`, `security`, `other`.

- `ReviewFinding` gains `class?: FindingClass`. New records always write it; old records read as `other`.
- The verdict parser accepts a valid class; an absent or unknown value becomes `other`. A malformed class never rejects a verdict, because the class is a learning label, not a gate.
- The three review instructions request the class and list the vocabulary. The output contract line names the field.
- The portable PASS record has no findings, so the portable parser and the archive audit are unchanged. A portable record that ever carries a finding gets the same optional treatment.

Alternatives: derive the class from the finding text with a model. It would be slower, non-deterministic, and would make the repeat metric unstable. A free-text tag was rejected because it cannot be counted.

### 2. The store is a bounded local JSONL, keyed by workspace, not by machine path

Path: `.dsh/review-learning/<workspaceKey>.jsonl`, where `workspaceKey = sha256(resolved workspace root).slice(0, 16)`. The root itself is not stored in the file.

```json
{
  "v": 1,
  "id": "lesson-...",
  "class": "path-boundary",
  "title": "Resolve a target by path components",
  "body": "When checking a target against an owned path, compare components; do not use a string prefix.",
  "appliesTo": { "rules": ["task-review"], "capabilities": ["delegation-rules"] },
  "status": "accepted",
  "source": { "change": "add-x", "taskId": "3.1", "findingHashes": ["..."] },
  "createdAt": 1762500000000,
  "decidedAt": 1762500100000,
  "appliedIn": "openspec/changes/add-x/specs/delegation-rules/spec.md"
}
```

- Dedupe key: normalized `class + title` (lowercase, whitespace-collapsed, punctuation-trimmed). A second proposal for a `proposed` lesson updates that record; a duplicate for an `accepted` or `applied` lesson creates a new `proposed` revision with a `supersedes` link, while the accepted/applied content and scope remain immutable.
- Bounds: 200 lessons or 1 MB per workspace, whichever comes first; the oldest non-`applied` lesson is removed first, applied lessons are retained. When no non-applied lesson remains, the write is refused atomically with `capacity` and existing records are unchanged.
- The store is local scratch, never tracked. A missing file is empty; a malformed line is skipped with a count in the report, not silently.

### 3. Acceptance is a user decision, not a model claim

The model may call `review_lesson` with `action: propose`, which writes `proposed`. Accept, reject, and apply call the host `userQuestions.ask` service with a bounded question naming the class, title, body preview, and source. The tool applies only the returned answer and records it.

- `accept`: proposed -> accepted.
- `reject`: proposed -> rejected.
- `apply`: accepted -> applied; requires a target (change/spec/file/test) and asks the user to confirm the target.
- A model cannot pass its own answer; the answer comes from the service. The question carries the exact lesson revision; an answer for an older revision is rejected and the current revision is named.
- A `proposed` or `rejected` lesson is never injected.

### 4. Retro is deterministic clustering over existing records

`review_retro` reads the bounded sanitized finding history for the workspace (default 50 entries, max 200), not the current review record alone. For each finding the retro takes `class` (default `other`), a normalized title hash, and the source record.

It returns:

- counts per class, sorted by count;
- the top class and up to three example findings (title + evidence, bounded);
- the repeat count and rate per class: a finding is repeated when the same class + title hash appeared in an earlier record inside the window;
- at most one proposed lesson draft: template `title`, `body`, `appliesTo`, `source`;
- the skipped/malformed and gap counts.

No model call, no file edit, no new log. The tool output is bounded (default 4000 characters). The caller decides whether to propose the draft.

The review engine overwrites its records on a later PASS, so `completeReviewRun()` appends one history entry after `publishRecord()` has written a PASS or FINDINGS record; a reused matching record appends nothing. History shape: one JSONL entry per settled review (`{"v":1,"kind":"run","rule","change","taskId?","verdict","digest","findings":[{"class","title","evidence","fix"}],"time"}`), or a gap marker (`{"v":1,"kind":"gap","time","reason"}`) with a sanitized bounded reason.

The append is a separate post-publication step, not part of `publishRecord()`. It runs after `publishRecord()` returns and the publish lock is released, and the helper catches every failure and returns a bounded result, so it never throws into the publication `catch` in `completeReviewRun()` and is never called from the `ERROR` or discarded path. A failed append:

- leaves the verdict, the local record, and any portable approval record unchanged, and writes no second or conflicting record;
- attempts one bounded `gap` marker in the same history file, which the retro reports; when the history file cannot be written at all, the run status detail (shown by `delegation_status`) names the gap instead;
- is not retried inside the same completion: the next settled review appends normally, and the marker stays until the history is pruned.

### 5. Injection happens in `reviewPrompt()` and is byte-identical without lessons

The caller loads lessons before building the prompt and passes them to `reviewPrompt()`. The function appends a section before the output contract:

```
## Lessons from prior reviews

- [path-boundary] Resolve a target by path components
  Compare components; do not use a string prefix.
```

- Only `accepted` and `applied` lessons.
- Match `appliesTo.rules` (exact rule id or `*`) and, when `appliesTo.capabilities` is non-empty, the change's delta capability directory names; an empty list matches any.
- At most 3 lessons and 1200 characters; each body is truncated with a marker.
- No matching lesson means no section and the prompt is byte-identical to the classification-aware instruction with lesson injection disabled (tested).
- Lesson text is sanitized (control characters, line separators) and treated as data; the section says the reviewer must apply judgment, not follow it blindly.

### 6. Interfaces and opt-out

- `review_retro`: `report` and `propose`.
- `review_lesson`: `list`, `propose`, `decide` (accept/reject), `apply`.
- `/review-retro`: a host command that runs the report and injects it into the session; it never accepts a lesson.
- `reviewLearning.enabled` (default true): when false, the tools and command are not registered and no lesson is injected; existing records remain readable.
- The tool descriptions name the user-approval rule and the fact that a lesson is data, not an instruction.

### 7. The metric uses records, not a second log

Repeat-finding rate is computed from the same sanitized finding history on demand. The retro report shows it per class; the Workflows projection in `add-workflow-observability` can display the report later without a new store. No counters are persisted; the history is the source of truth.

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| The class vocabulary is too coarse and hides distinct failures. | `other` plus the retro examples; a future class is an additive change to the vocabulary after evidence. |
| A lesson overfits one change. | User approval, source evidence, and the `appliesTo` scope; the report shows repeats before proposing. |
| Lesson text bloats the review prompt. | Max 3 lessons and 1200 characters; no section when none; a byte-identical test. |
| The model proposes a bad lesson. | A model can only propose; a user answer is required for accept/apply; the prompt says to treat lessons as advice. |
| The store grows without bound. | 200/1 MB cap; applied lessons retained; old proposed lessons removed first. |
| A history write fails and hides findings. | The append runs after publication, never throws into the completion path, adds a bounded gap marker the retro reports, and changes no verdict or approval record. |
| Old records have no class. | Normalize to `other` on read; no rewrite; the first retro shows the historical `other` bucket. |
| User approval is friction. | The retro is occasional and returns one draft; the user can reject in one answer. |
| The lesson influences a review incorrectly. | The lesson is bounded advice, not a rule; the P0/P1 rule and the gate are unchanged. |

## Migration Plan

1. Extend `ReviewFinding` and the parser with the optional class; normalize old records on read.
2. Update the three review instructions and the output contract; new reviews start emitting classes.
3. Add the store, the post-publication history append, the tools, and the command; enabled by default with an empty store, so the first review is unchanged.
4. Rollback: set `reviewLearning.enabled: false`; the store remains readable and no review behavior changes.

## Open Questions

None. P2/non-blocking findings are out of scope because the review contract does not report them; adding them later would require a spec change to the review output.
