# Proposal

## Why

The process is enforced by separate self-declared gates, so the owner cannot see a declared step graph and the model can skip a step by not declaring it. The built-in `workflowEngine` already runs agent fan-out, and the observability change already records triggers and projected runs; what is missing is a durable definition of the required steps, a trigger that creates an obligation, evidence that a step actually ran, and a gate that refuses a close or a creation command while the obligation is open.

The first real use is the front of the OpenSpec flow: a new change must not start before its business requirements, architecture, and interface are worked through, and the spec review must pass before the change is treated as real. The existing checkpoint and task-review gates stay untouched; this change adds the new obligation and projects the existing ones as deferred workflows.

## What Changes

- Add a `workflows` capability to `@dsh-setup/plugin-workflows`: JSON workflow definitions, deterministic event triggers, an optional intent trigger, a durable run store, and a step runner.
- Add the step executors: `main` (steer the root agent), `subagent` (start a child with a result schema), `tool` (call an allow-listed tool), `human` (ask the user), `branch` (JSONLogic), and `loop` (bounded).
- Add evidence contracts: a file, a record, a successful tool call, a zero exit code, a human answer, or a recursive `all` of those. A critical step MUST NOT complete on a model declaration alone, and a human step MUST NOT complete on a rejected answer.
- Add the turn-close gate and the pre-execute gate. The pre-execute gate blocks `openspec new change <name>` until a completed `change-intake` run or host-authenticated adoption receipt exists for that name, resumes an interrupted intake before redirecting an existing directory to adoption, and blocks `openspec archive` while a required review obligation is open, no completed intake or authenticated receipt exists, or the current whole-spec PASS record is missing.
- Add host-authenticated completion and adoption receipts under `.dsh/workflows/receipts/`, signed with a host key held outside the workspace, so pruning run history or an arbitrary file write cannot revoke or forge an archive authorization; add the user-started `/workflows adopt <name>` command for changes that predate installation.
- Add a host approval store and the user-started `/workflows install <path>` command: a local definition or override is active only when its content hash and HMAC signature match the recorded approval.
- Add the model tool `workflows` (`list`, `start`, `resume`, `status`, `evidence`, `cancel`) and the `/workflows` command; the Workflows view from `add-workflow-observability` renders the definitions and runs.
- Ship three definitions: `change-intake` (active), `task-review` (active, `gateOwnership: defer` until `retire-legacy-gates`), and `retro` (active, `gateOwnership: defer`, applicability-gated).
- Add the legacy composition rule: while a legacy gate is installed, a workflow step that covers the same behavior declares it, reads its record, and does not add a second steer. Ownership moves into the workflow only in `retire-legacy-gates`.

## Capabilities

### New Capabilities

- `workflows`: stored workflow definitions, deterministic and optional intent triggers, durable runs, step executors, evidence verification, turn-close and pre-execute gates, model/user interfaces, and legacy-gate composition.

### Modified Capabilities

None.

## Impact

- `packages/plugin-workflows` Host and Client halves, definition assets, trigger assets, tests, and docs.
- Uses the DSH `workflowEngine`, `subagents`, `tools`, `commands`, `systemPrompt`, `fs`, and `userQuestions` services; no new DSH version.
- Writes only under `.dsh/workflows/` (definitions, runs, receipts, and the approval store); definitions are local config, not tracked scratch. The setup generation and vendored tree change.
- Out of scope: the React Flow editor (separate change), retiring the legacy gates (separate change), the review queue and learning loop (separate changes), and any automatic semantic classification of a user message as "new change".
