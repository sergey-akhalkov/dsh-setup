# Proposal

## Why

`buildConditionContext` rejects owner-authored task prose as if it were a filesystem path
(`packages/plugin-workflows/src/host/condition.ts:188-227`). A task line containing
`https://github.com/…`, a custom-scheme address such as `sidebar://worktrees`, or even prose such as
``refuses `mv`/archive`` trips the `absolutePath` regex (`:` or a closing backtick immediately before
`/`). The build then throws, `conditionsFor` records a listener error and answers `false` for every
conditional definition, and the turn close reports `condition-false` for `spec-review` and
`integration-review` — so both reviews are silently suppressed (issue #6).

The guard's live surface is only prose. A `condition` is accepted only on a `turn.stopping` trigger
(`definitions.ts:517-523`), the turn-stopping definition event carries no `path` or `command`
(`index.ts:260-261`), and the built context is never persisted or rendered — a predicate only returns a
boolean, so a path written in owner-authored prose has no channel to escape. The archived Release A
design already treats that prose as plan text, not untrusted input
(`2026-11-16-move-review-runtime-into-workflows/design.md:173-177`); the guard nevertheless disables the
review engine for it.

Three of the four open changes in this repository currently fail the build: `rebrand-to-dsh-studio`
(an `https` URL), `add-worktree-cleanup` (`sidebar://worktrees`), and `add-exploratory-testing`
(``refuses `mv`/archive``).

## What Changes

- Narrow the condition-context path guard to the values that are real path inputs: `event.path`,
  `event.command`, and each lane's `owned` globs. Task text and lane titles are owner-authored prose and
  are no longer rejected. Absolute POSIX paths in prose therefore stop disabling condition evaluation;
  the boundary moves to lane ownership (which feeds the lane-assignment payload) and to the event fields.
- Keep the rest of the boundary for the retained values: drive, UNC, traversal, delimiter-adjacent
  absolute POSIX paths, and shell redirection stay rejected.
- Exempt non-`file:` URL spans from the retained guard, so a future `event.command` source cannot
  reintroduce this failure. `file:` URLs stay rejected because they name a machine-local path.
- When a context build must fail, every condition-bearing definition records `error` with a bounded
  detail instead of `condition-false`; the health record keeps the cause, and unconditional definitions
  still evaluate for the same event.
- Update the guard's rationale comment, the `docs/workflows.md` trigger paragraph, and the
  `workflows` `Review condition` requirement with a delta scenario for prose and for the failure state.
- Flip the affected boundary tests from rejection to build assertions, add URL and inline-code cases,
  add the `error`-row test, and rebuild the committed `lib/**` output.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflows`: `Review condition` states which context values are path inputs, exempts owner-authored
  prose and URLs, and requires a context-build failure to record `error` rather than a false condition.

## Impact

- `packages/plugin-workflows/src/host/{condition.ts,triggers.ts,index.ts}` and the built
  `packages/plugin-workflows/lib/**`.
- `packages/plugin-workflows/test/condition.test.ts` and the trigger-context tests.
- `docs/workflows.md`; `openspec/specs/workflows/spec.md` (delta in this change).

Out of scope: any change to the shipped `spec-review`/`integration-review` conditions, to the
definition-load predicate rule that rejects paths inside a predicate, to the lane-assignment steer
payload, or to the event sources. The archived Release A design and its D14 entry stay as history and
are not rewritten. This change deliberately reverses one expectation from issue #6: an absolute path in
task prose is accepted; the rejection is kept for lane ownership and the event fields, where a machine
path is a genuine input.
