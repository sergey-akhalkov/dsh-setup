# Proposal

## Why

DSH's goal layer stops an active goal on harness artifacts rather than on real blockers: any aborted turn disarms the goal, a goal-round abort makes the driver pause it, a session restart disarms it, and a reached round cap turns into a durable `block`. In the inspected 22-hour session the goal was stopped and manually revived four times, with gaps of 8h53m, 6h20m, 1h06m and 9m; all eight turn aborts were loop-guard **resets** (a recoverable signal), while 57 of the 100 goal rounds were spent polling background jobs with 114 `job_output` calls and no `wait: true`. The result is neither autonomy nor a real blocker report: a long goal needs the user to notice the stop and run `/goal resume`.

## What Changes

- Add the Host-only `@dsh-setup/plugin-goal-continuity` bundle. It supervises an existing goal through the public goal service: it re-arms an `active + disarmed` root-agent goal, prevents the driver's pause for a recoverable loop-guard reset and resumes the resulting goal, and extends a bounded cap increase on a `round-limit` block or on a reset that lands on the last permitted round; when the extension budget is exhausted, the native `round-limit` block stays the visible record. It never touches a user pause/clear/complete, a `model-reported` block, a user abort of a goal round, a `loop-guard:final:` or unrecognized hook cause, or a `max-tokens`/agent-error stop. Notices are non-waking; a terminal refusal blocks the active goal with a visible reason instead of starting a turn.
- Bound every automatic action: a per-session resume budget, a per-goal cap-extension budget, a hard total cap, and one visible record per automatic action or terminal refusal that names the cause and the next action. On an exhausted budget the plugin stops and reports instead of retrying silently.
- Add machine-readable loop-guard abort causes (`loop-guard:reset:` and `loop-guard:final:`) ahead of the existing human-readable reason. The supervisor resumes only a recoverable reset; the guard's behavior, limits and messages stay unchanged.
- State the goal-round continuation policy in the always-on working contract: do not end a round only to wait, use `job_output(wait: true)` or do independent work, a timeout is not a blocker, `blocked` needs three consecutive rounds with the same checkable obstacle, `complete` needs current evidence, and goal creation omits `max_goal_rounds` unless the user asked for a limit.
- Mount the plugin in the setup bundle with defaults: enabled, `resumeAfterRestart: false`, `resumeAfterUserStop: non-goal`. A profile can change these values; disabling the row restores stock DSH behavior exactly.
- Regenerate the setup patch, manifest and vendored tree; add the plugin market locale and icon, the root README row, and the user documentation. No Client UI, no driver fork, no new token budget, no scheduled job.

Behavioral change: an active goal is re-armed after recoverable harness stops by default. It is not a configuration or API break, and the plugin row is the off switch.

## Capabilities

### New Capabilities

- `goal-continuity`: continuity supervision of an existing DSH goal — reconciliation of `active + disarmed` goals, translation of recoverable harness aborts into bounded resumes, bounded round-cap extension, explicit suppression of real stops, visible notices, and the Host-only composition boundary.

### Modified Capabilities

- `session-guidance`: the always-on working contract gains the goal-round continuation policy (wait handling, blocker threshold, completion audit, round-cap discipline) inside the existing bounded section.
- `loop-guard`: the hook abort reason gains a stable machine-readable cause prefix (`loop-guard:reset:` or `loop-guard:final:`) while keeping the existing human-readable text, limits and escalation behavior.

## Impact

- New package `packages/plugin-goal-continuity` (Host-only bundle: manifest, fragment, locale, icon, Host source, tests) and its `tsconfig.json` project reference.
- `packages/plugin-loop-guard/src/host/index.ts` and its tests: the two abort reasons gain the cause prefix; the spec delta records the contract.
- `packages/plugin-working-principles/assets/working-principles/contract.md`: the goal-round policy paragraph; the section stays under the documented 1500 estimated-token budget.
- Generated setup output (`packages/setup/package.json`, `packages/setup/cordis.patch.yml`, `packages/setup/node_modules/@dsh-setup/**`), `README.md`, `docs/plugins.md` (or the closest plugin doc), and the new package's market metadata.
- Runtime dependencies for type checking and peers: `@deepseek-ai/cordis` peer as in the other plugins; `@deepseek-ai/dsh-goal`, `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-llm` dev dependencies pinned to DSH 0.2.1-rc.3; `engines.dsh` matching `dsh.json`.
- Live acceptance is owner-driven: the running Desktop app is restarted by the owner, never by an agent session. The abort-translation path is covered by unit tests; a throwaway profile with a lowered loop-guard threshold is the optional integration check.
