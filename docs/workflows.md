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

The engine never loads `.dsh/workflows/drafts/`; a model may propose a draft, and only the user-started `/workflows install <path>` copies, validates, and approves it. That command is the currently implemented installation path. The editor (change 5, not shipped here) will save through the same exported host `installDefinition` function: the definition bytes and its matching HMAC approval are persisted together, a failure restores both, and a successful editor save is therefore an authorized install, never a model activation. The install path refuses a linked ancestor or a destination outside the definitions directory.

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
