# Design

## Context

See `proposal.md` for motivation. The existing engine already has everything the advisor needs mechanically: a manual trigger, an `answer` contract that runs a read-only target, a rule-target indirection, and a synchronous tool result. The shipped rules currently send `review`, `research`, and `blocker` to the `codex` target, which uses the provider defaults; the `codex-astra` target already selects `gpt-6-astra` at `xhigh` but no rule uses it. The model-facing policy lives in the `delegate` tool description and the on-demand skill, under a documented byte budget.

The owner chose the broader default: every Codex rule uses the strong model and `xhigh` effort. This is a deliberate cost trade-off, not a side effect. The advisor remains a manual, bounded tool rather than an automatic participant.

## Goals / Non-Goals

**Goals:**

- A manual `advisor` rule that returns one bounded second opinion from the strong Codex target.
- Strong shipped Codex defaults for both `codex` and `codex-write`, with the target values still configurable.
- A model-facing policy that keeps the advisor for hard decisions and away from routine work.
- No new trigger, contract, gate, UI slot, or session injection path.
- Documentation, tests, and generated artifacts that make the defaults and their override path visible.

**Non-Goals:**

- An automatic supervisor, a turn-stopping listener, `steer`, `followup`, or chat injection.
- Letting the advisor satisfy or override a review, a block, or a completion gate.
- A hard per-session call cap. The soft three-call ceiling is the first version; a code-enforced cap is a possible follow-up if observed overuse justifies it.
- Reusing Codex threads across advisor calls. Answer runs stay ephemeral; review-thread reuse is unchanged.
- Changing the review rubrics, digests, records, worktree isolation, approval records, or archive gate.

## Decisions

### D1. Reuse the `answer` contract and a manual rule, not a new tool

The advisor is a new rule in the existing engine:

```yaml
- id: advisor
  when: manual
  to: codex-astra
  contract: answer
  gate: none
  instruction: bundled:advisor
```

The `delegate` rule parameter is generated from config, so the tool exposes the rule without a schema change. The answer path already validates the rule/target, runs the target read-only, returns a bounded response, writes no record, and leaves the turn closable.

Alternatives: a dedicated `consult_advisor` tool (duplicates validation, target resolution, timeouts, and the answer path for no behavior gain); repointing `research` at the strong target (loses the research/evidence prompt and makes factual research indistinguishable from a design opinion); a new trigger (the advisor is deliberately manual, so a trigger would add automatic spend).

### D2. Strong defaults on `codex` and `codex-write`; `codex-astra` stays the advisor's explicit target

The shipped targets become:

```yaml
codex:
  provider: codex-subagent
  model: gpt-6-astra
  reasoningEffort: xhigh
codex-write:
  provider: codex-subagent-write
  write: true
  model: gpt-6-astra
  reasoningEffort: xhigh
codex-astra:
  provider: codex-subagent
  model: gpt-6-astra
  reasoningEffort: xhigh
```

Every existing rule that points at `codex` or `codex-write` (spec review, task review, blocker, research, bug-fix, integration review) therefore uses the strong model by default, as requested. The advisor points at `codex-astra`, not `codex`, so a profile can override `codex` to a cheaper model without weakening the advisor. `codex-astra` keeps its explicit role as the strong target even while its values duplicate `codex` by default.

Alternatives: pointing only the advisor at `codex-astra` (rejected by the owner: all Codex rules should use the strong model); removing `codex-astra` and pointing the advisor at `codex` (rejected: overriding `codex` would silently weaken the advisor); putting the model options on the provider row (rejected: the engine's target-level data is the existing per-rule override mechanism, and a row-wide default would be less visible in `delegation_status`).

### D3. A dedicated `advisor.md` prompt

`research.md` asks for a direct answer with sources; `consult.md` begins from a stuck agent. An advisor needs a different shape:

- the exact question and its constraints, not a nearby question;
- a recommendation in one or two sentences;
- the decisive evidence and the strongest counterargument;
- risks and unknowns, with the check that would settle them;
- one exact next action, or an explicit "stop, the current path is sound";
- confidence and the missing fact that changes it;
- no restatement of history, no design document, no file edits.

The answer contract appends its own evidence/read-only reminder, so the prompt stays short. The target is the read-only `codex-subagent` provider; it can read repository files, which is the evidence it needs for a code decision.

Alternatives: reuse `consult.md` (wrong framing: it biases toward a stuck diagnosis); reuse `research.md` (no risk/counterargument shape); inject a long system prompt into every request (violates the no-always-on-prompt-section boundary and the byte budget).

### D4. Policy in the tool description and skill; no hard cap in this change

The `delegate` tool description is always visible to the model, unlike the on-demand skill. It gains a short policy:

> `advisor` is a manual second opinion from the strong target. Use it only for a decision that is expensive to reverse, a security or data-integrity question, a cross-module design, or after two failed attempts. Never for routine edits, syntax, lookups, or facts you can verify locally. At most three advisor calls per session.

The skill carries the same rule with a little more detail and the default-rule table. The `advisor` rule is manual, so no turn-stopping listener starts it. The soft ceiling is a policy, not an engine counter; the tool call is visible, synchronous, slow, and expensive, so the model has a natural incentive to keep it rare. If observation shows the model still overuses it, a later change can add `maxCallsPerSession` to answer rules and return a clear next action when exhausted.

Alternatives: a hard cap now (more schema, validation, state, and tests for an unobserved problem); no policy at all (the owner explicitly asked to avoid routine use); an automatic trigger on hard-looking turns (no deterministic definition, and it would spend without the lead's decision).

### D5. The advisor has no gate, wake, steer, or chat authority

The answer contract writes no record, so an advisor answer cannot satisfy a strict review, authorize a block, or change a goal. The engine never calls `agent.steer` or `agent.followup` for the advisor, and the advisor produces no session event of its own; the lead receives a normal tool result. This keeps it out of the turn-stopping path where the delegation gate, verification gate, and goal continuity already act, avoiding duplicate steers and contradictory instructions.

Alternatives: delivering advice as a user-role `agent.inject` (would look like the user, could be mistaken for an instruction, and would appear as a chat message without a distinct speaker identity); a supervisor teammate (a separate session, extra wake cost, and still a user-role message); a new chat node kind (an upstream DSH change, not a delegation-rules change).

### D6. The caller supplies the bounded question; the target reads the repository itself

`answerPrompt` sends the rule instruction plus `context` and `objective`; it does not seed the whole conversation. The advisor is expected to read the files it needs. This keeps the strong-model input focused and avoids paying for the entire transcript on every consultation.

Alternatives: automatically seeding the live session transcript (large, mostly irrelevant, and a new privacy/cost surface); a separate digest tool (more code and another interface); a forked subagent with inherited context (heavier and not the Codex target the owner wants).

### D7. Keep review thread reuse unchanged; answer calls stay ephemeral

The Codex provider reuses threads only for review runs keyed by the review key. The advisor is a single question, so a fresh ephemeral thread is appropriate and avoids carrying stale assumptions between unrelated decisions. A follow-up call repeats the relevant context; that limitation is documented.

Alternatives: add answer-thread reuse now (a new persistence key, lifecycle, and cleanup surface); reuse a review thread (would mix a review's evidence and verdict with an unrelated decision).

### D8. The strong defaults are data, documented and overrideable

The model id and effort are target values, not engine constants. The fragment's comment, `docs/delegation-rules.md`, `docs/codex-subagent.md`, and `delegation_status` all show them. A profile patch can override `codex`/`codex-write` to the provider defaults or another model; the advisor stays on `codex-astra`. The tests pin the shipped values so the docs and the generated patch cannot drift.

Alternatives: hard-code the model in the engine (violates model-agnostic design); leave the values only in the fragment (not visible to the user or `delegation_status`); pin the model in the spec text (brittle and duplicates configuration data; the design and docs carry the value).

## Risks / Trade-offs

- **All default Codex runs become materially more expensive and slower** -> This is the owner's explicit choice. Mitigation: the target values stay overrideable; the docs show the cheaper override; the advisor's soft ceiling limits the new manual path. Per-task reviews still multiply, so a future cost review should look at review count, not just model choice.
- **`gpt-6-astra` may be unavailable to the account** -> The run fails with the target/model diagnostic and no PASS; composition still succeeds. Mitigation: override `codex`/`codex-write` to the provider defaults, or point `codex-astra` at another strong model; run one small smoke test after install.
- **The advisor is called for routine work** -> Soft policy plus a slow, expensive, synchronous call. Mitigation: the tool description and skill both exclude routine work and state the ceiling; if observed, add a hard per-session cap and an explicit exhausted error.
- **Advisor advice is wrong or overconfident** -> It is read-only advice, not a gate record; the lead must weigh it. The prompt requires the strongest counterargument, risks, and confidence, so the answer exposes its uncertainty instead of hiding it.
- **Prompt injection through repository content** -> The target is read-only, the answer is untrusted model output, and the engine never executes it. The answer cannot approve, publish, delete, or satisfy a gate.
- **Caller supplies too little context** -> A weak answer. Mitigation: the policy asks for the question, constraints, and evidence, and the target can read the named files.
- **Tool-description budget** -> The advisor policy adds bytes under the 900 estimated-token budget; the measured-size test fails if it grows past it. Mitigation: keep the description terse and move detail into the skill.
- **Existing profiles that override the whole delegation config** -> A profile patch replaces the whole `config`, so an existing override must be updated to receive the new targets and rule. Mitigation: document this in the delegation docs; the setup default applies to profiles without an override.
- **The live desktop profile does not change from this repository edit** -> The owner must install the updated setup externally; this session cannot install into the desktop profile. Mitigation: the change is tested in the repo; the live profile gets it on the next owner-driven install.

## Migration Plan

1. Update the fragment, the new prompt, the package files list, the tool description/skill, docs, and tests.
2. Run `pnpm gen` to regenerate the plugin and setup patches and the vendored package tree.
3. Run `pnpm build` and the targeted tests; then the repository checks used by the change.
4. The owner installs the updated setup externally (the desktop profile is not installed from an agent session). Existing profile overrides must restate the new targets/rule.
5. Smoke test one small advisor call after install; if the model is unavailable, override the target.
6. Rollback: revert the change and regenerate, or override `codex`/`codex-write` to the previous provider defaults and remove the advisor rule from a profile patch. No data migration is involved.

## Open Questions

None. The owner chose the strong defaults and the soft policy. A hard per-session cap is a deliberate later option, not a missing decision.
