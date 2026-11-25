# Proposal

## Why

A blocking `ask_user_question` keeps the turn open, so an active goal has nothing to resume: the supervisor only acts at turn end. In session `5578577c` one turn ran 19 h 40 min and spent about 11 h 55 min waiting on eight questions; in session `ea02b074` a question asked at 01:45 waited 5 h 59 min, and the owner then chose the non-recommended scope option. A blind auto-answer would therefore have changed the product against the owner's later decision. The runtime already ships a timed `ask_user_question` with a countdown, Take time, and a `pending` result that releases the turn while the question stays answerable; the stock preset runs it in legacy mode.

## What Changes

- The owner switches the active preset's `tool-ask-user` row to `mode: timed` with `timeout: 300`; this is a one-time preset edit in the owner's profile, not a repository row.
- The always-on working contract adds the pending policy: pending is not a pause and not permission; continue independent work; take the recommended option only for a reversible operational choice and record the assumption; leave scope, product, release, credential, and destructive choices open; never ask whether to continue.
- The contract budget test is tightened from 1 600 to the documented 1 500 estimated tokens, and the contract is trimmed by about 660 bytes to make room for the policy while preserving every asserted rule.
- An independent `goal-continuity` test pins that a timed `pending` result withholds the prior `user_decision` stop, is not an answer, and is not permission; a `timeout: -1` call remains an indefinite wait.
- `docs/autonomy.md` documents the preset row, the editor route, the new-session rule, the acceptance check, and the limits; `docs/plugins.md` and `docs/install.md` link it.
- The setup ships a configurable question timeout: a Host plugin derives the timed `tool-ask-user` row from each installed preset into the profile patch, reads `timed` and `timeout` from a watched profile settings file, and re-applies them through the Loader, so a DSH restart is not needed and another machine gets the same default on install.
- The always-on working contract adds the configurability rule: a decision with real operational knobs is exposed as a configuration value with a default, while unrelated behavior is not made configurable.
- Explicitly not included: an auto-answer plugin, a night time window, automatic Codex analysis per question, a change to the question-review scope, a DSH core change, or a static preset copy maintained by hand.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-guidance`: adds the pending-question policy to the working-principles contract, keeps it in the existing always-on section, and holds the documented 1 500-token budget.
- `goal-continuity`: a timed `pending` question result counts as plan-freshness evidence for a prior `user_decision` checkpoint without being an answered user signal, a decision, or permission.

## Impact

- `packages/plugin-working-principles/assets/working-principles/contract.md` and `test/budget.test.ts`.
- `packages/plugin-question-timeout/**` (new Host-only bundle), `packages/setup/defaults.yml` and its generated patch, and `docs/autonomy.md`.
- `packages/plugin-goal-continuity/test/resume-evidence.test.ts` and one production comment; no behavior change is expected there.
- `docs/autonomy.md`, `docs/plugins.md`, `docs/install.md`.
- The owner's active preset in the profile (not tracked by this repository).
- No public API, dependency, runtime, or data migration; the timer is a stock DSH feature enabled by configuration.
