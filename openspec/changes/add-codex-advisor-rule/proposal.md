# Proposal

## Why

The setup can already consult Codex for research questions and automatic blocker help, but it has no manual expert-advice path and the strong `codex-astra` target is unused. A bounded advisor lets the lead ask a stronger model for a second opinion on an expensive or risky decision without turning every routine step into a strong-model run. The owner also wants the shipped Codex defaults to select `gpt-6-astra` with `xhigh` reasoning, while keeping the target values configurable.

## What Changes

- Add a manual `advisor` answer rule: read-only, no gate record, no automatic trigger. One bounded decision per call, answered with a recommendation, the strongest counterargument, risks, a next action, and confidence.
- Add a bundled `advisor.md` prompt and include it in the published package and vendored setup tree.
- Make the shipped `codex` and `codex-write` targets select `gpt-6-astra` and `xhigh` by default. Keep `codex-astra` as the explicit strong target used by `advisor`, so a profile can make `codex` cheaper without weakening the advisor.
- Update the `delegate` tool description and the `delegation-rules` skill with when to consult the advisor, when not to, and a soft ceiling of three advisor calls per session. Routine edits, lookups, and facts the lead can verify locally are explicitly out of scope for the advisor.
- Update the default-rule tables, target documentation, model-facing byte counts, tests, and generated bundle patches.
- Existing review and blocker semantics are unchanged: the advisor writes no gate record, never satisfies a strict review, never steers, never wakes a session, and never injects a chat message. The only behavior change to existing rules is that their configured Codex target now defaults to the strong model and effort.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `delegation-rules`: the default rule set gains a manual advisor answer rule; the answer contract gains the advisor answer shape; the delegate tool description names the advisor policy; and the shipped default Codex target values select the documented strong model and effort.

## Impact

- `packages/plugin-delegation-rules`: composition fragment, a new bundled prompt, `package.json` files, the `delegate` tool description, the on-demand skill, documentation, and tests.
- `packages/setup`: regenerated patch and vendored package tree.
- Cost: every default Codex rule (spec review, task review, blocker, research, bug-fix, integration review) now starts Codex on the strong model at `xhigh` effort. A profile can override `codex` or `codex-write` to a cheaper model without changing the advisor, which stays on `codex-astra`.
- Availability: if the account cannot use the configured model, default Codex runs fail with the target/model error until the profile overrides the target.
- No new trigger, contract, gate, UI slot, or session injection mechanism.
