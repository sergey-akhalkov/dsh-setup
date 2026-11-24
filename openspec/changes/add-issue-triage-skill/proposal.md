# Proposal

## Why

There is no repeatable procedure from an open issue to a decision. The repository holds 7 open
issues and 4 open changes (3 at 0 tasks), with one duplicate pair (#16/#17), one fix shipped without
a closure (#9), one issue tracked only by prose (#1), and two CI flakes (#13, #14) that need a rerun
before any judgement. Triage happens in chat, leaves no durable record on the issue, and produces no
evidence for its verdicts.

## What Changes

- New opt-in bundle `@dsh-setup/plugin-issue-triage` shipping one skill, `issue-triage`, with no
  always-on text and no configuration.
- The skill defines one run: preflight, inventory, existing links, verdicts with evidence, closes for
  duplicates and already-fixed issues, path-based clustering capped at three proposals, one change
  draft per cluster, one link comment per issue, and one report table.
- GitHub writes are lead-only; a subagent writes only its draft directory.
- New capability `issue-triage`. The link is the `Fixes #` convention from `close-issues-on-release`,
  and a draft is promoted to a change through the normal owner-approved intake.

## Capabilities

### New Capabilities

- `issue-triage`: the evidence-bound triage run from open issues to closed duplicates, a capped set
  of change drafts, and one report.

### Modified Capabilities

None.

## Impact

- New `packages/plugin-issue-triage/**`, a root `tsconfig.json` reference, regenerated
  `packages/setup`, and rows in `docs/plugins.md` and `README.md`.
- The market lists one new bundle; no installer, `dsh.json`, or engine-range change.
- No always-on contribution: a profile that does not install the bundle sees nothing new.
