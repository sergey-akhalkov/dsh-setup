# Workflows

`@dsh-setup/plugin-workflows` has two halves in one row (`dsh-setup-workflows`):

- the read-only **observability** surface from `add-workflow-observability` — a per-session event journal, a shadow trigger catalog, a run projection, health, the read API, and the Workflows view;
- the **obligation engine** from `add-workflow-obligations` — stored definitions, deterministic triggers, durable runs, evidence-verified steps, and the gates that refuse a turn close or an `openspec` creation/archive while a required step is open.

Disabling the row removes both halves together. The engine never adds a second event log: every trigger evaluation goes to the same journal and Why-not table as the shadow catalog.

## Definition schema

Definitions are closed-schema JSON data under `.dsh/workflows/definitions/*.json` (local) or the package's read-only `assets/definitions/*.json` (shipped). The schema is versioned (`v: 1`) and every unknown field, duplicate step id, dangling edge, implicit cycle, or credential-shaped value fails load with the definition and field.

Top-level fields: `v`, `id` (lowercase kebab, also the install file name), `name`, `version`, `trigger`, `settings`, `steps`.

`settings`: `allowModelStart`, `risk` (`low`/`medium`/`high`), `gateOwnership` (`own`/`defer`, default `own`), `maxBlocks`, `allowIntent`, `allowTools` (the tool allowlist), and `legacy` (`{plugin, signal}`, required for a deferred definition).

A step has `id`, `title`, `executor` (`main`, `subagent`, `tool`, `branch`, `loop`, `human`), optional `prompt`, an `evidence` completion contract, `next` (a step id or `end`), optional `blockTurnClose`, `nonCritical`, `ownership`, `legacy`, and the executor-specific object. A `branch` step declares `branch: {predicate, then, else}`; a `loop` step declares `loop: {maxIterations (≤50), stop, next, cap}` and must be the only way to iterate. An `all` evidence contract is a non-empty recursive list, passes only when every item passes, and its failure names the first failing item path (`items[0].items[1]`).

Shipped definitions: `change-intake` (active, own, with the `spec-review` step deferred to the strict `spec-review` rule), `task-review` (active, deferred), and `retro` (active, deferred, applicability-gated).

## Triggers

Deterministic kinds the engine may evaluate: `turn.stopping`, `tool.pre-execute`, `tool.result`, `fs.change`, `subagent.end`, and `review.record`; the optional intent trigger is a separate kind, never a deterministic event. The observability shadow catalog keeps its six kinds (agent turn start/stop, tool result, subagent start/end, workspace file change); the engine's extra kinds and outcomes are additive and documented by the `workflow-observability` delta.

A trigger is `shadow` or `active`, with a `dedupe` policy (`none`, `turn`, `path+content-hash`, `callId`, `name`) and optional `repeat` and `applicability` (`checkpoint-required`). A shadow match records `would-fire` and acts on nothing. An active match starts at most one run per dedupe key (a repeat starts a new run). A not-applicable trigger records `not-applicable` and creates no run. The retro applicability is the workflows row's `checkpointApplicability` config: `minToolCalls` (default 4) and `requireWrite` (default true). The plugin cannot read another row's config, so the operator MUST mirror the installed goal-continuity checkpoint settings there; a mismatch makes retro start or stay idle when the legacy checkpoint gate would not. The Why-not table shows the effective vocabulary: the shadow reasons (`would-fire`, `event-mismatch`, `filter-mismatch`, `dedupe`, `disabled`, `not-ready`, `error`) plus the engine outcomes `run-created`, `run-suppressed`, and `not-applicable`.

The optional intent trigger is shadow by default, records the classifier name, confidence, and reason, and can start a run only when both the plugin row's `config.allowIntent` (default false) and the definition's `settings.allowIntent` are true and the definition was installed and user-confirmed. The host classifies the latest user message with the bounded built-in heuristic (`heuristic-v1`); a definition matches only its declared `intent`, `classifier`, `session`, and `workspace` filters.

## Evidence

A critical step never completes from a model text claim. The completion contract is one of:

- `file` — a workspace-relative path, existence, non-empty, optional `minBytes`, optional segment glob; a link or `..` escape is refused.
- `record` — the whole-spec review at `.dsh/delegation/spec-review/<change>/spec.json` or the portable task record at `openspec/changes/<change>/reviews/<taskId>.json`, matched on rule/change/phase/scope/task/verdict and, with `digest: current`, the current change artifact digest; a task-scoped record never satisfies a whole-spec step. A `source: checkpoint` record reads a goal-continuity checkpoint.
- `tool` — a completed tool call with the declared name and arguments.
- `check` — a foreground shell result that ran after the step was requested with exit 0 and no timeout, signal, or sandbox denial.
- `human` — a recorded user answer matching the declared accepted answer.
- `all` — every recursive item; the first failure is reported with its item path.
- `declaration` — only for a `nonCritical` step; it is recorded as `self-declared` and never satisfies a critical step.

## Host authentication

Approvals (`.dsh/workflows/approved.json`), completion/adoption receipts (`.dsh/workflows/receipts/<change>.json`), and authoritative run files are signed with HMAC-SHA256 using a host key at `~/.dsh-setup/workflows-host.key` (or `DSH_WORKFLOWS_HOST_KEY`). The loader and archive gate verify the signature: an unsigned, forged, or modified approval, receipt, or run is refused after reload and cannot authorize a creation, archive, resume, or receipt. Editing an installed definition changes its hash and refuses it until re-approved.

Trust boundary: the key gives tamper-evidence against model-mediated writes (`write`/`edit`/tool paths there are refused by the pre-execute guard), accidental edits, and on-disk tampering between host restarts. It is **not** a boundary against an arbitrary same-user shell or `run_code` program, which can read files the host can read; that case is outside this threat model. Approvals and receipts are durable across restarts but are not tamper-proof against the OS user.

The engine never loads `.dsh/workflows/drafts/`; a model may propose a draft, and only the user-started `/workflows install <path>` or the Design mode's save copies, validates, and approves it. The editor saves through the same exported host `installDefinition` function: the definition bytes and their matching HMAC approval are persisted together, a failure restores both, and a successful editor save is therefore an authorized install, never a model activation. The install path refuses a linked ancestor or a destination outside the definitions directory.

## Design mode

The Workflows view has two surfaces: the read-only view (default) and **Design**. Design is one mode inside the existing conversation view; it is not a second shell, and it edits the same JSON the engine loads.

- **Canvas**: the trigger node renders first, then the ordered step nodes, then the terminal `end` node. Edges are labelled `start`, `next`, `true`/`false` (branch), and `body`/`exit` (loop). The canvas supports pan, zoom, selection, and focusable nodes and edges; a property panel edits the selected node. Drag a node to move it and drag between handles to connect; the palette adds `step`, `branch`, `loop`, and `human` nodes.
- **List mode**: the `Canvas | List` toggle switches to a form editor with every step field and every edge, backed by the same editor state and save path. Below a 720 px window the view defaults to List and keeps the canvas available.
- **Templates**: the shipped definitions (`change-intake`, `task-review`, `retro`) are read-only templates; "create from template" copies one into a local definition with a new id and `version: 1`. A shipped definition is never edited or deleted in place.
- **Lifecycle**: a new definition starts at `version: 1`; a copy or duplicate gets `<id>-copy` (then `<id>-copy-2`, …); rename changes only `name`, because the id is immutable; delete removes a local definition and is refused while an active run references it, returning the run ids.
- **Save is an authorized install**: the host validates the graph with the engine's own `loadDefinition` schema, writes the definition and its matching host-signed approval together, and returns the new revision (the SHA-256 of the exact file bytes). A failed definition or approval write leaves both unchanged. One successful save bumps `version` by one.
- **Create-only and revisions**: every definition and layout write sends `expectedRevision`. A create-only save sends `null`; the host creates atomically, and a collision returns `409` with the current revision and writes nothing. Update and delete send the revision from the read that loaded the resource; a mismatch returns `409` with the current revision and writes nothing, and the editor offers reload, the next free id, or save-as-copy. Definition and layout revisions are independent: the first layout save sends `null`, and neither save requires the other's revision.
- **Layout sidecar**: node positions live in `.dsh/workflows/layout/<id>.json` as `{v: 1, id, positions: {[stepId]: {x, y}}}`. They never enter the definition, the engine ignores the file, and a missing sidecar uses a deterministic layered layout, so a missing or stale layout cannot change a run.
- **Run overlay**: the view selects the newest run for the open definition (`source=workflow&definition=<id>`), or another run of that definition from a selector that labels each run with its id, status, and recorded definition version, and overlays each node with the recorded state, structured evidence (`kind` and `ref`, with the full ref in the tooltip), producer-owned failure class, and violations. The accessibility summary notes when the run's recorded definition version differs from the open definition. A run step the definition no longer has is marked orphan and never drawn as a node; a definition step missing from the run shows no run state; a violation naming an unknown step is a run-level notice. The overlay is read-only: a node click opens the property panel, and it never starts a run, a step, or a tool.
- **Drafts**: a definition draft is `.dsh/workflows/drafts/<name>/definition.json`. It is never loaded and never listed as a local definition; opening it in Design and saving installs it through a create-only, approved save at `version: 1`. The user's save is the confirmation.
- **Accessibility and fallback**: a screen-reader summary states the trigger, step count, selection, and run state; keyboard add (palette + Enter) and keyboard connect (select a source, press `C`, choose the labelled target) replace drag; focus is visible. A canvas render error switches to List with a bounded notice and the definition stays editable; the host and the runs are unaffected. A client-module evaluation failure happens before render and is reported by the Harness loader, outside this in-view fallback.
- **Trust boundary**: the editor writes only `.dsh/workflows/definitions/` and `.dsh/workflows/layout/`; the workspace comes from the live session, ids are validated, and links or escapes are refused. Conditions are JSONLogic data, never evaluated in the client, and a credential-shaped definition is refused by the host validator.

## Runs

Each run is one JSON file under `.dsh/workflows/runs/<runId>.json`, replaced atomically on every transition. Statuses: `running`, `blocked`, `completed`, `failed`, `cancelled`, `interrupted`. A run is scoped to one session and one workspace; another session can view it but cannot satisfy its steps. On startup an unfinished run becomes `interrupted` with a bounded reason and is never auto-completed; `/workflows resume <runId>` (or the `workflows` tool `resume`) re-evaluates its pending step without recreating a change directory or starting a second run. Runs execute one requested step at a time, and one start per dedupe key.

Retention: terminal runs are pruned after 30 days or when the workspace exceeds 20 MB; open runs are retained. Receipts are separate files and survive pruning while the change exists, so an archive authorization is not revoked by pruning.

## Gates

- **Turn close** (`agent/turn-stopping`, root turns only): while a run has an open `blockTurnClose` step that the engine owns and does not defer, the gate steers with the step prompt, its evidence contract, and the exact workspace-relative path the verifier checks. Refusals are bounded by `maxBlocks`; after the cap the close is allowed exactly once with a visible `VIOLATION` in the run and is never reported as a pass. An internal error fails open. Subagent turns are exempt.
- **Pre-execute intake** for a shell `openspec new change <name>` (normal, `rtk openspec`, `pnpm exec openspec`): an authenticated completed `change-intake` run or authenticated receipt allows the call without starting or resuming anything; an owned `create-change` call is allowed; a resumable intake for the name resumes at its pending step and the call is refused; an existing `openspec/changes/<name>/` without a resumable run or receipt is redirected to `/workflows adopt <name>`; otherwise the intake run is created and the call is refused with its first step. A compound command is not matched; the archive gate and the change watcher are the backstop.
- **Pre-execute archive** over `openspec archive <name>` and over a move of `openspec/changes/<name>` into `openspec/changes/archive/` through `mv`, PowerShell `Move-Item`, or `git mv`: refused while a related run has an open required step, when no authenticated completed intake run and no authenticated receipt exist, or when the current whole-spec PASS record is missing or stale. A forged/unsigned receipt or run and a text claim never allow it.
- **Authorization write guard**: a model-originated write to `.dsh/workflows/definitions/`, `.dsh/workflows/approved.json`, `.dsh/workflows/receipts/`, or `.dsh/workflows/runs/` is refused; only host-owned install/receipt calls pass.

## Commands and tool

User commands:

- `/workflows` — names the Workflows tab as the entry point (a Host command result is text-only and cannot open a client view); nothing starts.
- `/workflows run <definitionId>` — user-started run.
- `/workflows resume <runId>` — resumes an interrupted/blocked run.
- `/workflows install <path>` — validates, asks the user, copies into the definitions directory, and records the hash + host signature.
- `/workflows adopt <name>` — verifies an existing change's four artifacts and the current whole-spec PASS record, asks the user, and writes the adoption receipt without recreating the directory or calling `openspec new change`.
- `/workflows status` — bounded text summary.

The model tool `workflows` offers `list`, `start`, `resume`, `status`, `evidence`, `cancel`. It refuses a raw script or definition, a start without `allowModelStart` (and a high-risk start without a direct user yes), a resume/cancel in another session, unauthenticated runs, an unverified evidence claim, an install, and an adoption. The tool never writes an approval or receipt.

## Intake flow

1. `openspec new change auth` is refused and an intake run starts.
2. The agent writes `.dsh/workflows/drafts/auth/requirements.md`, then `architecture.md`, then `interface.md`; each turn close re-checks the same path the steer shows.
3. `create-change` runs the owned `openspec new change auth` call and completes only from that call plus the created `.openspec.yaml`.
4. `spec` verifies the four artifacts and `openspec validate auth --strict`; strict validation lives here, after creation.
5. `spec-review` is deferred: it reads `.dsh/delegation/spec-review/auth/spec.json`, requires the current whole-spec PASS, and dispatches no `delegate` call; the legacy strict gate remains the only steer.
6. `approval` asks the user; only a yes completes the run, writes the host-authenticated `.dsh/workflows/receipts/auth.json`, and lets the archive gate accept the change later.

A restart after `create-change` marks the run interrupted; the next `openspec new change auth` resumes it at `spec` without recreating the directory or being redirected to adoption.

## Migration and rollback

A change created before the row was installed is adopted with `/workflows adopt <name>`: the host verifies `proposal.md`, `design.md`, `tasks.md`, at least one `specs/*/spec.md`, and the current whole-spec PASS record, asks the user, and writes the adoption receipt. The model cannot invoke adoption. A pre-existing active change (including `add-workflow-obligations` itself) can be adopted this way.

While a legacy gate is installed, a step covering the same behavior declares `legacy: {plugin, signal}` and `ownership: defer`; it reads the legacy record, dispatches no executor, and adds no second steer. A deferred definition or step refuses to load when its source is not installed (naming `retire-legacy-gates`), and an `own` step refuses to load while its declared source is installed. `task-review` and `retro` ship active but deferred: they create observational runs (retro only for applicable turns) and never steer.

Rollback: set the row `enabled: false` (stops new runs and steers, keeps records) or remove the row. The legacy gates keep enforcing, so rollback removes no guarantee.
