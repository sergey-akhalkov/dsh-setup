# Design

## Context

See `proposal.md` - Why. Today `reviewedInputs` builds a review's live input set in two pieces: a
change-artifact walk that already excludes `.openspec.yaml` and the change-root `reviews/` approval
directory, and a Git-visible walk (`git ls-files --cached --others --exclude-standard`) that filters only
`.dsh/` and `.tmp/`. A portable task approval is written into the change's `reviews/` directory on a task
`PASS`, so the Git-visible walk sees it and a concurrently running review fails the mutation guard. The
same Git-visible walk is the task-review fallback when `createReviewSnapshot` cannot build the frozen
snapshot, and the fallback currently reports only `live worktree`.

`DEFAULT_TIMEOUTS.review` is 600 000 ms. A whole-spec `xhigh` review of a large change has exceeded it,
produced an `ERROR` record, and left the strict gate requiring the same review again.

## Goals / Non-Goals

**Goals:**

- A portable approval record written during any review never invalidates that review or a concurrent one.
- The live fallback reports a bounded, actionable reason in the run detail.
- The default review timeout fits a whole-spec `xhigh` review while remaining a bounded failure.

**Non-Goals:**

- Serializing live reviews or changing the run queue.
- Auto-writing `.dsh/` into a repository's ignore files; the prerequisite and its documentation stay.
- Changing the worktree digest, the task/spec digest, the record shape, or attribution.
- Changing the snapshot build, the gate rules, or whole-spec/integration review semantics beyond the
  approval exclusion.

## Decisions

### D1 - The approval directory is engine output, filtered from the Git-visible guard

In `reviewedInputs`, after `gitInputSignature`, remove every entry whose absolute path is the change's
`reviews/` directory or lies under it, for every review scope that uses the Git-visible set (task
fallback and implementation-complete). The change-artifact walk already excludes it. The filter applies
to the guard only; `worktreeDigest` keeps covering the directory as content identity, so existing digests
and gate comparisons do not change.

Alternatives considered:

- Serialize live reviews per change: reintroduces the serial bottleneck the snapshot work removed and
  does not cover a whole-spec review racing a task review.
- Auto-add `.dsh/` to `.git/info/exclude`: mutates the user's repository and changes a documented
  prerequisite; adding the ignore rule stays the operator's action, now named by the fallback reason.
- Drop the live mutation guard: loses protection against real writes during a fallback review.
- Exclude the approval directory from the worktree digest too: changes gate digests, progress-note
  freshness, and attribution beyond this fix. The digest may keep covering the directory because an
  approval record is not reviewed content.

### D2 - The fallback reason travels through a callback and survives settlement

`createReviewSnapshot` gains an optional `onUnavailable(reason)` callback. Every early `undefined`
return reports one fixed, bounded reason: change directory outside the repository, unresolvable
repository/change path, `.dsh/` not Git-ignored (with the next action), unmerged index entries, or a
generic snapshot-build failure. `prepareReview` stores the reason on `ReviewPreparation`, and
`beginReviewRun` writes `live worktree: <reason>` as the run detail. The terminal marks replace the
running detail, so a small `withFallbackDetail` helper appends the same bounded cause to the verdict or
error detail, keeping it available after settlement. Omitting the callback changes nothing, so the
exported function and existing tests stay source-compatible.

Alternatives considered:

- Return a discriminated union: accurate, but rewrites the exported return type and every snapshot test
  for a diagnostic; the callback is smaller and leaves behavior identical.
- Re-run the cheap preconditions in `prepareReview` to guess the reason: duplicates the checks and can
  misreport a later build failure.
- Include the raw git error: may contain machine paths and git noise; the fixed reasons are actionable
  and the generic failure still says the snapshot build failed.

### D3 - Default review timeout becomes 20 minutes

`DEFAULT_TIMEOUTS.review` becomes 1 200 000 ms. A whole-spec `xhigh` review of a large change needs more
than the measured 10-minute budget, and the strict gate retries an `ERROR`, so a too-small default turns
a slow review into a repeated one. The config override and the timeout error text stay as they are, so a
profile can still widen or narrow it.

Alternatives considered: an unbounded review (a stuck target would never fail), a per-rule timeout (new
config surface for one observed need), or narrowing the review prompt (changes review quality).

## Risks / Trade-offs

- [A repository that does not ignore `.dsh/` still uses the live fallback] -> the fallback no longer
  self-invalidates, and the run detail names the missing ignore rule and its fix.
- [The worktree digest still covers approval records while the guard ignores them] -> the verdict binds
  to the start-of-run identity; approval records are engine metadata, not reviewed content, so a later
  approval write must not discard it.
- [A longer default timeout delays failing a stuck review] -> bounded at 20 minutes, configurable, and
  the timeout error still names `timeouts.review`.
- [A future engine write under the change directory could be mistaken for review output] -> only the
  exact `reviews/` directory of the reviewed change is filtered; all other paths stay guarded.
