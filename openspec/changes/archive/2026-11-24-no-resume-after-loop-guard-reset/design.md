# Design

## Context

The supervisor maps a `turn/end` reason to a cause (`hookCause`): a `loop-guard:reset:` prefix becomes
`reset`, `loop-guard:final:` becomes `final`, anything else hook-shaped becomes `unknown-hook`. On a
reset it disarms the goal (pause prevention), schedules a reconcile, and the reconcile resumes the
active disarmed goal when the evidence rules and the resume budget allow it — "the harness stopped
the turn, not the goal".

That translation is wrong for the loop guard: a `reset` is emitted because the model repeated a
reasoning line, so the model that a resumed goal would drive is still looping. In session
`session-ea02b074` this produced "resumed the goal after a recoverable loop-guard reset. Automatic
resume 1 of 20" and "2 of 20" while the guard kept cutting the same line; the final stop then blocked
the goal anyway.

Two existing behaviors constrain the change:

- `handleTurnEnd` runs `applyContinuationDecision` before the hook branch, and that decision may
  already set a non-terminal suppression and queue its own notice (a done or `user_decision` plan, or
  the second consecutive no-effect round). A reset branch must not overwrite that state or add a
  second notice.
- The reconcile's capped-goal branch (`continueAtCap`) is generic: any unsuppressed active disarmed
  goal at its cap is extended before the resume. It is also the recovery after a direct user message
  cleared a reset stop, so it must stay.

## Goals / Non-Goals

**Goals:**

- A loop-guard reset never resumes the goal; the goal stays `active` and disarmed, with one bounded
  notice naming the reset and the recovery.
- Keep the existing disarm, so the driver does not record a pause and no phase changes.
- Keep an already-decided stop's suppression and notice untouched.
- Keep the generic capped-goal extension, including recovery after a user signal.

**Non-Goals:**

- Changing the loop guard (it already bounds itself: three notices, two resets, final stop).
- Changing the evidence rules, the no-effect counting, the resume budget, or the blocked
  `round-limit` extension.
- Blocking the goal on a reset; blocking stays reserved for the final stop and the budget paths.

## Decisions

### D1: a reset stop only when nothing else already stopped continuation

`handleTurnEnd` for `hook === 'reset'`:

- keep `preventPause(agent)` for a goal round (the disarm that prevents a recorded pause);
- set `state.suppression = { cause: 'loop-guard-reset', terminal: false, detail: 'the loop guard
  stopped a repeated line' }` **only when `state.suppression === null`** after
  `applyContinuationDecision`, and deliver the reset notice only in that case;
- always schedule the reconcile, which returns early on any non-null suppression.

So a fresh evidence stop or a second no-effect round keeps its own cause and single notice; the reset
adds no second one. A direct user message already clears the suppression, so the ordinary
continuation rules apply again with no extra code.

Alternative rejected: **resume once and evaluate the next round** — the next round runs over the same
looping model, spends a resume slot and a round, and is the behavior being removed.

Alternative rejected: **deduplicate by the repeated line** — the abort reason's line changes between
turns ("The final answer." vs "The the. The the." vs "The gate repeats…"), so it is not a stable key.

### D2: keep the generic capped-goal path

`continueAtCap` stays untouched. It is not a reset path: it serves any unsuppressed active disarmed
goal at its cap, including after a direct message cleared a reset stop, and it performs the cap
extension the goal service requires before a resume. Only the requirement text changes: at the reset
itself the reset stop is a continuation rule, so nothing is extended and the notice names the cap as
the prerequisite for an explicit resume.

### D3: the reset notice names the state-specific recovery

The notice says the goal is active and automatic continuation stopped, and offers the recovery for
its state:

- below the cap: send a message, or resume with `/goal resume`;
- at or above the cap: send a message (the supervisor raises the cap and continues); `/goal resume`
  alone is refused by the goal service until the cap rises.

### D4: counters stay truthful

The reset round still counts toward `noEffect` and the goal round counter: `applyContinuationDecision`
runs before the hook branch and is not modified. Only the resume decision changes.

## Risks / Trade-offs

- A genuinely spurious reset (one accidental repeated line) now needs a user nudge instead of an
  automatic resume. That is the intended trade: the notice names the cause and the recovery, and the
  goal is never paused.
- Profiles that relied on the automatic reset resume lose it without a flag; that is a deliberate
  breaking change documented in the proposal. No configuration or stored state needs migration.
- A reset stop that replaces a would-be evidence stop is invisible as a reset in that case: the
  evidence notice says why continuation stopped, which is the more precise cause.
