# Design

## Context

See `proposal.md` — Why. The constraints that shape the approach:

- DSH 0.2.1-rc.3 owns the goal stack. `dsh-goal` is the durable, event-sourced service (`create`, `edit`, `pause`, `resume`, `block`, `clear`, `disarm`) and deliberately disarms every goal on `agent/created`; `dsh-goal-round-driver` is the only continuation engine. It disarms on `max-tokens`, on `agent/error`, and on any `aborted` turn that did not claim a goal attempt; it pauses on the idle settlement of a cancelled goal round; it blocks with `code: "round-limit"` at the cap. `goal/changed` carries the change but no actor.
- The model-facing goal tools forbid the model from resuming a paused goal; the service itself is the lifecycle-owner seam, and the loop-guard already crosses it with `pause`/`resume` semantics in the driver.
- `dsh-agent-loop` wakes the driver for both `followup()` and `steer()`; `inject()` is the only non-waking delivery. The goal driver pauses a cancelled goal round in its `agent/status idle` handler, after the `turn/end` dispatch.
- The repository's loop-guard is a shipped Host plugin; its reset is a hook cancellation whose reason is a plain string. The working contract is an always-on contribution with a 1500 estimated-token budget, measured by repository validation.
- The setup package mounts plugin rows through generated fragments; the plugin is a normal Host-only bundle and must follow `AGENTS.md` §5.

## Goals / Non-Goals

**Goals:**

- Remove the four harness-artifact stops that cost the inspected session hours: disarm after a non-goal abort, the driver's pause after a recoverable loop-guard reset, disarm after a user stop on a non-goal turn, and a durable `round-limit` block.
- Keep the loop-guard fully authoritative: it still cuts the stream, resets the turn, and final-stops; the supervisor only translates a recoverable reset into continuation, with a budget.
- Make every automatic action and every terminal refusal visible in the UI (notice, goal card, or `/goal`), so the user never has to ask "why did it stop?".
- Reduce the waiting waste through guidance in the existing contract, without adding a second always-on section.
- Keep the plugin small, additive, reversible, and free of any driver fork or model call.

**Non-Goals:**

- No automatic resume after a user pause/clear/complete, a `model-reported` block, a `loop-guard:final:` or unrecognized hook cause, `max-tokens`, or an agent error.
- No automatic restart resume by default; no fork/subagent supervision; no Client UI; no new token budget; no scheduled job.
- No global increase of `defaultMaxGoalRounds`; the 256 default remains the safety budget and the supervisor extends only the goal that reaches the limit.
- No change to loop-guard detection, limits, notices, or escalation behavior.

## Decisions

### D1 — Supervisor plugin over the public goal service, not a driver fork

A Host-only `@dsh-setup/plugin-goal-continuity` bundle injects `goals` and `agents` and calls only `get`, `disarm`, `resume`, `edit`, `block` (a terminal refusal), and non-waking `agent.inject` (a notice). It never starts or cancels a turn, never uses `followup` or `steer`, and never calls the model.

Alternatives: fork `dsh-goal-round-driver` (rejected: upstream logic, race fences, maintenance); patch the app.asar (rejected: not a tracked artifact, breaks on every DSH update); do nothing (rejected: the session evidence shows hours lost per day).

### D2 — Deterministic signals only

The supervisor uses the durable turn-end reason, the goal-round message source, and the goal service events. It does not parse `/goal` commands, time deltas, or actor heuristics.

The available signals are explicit in the code and the session log:

| Signal | Use |
|---|---|
| `turn/end` `reason.kind` and `reason.reason.kind` | `aborted`/`hook` vs `aborted`/`user` vs `max-tokens` vs `interrupted` |
| `turn/end` `reason.reason.reason` prefix | `loop-guard:reset:` vs `loop-guard:final:` |
| `user/message` with `source.kind === "goal"` | the current turn is a goal round |
| `goal/activation-changed` | the goal was armed/disarmed (in-process disarm, restart disarm) |
| `goal/changed` | pause, block with `code`, revision updates |
| `agent/error` | infrastructure stop |
| `session.header` | fork/subagent exclusion; session creation time for the restart policy |

Alternatives: schedule/command parsing (rejected: `command/run` records `/goal` command use only; UI pause/resume leaves no command event); timing windows (rejected: fragile and untestable); inferring a user pause from `goal/changed` (rejected: no actor field).

### D3 — Prevent the driver's pause for a goal-round hook abort; do not weaken the guard

The loop-guard's reset is a recovery instruction, not a stop. Its cancellation ends the turn as `aborted`; the driver marks the goal attempt cancelled and pauses the goal in the later `agent/status idle` handler. The supervisor acts in the `turn/end` dispatch, which precedes the idle settlement: for any goal-round hook cause (reset, final, or unrecognized) it calls `goals.disarm` before the idle, so the driver's pause condition (phase active and activation armed) is false and no pause is recorded. A terminal cause also records its suppression synchronously in the same handler, before the disarm, so the deferred reconcile cannot resume the goal before the block. It never disarms for a user abort, and it never changes a paused goal.

After the settlement the goal is `active + disarmed`: a reset continues through reconciliation (or a cap extension at the cap), while a final or unrecognized cause is blocked with `continuity-stopped`. A user pause is a durable `paused` phase and is never resumed, so the supervisor has no ambiguous pause to interpret and no UI-pause race.

A reset on the last permitted round produces the same active+disarmed state; `resume` would be rejected by the round budget, so the supervisor extends the cap (shared extension budget) before resuming, or blocks with the reason when the budget is exhausted.

The loop-guard's hook reason gains a machine-readable prefix: `loop-guard:reset: <existing human text>` for a reset and `loop-guard:final: <existing human text>` for the final stop. Detection, limits, notices, and the human text are unchanged. The prefix is a small instrumentation change, not a behavior change. A `loop-guard:final:` or unrecognized hook cause is terminal: it blocks reconciliation even on a non-goal turn, where the driver merely disarms the goal, and records a `continuity-stopped` block on the active goal.

Alternatives: translate the driver's pause (rejected: the pause has no actor, so a UI pause in the same window is indistinguishable, and it costs two durable changes); disable the guard's reset/final stop while a goal is active (rejected: removes the brake that was doing its job); retry every hook abort without distinction (rejected: undermines the final stop); parse prose (rejected: brittle).

### D4 — Restart resume is opt-in and detected from session creation time

`resumeAfterRestart` defaults to `false`. The supervisor identifies a restored session by comparing `session.header.createdAt` with the plugin's mount time: an active goal in a session created before this process mounted is a restart observation; a goal in a session created later is in-process. When the check is unavailable, the fallback is the first observation per agent, marked on `agent/created`.

Alternatives: always resume (rejected: revives work the owner closed the app to stop); add a durable "continuity" field to the goal (rejected: the goal schema is closed); infer from the goal's `updatedAt` (rejected: a process-local disarm writes no durable timestamp).

### D5 — User stop policy: goal-round vs non-goal turn

A user abort of a goal round is a goal-level stop: suppress until the next direct user message, and the driver's paused phase is the visible stop. A user abort of a non-goal turn is a turn-level stop: with `resumeAfterUserStop: "non-goal"` the supervisor re-arms the goal after that turn settles and records one notice; with `"never"` it suppresses until the next direct user message and records one notice. The inspected 6h20m gap was a user stop on a non-goal turn, which is exactly this case.

Alternatives: respect every Stop (rejected: a turn-level Stop silently kills a multi-day goal); ignore every Stop (rejected: fights an explicit goal-level stop); add a third `"always"` value (deferred: no evidence for it).

### D6 — The round cap stays a real budget; extension is bounded

The 256 default is unchanged. On a `round-limit` block the supervisor raises `maxGoalRounds` by `roundExtension` (1000) and resumes, at most `maxRoundExtensions` (2) times per goal, and never beyond `hardMaxGoalRounds` (5000). A reset that lands on the last permitted round uses the same extension before its resume. When the extension budget or the hard total cap is exhausted for a `round-limit` goal, the goal keeps its native `round-limit` block, which is the visible record, and the supervisor injects a non-waking notice with the remaining budget and next action. When the exhausted path is a reset at the cap, the goal is active and is blocked with `continuity-stopped`. A `model-reported` block is never changed. Every extension is a visible notice.

Alternatives: raise the global default (rejected: silently raises every goal's budget); remove the cap (rejected: no budget at all); extend without a limit (rejected: turns the budget into a formality).

### D7 — Goal behavior lives in the existing working contract

The wait, blocker, completion, and round-cap rules are added to the existing working-principles section, not to a new always-on section or a plugin prompt. The current contract is ~4876 bytes (~1219 estimated tokens); the addition stays under the documented 1500 budget and validation measures it.

Alternatives: a new plugin prompt section (rejected: another always-on contribution to budget and validate); a one-time notice (rejected: compaction can drop it); the built-in `tool:goal` guidance only (rejected: it does not cover the wait behavior).

### D8 — Notices through the existing notice pattern

The DSH agent loop wakes the driver for both `followup()` and `steer()` (`wakeup: true`); only `inject()` is non-waking. The plugin therefore delivers every notice with `agent.inject` into the next step, so an idle agent stays idle and the notice rides the next goal round. It MUST NOT use `followup` or `steer`.

A terminal refusal must not start a turn either. The supervisor blocks the active goal with `continuity-stopped` and a bounded, trimmed reason and next action; the goal card and `/goal` are the passive visible record. When the goal is already blocked with `round-limit`, the supervisor does not replace the block: that native reason is the visible record and the supervisor injects one non-waking notice. A goal already paused by the user stays paused and is not changed. The notice is a `UserMessage` with source `kind: "goal-continuity"`, `form: "notice"`, bounded text; the loop-guard's construction is the pattern and the plugin declares its source in `MessageSourceMap`.

Alternatives: a follow-up report (rejected: starts a model turn after a stop, exactly what must not happen); `steer` (rejected: wakes the agent); a system-prompt section (rejected: D7, and it would not carry the per-incident cause); silence (rejected: the user must not have to ask); a Client toast (rejected: no Client UI in this change).

### D9 — Act in the turn/end dispatch, reconcile after it settles

The supervisor's `turn/end` handler runs synchronously inside the agent's turn; the driver's pause runs in the later `agent/status idle` dispatch. That ordering is the mechanism: the disarm for a goal-round hook abort is recorded before the idle settlement, so the driver sees a disarmed goal and skips the pause. The remaining decisions (reconcile, resume, extend, block) are scheduled after the current dispatch settles, so the goal service's `agent/created` disarm, the driver's settle, and the supervisor's own disarm are all visible.

Alternatives: translate the driver's pause (rejected: no actor, UI-pause race); act inside the idle dispatch (rejected: listener order between the supervisor, the driver, and the goal service is not a contract); poll on a timer (rejected: wasted wakeups and races).

### D10 — Composition: normal Host-only bundle, enabled by default with conservative flags

`packages/plugin-goal-continuity` follows the loop-guard/rust bundle shape: manifest, fragment, locale, icon, Host source, tests, tsconfig reference. The row is enabled, with `resumeAfterRestart: false`, `resumeAfterUserStop: "non-goal"`, `maxSessionResumes: 20`, `roundExtension: 1000`, `maxRoundExtensions: 2`, `hardMaxGoalRounds: 5000`. `enabled: false` or a disabled row leaves stock DSH behavior with no side effects.

Alternatives: default-off until live acceptance (viable, but then the in-session pain is not fixed out of the box; the restart flag is the actual safety override and it is off); a separate row per behavior (rejected: no need).

### D11 — The bridge is deliberately small; the policy gap belongs upstream

The DSH goal layer has no continuity policy and no actor in `goal/changed`. This change does not patch it. The design records the two upstream gaps in the README/design so a future DSH release can absorb them; the plugin surface (`get`/`resume`/`edit`) is small enough to retire when it does.

## Risks / Trade-offs

- **Internal goal service API** → pin DSH 0.2.1-rc.3 in `engines.dsh` and devDependencies; unit tests fake the service but the composition check exercises the real one; a DSH bump must revalidate the method signatures.
- **Event-order dependency for the pause prevention** → the disarm relies on `turn/end` being dispatched before `agent/status idle`, which holds in DSH 0.2.1-rc.3. If a future version reverses it, the driver pauses and the supervisor does not resume a paused goal: a safe degradation where the goal stops and the user resumes. A test covers the reversed order and asserts no resume.
- **A user pause is never resumed** → the supervisor reconciles only `active + disarmed`; a user pause sets `paused`, which the reconcile and the reset path never touch. The pre-settle disarm does not change a paused phase.
- **Extra durable changes** → the reset path now writes one resume change (the pause is prevented), and a terminal refusal writes one block; both are visible in `/goal` history.
- **`resumeAfterUserStop: "non-goal"` can surprise** → the notice names the turn-level stop and `/goal pause` is the goal-level off switch; `"never"` is the strict profile choice. This is the one deliberate autonomy-over-Stop trade-off.
- **Budget exhaustion on a long goal** → 20 resumes is a safety net, not a normal operating point; on exhaustion the active goal is blocked with a visible reason and `/goal resume` as the next action. A multi-day goal that degenerates 20 times should stop.
- **Cap extension increases token spend** → bounded per goal and by the hard total; every extension is visible. A reset on the last permitted round uses the same extension budget as a `round-limit` block.
- **Restart resume remains off by default** → the restart gap from the proposal is not removed until the owner opts in; this is intentional.
- **Notice delivery never wakes the agent** → `agent.inject` is non-waking; a resume notice rides the next goal round. A terminal refusal is a `continuity-stopped` block, so the reason is visible in the goal card and `/goal` without any turn; an already-blocked `round-limit` goal keeps its native block and gets only the injected notice. A user pause stays paused and is not explained by an automatic notice.
- **A terminal refusal changes the goal phase** → blocking an active goal makes the stop durable and visible in the goal card and `/goal`; the user can still resume with `/goal resume` when the round budget allows. This is deliberate: a silent disarmed goal was the original failure.
- **Working-contract budget** → the addition is measured by the existing validation; it stays under 1500 estimated tokens.
- **The loop-guard prefix is a cross-plugin contract** → the prefix is covered by loop-guard tests and by the goal-continuity spec; the human-readable text stays, so old logs and readers are unaffected.

## Migration Plan

1. Add the plugin package, the loop-guard prefix, and the contract paragraph; run `pnpm gen`, `pnpm build`, and `pnpm check`.
2. Regenerate the setup manifest, patch, and vendored tree; update the README row and docs; run `pnpm validate:repo` and `pnpm validate:composition`.
3. Release a new setup version; the owner fully quits and relaunches the Desktop app (never from an agent-hosted shell).
4. Live acceptance: with the plugin enabled and a short goal, verify a non-goal stop re-arms the goal, a goal-round reset resumes it with a notice, a terminal stop leaves a visible blocked or paused record with no new turn, a restart stays disarmed by default, and `/goal pause` remains final.
5. Rollback: disable the row (or `enabled: false`); no data migration is needed, goals remain durable, and the loop-guard prefix alone is harmless.

## Open Questions

- After the live acceptance, should the owner flip `resumeAfterRestart` to `true`? This is an owner decision, not a spec or task blocker.
