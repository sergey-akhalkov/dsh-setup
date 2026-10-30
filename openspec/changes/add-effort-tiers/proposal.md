# Proposal

## Why

One reasoning effort for every step cannot serve both hard planning and routine work. On the
DeepSeek route, `minimal`/`low` map to `low`, `medium`/`high`/`xhigh` map to `high`, and only `max`
is distinct ([thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)), so the setup
effectively has three levels and currently uses one: the shipped default is `high`
(`packages/setup/defaults.yml`), while the owner's live profile pins `max` — a machine-local value
that does not travel to another installation.

Delegated subagent work has the same problem from the other side: every shipped delegation target is
the strong Codex target at `xhigh`, so a cheap research or sweep subtask cannot be routed to an
economical worker. The owner's policy is explicit: the main session runs `max`, Codex keeps `xhigh`,
and delegated workers choose their effort per task.

## What Changes

- Ship `reasoningEffort: max` for the default agent row in the setup owner defaults, so the main
  session policy travels with the setup instead of living in one profile patch.
- Add two shipped delegation worker targets: `worker-fast` on the DSH subagent provider at `high`,
  and `worker-deep` at `max`. Both keep the provider's model, so the effort is the only difference.
- Add two manual `answer` rules that call those targets (`worker-fast`, `worker-deep`), so the
  `delegate` tool offers the choice and the agent selects per subtask.
- Extend the bundled delegation skill with a short selection policy: routine inspection and
  mechanical sweeps go to `worker-fast`; ambiguous analysis, root-cause work, and anything that
  gates a decision go to `worker-deep`; the main loop stays `max`.
- Update the delegation tests, generated setup patch, and the delegation documentation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `delegation-rules`: the shipped default rule set gains two worker targets and two manual answer
  rules, with an explicit effort-selection policy in the bundled skill.
- `portable-setup`: the shipped owner defaults name `max` instead of `high` for the default agent
  row's reasoning effort.

## Impact

- `packages/plugin-delegation-rules/cordis.fragment.yml` (targets and rules), its generated
  `cordis.patch.yml`, `packages/plugin-delegation-rules/assets/delegation-rules/SKILL.md`, and the
  package tests under `packages/plugin-delegation-rules/test/`.
- `packages/setup/defaults.yml` and the generated `packages/setup/cordis.patch.yml`.
- `docs/delegation-rules.md` and the setup composition documentation.
- No DSH API change: targets already accept `provider`, `model`, and `reasoningEffort`, and the
  `spawn` provider already reports that it supports agent options.
