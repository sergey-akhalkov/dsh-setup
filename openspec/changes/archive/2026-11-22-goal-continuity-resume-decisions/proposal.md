# Proposal

## Why

A live session showed the goal supervisor reversing a user three times in a row. The user pressed Stop three times; each Stop produced an automatic resume, the second resume added a forced goal round, and only a manual goal pause ended the loop. Neither resumed turn did any work: the first one invented a test suite nobody asked for, the third produced no output at all.

The supervisor had the evidence it needed to stop. In the first turn of that same session the model had recorded a `work_checkpoint` whose plan said the only remaining lane was waiting for a scheduled check the next morning, with a `user_decision` bottleneck and a `next` field naming that check. The supervisor forces that record to exist and then never reads it, so it resumed with the only sentence it has — `Next: continue the current objective` — and the model filled the vacuum.

The strict policy already exists (`resumeAfterUserStop: never`); it is simply not the default. So the gap is not a missing lever, it is a decision the plugin makes without evidence and without the user.

## What Changes

- **A user Stop ends automatic continuation by default.** The shipped `resumeAfterUserStop` default becomes `never`: any user abort suppresses automatic resumes until the next direct user message and records one notice. The `non-goal` value stays accepted so existing profiles load, and it stays meaningful as an opt-in that puts the continuation evidence in front of the decision instead of replacing it. **Behaviour change for every profile that does not set the field.**
- **The supervisor reads the latest work-checkpoint record at every settled goal round.** A fresh record that declares `outcome: done` stops automatic continuation; so does `outcome: continue` with a `user_decision` bottleneck. Both record one notice naming what was read and what the user can do, and they disarm an armed goal so the driver admits no further round while leaving the phase untouched. A fresh `outcome: continue` plan still allows the resume, and its `next` text replaces the generic sentence in the notice.
- **With no record, the one resume asks for a decision.** The notice requires the next round to either make a concrete step or record a `work_checkpoint` declaring `done` or a `user_decision` bottleneck, instead of instructing the model to continue.
- **Two consecutive no-effect rounds end automatic continuation.** A round that produced no successful write, no worker start, and no successful checkpoint is a no-effect round; the second one in a row disarms the goal so no further round starts and records one notice.
- **A user Stop outranks a continuation stop.** A Stop on a goal round already ends the round through the driver's durable pause, so the plugin never disarms it. A Stop on any other turn has no such record: the default `never` policy disarms an armed goal and suppresses the resume, while the `non-goal` opt-in keeps its meaning and submits that Stop to the same evidence rules.
- **Evidence older than the user's own last message is not evidence.** The plan that asked a `user_decision` question stops counting once the user answers, so the same stop cannot replay against a decision the user already made.
- **No new configuration field, no new goal phase, no new model call.** The continuation decision is made from state the plugin already collects.

## Capabilities

### New Capabilities

None. The behaviour belongs to an existing capability.

### Modified Capabilities

- `goal-continuity`: the user-abort policy and its default, active-disarmed-goal reconciliation, the notice contract, a new checkpoint-evidenced continuation requirement, a new no-effect stop requirement, and the shipped defaults.

## Impact

- `packages/plugin-goal-continuity/src/host/index.ts`: the resolver default, the turn-end user-abort branch, the reconciliation gate, the resume notice, and one per-agent counter.
- `packages/plugin-goal-continuity/test/`: lifecycle, config, and a new resume-decision suite.
- `packages/setup/defaults.yml` and the regenerated setup patch and vendored tree; `scripts/validate-composition.ts` asserts the shipped default string and changes with it.
- `README.md`, `docs/plugins.md`, and `docs/goal-continuity.md` describe the shipped default and the continuation rule.
- No public API change, no dependency change, no data migration. A profile that sets `resumeAfterUserStop: non-goal` keeps its behaviour minus the blind resume.

Out of scope: the stale review loop that woke that same session repeatedly with an unchanged findings digest. It is a separate defect in the review engine and is recorded as its own work, not fixed here.
