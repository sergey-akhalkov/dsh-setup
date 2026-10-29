# Design

## Context

See `proposal.md` — Why. The constraints that shape the approach:

- DSH `0.2.1-rc.3` exposes `tools/pre-execute`, a waterfall that can allow, deny, cancel, or ask before a tool body runs; its deny reason is model-facing.
- The model-facing `update_goal` tool owns the block: before the three-round threshold it rejects `action: "blocked"`; after the threshold it calls the goal service immediately and defers a `<goal_blocked>` closing context.
- `@dsh-setup/plugin-goal-continuity` currently owns the goal lifecycle as a deterministic supervisor over `ctx.goals`; its spec forbids it from calling the model. It already reads `session/event`, `goal/activation-changed`, `goal/changed`, and `agent/error`.
- The delegation-rules engine already runs subagents, parses verdicts, and writes digest-bound records. The owner explicitly chose goal-continuity as the home for the block review, not delegation-rules.
- The two inspected incidents both blocked while an authorized code route existed: a missing method in a sibling automation repository, and a test-only HMI activation/accessibility change. The runtime had `danger-full-access`; the agent still treated the code change as a permission question.
- The working contract is an always-on contribution with a documented 1500 estimated-token budget; the contract currently defines `blocked` by round count and “no authorized path remains”, without the user-only test or the means-vs-scope distinction.
- A standing user grant is currently session memory only; the inspected runs repeated a permission request after the user had already granted it.
- The `spawn` subagent provider supports an independent `agentPreset` and does not inherit parent context. An omitted preset joins the parent's composition, including `danger-full-access`, so a write-capable reviewer is the default unless the gate selects an enforced read-only preset.
- The tool registry seeds every scoped tool set from the global set; a preset's own declarations do not remove global tools such as `mcp_call`, `delegate`, or the shell. A reviewer-scoped `tools.restrict({ allow: [...] })` is the enforcement that filters inherited tools. The restriction is valid only in the scope that inherits the tools: the preset's shared scope sees its own preset tools as current registrations, so the gate applies the restriction on the reviewer child's `agent.ctx` after preset binding and before the first step.
- The subagent manager mounts an independent preset before it appends the parent's delegated policy overrides; an explicit `danger-full-access` parent override reaches the child even when the preset configures a read-only sandbox. The review must not rely on the sandbox; the tool allowlist is the boundary.
- The goal tool's rejection threshold is `blockedAfterConsecutiveRounds` (default 3). Its check runs inside `update_goal` after `tools/pre-execute`, so the gate must check the effective threshold before starting a review.
- The setup patch is generated from per-plugin composition fragments. A read-only preset declaration is a new approved Harness row in the goal-continuity fragment; the setup dependency rule needs an explicit exception because the preset and its tools are Harness-provided.

## Goals / Non-Goals

**Goals:**

- Review every root-agent proposed goal block before it takes effect, and deny it when any authorized non-user route exists.
- Keep the goal active on a denial; give the model one concrete next action; never show a closing “blocked” message for a denied proposal.
- Allow a verified blocker and carry the exact user-only action into the closing message and the review record.
- Run the reviewer with no write capability, in an enforced read-only preset, and skip reviews before the effective block threshold.
- Keep the continuity supervisor deterministic; the block-review subagent is the only model call and never starts, continues, or cancels a turn.
- Make the decision auditable: a local record, a digest, the target identity, the evidence, and the grant ledger.
- Bound cost and latency: one fresh-context review per block proposal, a verdict cache, a per-goal review budget, and configured failure policies.
- End repeated permission questions: the workspace grant ledger is part of the review evidence.

**Non-Goals:**

- No completion review on `update_goal(action: "complete")`; a symmetric review is a later change.
- No `question-only` mode, no post-block automatic reversal, and no change to the runtime's `blockedAfterConsecutiveRounds` threshold.
- No new delegation-rules trigger or contract; the delegation engine remains for task/spec/answer/patch rules.
- No change to user pause, clear, complete, `/goal` commands, or the existing continuity policies.
- No automatic push, publication, credential, or destructive-action authorization; the review is advisory to the gate, and those actions stay user decisions unless explicitly granted.

## Decisions

### D1 — Gate in goal-continuity, at `tools/pre-execute`

The gate lives in `@dsh-setup/plugin-goal-continuity` and intercepts `update_goal` before the goal service changes. A `deny` leaves the goal active and gives the model a next action; an `allow` is the only path to a block. The continuity supervisor is untouched: it still sees only a verified `model-reported` block and preserves it.

Alternatives: a delegation-rules trigger (rejected by the owner: the goal owner must own the decision); a post-block supervisor review (rejected: the block and closing message already ran, and reversing it needs a second model call plus resume churn); a new plugin (rejected: another package and composition surface for one decision).

### D2 — Split the plugin boundary instead of hiding the model call

The current “Continuity supervision boundary” requirement forbids the supervisor from calling the model. The design splits the responsibilities explicitly:

- the **continuity supervisor** remains deterministic and never calls a model;
- the **block-review gate** may start one bounded, read-only subagent for one proposed block, and only returns a tool-call decision.

The spec is modified accordingly. A unit test asserts the continuity path never starts a subagent, and a separate test asserts the gate does.

Alternatives: keep the boundary absolute (rejected: the owner wants the reviewer in this plugin); move the gate to delegation (rejected); make the gate a second whole plugin (rejected: overkill).

### D3 — Pre-execute deny/allow, not a post-block record

The gate returns `deny` with a model-facing reason for `not-blocker`, and `next()` for `blocker`. `deny` is the only decision that both prevents the block and tells the model what to do; `cancel` hides the reason, `ask` needs an approval service, and `post-execute` is too late because the goal has already changed.

Skip conditions:

- the caller is not a root agent, or has no current active goal;
- `exec.name !== 'update_goal'` or `action !== 'blocked'`;
- the argument goal id/revision is not the current goal (the tool's own stale check decides);
- the user explicitly asked for the block in the open turn, detected by a bounded explicit-request check; any other direct-human turn is reviewed;
- the review is disabled;
- the call is a goal-round call (no direct user message in the open turn) and the goal has started fewer rounds than the effective `blockedAfterConsecutiveRounds` threshold; a premature goal-round call is left to the goal tool's own rejection and consumes no review budget.

The gate does not mutate the goal, resume it, or inject a turn. It may inject one bounded notice before allowing a verified block so the closing message can name the user action.

The threshold check applies only to a goal-round call. A direct user message gives the goal tool direct-human authority, which accepts a block without the round threshold, so the gate must not extend the bypass to a direct-human “continue” turn. Only an explicit block request skips the review; a below-threshold direct-human proposal is reviewed.

Alternatives: rely on the goal tool's rejection (rejected: the review runs first and spends the per-goal budget); deny premature calls ourselves (rejected: the goal tool already owns that error and its message); skip every direct-human turn (rejected: a “continue” turn could block unreviewed). The pre-execute choice itself has these alternatives: deny every block (rejected: a genuine restart would be trapped); allow with a warning (rejected: the block still ends the run); post-block supervisor review (rejected: D1).

### D4 — Fresh-context reviewer with raw evidence, default `not-blocker`

The reviewer is a separate subagent started through `ctx.subagents.startActivation` with `parent: agent`, the session cwd, the configured model/effort, and the independent `goal-reviewer` preset selected through `request.agentPreset`. The preset exposes only `read`, `grep`, and `glob` plus the reviewer persona. The gate applies `ctx.tools.restrict({ allow: ['read', 'grep', 'glob'] })` on the reviewer child's `agent.ctx` when the child is created, after the preset is mounted and before its first step; the child scope inherits the preset tools, so they are valid allowlist entries, and it filters inherited global tools such as `mcp_call`, `delegate`, the shell, and the goal tools. A restriction in the preset's shared scope would see the preset's own tools as current registrations and throw, so the gate must not use it. The provider must advertise `capabilities.agentPreset` and not inherit parent context; otherwise the gate treats the review as unavailable. Omitting the preset would join the parent's `danger-full-access` composition, which is not acceptable for a reviewer. The reviewer receives:

- the goal objective, rounds started, and max rounds;
- the block reason;
- the last three goal rounds' tool calls and results, truncated and bounded;
- the user messages and the standing grants;
- the runtime permission policy (from the session's runtime-context messages);
- the workspace `AGENTS.md` and the local grant record;
- the workspace path, with a read-only instruction.

It does not receive the agent's reasoning or a narrative summary; the block reason is a claim to verify, not evidence. The prompt defaults to `not-blocker`, names the user-only definition and the non-blocker examples, and requires a concrete next action for a denial.

Alternatives: pass the agent's reasoning (rejected: rationalization and prompt-injection surface); pass only the block reason (rejected: the inspector needs the actual tool results); use the main agent as its own reviewer (rejected: no independence); omit the preset (rejected: the child inherits the parent's write composition); a preset without the child-scope allowlist (rejected: inherited global tools remain available); a restriction in the preset's shared scope (rejected: the preset tools are current registrations and the restriction throws); a read-only sandbox (rejected: the delegated policy override wins); a direct model call (deferred: no workspace inspection); a start-time tool filter (not offered by the start request; the child composition's tool filter is only for historical descriptors).

### D5 — Strict verdict, digest-bound record, cache, budgets

The review returns one fenced JSON verdict:

```json
{
  "verdict": "blocker",
  "userAction": "restart the DeepSeek Harness app",
  "nextStep": null,
  "evidence": ["..."],
  "confidence": "high"
}
```

`blocker` requires `userAction`; `not-blocker` requires `nextStep`; anything else is a review error. The gate writes an atomic record under `.dsh/goal-continuity/block-review/<goal-id>/<digest>.json`, where the digest covers the objective, block reason, and evidence bundle. A matching digest reuses the verdict. A per-goal review bound (default 3) stops unbounded spend. When the bound is reached, `onExhausted` (default `deny`) leaves the goal active and denies further proposals with a visible reason; `onExhausted: "allow"` accepts an unverified block with a notice. A new proposal with different evidence does not reset the bound; only raising `maxReviewsPerGoal` does. The record marks every policy-allowed block as unverified.

Alternatives: no record (rejected: no audit); a shared delegation record path (rejected: goal-scoped, not change-scoped); no cache (rejected: cost and repeat loops); allow after the bound by default (rejected: the default must preserve the goal).

### D6 — Failure and unavailable policies

Defaults: `onUnavailable: "allow"` (a missing provider or preset is a configuration problem; allow the stock block with a visible unverified notice so the session is not trapped), `onReviewError: "deny"` (a failed review is not evidence of a blocker; keep the goal active), and `onExhausted: "deny"`. The `allow` policy is an explicit exception to the confirmation rule: the gate records the block as unverified and injects a notice naming the policy. The default error and exhausted policies keep the goal active. All three are configurable. The gate never fails the session; an invalid verdict is an error, not a blocker; a review that does not confirm a blocker leaves the goal active unless an allow policy explicitly applies.

Alternatives: deny on unavailable (rejected: a missing configuration would trap every block); allow on error by default (rejected: an unverified block would end the run); silently allow without a record (rejected: no audit).

### D7 — Config, defaults, and off switch

Add a nested `blockReview` config:

```ts
interface BlockReviewConfig {
  enabled?: boolean          // default true
  provider?: string          // default "spawn"
  model?: string             // default "deepseek-flash"
  reasoningEffort?: string   // default "max"
  reviewerPreset?: string    // default "goal-reviewer"
  blockedAfterConsecutiveRounds?: number // default 3; must equal the goal tool setting
  timeoutMs?: number         // default 300000
  maxReviewsPerGoal?: number // default 3
  onReviewError?: 'deny' | 'allow'      // default 'deny'
  onUnavailable?: 'deny' | 'allow'      // default 'allow'
  onExhausted?: 'deny' | 'allow'        // default 'deny'
}
```

`blockReview.enabled: false` disables only the gate; the row's `enabled: false` disables the whole plugin. Unknown, mistyped, or out-of-range fields fail plugin load. The defaults are shipped in the fragment and validated live; if the provider does not accept `model`/`reasoningEffort`, the target falls back to the provider defaults rather than failing every review. The reviewer preset must be installed and read-only; the gate checks the provider's `agentPreset` capability and treats a missing or write-capable preset as unavailable. `blockedAfterConsecutiveRounds` is the gate's view of the goal tool's effective threshold; the setup documentation requires the two values to stay equal, and the tests exercise a non-default value.

Alternatives: top-level fields (rejected: noisy config); no options (rejected: the owner cannot choose a different model or policy); a separate target config (rejected: one review target, not a delegation rule set); derive the threshold from the goal tool at runtime (not exposed by the tool registry) or hardcode 3 (rejected: a profile may change the threshold).

### D8 — Standing grants are durable and scoped

The contract tells the agent to record a user grant as a dated, scoped entry in the workspace `AGENTS.md` (repo-durable) or `.dsh/goal-continuity/grants.json` (machine-local). The gate reads both and includes them in the reviewer's evidence. A grant covers means: code, tools, tests, sibling repositories, testability, and instrumentation. It does not cover a new product requirement, a destructive action, a credential, or a publication unless it names them. A stale or foreign grant is not applied.

Alternatives: session-only grants (rejected: the inspected runs repeated the ask); profile-only grants (rejected: grants are workspace-specific); a new tool to write grants (rejected: the agent can write the file with its existing tools).

### D9 — Contract changes: user-only, means, no menu, testability

Modify the working contract:

- a blocker is a user-only action or user-only knowledge; a library/sibling-repo/test/testability change and a permission the runtime already grants are not blockers;
- a blocker names exactly one user-only action; a menu with an authorized code option is not a blocker;
- test-only activation/accessibility/instrumentation is a means; a production behavior change is a product decision;
- a denied block is a continuation instruction; the agent must not turn the review into a permission request;
- a standing grant is recorded and not re-asked.

The detailed examples and the evidence procedure stay in the reviewer prompt, not the always-on contract, to protect the 1500 estimated-token budget. The contract edit replaces existing lines where possible and is measured by the repository's budget test.

Alternatives: reviewer-only change (rejected: the model's own framing causes the bad proposal); a new always-on section (rejected: budget and duplication).

### D10 — Security and trust boundaries

- The reviewer runs under the independent preset; the gate applies the child-scope `tools.restrict` allowlist on `agent/created`, after preset binding and before the first step, and the effective tool surface is the read-only allowlist. The gate validates the provider's `agentPreset` capability and verifies the restriction; a failed restriction disposes the child and treats the review as unavailable. The review output is parsed, never executed.
- The gate does not rely on the session sandbox: a parent `danger-full-access` override can reach the child, so the tool allowlist is the boundary. A test registers `read`, `grep`, and `glob` only in the preset and mutation tools globally, starts from a parent with the override, and asserts the child's effective tool surface is only the allowlist.
- Repo files, tool results, and the block reason are untrusted data; the prompt says so.
- The record is sanitized of machine paths and obvious credentials; it lives under local `.dsh` state, not a tracked file.
- A verified blocker remains a user decision: the gate never authorizes a destructive action, credential use, publication, or force-push.
- The reviewer can be wrong; the record and the notice make the decision visible, and the user can pause/override or disable the gate.

Alternatives: full tool access for the reviewer (rejected: not needed; increases injection risk); no record (rejected: no audit).

### D11 — Composition and generation

The package adds `assets/blocker-review.md` to `files`, adds the new DSH packages to devDependencies (`dsh-tools`, `dsh-subagent`, `dsh-working-directory`), keeps the pinned engines range, and adds the fragment config including the `preset-goal-reviewer` declaration. The declaration names `@deepseek-ai/dsh-agent-preset`, carries config id `goal-reviewer`, and mounts only `read`, `grep`, and `glob` plus the reviewer persona; it mounts no edit, write, shell, or other write-capable tool. The gate's Host source listens for `agent/created`, identifies the reviewer child by its subagent origin and `goal-reviewer` preset, and applies `ctx.tools.restrict({ allow: ['read', 'grep', 'glob'] })` to the child's own `agent.ctx` after preset binding and before the first step. The fragment generator/validator allow this approved Harness declaration from the goal-continuity fragment (the same kind of exception as the approved MCP adapter row), the setup patch includes it, and the `portable-setup` delta permits the Harness-provided preset and tool packages without setup duplication. `pnpm gen` updates the generated patch, setup manifest, and vendored tree; `pnpm build` updates `lib/**`; `pnpm validate:composition` mounts the preset; the gate test applies the child-scope allowlist with preset-only read tools and globally mounted mutation tools. The README row, docs, and market locale describe the block review and the preset.

Alternatives: embed the prompt in TypeScript (rejected: harder to review and test); skip the vendored asset (rejected: the setup must deliver it); ship the preset as a separate shipped bundle (rejected: the setup patch already delivers the bundle, and a separate shipped bundle would change the installer and bundle lists for one declaration); keep the reviewer in the parent's composition (rejected: write-capable); put the restriction in the preset's shared scope (rejected: it sees the preset tools as current registrations and throws); rely on the preset's tool list without the child-scope restriction (rejected: global tools remain).

## Risks / Trade-offs

- **Reviewer latency inside a tool call** → one review per block, a 300 s timeout, a visible pending call, and a verdict cache; blocks are rare, and the alternative is hours of user time.
- **Reviewer bias** → the prompt defaults to `not-blocker`, uses the user's definition and the incident examples, and the provider/model is configurable (a different model can be selected for independence).
- **Reviewer hallucinates a route** → the model tries it; a new failure produces new evidence and a new review; the per-goal bound prevents runaway spend.
- **False `blocker`** → the block is allowed; the user can resume, the record shows the target and evidence, and the gate can be disabled per profile.
- **Reviewer tool surface** → the preset's own tools do not remove inherited global tools; the gate applies the allowlist on the reviewer child's `agent.ctx` after preset binding, where the preset tools are inherited and restrictable. A preset-scope restriction would see its own tools as current registrations and throw; a parent `danger-full-access` override cannot re-add mutation tools to the child scope. The test registers `read`, `grep`, and `glob` only in the preset and mutation tools globally.
- **Direct-human threshold bypass** → the threshold skip applies only to goal-round calls; a direct-human “continue” turn below the threshold is reviewed, and only an explicit block request skips the review. A test covers the below-threshold continue turn.
- **Threshold mismatch** → the gate's `blockedAfterConsecutiveRounds` must equal the goal tool's setting; the setup documentation and a non-default test keep them aligned; a mismatch either skips an eligible review or spends a premature one.
- **Unverified allow policy** → an unavailable target or a configured `allow` accepts a block without a verdict; the record and notice mark it unverified; the default error and exhausted policies are `deny`, and the owner can choose `deny` for unavailable.
- **Preset declaration is a foreign row** → the generator exception and the `portable-setup` delta make it an approved Harness declaration; validation rejects any other foreign name.
- **Target missing or failing** → `onUnavailable`/`onReviewError` policies; a visible notice; the session never fails.
- **The deny is a tool error** → the delegation-rules failure-streak soft hint may fire after repeated denials; it is a harmless consultation hint, and this change does not alter delegation behavior.
- **Grant ledger abuse** → the reviewer treats file content as data; a grant must be a dated user statement; the local record is authoritative for the session; the scope limits are in the prompt and contract.
- **Production behavior change disguised as testability** → the prompt requires a test-only flag and treats a production behavior change as a product decision.
- **Host change needs a restart** → the owner fully quits and relaunches; live acceptance happens in the new session.
- **Always-on budget** → the contract edit replaces existing lines and is measured; the detailed taxonomy lives in the on-demand prompt.
- **A genuine blocker waits for the runtime threshold** → unchanged; the gate reviews at the threshold, and a lower threshold is an owner setting outside this change.

## Migration Plan

1. Add the config, asset, prompt, gate, evidence reader, verdict parser, record, cache, budgets, the read-only `goal-reviewer` preset declaration, the fragment/generator exception, and tests to `packages/plugin-goal-continuity` and the setup generator.
2. Modify the working contract and its budget test.
3. Run `pnpm gen`, `pnpm build`, `pnpm check`, `pnpm validate:repo`, and `pnpm validate:composition`; confirm the composed profile contains the read-only preset, and that the reviewer child's allowlist excludes `mcp_call`, `delegate`, the shell, and the goal tools even when the parent has a `danger-full-access` override, with `read`, `grep`, and `glob` registered only in the preset; commit sources and generated output.
4. The owner fully quits and relaunches the Desktop app from outside an agent-hosted shell.
5. Live acceptance: replay the sibling-repository block (denied, goal continues), replay the HMI testability block (denied, test-only change continues), a genuine restart block (allowed, exact action), a standing grant (permission block denied), a premature goal-round block call (no review spend), a direct-human below-threshold “continue” turn (reviewed), a configured unverified policy (visible record/notice), and a mutation attempt under the reviewer child (denied).
6. Rollback: set `blockReview.enabled: false` (continuity unchanged) or disable the row (stock behavior); the preset remains installed but unused; records stay local and need no migration.
