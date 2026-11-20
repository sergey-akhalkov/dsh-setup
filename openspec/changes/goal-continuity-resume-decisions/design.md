# Design

## Context

See `proposal.md` — Why. What shapes the approach:

- The supervisor in `packages/plugin-goal-continuity/src/host/index.ts` observes the durable session log and, at each settled turn, reconciles one goal. Its only levers on the goal are `disarm`, `resume`, `edit`, and `block`; it never calls the model, never starts a turn, and never uses a waking delivery. Everything it does must stay inside that boundary.
- The same plugin already runs two evidence-based mechanisms. The **block review** starts one fresh-context read-only child to judge a model's `blocked` proposal, with a strict verdict and cached records. The **work checkpoint** forces the model to record a structured plan (outcome, lanes, bottleneck, next action) at every substantial turn close, and refuses closes that lack one.
- The goal domain has exactly four phases (`active`, `paused`, `blocked`, `complete`) and a process-local activation. There is no "waiting for an external event" state, and this repository does not own that domain.
- Continuation is driven by `resume`: an armed goal makes the driver admit a goal round. `maxGoalRounds` bounds the rounds, not the resumes.

The incident that motivates the change, as recorded in one live session's log:

| Event | What the log shows |
| --- | --- |
| A substantial turn closes | The model records a `work_checkpoint` whose plan is `continue` with a `user_decision` bottleneck, and whose next action is a scheduled check on the following morning |
| A later turn closes with a complete final answer | The remaining work is that scheduled check; nothing can be done before it |
| The user presses Stop on a turn the goal did not start | `turn/end` carries `aborted` / `user` |
| Immediately after | The supervisor resumes the goal and injects `Next: continue the current objective` |
| The next turn | Produces no tool call at all, and its reasoning invents a test suite nobody asked for |
| The user presses Stop again | The supervisor resumes again, this time also admitting a forced goal round (`Round: 1/256`) |
| The user presses Stop a third time, then pauses the goal | Only the manual pause ends the loop |

Three properties of that sequence drive the design. The supervisor reversed an explicit user decision three times; it reversed it with a notice that carried no information; and it ignored a considered statement it had itself forced the model to make.

## Goals / Non-Goals

**Goals:**

- An explicit user Stop ends automatic continuation, with no analysis in the way and no exception that outlives the next direct user message.
- A continuation the plugin decides on its own carries either a substantive next action or an explicit request for the model's decision. Never a blind instruction to continue.
- Automatic continuation ends by itself when it stops producing effect, instead of consuming the whole resume budget.
- Every decision, taken or withheld, is visible to the user as one bounded notice.
- The supervisor keeps its boundary: no model call, no turn start or cancel, no goal-phase change for a withheld resume.

**Non-Goals:**

- Adding a goal phase or any other change to the `@deepseek-ai/dsh-goal` domain.
- Reviewing a user's Stop with a model subagent.
- Fixing the review engine's stale-findings loop that also disturbed that session; that is separate work.
- Changing `maxSessionResumes`, the round-cap extension policy, or the block review.

## Decisions

### D1. A user Stop is absolute; the shipped policy becomes `never`

`resumeAfterUserStop` gains no new values and loses none: the shipped default flips from `non-goal` to `never`, and the `non-goal` branch keeps its meaning as an opt-in that submits the continuation to the evidence rules below rather than a resume on the abort alone.

The option is kept rather than deleted because `resolveConfig` rejects unknown fields at load: removing it would break every profile that still carries it. The strict behaviour is already implemented and tested; only the default and the rationale change.

*Alternative considered and rejected:* reviewing the Stop with the block reviewer. A Stop is the user's own decision, so reviewing it reviews the user; the reconcile path also fires on every in-process disarm, so the review would run once per goal round — the cost is a model call before each turn, larger than the problem it solves. The block review exists to catch a *model* proposing to stop, which is a different question.

### D2. Continuation reads the plan the plugin itself forces

At every settled turn of an active goal, before any continuation decision, the supervisor reads the session's latest **successful** `work_checkpoint` plan at or before that turn. Freshness is two turns *and* a message boundary: a plan recorded in the settled turn or the turn before it counts, anything older does not, and a plan recorded before the most recent direct user message counts for nothing.

The message boundary is what makes the documented recovery work. When the user answers a `user_decision` bottleneck, their message invalidates the plan that asked the question, so the next resume is the evidence-free one that asks for a decision again — instead of the same stop replaying on a plan the user has already answered.

- `outcome: done` → withhold.
- `outcome: continue` with a `user_decision` bottleneck → withhold.
- any other fresh plan → resume, and the plan's `next` text becomes the notice's next action.

Why this evidence is worth trusting: the plan is written under a gate, is required to name lanes, a bottleneck, and a next action, and is produced by the same model in the same context. The plugin already treats it as authoritative for its own close gates (remedy matching, parallel fan-out, bottleneck age); using it for continuation is the same kind of evidence, not a new one. In the incident it was also simply correct: it said the next action was a scheduled check, and that is what the next three turns failed to do.

Trusting it is bounded three ways: by freshness, by the fact that a stop leaves the phase alone (a direct message still continues the work), and by D5.

*Alternatives considered and rejected:* a model review of the continuation decision (the user's original shape) — expensive on a path that fires per round, and redundant against a plan the model already wrote; proving "no work remains" by scanning tool results — cannot distinguish a finished objective from an interrupted one.

### D3. The evidence is read from the session log, not from the local record file

The `work_checkpoint` tool writes a local record best-effort and reports when it could not. The session log, by contrast, always carries the call arguments and its result. So the supervisor scans back from the settled turn for the last `work_checkpoint` call whose result is not an error, parses its arguments with the existing `parseCheckpointInput`, and treats a parse failure as no evidence.

This keeps the decision independent of the workspace path, of a failed local write, and of the file sandbox.

### D4. With no fresh plan, the single resume asks instead of pushing

The notice for an evidence-free resume does not say "continue the current objective". It requires the next round to either make a concrete step or record a plan declaring `done` or a `user_decision` bottleneck. The model gets a legitimate way out on the first round instead of having to invent work, and the next round's plan supplies the evidence for every later resume — the loop is self-correcting after one round.

*Alternative considered and rejected:* withhold every evidence-free resume. That turns a missing record into a permanent stop and would strand a goal after an ordinary restart.

### D5. Two consecutive no-effect rounds end continuation

A goal round is no-effect when it produced no successful write, no worker start, and no successful `work_checkpoint`. The count covers every settled goal round whatever its end reason — a loop-guard reset or a user abort is as much a round as a clean completion. Two consecutive no-effect rounds stop automatic continuation: the supervisor disarms an armed goal, resumes nothing for a disarmed one, and records a notice; an effective round or a direct user message resets the count.

Including the checkpoint in the definition matters twice: a round that records a considered plan is not a spin, and a round that records one is already handled by D2, so D5 only catches the case where the model neither acts nor decides. The observed resume produced exactly that — one step, reasoning only, no tool call.

The count lives in the plugin's per-agent state beside the resume budget, is in memory only, and resets with the suppression on a direct user message. Two is a constant with a comment, not a configuration field: it is a leash on a pathological loop, not a tunable policy, and any effective round resets it.

### D6. The decision runs at every settled goal turn, and a stop disarms

`reconcile` returns as soon as the goal's activation is not `disarmed`; the supervisor has only ever driven a disarmed goal. That is enough for a *resume* and not enough for a *stop*: the driver admits the next round of an armed goal by itself, and the existing harness in `packages/plugin-goal-continuity/test/checkpoint-goal.test.ts` (`closes the round and the next goal round sees the checkpoint`) starts a second goal round with no goal-service call at all. A stop decided only on the disarmed path would never reach the loop the incident is about.

So the stop is expressed with the lever that reaches that loop: `disarm`. An armed active goal that the evidence stops is disarmed, which is the same action the existing pause prevention already takes before the driver's idle settlement. The phase stays `active`, so a direct message or an explicit resume continues the work; nothing is paused, blocked, or completed.

The ordering of one settled goal round:

| Step | Condition | Action |
| --- | --- | --- |
| Read | every settled goal round | build the turn evidence and read the latest fresh plan |
| Count | every settled goal round | update the no-effect count from that turn's evidence; the counter resets with the suppression in the same `user/message` handler |
| Stop | a fresh plan stops it, or two no-effect rounds, on a recoverable end reason | disarm an armed goal, suppress, record one notice, change no phase; a user-aborted goal round keeps the driver's pause instead (D7) |
| Resume | evidence allows and the goal is disarmed | resume with the plan's next action, or the decision request when there is no plan |
| Continue | evidence allows and the goal is armed | nothing; the driver continues and the counter stays at zero |

| Touch point | Change |
| --- | --- |
| `DEFAULT_CONFIG` | `resumeAfterUserStop: 'never'`; the composition fragment and generated patch follow through `pnpm gen` |
| `handleTurnEnd` | read the evidence and update the counter before the end-reason branches, so a hook-aborted round is counted and an effective aborted round resets the count; apply the stop decision for every settled goal round |
| `reconcile` | keep the single choke point for the resume and cap-extension path, consulting the same decision so a stopped continuation never extends the round cap either |
| `resumeAndNotify` | accept the next action to name, and return a distinct result instead of resuming |
| `AgentState` | one counter field, reset with the suppression |

The decision is computed once per settled turn and reused by both the stop path and `reconcile`, so the resume budget, the cap extension, and the notices keep a single decision point. A stop is a suppression in the existing sense: it survives until a direct user message clears it.

A terminal end reason — a final or unrecognized hook cause, the token limit, or an agent error — is not a continuation question: it already owns one stop, one notice, and a visible record, and it may block the goal. The evidence stop therefore yields to it instead of adding a second, contradictory notice; the round is still counted and its plan is still evidence for the next settled turn. The same precedence covers a user abort, handled in D7.

### D7. A user abort outranks the evidence stop, and the policy decides the non-goal case

A user abort of a goal round already ends that turn through the driver's pause, and the retained pause-prevention rule forbids disarming for a user abort. The evidence stop therefore does not disarm such a round: the pause is the durable record of the user's decision, the evidence and the no-effect count are still recorded, and the stop applies from the next settled round.

A user abort of a turn that is not a goal round leaves no driver pause, and there the configured policy decides. Under the default `never` the Stop is authoritative: an armed goal is disarmed and the resume suppressed, which is the incident's exact shape — a Stop on a notification-driven turn while the goal was still live, and the disarm is what makes the Stop reach a goal that needs no resume. Under `non-goal` the opt-in from D1 stays meaningful: the evidence rules decide, so a permissive plan lets an armed goal keep running and resumes a disarmed one, and only a stopping plan withholds. Collapsing both policies into an unconditional stop would have made `non-goal` an alias of `never`.

### D8. Notices carry their reason

The existing bound (`NOTICE_TEXT_MAX_CHARS`) stays. A resume notice names the cause, the retry count, and the next action taken from D2 or D4. A stop notice names the evidence read (the plan's outcome and bottleneck, or the no-effect round count) and the user action that continues work. The generic sentence is removed rather than reworded, because a notice that names no next action is what produced the invented work.

## Risks / Trade-offs

- **The default change alters every profile that does not set the field** → the field stays accepted, the docs state the new default, and the opt-out is one value away. A user who Stops a non-goal turn and wants the goal to continue says one word; that is the intended trade, and a stop never pauses or blocks the goal, so nothing is lost.
- **A stopped continuation could strand a goal the user expected to continue** → a stop disarms and suppresses but never pauses or blocks; the next direct user message clears it, `/goal resume` still works at any time, and the notice names the exact action that continues.
- **The disarm races the driver's next round** → the stop decision runs in the `turn/end` path, the same place the existing pause prevention already disarms from; if a build admits a round before that point, the cost is one more round, after which the evidence and the counter still hold. The regression test completes two no-effect rounds without pre-disarming and asserts that no third round starts.
- **A long read-only investigation round looks no-effect** → it counts only when the round also records no plan; the response is one notice, not a block; two consecutive occurrences are needed.
- **The checkpoint close gate might not fire in a deployed build** → see Open Questions. D4 is the safe fallback: with no plan the supervisor asks for a decision instead of resuming blindly, so the change degrades to a weaker but safe behaviour, never to the observed one.
- **A plan is the model's self-report** → bounded by the freshness window and by D5; a wrong `continue` costs one round, after which its own next action is on the record and the notice names it.
- **The message boundary can discard a still-valid plan** → after the user answers, one round runs on the evidence-free rule and asks for a decision, and a fresh plan follows; the boundary only ever discards evidence that the user's own message predates.

## Migration Plan

No data migration and no API change. Existing profiles keep loading; one that sets `resumeAfterUserStop: non-goal` keeps its value and gains the evidence gate. `packages/setup/defaults.yml` changes and `pnpm gen` regenerates the setup patch, the vendored tree, and the plugin's own patch and fragment; `scripts/validate-composition.ts` asserts the shipped default string and is updated with it. Rollback is a version downgrade; the previous release's behaviour needs no state conversion.

## Open Questions

- Does the shipped checkpoint close gate actually fire in a deployed build? In the motivating session, ten substantial turns produced exactly one `work_checkpoint` and no `UNCHECKED` notice despite `minToolCalls: 4`, `requireWrite: true`, and `maxBlocks: 3`, while the workflows engine's own gate did fire. A read-only probe of the deployed runtime archive finds `agent/turn-stopping` referenced 34 times, so the hook exists in the shipped build and the silence is not a missing event: it points at the gate's own conditions, at the profile's ownership of the checkpoint, or at the session state the gate reads. This does not change the approach — D4 covers a missing plan — but it changes how much of D2 is load-bearing. Still answered only by a live probe or an integration test that asserts a refusal; no spec or task depends on the answer.
