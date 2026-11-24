# Design

## Context

The runtime already has the mechanism this change needs. `@deepseek-ai/dsh-tool-ask-user` has a `legacy` definition and a `timed` definition; the timed one adds a `timeout` parameter, calls `userQuestions.askTimed`, and returns `{pending, callId}` at the deadline. The `dsh-user-questions` projection keeps the question `continued`, and a late answer arrives as a `user-question-reply` steering message. The client question card renders the countdown, Take time, and the preselected `(Recommended)` option.

The row is a child of `preset-standard`, not a profile-level row. The archived `add-goal-question-review` change recorded that switching it is an owner-level profile decision, so this change documents the edit and does not ship a preset copy. The always-on contract is at 6 171 contract bytes and about 1 590 estimated tokens including its footer; the documented budget is 1 500 and the current test allows 1 600. The goal supervisor only acts at turn end, and `latestCheckpointPlan` treats any successful `ask_user_question` result as plan-freshness evidence.

See `proposal.md` for the motivation and the two session incidents.

## Goals / Non-Goals

**Goals:**

- Make the built-in timed question the behavior of a new session through a one-time owner preset edit.
- Add a bounded policy that tells the agent how to behave on `pending` and when not to ask.
- Pin the goal-continuity pending path with a test and document the limits.
- Keep the always-on contract within its documented 1 500-token budget by trimming, not by raising it.

**Non-Goals:**

- Any auto-answer plugin, night window, automatic Codex analysis, DSH core change, question-review scope change, or setup-shipped preset copy.
- Resuming a loop-guard final stop; that stop remains deliberate.

## Decisions

### D1. Enable the stock timed mode, do not build an auto-answer

The owner sets `mode: timed` and `timeout: 300` on the active preset's `tool-ask-user` row. The built-in path gives the countdown, Take time, the preselected recommendation, a `pending` result that releases the turn, and a question that stays answerable. A custom plugin that fabricates the recommended answer would record a human decision the owner never made; in session `ea02b074` the owner chose the non-recommended scope option after 5 h 59 min, so the recommendation is not a safe default for scope decisions.

*Alternatives rejected:* a host plugin that answers through `userQuestions.answer` (loses the built-in continued state and fakes consent); a client-only countdown (does not release the turn); a setup-shipped preset copy (version-fragile and outside the setup's ownership).

### D2. The pending policy distinguishes operational from scope choices

The contract gains two rules in its existing `Recover instead of repeating` section:

- pending is not a pause and not permission: continue independent work; take the recommended option only for a reversible operational choice and record the assumption in the next checkpoint; leave scope, product, release, credential, and destructive choices unauthorized. An already-returned pending scope question cannot become an indefinite wait; the agent continues independent work and stops with the pending decision only when none remains, choosing `timeout: -1` before the call only when the decision is irreversible and no independent work can proceed;
- a question is not a way to end a turn; never ask whether to continue.

The distinction is the core decision. A blanket "take the recommended option" would have applied the wrong product scope in `ea02b074`; a blanket "never decide" would leave the model waiting for a non-decision. The model is the right classifier: it knows whether its own recommended option is reversible and operational. An already-returned `pending` scope result cannot be retroactively converted into an indefinite wait; the indefinite wait is a pre-call choice, and the question remains answerable so a later answer still settles it. The policy adds no new always-on section; both rules live in the existing working-principles section.

*Alternative rejected:* a separate plugin prompt section. It would add another always-on row and repeat the same per-step cost without improving the rule.

### D3. Trim the contract and tighten the budget test to the documented 1 500

The contract is at 6 171 bytes; the policy needs about 300 bytes and the documented budget leaves about 5 810 contract bytes including the footer. The implementation trims about 660 bytes of redundant prose while preserving every phrase the existing budget test asserts, sets `BUDGET_TOKENS = 1500`, and derives `MAXIMUM_BYTES` from the footer and the budget so the two caps cannot drift again. If a required phrase and the trim conflict, the task stops and reports the conflict rather than raising the budget.

*Alternative rejected:* changing the documented budget to 1 600. It would legitimize a per-step cost the reviewed spec deliberately capped and keep the spec/test divergence.

### D4. A pending result is plan freshness, not an answer

`latestCheckpointPlan` already treats a successful `ask_user_question` result as a user signal, so a timed `pending` result invalidates the earlier `user_decision` plan and the supervisor continues instead of stopping. That is the desired behavior, but it is incidental and untested. The change adds the pending case to `resume-evidence.test.ts`: a `user_decision` checkpoint, a recorded ask result with `pending: true`, and a completed turn must not stop continuation. The supervisor test stays at the recorded-result boundary; it does not execute the ask tool or its timer. The production comment becomes explicit: a pending result settles the ask without deciding it; it is not an answer and not permission. A `timeout: -1` call returns no pending result and holds the turn, so the supervisor never acts on it; the indefinite wait is verified by the runtime acceptance task (4.3), the only check that executes the timed tool.

*Alternative rejected:* changing `lastUserSignal` to ignore pending results. It would make the earlier `user_decision` plan stop the goal, which is exactly the night-time stop this change removes.

### D5. Document the owner edit and the limits

`docs/autonomy.md` carries the exact row, the preset override route (the Web preset page is read-only, so the `preset-standard` row is overridden by id with the complete child list), the new-session rule, the 10-second acceptance, the `-1` exception, and the limits: the preset override does not merge future DSH preset changes; the question review stays goal-round-only; a loop-guard final stop stays. `docs/plugins.md` and `docs/install.md` link the page. The owner performs the manual preset edit only
when no bundle owns the row; the shipped question-timeout bundle manages its derived row through the
config editor (D6).

### D6. The setup owns the timed row through the Loader, not through a copied preset

A Host-only bundle, `@dsh-setup/plugin-question-timeout`, carries `timed` and `timeout` (defaults
`true` and `300`) as its row config and reads the profile-local settings file
`.dsh-setup-question-timeout.json` for overrides, which it also watches. On every activation and on
every save of that file it walks each `preset-*` entry and calls
`configEditor.edit(entry, (current, inherited) => next)`: `inherited` is the declaration composed
from the bundle layers alone, never the plugin's own persisted override, so each derivation reads the
installed list and a DSH upgrade cannot leave a stale copy behind. The edits run from a deferred task
after activation and outside any enclosing HMR transaction, because the editor reconciles the profile
and would otherwise wait on the activating fiber or reject a nested transaction. An entry whose
`inherited` config has no `tool-ask-user` row is skipped — unless the plugin previously wrote it, in
which case that override is removed and its ownership record dropped. When the row exists, `next` is
that declaration with the row set to `mode: timed` and the timeout; with `timed` false `next` is
`inherited` itself, which makes the editor delete the managed profile row. A preset whose profile
patch already holds a different override — the owner's own child list — wins: the plugin leaves it
untouched and logs one line, so local precedence is preserved. The ownership record (which hash the
plugin wrote and which it replaced) is written ahead of each edit and restored when the edit fails, so
a restart, an interrupted commit, or an upstream change re-derives cleanly, and a config equal to the
installed declaration counts as untouched. A profile without `configEditor` stays untouched with one
logged warning.

*Alternatives rejected:* `agentPresets.register()` cannot override a shipped preset — the registry
throws `Duplicate agent preset` for an existing id; a static override per preset is the
hand-maintained copy this design rejects; and a `userQuestions` wrapper cannot turn a legacy tool
into a timed one, because the legacy result type has no pending case.

## Risks / Trade-offs

- Restart, upgrade, timed-off, and existing-override tests: the derivation reads `inherited`, so a restart writes the same row, an upstream child-list change reaches the next derivation, `timed: false` deletes the managed row, an upstream row removal restores the declaration, and a foreign profile override is skipped untouched. The ownership record is written ahead of each edit, so an interrupted commit re-derives instead of adopting a stale row.
- **The owner's own preset override wins** → `timed` does not apply to that preset until the override is removed; the plugin logs the preset id once so the cause is visible.
- **The watched settings file is shared with the ownership record** → the plugin writes `managed` into the same JSON; a hand edit must keep that object intact.
- **The preset override drift** → The owner's override copies the stock child list; a DSH upgrade may need the row re-applied. The docs name the check and the exact row.
- **A model uses `timeout: -1` for a reversible choice** → The policy and the question review are the guard; a genuinely user-only decision still waits, which is correct.
- **The trim removes a nuanced rule** → The budget test asserts every preserved phrase; the implementation stops if a phrase cannot fit; the owner can choose the 1 600 budget in a follow-up if the trim proves impossible.
- **The live timed behavior cannot be tested in CI** → The owner acceptance in a new session covers the schema, countdown, pending, late answer, and `-1`; the unit tests cover the contract and the goal pending path.
- **A pending question still holds no one** → The model continues independent work; if none remains, it records the assumption and hands off, which is a visible stop, not a silent wait.

## Migration Plan

1. Land the contract policy, the budget test, the goal-continuity test/comment, and the docs; run the repository gates.
2. The owner overrides the `preset-standard` row in the profile patch (or installs an equivalent bundle), sets the `tool-ask-user` row to `mode: timed` and `timeout: 300`, and starts a new session. Existing sessions keep their composition.
3. Acceptance: a 10-second question returns `pending`, the turn continues, the card shows the countdown, a late answer steers the agent, and a `timeout: -1` question waits.
4. Rollback: remove the row's `config` (or set `mode: legacy`) in the preset and start a new session; revert the contract/test/docs commit. No data migration.

## Open Questions

None. The preset edit route, the 300-second default, and the pending policy are decided; the only deferred item is the owner's live acceptance, which is documented as a task.
