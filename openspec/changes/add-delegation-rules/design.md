# Design

## Context

See `proposal.md` for motivation. The constraints that shape this design:

- DSH `0.2.1-rc.3` exposes `agent/turn-stopping` as a serial event awaited before the turn boundary commits. A listener may call `agent.steer(message)`; the machine re-reads the inbox, runs another step, and closes the turn only when no fresh steering remains. It is the only deterministic place to refuse a handoff.
- `ctx.subagents` is a registry of named providers. `startActivation` starts one provider and returns a result promise; providers differ in context inheritance, model options, and write permissions. The official `@deepseek-ai/dsh-subagent-codex` provider is pinned to its bundled `@openai/codex` `0.153.4`; its wrapper resolves only its package-local binary and exposes no binary-path config.
- The owner machine has `codex-cli 0.164.0` in `PATH`; the default Codex home has no `config.toml` or `auth.json` observed, and `CODEX_HOME` is unset. The installed codex's `exec`/`app-server` commands and config path are the operational boundary; the first live run verifies auth and config.
- The setup's existing plugins are Host-only bundles with skills and/or an always-on section. This change adds a generic rules engine, a forked provider target, and no always-on prompt section.
- The owner chose: a model-agnostic rules engine rather than a Codex-named task plugin; any registered subagent provider as a target; the official Codex provider code as the 100% base for the fork; auto-detected installed Codex with an optional `codexPath`; no automatic write-back to the profile patch; the bounded `ERROR` handoff instead of a strict deadlock.
- `openspec/config.yaml` requires English for every artifact.

## Goals / Non-Goals

**Goals:**

- One generic engine where triggers, targets, instructions, contracts, and gates are data. Codex is one target; another user can point the same rules at a DSH model, another provider, or another subscription.
- A deterministic gate for gated rules: a turn cannot close without a matching digest-bound PASS/ERROR record; a stale record never authorizes a handoff.
- An authentic delegation result: the engine builds the instruction, starts the configured target, parses the result, and writes the record; a model's text claim is never a pass.
- Codex support for the owner's installed CLI through a forked provider with PATH/`codexPath` discovery, validation, status, and read-only/write instances.
- A safe patch path for complex bug fixes: isolated worktree, returned diff, no automatic merge.
- No always-on prompt section, no Client half, no DSH patch, no mandatory Codex dependency in the generic engine.

**Non-Goals:**

- Intercepting the model stream to retract an already-streamed draft answer.
- Cryptographic anti-forgery of records against a model with full filesystem access.
- Automatically writing a detected Codex path into the profile patch or any tracked file.
- Automatically merging `patch` results, installing Codex, or signing in to any provider.
- An arbitrary event rule language; only the documented trigger vocabulary is configurable. New trigger sources are code.
- Guaranteeing that a judgment call ("this task is hard") is delegated; that remains policy in the rule descriptions and skill.
- A dashboard, settings page, Client UI, or cross-machine record sync.

## Decisions

### D1 — Generic delegation rules, not a Codex-specific task plugin

| Option | Verdict | Why |
| --- | --- | --- |
| Two fixed Codex tools | rejected | Every new task, model, or trigger needs code; the tools are not model-agnostic |
| Codex-specific task presets | rejected | The engine would still assume Codex; another model/subscription would need a new plugin |
| Generic rules over `ctx.subagents` | **chosen** | Targets are providers/models; rules and instructions are data; the gate and records stay generic |
| Direct `codex exec` | rejected | It couples the engine to one CLI and loses the provider abstraction; the owner chose the provider fork |

The engine registers the rules and targets from its Config; default rules ship as data and can be overridden. The setup's defaults target the Codex fork; the engine itself imports no Codex package.

### D2 — Rule schema and config boundary

A rule is data:

```yaml
rules:
  - id: spec-review
    when: spec-ready
    to: codex
    contract: review
    phase: spec
    instruction: bundled:review-spec
    gate: strict
```

- `id` is unique and kebab-case; it is the record key and the `delegate` tool's enum value.
- `when` is one of the engine's trigger primitives; `to` references a configured target; `instruction` is a bundled prompt asset or inline text; `contract` is `review`, `answer`, or `patch`; `gate` is `strict`, `soft`, or `none`.
- Trigger-specific fields (`phase`, `threshold`) and contract-specific fields (`isolation`) are validated against the trigger/contract.
- The engine validates at apply: unique IDs, known triggers/contracts/gates, existing targets, a review rule has a phase, a patch rule has an isolation mode, no duplicate strict gate for the same digest scope, and a `delegate`/status tool can list the rules.
- Adding a task that uses an existing trigger and contract is configuration only. A new trigger source or a new result contract is a code extension; the design states that limit instead of pretending arbitrary events are configurable.

### D3 — Targets are DSH subagent providers

```yaml
targets:
  codex:
    provider: codex-subagent
  codex-write:
    provider: codex-subagent-write
  deepseek:
    provider: spawn
    model: deepseek-flash
    reasoningEffort: max
```

- A target names a registered `ctx.subagents` provider and optional model/agent options. The engine resolves the provider at apply/first use, validates its capabilities, and reports a missing target with the exact config key and next action.
- Targets can be added by installing/writing another provider; the engine's code is unchanged. The official `codex`, the DSH `spawn`/`fork` providers, and the fork's instances are all valid targets; model/subscription choice belongs to the target.
- The engine does not assume read-only; the target's provider/config owns its sandbox and permissions. A `patch` rule must point at a write-capable target, and the engine validates that declaration rather than silently escalating.
- Context inheritance is a provider property. The engine includes the rule's instruction and task context in the prompt; it does not fabricate provider context.
- `delegation_status` lists registered providers, capabilities, configured targets/rules, and the missing-target diagnostics. The Codex fork also exposes `codex_subagent_status` for its resolved CLI path/version.

### D4 — Trigger vocabulary and gate

The engine implements four deterministic triggers:

- `spec-ready`: an active review-ready change exists and the gated review has no matching PASS.
- `implementation-complete`: the change's task list is complete and the gated review has no matching PASS.
- `failure-streak`: a configured number of consecutive failed tool calls with no intervening success and no consultation attempt for that streak.
- `manual`: no automatic condition; the agent/user runs the rule through `delegate`.

The turn-stopping listener evaluates only the configured gated rules; it never starts a target run. A strict rule contributes an issue until a matching PASS/ERROR record exists; a soft rule steers once per streak and a failed consultation is reported without trapping the turn. The default rule set reproduces the owner flow: spec review, implementation review, blocker, research, and bug-fix (manual).

New trigger sources and new contracts require a code extension; the config cannot invent an event or a result format. That is the deliberate boundary that keeps the engine testable.

### D5 — Contracts, records, and digests

**`review`.** The engine computes the digest for the rule's phase (spec artifact digest or worktree digest), builds the P0/P1 prompt, runs the target, parses one fenced JSON verdict, validates the digest and severities, and writes a `.dsh/delegation/<rule>/<phase>.json` record. A `PASS` requires zero P0/P1 findings; `FINDINGS` and `ERROR` records are non-passing. Records are atomic; a matching `PASS`/`FINDINGS` record is reused without another run; an `ERROR` is retried after the cause is fixed. A stale digest is ignored.

**`answer`.** The engine builds the blocker/research prompt, runs the target read-only, returns the answer with evidence and sources, and writes no gate record. A failed answer is reported; a soft trigger records the attempt so the same streak does not loop.

**`patch`.** The engine creates an isolated git worktree, runs a write-capable target there, and returns the diff, changed files, and test results. It never applies the diff to the session worktree. The owner/agent reviews and merges. A patch run is never a review PASS; if a rule needs a review of the result, a separate `review` rule can target the patch worktree.

**Digests.** The spec digest hashes all regular files under the change directory except `.openspec.yaml`, with `tasks.md` checkbox state normalized so progress does not invalidate a review. The implementation digest hashes `git status --porcelain=v1 -z --untracked-files=all`, `git diff --binary HEAD`, and untracked file bytes, ignoring `.dsh/` and `.tmp/`. Git is invoked with fixed argument arrays, no shell.

### D6 — Turn-stopping gate

On `agent/turn-stopping` the listener resolves the session cwd, finds the nearest `openspec/changes` root, evaluates the configured gated rules, and builds a list of issues (rule, trigger, digest, record path, exact `delegate` call). If non-empty it steers with `createUserMessage({ content, source: { kind: 'delegation-rules' } })`; the source is attributed to the gate, not the user. It never starts a target and never throws; digest/read failures become issues with the failure text.

The gate allows a turn to close only when a matching `PASS` or `ERROR` record exists for the rule and digest. A stale record never authorizes a handoff. There is no in-session bypass; disabling the row is the explicit opt-out. The gate is a process-integrity check, not an anti-forgery boundary: a model with full filesystem access could write a record-shaped file; a future change may sign records if that threat matters.

### D7 — Codex fork and installed-CLI discovery

`@dsh-setup/plugin-codex-subagent` is a fork of the official MIT `@deepseek-ai/dsh-subagent-codex@0.2.1-rc.3`: the upstream `lib/index.js`/types are vendored, the binary resolution is replaced, and the app-server protocol adapter is retained. The fork records its upstream source/license in a NOTICE/README and is rebased when DSH support changes.

Discovery order:

1. `config.codexPath` when set: an absolute executable path or a command name; validate it exists and runs.
2. Otherwise resolve `codex` from `PATH` (Windows `codex.exe`/`codex.cmd` via PATH/PATHEXT; POSIX `codex`).
3. If none, fail the run with a clear error naming the `codexPath` config key and `codex_subagent_status`; never fall back to the bundled `0.153.4`.

The fork validates `codex --version` and records the resolved path/version/source. On Windows it spawns `.cmd` through `ComSpec` with fixed arguments and a direct `.exe` otherwise; the prompt goes to the app-server stdin, not a shell. The app-server adapter talks to the installed CLI's `app-server --stdio`; the 0.164.0 protocol delta is a live-verification risk, and the adapter is patched if needed.

The fork registers `codex-subagent` (read-only) and `codex-subagent-write` (workspace-write) providers; the official `codex` provider may coexist. `codex_subagent_status` reports the path/version/source and a paste-ready `codexPath` snippet; it does not write the profile patch. The owner adds `codexPath` to the profile's `cordis.patch.yml` only if pinning is needed.

### D8 — Tools, skill, and model-facing cost

- `delegate(rule, change?, context?, objective?)` runs a configured rule. The `rule` parameter is an enum generated from the configured rules; its description names the manual tasks and the gate rules. The tool validates the rule's required inputs and returns the review findings, the answer, or the patch summary.
- `delegation_status` reports registered providers/capabilities, configured targets/rules, and missing-target diagnostics.
- The on-demand `delegation-rules` skill carries the trigger/contract/gate/rule-authoring detail, the P0/P1 rubric, the consult/patch guidance, and the troubleshooting steps.
- No always-on section. The two tool descriptions plus the skill catalog description are bounded at 700 estimated tokens (`UTF-8 bytes / 4`); the skill body is bounded at 20,000 UTF-8 bytes; a budget test reports measured sizes.

### D9 — Package mechanics

| Item | Decision |
| --- | --- |
| Rules package | `packages/plugin-delegation-rules`, `@dsh-setup/plugin-delegation-rules`, Host-only TypeScript, row `dsh-setup-delegation-rules` |
| Fork package | `packages/plugin-codex-subagent`, `@dsh-setup/plugin-codex-subagent`, Host-only forked JavaScript, row `dsh-setup-codex-subagent` |
| Rules module | Exports `name`, `inject = ['tools', 'subagents', 'skills', 'workingDirectory']`, `apply(ctx, config)`; registers the tools, skill provider, and turn-stopping listener |
| Fork module | Exports `name`, `inject = ['subagents', 'subprocess']`, `apply(ctx, config)`; registers the two Codex providers and the status tool |
| Config | Rules: `targets`, `rules`, timeouts, `failureStreak`; fork: `codexPath`, `providerName`, `model`, `env`, `permissionMode`, `disposeGraceMs` |
| Assets | Rules: default rule/prompt assets and `delegation-rules/SKILL.md`; fork: its README/NOTICE and locale/icon |
| Manifest | `dsh.bundle.patch`, exact `engines.dsh`, `@deepseek-ai/cordis` peer, pinned DSH peers/devDependencies |
| Generation | `pnpm gen` writes both patches, the setup patch/manifest, and the vendored tree; `pnpm build` writes the rules package's `lib/**`; the fork's `lib/**` is committed from the patched upstream |
| Release | One set version bump; market cards from `locale/en.json`; no `dsh.json`, `install.ps1`, or existing plugin change |

### D10 — Security and trust boundaries

- Rule and target IDs, change names, worktree paths, and git arguments are validated; no model input reaches a shell.
- The target provider owns its sandbox/permissions; the engine documents that a `patch` rule needs a write-capable target and never escalates one silently.
- The review/answer targets should be read-only; the prompt forbids file modification; a worktree change during a review invalidates the record via the digest.
- Patch results are isolated in a worktree and never auto-merged; the diff and tests are returned for human/agent review.
- Records contain no credentials, tokens, machine paths, or private keys. Reviewer/model output is untrusted data and is parsed, never executed.
- The Codex fork vendors no Codex binary, installs nothing, and signs in to nothing; it uses the user's installed CLI and config/auth.
- The fork's upstream MIT code is attributed; its local patch is documented. The gate's record anti-forgery limitation is documented.

### D11 — Model-agnostic proof and defaults

The setup's default rules target the Codex fork, because that is the owner's strongest current target. The engine has no Codex dependency: the same rule can target a DSH `spawn`/`fork` provider with another model, and the docs show that configuration. The live acceptance includes at least one non-Codex target run (a DSH in-process provider) for a review or answer rule, proving the target abstraction rather than asserting it. Other users install their own provider and point targets at it.

### D12 — Verification

- Unit tests: rule/target validation, trigger evaluation, spec/implementation digests, record atomicity/reuse/staleness, review verdict parsing, answer/patch contracts, gate decisions/steering, status tools, path resolver (config/PATH/missing/`.cmd`), provider registration, no always-on section, budget.
- Repository checks: `pnpm build`, `git diff --exit-code`, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:repo`, `pnpm validate:composition`.
- Live acceptance in a throwaway profile: installed Codex 0.164.0 auto-detect/`codexPath`, review FINDINGS→PASS/stale, implementation gate, a non-Codex target, missing target/path ERROR, `patch` worktree, removal.
- The app-server 0.164.0 handshake and Codex auth/config are implementation-time verifications; the recorded outcome decides whether the adapter needs a patch before release.

## Risks / Trade-offs

- **The rules DSL can grow into a config language.** → Small fixed trigger/contract vocabulary, validation, default rules, status tool, and a documented config/code boundary.
- **Target capabilities differ.** → Target declaration/validation, capability-aware status, read-only/write docs; the engine does not silently escalate.
- **The fork's app-server adapter may not match Codex 0.164.0.** → Live handshake first; patch the adapter if needed; the official 0.153.4 target can be used temporarily, but the owner wants the installed CLI.
- **The fork must be rebased on DSH updates.** → Record the upstream version/license; add the rebase to the DSH support-change checklist; the copied code is isolated in one package.
- **Path discovery can pick a `.cmd` that misbehaves.** → Status shows the resolved path; docs recommend an absolute `codex.exe` when needed; clear errors.
- **The review gate can livelock on persistent findings.** → The agent can consult, ask the owner, change the spec, or the owner can cancel/disable the rule; the strict/ERROR policy is explicit.
- **The final answer may stream before the gate runs.** → Tool descriptions instruct delegation before presenting; the gate forces another step; no stream interception.
- **A model with full filesystem access can forge a record.** → Accepted; the gate protects the normal flow, not a hostile agent.
- **Patch targets can modify code.** → Worktree isolation, no auto-merge, explicit target permissions, docs.
- **A non-Codex target may be weaker.** → The owner chooses the target/model per rule; the gate still requires the contract.
- **Default setup targets Codex.** → The engine is generic; other users override targets; the docs show a DSH target.

## Migration Plan

1. Fork `plugin-codex-subagent` from the upstream MIT provider; replace binary resolution with PATH/`codexPath`, add validation/status/providers, and test the 0.164.0 app-server handshake.
2. Implement `plugin-delegation-rules`: config validation, targets/triggers/contracts/gates, records/digests, tools/skill, default rules/prompts.
3. Add the setup defaults (Codex targets + default rules), docs, market cards, root TypeScript reference, and generated setup/vendored output.
4. Run the repository gate and the throwaway-profile live acceptance, including a non-Codex target and the patch worktree.
5. Bump the set version with `pnpm release:prepare`, regenerate, and publish only on the owner's release decision.
6. Rollback: disable/remove the two rows; the tools, gate, and skill disappear, records/worktrees/changes remain. No data migration.

Do not install the setup into the live desktop profile from a shell hosted by the running Harness; use a throwaway profile for the live acceptance, as the installer rules require.

## Open Questions

- The initial failure-streak threshold and review/answer/patch timeout defaults are operational values; they can be tuned through the rules/fork Config after the first live run without changing the spec or approach.
- The exact non-Codex target used for the live acceptance is a DSH in-process provider; the spec only requires that one such target is exercised.
