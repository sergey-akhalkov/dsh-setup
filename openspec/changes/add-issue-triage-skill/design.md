# Design

## Context

The repository already has one tracker (GitHub issues), a second, drifting one
(`docs/openspec-status.md`), and a change pipeline whose intake requires the owner's approval per
change. A triage run must not create a third tracker, must not bypass the intake, and must not let
six parallel workers write to GitHub.

## Goals

- One invokable procedure that turns open issues into evidence-backed verdicts and a bounded set of
  drafts.
- A durable record on each issue, so the next reader knows what was decided and why.
- No GitHub write from a subagent, and no second comment on a rerun.

## Non-Goals

- No nightly job, no scheduler, no backlog burndown chart.
- No automatic close of `invalid` or `wontfix`; the owner answers those.
- No implementation inside a triage run.

## Decisions

- **Clusters with a cap of three.** The GitHub issue is the queue; the change is the commitment.
  Three open proposals is already more than this repository implements in a week, and #15/#17 would
  edit the same files in two parallel changes.
- **Drafts, not changes.** The change-intake gate matches a Harness shell call of
  `openspec new change {name}`, so a change is created only when the agent runs that call inside the
  session. A triage run that produced actual changes would need three owner approvals inside the run
  or would bypass the gate; drafts keep the gate where it belongs, and promotion is the owner's
  decision followed by that agent-invoked call.
- **Verdicts are evidence-bound.** `fixed` names a command and its passing output, `duplicate` names
  the canonical number, `needs-change` names the paths it will touch. A text claim is not a verdict.
- **The lead writes to GitHub.** Workers write only `.dsh/workflows/drafts/<name>/`; the lead posts
  one comment per issue and performs the closes, so parallel workers cannot race or spam.
- **One bundle for one method.** `plugin-refactoring` is the shape: one skill, no always-on text, no
  config, catalog rank `600`. Appending to `plugin-working-principles` would be cheaper by three
  files but would put a triage method in an always-on package whose card is the working contract.

## Rejected Alternatives

- One change per issue: seven proposals over four open changes, and #15/#17 edit the same files.
- A triage script instead of a skill: only the inventory is mechanical; the verdict is judgement.
- Auto-close of `invalid`/`wontfix`: the owner's decision, not the agent's.

## Risks / Trade-offs

- A subagent overstates validity: mitigated by the lead's evidence rule and the report's evidence
  column.
- A run over seven issues spends tokens: bounded by the preflight stop and the cap.
- The skill's advice can drift from the pipeline: the `Fixes #` contract is named in the skill body
  and checked by the closeout dry run in the promoted change.

## Open Questions

None.
