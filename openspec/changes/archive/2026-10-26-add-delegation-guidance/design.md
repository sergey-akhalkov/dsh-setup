# Design

## Context

See `proposal.md` for motivation. The constraints that shape this design:

- The working-principles contract is an always-on system-prompt section of 4,424 bytes; the repository
  test caps it at 1,500 estimated tokens (6,000 bytes) and currently reviews a 3,200-4,800 byte size
  range. Any addition is paid on every model step of every session.
- The same plugin already ships an on-demand `working-principles` skill for the rationale behind each
  rule. Skill bodies are not in the assembled prompt until invoked.
- Agent Teams is selected by `dsh.json`/`install.ps1` and its prompt section belongs to the
  experimental bundle, not to this repository. The setup can guide its use, not change its tools.
- The pending `add-delegation-rules` change is not implemented and is explicitly out of scope here.
- `session-guidance` already requires bounded prompt cost, on-demand skill bodies, and a recorded
  adaptation of source content.

## Goals / Non-Goals

**Goals:**

- State the single-agent default and the delegation conditions in the always-on contract.
- Keep the addition to two short bullets so the per-step cost stays negligible.
- Put the reasoning in the existing on-demand skill.
- Record the source and the measured size so the budget and adaptation requirements stay satisfied.

**Non-Goals:**

- A hard block or a gate that prevents spawning; guidance can only state policy.
- A new plugin, skill, or system-prompt section.
- Any change to the `add-delegation-rules` engine or its default gates.
- Changing the shipped Agent Teams selection.

## Decisions

### D1 — The rule lives in the existing always-on contract

| Option | Verdict | Why |
| --- | --- | --- |
| New always-on plugin | rejected | A second section and a second package for two bullets; the working-principles row already owns the session policy |
| New on-demand skill only | rejected | The model decides to delegate while the Harness team tools are already advertised; a skill that must be invoked first cannot counter that default |
| Harness profile or bundle change | rejected | The Agent Teams section is external to this repository and removing the bundle removes the capability |
| Existing contract, two bullets | **chosen** | Paid on every step but tiny, and it is the one section that already states session-wide policy |

### D2 — Content: conditions and anti-conditions

The contract gains one section after "Scope belongs to the user":

- Default: one agent with its skills.
- Allowed: an independent piece with little shared context that runs in parallel and returns a
  compact result, or verification that needs a fresh context.
- Forbidden: a team for sequential work, ceremony, or a context restatement.

The skill carries the detail: why handoffs are lossy, divide by context rather than by problem type,
prefer a one-shot subagent over a durable teammate, and fold a noisy handoff back into the main loop.
The skill is the rationale layer, not a second copy of the rule.

### D3 — Budget: raise the reviewed size range, not the token budget

The rule is about 400-450 bytes, which exceeds the current 4,800-byte reviewed maximum by a small
margin. Raise `MAXIMUM_BYTES` in the budget test to 5,200; keep `BUDGET_TOKENS` at 1,500 because the
spec's hard budget does not change. Update the measured size in `docs/principles.md`. The alternative
- trimming the rule to 376 bytes - loses either the verification clause or the anti-conditions, which
are the point of the change.

### D4 — Adaptation record

`docs/principles.md` records the source (Anthropic, "Building agents: When to fold subagents into your
main agent loop", checked 2026-10-26), what was kept (conditions, divide-by-context, handoff cost),
and what was dropped (platform-specific migration and eval tooling). The text is paraphrased, not
copied, so no upstream license obligation applies. This satisfies the existing adaptation requirement
in `session-guidance`.

### D5 — Boundary with `add-delegation-rules`

This change does not modify that change. If the engine ships later, its default review rules must not
require a handoff for sequential work; otherwise it contradicts the contract. That decision stays in
that change and is named here as a dependency. Fresh-context verification remains an allowed
delegation, so a manual review rule is compatible with this guidance.

## Risks / Trade-offs

- **Always-on cost** → two bullets only; the budget test measures the whole section and fails past
  1,500 tokens.
- **Guidance is advisory** → a model can still spawn a team. If a hard limit is required, it is a
  separate profile/configuration decision, not a text edit.
- **Conflict with the Harness team section** → the contract states policy and the team section states
  capability; verify the assembled prompt after the next profile install, since this repository cannot
  change the external bundle.
- **Future `add-delegation-rules` defaults** → keep strict gating opt-in when that change is
  implemented; otherwise the two instructions contradict.
- **Source drift** → the article is cited with a checked date; the rule paraphrases principles, not
  unstable product details.

## Migration Plan

1. Edit the contract, skill, docs, and the budget test.
2. Run `pnpm gen`, `pnpm test`, `pnpm lint`, and `pnpm validate:repo`.
3. Commit the assets, docs, test, and the regenerated vendored copy.
4. Rollback: revert the commit, or set `alwaysOn: false` on the row to drop the section while keeping
   the skills. No data migration.
