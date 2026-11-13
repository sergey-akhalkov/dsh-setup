# Proposal

## Why

A rule-driven Codex review is an external activation started with
`delivery: 'caller'`, so the subagent service never catalogs it. The owner sees a
`delegate` tool call and a Codex CLI process, but no entry in the Session's subagent
list, so the review cannot be watched like a subagent. The owner wants every review run
to appear in that list without changing the gate or record semantics.

## What Changes

- Every `review`-contract activation started by the delegation engine uses
  `delivery: 'parent'` and no explicit child name, so the service catalogs it as an
  external child of the delegating Session under the `delegation:<rule>` label.
- The parent receives the review answer as a settlement notice when the run completes;
  the external child is a leaf that accepts no follow-up input and shows no
  token/duration metrics.
- `answer` and `patch` activations keep `delivery: 'caller'`: their results stay
  synchronous and are not duplicated as settlement notices. External answer/patch runs
  are therefore not cataloged; in-process providers keep the service's existing local
  catalog behavior, which is independent of the delivery choice.
- The review queue, records, approvals, digests, thread reuse, and every gate are
  unchanged.
- Tests assert the delivery per contract; the delegation and Codex docs describe the
  visible external review entry and its limits, and that local providers are unchanged.
- The change ships as a new set version (0.38.0) and the owner installs it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `delegation-rules`: a new requirement states that review-contract activations are
  cataloged external children with a settlement notice, while answer and patch
  activations stay caller-delivered and uncataloged.

## Impact

- `packages/plugin-delegation-rules/src/host/index.ts` (`startTarget`).
- `packages/plugin-delegation-rules/test/**` (delivery assertions).
- `docs/delegation-rules.md`, `docs/codex-subagent.md`.
- Release: manifests, generated setup tree, tag v0.38.0, market index.
