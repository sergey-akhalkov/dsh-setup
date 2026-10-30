# Proposal

## Why

The shipped `lane-boundary` gate reacts only after one lane is fully checked, and its worker evidence is a
per-turn boolean. A worker started in an earlier turn is forgotten, so the next lane completion can demand
a second worker for a lane that is already in progress; one `task_progress` note for one lane silences the
whole rule; and an unrelated worker start settles it. In a long goal the result is late fan-out, duplicate
fan-out, or a silent serial fallback while independent lanes wait.

## What Changes

- Add a `lane-assignment` trigger. At turn close, for each change this session is involved in, it reports
  every non-serial lane with unchecked tasks that has no assignment and is not the lane this session ticked
  in the current turn.
- Add a session-scoped lane assignment ledger. A successful `subagent`, `subagent_fork`, `spawn_teammate`,
  or `workflow` start whose arguments carry `lane-tag: <change>#<n>` marks that lane assigned. A successful
  `task_progress` note for a task in a lane marks that lane serial.
- The steer lists only unassigned lanes and prints the checkpoint commit, one ready worker call per lane
  with its tag, and the per-lane `task_progress` call. It never reissues an assigned lane.
- Switch the shipped `lane-fanout` rule to `lane-assignment`. Keep `lane-boundary` accepted for existing
  profiles but mark it deprecated; no shipped rule uses it.
- Update the bundled skill, the plugin and repository documentation, the config and gate tests, and the
  generated plugin patch and setup output.

No new plugin, tool, dependency, or always-on prompt section is added.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `delegation-rules`: the trigger vocabulary gains `lane-assignment`; the shipped rule set uses it; the
  gate's assignment state, worker tag, steer payload, and fail-open behavior become requirements; the
  deprecated `lane-boundary` trigger remains accepted; the documented default gate changes.

## Impact

- `packages/plugin-delegation-rules/src/host/index.ts`: trigger vocabulary, assignment ledger, tag handling,
  gate condition, and steer payload.
- `packages/plugin-delegation-rules/src/shared/approval.ts`: lane lookup only if the existing helper needs
  an index or title accessor.
- `packages/plugin-delegation-rules/cordis.fragment.yml` and the generated `cordis.patch.yml`: the default
  rule moves to the new trigger.
- `packages/plugin-delegation-rules/assets/delegation-rules/SKILL.md`, `docs/delegation-rules.md`, and
  `docs/openspec-status.md`.
- Tests under `packages/plugin-delegation-rules/test/`, plus generated `lib/**` and the vendored setup tree.
- Model-facing cost: no new tool description and no always-on prompt text; the on-demand skill body grows
  by a few lines inside its existing 24,000-byte budget.
