# Design

## Context

See `proposal.md` - Why. The pieces this design builds on:

- `add-workflow-observability` already records trigger evaluations and projects existing runs. The obligation engine reuses its journal, run projection, health check, and Workflows view; it does not add a second event log.
- `harden-review-queue` makes task and spec reviews queue, retry, and settle. The task-review workflow reads their durable records.
- `learn-from-review-findings` provides the lesson store and the retro report. The retro workflow reads them.
- The Host exposes `workflowEngine`, `subagents`, `tools`, `commands`, `systemPrompt`, `fs`, `userQuestions`, and `connection`. The existing legacy gates are `plugin-goal-continuity` (checkpoint), `plugin-delegation-rules` (task/spec review and archive), and `plugin-verification-gate` (verification command).

The engine is deliberately not a second agent runtime. It is a durable obligation state machine over the existing root agent and the existing DSH services. A `main` step steers the root agent; a `subagent` step starts one child; a `tool` step calls an allow-listed tool. The built-in `workflowEngine` is reserved for a future `fanout` executor because a single obligation does not need a script runtime.

## Goals / Non-Goals

**Goals:**

- Make a declared step graph enforceable and visible: a run records every step, the evidence that satisfied it, and the reason it is still open.
- Make the first real pipeline deterministic: `openspec new change` is refused until the `change-intake` run completes.
- Let a change created before installation adopt its existing artifacts instead of recreating its directory.
- Keep the existing gates working during the transition: a workflow that covers a legacy behavior defers to the legacy record and never adds a second steer.
- Keep the engine small enough to review: one state machine, one evidence verifier, six executors.

**Non-Goals:**

- The React Flow editor (separate change), the removal of legacy gates (separate change), a general-purpose n8n node catalog, arbitrary user-authored code, and a durable queue for workflow runs.
- Automatic semantic classification of every user message. The intake gate is deterministic on the `openspec new change` action; intent triggers are optional and shadow by default.
- Replacing the review prompt or the checkpoint schema; the workflows read those records.

## Decisions

### 1. Definitions are JSON data with a closed schema

`definitions/<id>.json`:

```json
{
  "v": 1,
  "id": "change-intake",
  "name": "OpenSpec change intake",
  "version": 1,
  "trigger": {
    "kind": "tool.pre-execute",
    "match": { "tool": "shell", "command": "openspec new change <name>" },
    "mode": "active",
    "dedupe": "name"
  },
  "settings": {
    "allowModelStart": false,
    "risk": "low",
    "gateOwnership": "own",
    "maxBlocks": 3
  },
  "steps": [
    { "id": "requirements", "title": "Business requirements", "executor": "main",
      "prompt": "Capture users, problem, outcomes, non-goals, constraints, acceptance.",
      "evidence": { "kind": "file", "path": ".dsh/workflows/drafts/{name}/requirements.md", "minBytes": 200 },
      "next": "architecture", "blockTurnClose": true },
    { "id": "architecture", "title": "Architecture", "executor": "main", "next": "interface",
      "evidence": { "kind": "file", "path": ".dsh/workflows/drafts/{name}/architecture.md" }, "blockTurnClose": true },
    { "id": "interface", "title": "Interface contract", "executor": "main", "next": "create-change",
      "evidence": { "kind": "file", "path": ".dsh/workflows/drafts/{name}/interface.md" }, "blockTurnClose": true },
    { "id": "create-change", "title": "Create the OpenSpec change", "executor": "tool",
      "tool": { "name": "shell", "command": "openspec new change {name}" },
      "evidence": { "kind": "all", "items": [
        { "kind": "tool", "name": "shell", "command": "openspec new change {name}" },
        { "kind": "file", "path": "openspec/changes/{name}/.openspec.yaml" }
      ] }, "next": "spec", "blockTurnClose": true },
    { "id": "spec", "title": "Write the spec set", "executor": "main",
      "evidence": { "kind": "all", "items": [
        { "kind": "file", "path": "openspec/changes/{name}/proposal.md" },
        { "kind": "file", "path": "openspec/changes/{name}/design.md" },
        { "kind": "file", "path": "openspec/changes/{name}/tasks.md" },
        { "kind": "file", "path": "openspec/changes/{name}/specs/**/spec.md" },
        { "kind": "check", "command": "openspec validate {name} --strict" }
      ] }, "next": "spec-review", "blockTurnClose": true },
    { "id": "spec-review", "title": "Independent spec review", "executor": "tool",
      "ownership": "defer",
      "legacy": { "plugin": "delegation-rules", "signal": "spec-review" },
      "tool": { "name": "delegate", "args": { "rule": "spec-review", "change": "{name}" } },
      "evidence": { "kind": "record", "path": ".dsh/delegation/spec-review/{name}/spec.json",
        "rule": "spec-review", "change": "{name}", "phase": "spec", "scope": "whole",
        "verdict": "PASS", "digest": "current" },
      "next": "approval", "blockTurnClose": true },
    { "id": "approval", "title": "Owner approval", "executor": "human",
      "prompt": "Approve the change spec before implementation starts.",
      "evidence": { "kind": "human", "answer": "yes" }, "next": "end" }
  ]
}
```

- The schema is closed: unknown fields fail load. Step ids are unique; every `next` names a step or `end`; a loop is explicit. An `all` completion contract is a non-empty recursive list and passes only when every item passes; its failure names the first failing item. `digest: current` compares the record's digest with the current change spec digest.
- `tool` steps carry a fixed tool name and fixed arguments; the only interpolation is a validated context value (`{name}` must match `^[a-z0-9][a-z0-9-]*$`). A definition cannot carry a raw shell string with a model-supplied value.
- Definitions live in `.dsh/workflows/definitions/`. Shipped defaults are read-only assets; an approved local file with the same id overrides. The model can write a draft under `.dsh/workflows/drafts/`, but the loader never loads that directory; the `/workflows install <path>` command validates the file, asks the user to confirm, copies it atomically into the definitions directory, and records its content hash and host HMAC signature.
- `gateOwnership` is `own` or `defer` and defaults to `own`. Ownership resolves per step: a step MAY declare `legacy` with `plugin` and `signal` and set `ownership: defer`. A deferred step reads the legacy record, never steers, and does not dispatch its own executor or tool; the shipped `spec-review` step is evidence-only until retirement. An own step is refused at load while the declared legacy source for the same behavior is installed. The shipped `change-intake` keeps `gateOwnership: own` for its own steps and marks only `spec-review` as `ownership: defer` to `delegation-rules`/`spec-review`, so the installed strict gate remains the only steer for that review. Ownership moves to `own` only in `retire-legacy-gates`.
- A local definition or override is active only when its content hash matches a host-authenticated approval record in `.dsh/workflows/approved.json`; each record carries an HMAC-SHA256 signature made with a host key held outside `.dsh` and never exposed to the model. The `/workflows install <path>` command and the editor's write API are the only signers. A model-written definition or a matching definition/approval pair without a valid signature is refused at load, and editing an approved file changes its hash and refuses it until re-approved. The ownership rule and the authenticated approval are the mechanical forms of the "no double gates" and "no model activation" rules.

### 2. Triggers are deterministic except the one labeled intent trigger

Event kinds: `turn.stopping`, `tool.pre-execute`, `tool.result`, `fs.change`, `subagent.end`, `review.record`. Filters: workspace, session, tool name, path glob, subject, verdict. Mode: `shadow` or `active`. Dedupe key: `trigger + session + (turn | path-hash | callId)`.

- `tool.pre-execute` is the intake trigger. The parser accepts the normal shell forms: trimmed `openspec new change <name>`, `rtk openspec new change <name>`, and the same with `pnpm exec`. A compound command or a command whose first token is not `openspec`/`rtk` is not matched; the archive gate and the file-watch violation cover the bypass.
- `fs.change` watches `openspec/changes/**` through the `fs` service, debounced. The payload carries the change name, the changed path, and, for `tasks.md`, the checked-task delta computed by the watcher.
- The intent trigger is a separate kind. It calls a bounded classifier only when `allowIntent` is true; it records the classifier, confidence, and reason; it is shadow by default; an active intent trigger requires a user-confirmed definition. It is never described as an event.
- Every evaluation goes through the change-1 evaluator and journal. The engine adds `would-fire`, `run-created`, `run-suppressed`, and `not-applicable` outcomes to the same Why-not table.

### 3. Runs are durable state machines with an in-memory live handle

```json
{
  "v": 1,
  "id": "run-...",
  "definition": "change-intake",
  "trigger": "tool.pre-execute",
  "session": "session-...",
  "workspaceKey": "...",
  "status": "running",
  "createdAt": 1762500000000,
  "updatedAt": 1762500001000,
  "context": { "name": "auth", "draftDir": ".dsh/workflows/drafts/auth" },
  "steps": [
    { "id": "requirements", "state": "done", "at": 1762500001000,
      "evidence": { "kind": "file", "path": ".dsh/workflows/drafts/auth/requirements.md", "bytes": 812 } },
    { "id": "architecture", "state": "open", "requestedAt": 1762500001000, "attempts": 1 }
  ],
  "violations": []
}
```

- Statuses: `running`, `blocked`, `completed`, `failed`, `cancelled`, `interrupted`.
- Writes are atomic (`write temp + rename`) after every transition. Each authoritative run file carries a host HMAC signature; the loader refuses an unsigned or modified run and does not trust its status, steps, or completion for resume, gates, or receipts. The run file is the source of truth only while authenticated; the in-memory object is a cache.
- On startup, a run left `running` or `blocked` is marked `interrupted` with a reason; it is never auto-completed. The next gate request asks the user/model to resume or cancel. The `workflows resume` action and `/workflows resume <runId>` command resume an interrupted run at its pending step, without recreating a change directory or starting a second run. Resuming re-evaluates the open step from authenticated durable state, not from a replay of prompts.
- A run is scoped to one session and one workspace. A different session can see it in the Workflows view but cannot satisfy its steps.
- Retention: 30 days or 20 MB; completed/cancelled runs are pruned first; open runs are retained. A completed intake and a successful adoption write a host-authenticated `.dsh/workflows/receipts/<name>.json`; receipts and the approval store are signed with the host key and are never pruned while the change or definition exists, so pruning cannot revoke an archive authorization.

### 4. Evidence is a verified contract, not a string

| Kind | Verification | Failure |
| --- | --- | --- |
| `file` | resolve inside the workspace, exists, non-empty, optional `minBytes`/glob | `blocked`, reason `missing-file` |
| `all` | a non-empty recursive list; every item passes | `blocked`, names the first failing item |
| `record` | parse the declared record (a whole-spec review under `.dsh/delegation/<rule>/<change>/<phase>.json`, or a checkpoint/review record), match rule/change/task/verdict, and compare `digest: current` when declared | `blocked`, reason `record-mismatch` |
| `tool` | a completed tool call with the expected name and arguments | `blocked`, reason `no-call` |
| `check` | a foreground shell result with exit 0, no signal/timeout/sandbox denial, after the step started | `blocked`, reason `check-failed` |
| `human` | a recorded user answer from `userQuestions` matching the declared accepted answer | `blocked`, reason `no-answer` or `rejected-answer` |
| `declaration` | allowed only if the step is `nonCritical`; recorded as `self-declared` | never satisfies a critical step |

The verifier is a pure function over the run context and the DSH observations; it does not call a model. A path is resolved with the `fs` service and must stay under the workspace root by path components. Every evidence and draft path in a definition is workspace-relative; there is no separate draft base, and the steer and the verifier resolve the same path. A record is read through the existing review/checkpoint readers, not a new parser.

For the shipped `spec-review` step the record contract resolves `.dsh/delegation/spec-review/{name}/spec.json` and requires `rule: spec-review`, `change: {name}`, `phase: spec`, `scope: whole`, `verdict: PASS`, and a `digest` equal to the current change spec digest. Task-scoped portable records under the change's `reviews/` directory are not whole-spec evidence.

### 5. Executors

- `main`: request the step by steering the root agent. The steer text is the step title, the prompt, the exact evidence contract, the workspace-relative path the verifier will check, and the run/step ids. Re-request only on a later turn stop, bounded by `maxBlocks`; do not spam every step.
- `subagent`: start one registered provider with a prompt, a JSON schema, and a provider/model override. Record the child id and the schema-validated result. A failed/non-completed child marks the step `failed`; it does not silently fall back to `main`.
- `tool`: call a tool on the definition's allowlist via the `tools` service, or a fixed shell command with validated interpolation. Register the generated call id as owned by the run before dispatch, so the pre-execute gate can distinguish it from a model call. Record the call id and result.
- `human`: call `userQuestions.ask` with a bounded prompt; record the answer. Only the declared accepted answer completes the step; any other answer is recorded as `rejected-answer` and leaves it open or blocked as declared, never completes the run. A timeout applies the step's declared timeout action.
- `branch`: evaluate JSONLogic over a plain context `{ context, steps, evidence, trigger }`. Invalid JSONLogic fails the run, not the turn.
- `loop`: a bounded iteration over a list in the context; each iteration may run a sub-workflow; `maxIterations` is required and capped at 50. A cap is `blocked` or `failed` as declared.
- `fanout` is not shipped; the built-in `workflowEngine` is the intended executor for it, because a fan-out script has its own concurrency and cancellation contract. This keeps the obligation runner single-threaded per run.

### 6. Gates: turn close and pre-execute

**Turn close.** `ctx.on('agent/turn-stopping')` evaluates every active run for the root agent:

1. If no run has an open `blockTurnClose` step owned by this plugin and not deferred, do nothing.
2. Otherwise steer with the first open step and its evidence contract; increment the run's turn refusal count.
3. If the count exceeds `maxBlocks`, append a `VIOLATION` with the step id and allow the close; the run stays open and the next turn re-requests it.
4. An internal error is recorded and the close is allowed (fail open). A subagent turn is skipped.

The deferred steps do not steer; they read the legacy record and update their own step state. If the legacy record is missing, the run is `blocked` for visibility, but the legacy gate already steered; the engine does not add a second steer.

**Pre-execute.** `ctx.on('tools/pre-execute')`:

- For a shell call whose command parses as `openspec new change <name>`, apply this order:
  1. A completed `change-intake` run or authenticated adoption receipt for the name allows the call and starts or resumes no run.
  2. A call id owned by the run's `create-change` step allows the call.
  3. A resumable `change-intake` run for the name in this session and workspace is resumed at its pending step and the call is refused with that step. A restart after `create-change` resumes at `spec` instead of recreating the directory or redirecting to adoption.
  4. If `openspec/changes/<name>/` already exists and no resumable run or authenticated receipt exists, refuse and name `/workflows adopt <name>`; do not start a run that would fail on the existing directory.
  5. Otherwise refuse with the started `change-intake` run and its first step, and create the run with the name before returning. The refusal is a `deny` decision; the command does not run.
- For a shell call that parses as `openspec archive <change>`, refuse while any required step for that change is open, no authenticated completed `change-intake` run or authenticated receipt exists, or the whole-spec PASS record is missing or stale. The message names the run, step, and missing evidence. The gate verifies the receipt's host HMAC and refuses a forged receipt. A completed intake and a successful adoption write a host-authenticated receipt under `.dsh/workflows/receipts/<name>.json` that survives run-history pruning.
- For a file-write call whose target is under `.dsh/workflows/definitions/`, is `.dsh/workflows/approved.json`, or is under `.dsh/workflows/receipts/`, refuse unless the call is owned by the host install/receipt path. A model-originated write is never owned. This keeps a model-written definition, approval, or receipt inactive even when it bypasses the creation and archive parsers; the host HMAC is the independent proof.
- For an owned call (the call id is in the run's owned set), allow it. The owned set is host-generated and never exposed to the model.
- Any other call is untouched.

The gate does not inspect arbitrary `run_code` source; a manual directory creation or an obfuscated shell command can evade the command gate. That bypass is visible as a `fs.change` event without a matching intake run and is refused at the archive gate. For definitions, approvals, and receipts, an arbitrary write can create files but cannot fabricate a valid host HMAC, so the loader and archive gate refuse the record; the design states this boundary instead of claiming a sandbox.

### 7. The intake draft flow

`openspec new change auth` from the model:

1. The pre-execute gate parses `auth`, creates `change-intake` run `run-...` with `context.name = auth`, and refuses the call with the first step.
2. The root agent is steered to `requirements`; it writes `.dsh/workflows/drafts/auth/requirements.md` (the evidence path is in the steer). The next turn stop checks the file and advances.
3. `architecture` and `interface` follow the same way.
4. `create-change` is a `tool` step: the engine calls `openspec new change auth` with an owned call id; the pre-execute gate allows it. The step completes only from that call and the created `.openspec.yaml`; it does not validate the change.
5. `spec` checks the four artifacts and `openspec validate auth --strict` exit 0. Strict validation lives in `spec`, after `create-change`, not in the creation step.
6. The legacy delegation-rules gate steers the whole-spec review. The intake's deferred `spec-review` step does not dispatch `delegate`; it waits for the current whole-spec PASS record at `.dsh/delegation/spec-review/auth/spec.json` and advances when the digest matches.
7. `approval` asks the user; only a yes completes the run and writes the host-authenticated `.dsh/workflows/receipts/auth.json`. A no is recorded as rejected and leaves the run open or blocked.

The drafts under `.dsh/workflows/drafts/` are the working memory; the change directory is created only at `create-change`. A change created outside the run is not retroactively accepted: the archive gate requires an authenticated completed intake run or an authenticated receipt for its name. The user starts `/workflows adopt <name>`; the command verifies `proposal.md`, `design.md`, `tasks.md`, at least one `specs/*/spec.md`, and the current whole-spec PASS record, asks the user to confirm, and writes the same host-authenticated receipt without calling `openspec new change`. The model cannot start adoption. A change that is neither completed nor adopted stays refused, and a creation call for an existing directory is redirected to adoption only when no resumable intake exists for the name.

### 8. Task-review and retro are active deferred definitions

- `task-review` triggers on the `tasks.md` checked-task delta. Its only step is `read-review`: read the existing review record for the change/task and mark the step done. `gateOwnership: defer`; the definition declares `legacy` as `delegation-rules`/`task-review`. The legacy task gate still refuses the close. When the legacy gate is retired, `task-review` gains a `start-review` step (the existing `delegate` call) and becomes `own`.
- `retro` triggers on `turn.stopping` only when the installed goal-continuity checkpoint applicability decision is true: the same `checkpointRequired` predicate over `toolCalls`, `lastTool`, the resolved `minToolCalls`, and `requireWrite` with the turn's writes and workers. A non-applicable turn is recorded as `not-applicable` and creates no run; a retro run that later evaluates as non-applicable is marked `completed` with reason `not-applicable`, so retention can prune it. Repeated short, read-only, or question-ending turns therefore create no blocked runs and consume no run capacity. Its only step is `read-checkpoint`: read the existing `work_checkpoint` record for the turn. `gateOwnership: defer`; the definition declares `legacy` as `goal-continuity`/`work_checkpoint`. The legacy checkpoint gate still refuses the close. Retirement flips it to `own` and adds the checkpoint request step.
- Both definitions are shipped as `active` with `gateOwnership: defer`: they create observational runs and never steer. They answer "did this process run and why not" without adding a second gate, which is the whole point of the transition.

### 9. Interfaces

- `workflows` tool actions: `list`, `start`, `resume`, `status`, `evidence`, `cancel`. `start` checks `allowModelStart`; `risk: high` asks the user first. `resume` continues an interrupted run in the current session/workspace at its pending step; it never starts a new run. `evidence` accepts `{runId, stepId, kind, ref}` and runs the verifier; a text claim is rejected.
- `/workflows` command: opens the conversation view from change 1; `/workflows run <id>` starts a definition; `/workflows resume <runId>` resumes an interrupted run; `/workflows install <path>` installs and approves a definition; `/workflows adopt <name>` verifies and adopts an existing change; `/workflows status` returns a bounded text summary. The model tool cannot install a definition or start an adoption.
- System prompt: a `systemPrompt.context` contribution named `workflows-active-runs` with at most five lines, one per active run; no section when none.
- Workflows view: change 1's shell gains a Definitions list, a run detail, a receipt list, and the trigger evaluation table. The editor is change 5.

### 10. Legacy composition is mechanical

`gateOwnership: defer` is valid only when a matching legacy source is declared on the definition or step:

```json
"legacy": { "plugin": "delegation-rules", "signal": "spec-review" }
```

At load, the engine resolves ownership per step and checks that the declared legacy row is present in the profile. A `defer` step is refused when its source is absent, with the retirement next action; when the source is present it reads that gate's record and cannot steer. An `own` step is refused while a declared legacy source for the same behavior is installed and not deferred. A deferred step does not dispatch its executor. A definition-level `defer` requires a definition-level source and defers every step; a definition-level `own` may still contain deferred steps. This keeps the shipped intake owned for its own steps, defers only `spec-review`, and prevents both "two gates" and "no gate" states.

### 11. Security and trust

- Definitions are local trusted config; the loader never loads `drafts/` and refuses an unapproved file in the definitions directory.
- Tool steps use an allowlist and fixed arguments; no raw shell interpolation from model text. The only interpolation values are validated identifiers, paths inside the workspace, and record ids.
- Evidence paths are resolved with the `fs` service and checked by path components; a symlink escape is refused.
- Prompts, steer messages, and run records are bounded and redacted; no credentials, no full file contents, no machine paths.
- The engine does not execute definition code; JSONLogic is data-only.
- A `human` step's answer is recorded from the user-question service, not from a model message.
- The approval store and receipts are host-authenticated, not merely host-owned. Each record carries an HMAC-SHA256 signature made with a host key held outside `.dsh` and never exposed to the model. The pre-execute gate refuses a recognized model file-write to the definitions directory, the approval store, or the receipts directory; the loader and archive gate verify the signature, so a record written through any other path, or a matching definition/approval pair without a valid signature, is refused. The model cannot install a definition, start `/workflows adopt`, or create a valid adoption receipt.

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| The intake gate blocks a legitimate quick change. | The `change-intake` definition is configurable; a `quick-change` definition with fewer steps is a follow-up, but it still requires a completed run. The gate is opt-out via `enabled: false` with a visible record. |
| A change created before installation cannot archive. | `/workflows adopt <name>` verifies the existing artifacts and current spec-review record and writes a host-authenticated receipt without recreating the directory; a creation call for an existing directory is redirected to adoption only when no resumable intake exists. |
| A manual `mkdir` bypasses the command gate. | The archive gate requires an authenticated completed intake run or authenticated receipt and a current whole-spec PASS record; the file watcher records the untracked creation as a violation; the design states that arbitrary `run_code` is not a sandbox. |
| A model forges an approval or receipt. | Approvals and receipts carry an HMAC made with a host key outside `.dsh`; the loader and archive gate refuse an unsigned, forged, or modified record even after an unrecognized write. |
| The turn-close gate refuses every turn until a multi-step intake is done. | `maxBlocks` caps the refusals; the run can be cancelled; the steer names the next step; the intake is usually one or two turns. |
| A deferred workflow's record is missing and the run stays blocked. | The legacy gate is the enforcing path; the run is visibility only; retirement flips it only after parity. |
| A run's main step loses context across turns. | The prompt and evidence contract are re-sent on each turn stop; the run record carries the step, drafts, and decisions. |
| A long definition becomes a second programming language. | The schema has six executors and JSONLogic only; a fanout step is deferred to the built-in engine; no arbitrary code. |
| A model starts a high-risk workflow. | `allowModelStart` and `risk` plus a user confirmation; the tool refuses by default. |
| Run records grow. | 30 days/20 MB retention, atomic writes, completed runs pruned first; receipts and approvals are exempt while the change or definition exists. |
| The `defer` check depends on the installed profile. | At load, the step's legacy source is checked; a missing source refuses the step instead of silently double-gating or silently dropping the gate. |
| The client view and the engine disagree. | One run file is the source of truth; the view reads the same API and shows the same step state; tests compare them. |

## Migration Plan

1. Ship the engine with `change-intake` active, `task-review` and `retro` active with `gateOwnership: defer`, the adoption command, and the intake/archive gates enabled.
2. Existing active changes, including this change, are adopted through `/workflows adopt <name>` after their spec review passes; adoption verifies the existing artifacts and the current whole-spec PASS record and writes a host-authenticated receipt without recreating the directory.
3. The legacy checkpoint, task-review, and verification gates are untouched; the deferred workflows read their records and add no steers.
4. The owner uses the Workflows view to confirm the intake, adoption, and deferred records; the change is not archived until the new pipeline and adoption are exercised.
5. Rollback: set `enabled: false` (stops runs and steers, keeps records) or remove the row. The legacy gates remain the enforcing path, so rollback does not remove a guarantee.

## Open Questions

None. The intent trigger is deliberately shadow-by-default; making it active is a user decision in a later change after the shadow data. The `quick-change` definition is a later template, not a schema change.
