# Design

## Context

`buildConditionContext` (`packages/plugin-workflows/src/host/condition.ts:188-227`) runs six path
heuristics over `event.path`, `event.command`, each lane title, each lane's owned globs, and every task
text, and throws on the first match. `conditionsFor` (`index.ts:1775-1813`) catches the throw, publishes
a listener error to `health.json`, and answers `false` for every conditional definition, so the trigger
reports `condition-false` (`triggers.ts:368-374`) and no run starts.

Two facts bound the guard's live reach:

- A `condition` is accepted only on a `turn.stopping` trigger (`definitions.ts:517-523`), and the
  turn-stopping definition event carries no `path` or `command` (`index.ts:260-261`). Only the prose —
  task text, lane titles, owned globs — reaches the guard while a predicate can still run.
- The built context is never persisted, rendered, or embedded in a record; a predicate returns a
  boolean (`condition.ts:300-329`). Task prose therefore has no channel to carry a path anywhere.

Issue #6 reports the URL case; the same build also fails today on a custom scheme
(`sidebar://worktrees`) and on prose with a slash after a closing backtick (``refuses `mv`/archive``).
The archived Release A design D14 (`2026-11-16-move-review-runtime-into-workflows/design.md:173-177`)
declared the prose boundary; this change supersedes that clause for prose.

## Goals / Non-Goals

**Goals:**

- Owner-authored prose can never disable condition evaluation.
- A genuine context-build failure is reported as an error, not as a false predicate.
- The retained guard still refuses a machine path where one is a real input, and a URL is never
  mistaken for one.

**Non-Goals:**

- Removing the path guard, or changing the event sources that populate `event.path`/`event.command`.
- Changing the definition-load rule that rejects a path inside a predicate (`validateCondition`).
- Changing the lane-assignment steer payload, the shipped review conditions, or the archived design.

## Decisions

### D1 — The guard covers path inputs, not prose

Keep the check for `event.path`, `event.command`, and lane `owned`; drop it for task text and lane
titles. Prose is owner-authored plan text, a predicate only yields a boolean, and the one live
condition event carries no path. Lane ownership stays guarded because it is a declared path glob that
reaches the lane-assignment payload, and the event fields stay guarded because a future source could
populate them.

Alternatives considered:

- **URL mask only** (the first suggestion in issue #6): fixes the `https`/`sidebar` cases but not a
  slash after inline code, so `add-exploratory-testing` and any future `` `x`/y `` prose still lose
  their reviews, and absolute prose paths keep doing the same.
- **A slash after a delimiter must open a two-segment path**: still a heuristic over prose, misses a
  bare `/tmp`, and re-breaks the next time plan text puts a slash after a code span.
- **Delete the guard entirely**: the retained fields are inert for condition-bearing triggers today,
  but D14's intent — no machine path enters a predicate context — is cheap to keep.

### D2 — A URL is not a filesystem path

Mask every `scheme://…` span except `file:`, with boundaries that fit the field. In a literal value
(an event path or a lane's owned glob) the span runs to whitespace or a quote, so query parameters stay
inside it. In a shell command a quoted URL is one argument and is masked whole, while an unquoted URL
ends at a shell operator so a redirection keeps its path operand visible to the checks. `file:` stays
rejected, as do drive, UNC, traversal, a delimiter-adjacent absolute POSIX path, and shell redirection.

### D3 — A build failure is an error state

Add an optional `conditionError` to `DefinitionEvaluationContext`. When the build throws,
`conditionsFor` returns that error instead of a false map; `evaluateDefinitionTrigger` answers
`reason: 'error'` with a bounded detail for every condition-bearing definition, while unconditional
definitions still evaluate. The health record keeps the cause, as it does today (`lastError`).

Alternatives considered:

- **Return an empty map** (one line): the trigger reports `not-ready` with the existing
  "context is unavailable" detail. Honest, but `not-ready` reads as a transient state and the
  requirement asks for an error.
- **Keep `condition-false`**: this is the silent false report issue #6 asks to remove.

The detail is a fixed bounded string ("the condition context could not be built"), not the raw error
text: causes stay in `health.json`, and a journal row never carries arbitrary content.

### D4 — No record, format, or configuration change

The context is in-memory, records are untouched, and no profile setting is added. The generated
artifacts are the committed `lib/**` and the vendored setup copies under
`packages/setup/node_modules/@dsh-setup/**`, which `pnpm gen` refreshes and `pnpm gen:check` verifies.

## Risks / Trade-offs

- **Prose paths now enter the in-memory context** → no persistence or rendering channel exists; the
  retained rejections and their tests keep the real inputs guarded.
- **An absolute lane `owned` path now surfaces as `error` on every turn close** → that is the intended
  visible failure: the row names the definition, the detail names the missing context, and
  `health.json` carries the cause; the owner fixes the plan.
- **A future event source reuses the context with untrusted prose** → the requirement states the
  boundary, and the URL mask covers the most common false positive; guarding prose again is a new
  change, not a revert.
- **Stricter tests for prose are inverted** → the six rejection cases move to lane ownership and the
  event fields, so the guard's coverage does not shrink to nothing.

## Migration Plan

No migration: no config key, record shape, or profile patch changes. Deploy is the ordinary build and
release; rollback is a revert of the change's commits, which restores the stricter prose guard and the
`condition-false` report.
