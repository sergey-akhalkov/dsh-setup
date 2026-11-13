# Design

## Context

See [proposal.md](proposal.md) — Why. The policy lives in two places: `SKILL_DESCRIPTION` in
`packages/plugin-answer-page/src/host/index.ts`, which is the always-present catalog line, and
`skillAdapterNote`, which is appended to the byte-identical vendored `SKILL.md` at load time. The
accepted `answer-pages` spec already permits a page for a complex explanation; the loaded text is
narrower than that contract. The vendored body also carries host-generic render instructions (stdin
heredoc, default `~/.answer-me-with-html` output) that contradict the deployment's workspace-only
flow, and the provider test pins the current phrases.

## Goals / Non-Goals

**Goals:**

- Make the catalog line and the loaded policy prefer a page for a complex explanation, without a
  new prompt mechanism and without a page for every answer.
- Make the deployment render flow explicitly authoritative over the vendored body.
- Keep the skill-only shape, the offline and workspace guarantees, and the byte-identical pin.

**Non-Goals:**

- No system-prompt section, no tool, no Client half, no configuration switch.
- No renderer or provenance change; no upstream version bump.
- No release step inside the change itself.

## Decisions

### Widen the catalog description, not the plugin shape

`SKILL_DESCRIPTION` is already injected into every turn's skill catalog, so it is the always-on lever
that costs no new mechanism. The new line drops "Use only when the user asks" and "No always-on use",
invites proactive use for a complex explanation, and keeps the simple-answer exclusions. The
alternative — a new system-prompt section — is more reliable but re-opens the deliberate
"no always-on section" design and adds per-request text; a workspace `AGENTS.md` rule is per-workspace
and competes with the old catalog line. Both are rejected.

### Prefer a page, do not attach one to every answer

The adapter paragraph states the proactive trigger for a flow, architecture, comparison of three or
more options, hierarchy, ranked list, or state machine, and keeps the exclusions (small talk,
one-line facts, pure code answers, delegated reports, plain-text requests). The upstream
`[answer-me-with-html always-on]` reminder stays disabled, so this is proactive, not the always-on
mode. It matches the modified `Page from a drafted source` requirement.

### The adapter wins over the vendored body

A new adapter paragraph names the body's stdin and default-home flow as host-generic, restates the
deployment flow (workspace draft file, `-o`, `AM_HOME`, `AM_NO_UPDATE_CHECK=1`, `--no-open`), and says
the adapter wins where the two disagree. Editing the vendored `SKILL.md` is rejected because it breaks
byte identity and the provenance test; adding the precedence sentence to our adapter keeps the pin and
fixes the only known failure path — a model that follows the body writes outside the workspace.

### Update the contract and the pins together

The delta spec modifies the trigger requirement, adds the deployment-flow precedence requirement, and
the provider test, docs, locale, and README change in the same change. Leaving the test pins for later
would make the suite fail between commits. Updating the locale also removes the inaccurate
"no always-on cost" claim: the catalog line is always in the prompt, just small.

## Risks / Trade-offs

- More renders → a complex explanation now costs a tool call, a draft, and a 100+ KB file under
  `.tmp/answers/`. Mitigation: the exclusions, the two-fix cap, and the text fallback already in the
  adapter.
- The precedence paragraph is instruction-level, not sandbox-enforced → a model could still follow the
  body. Mitigation: the explicit "this adapter wins" sentence and the existing workspace-only
  requirement; the offline test proves the documented invocation writes only inside the workspace.
- The behavior depends on model judgment of "complex enough" → it may over- or under-render. This is
  a text-only policy, so it is adjusted by editing the catalog line, not by code.
- Tests pin the policy text → each wording change needs a test edit. Expected for a prompt-content
  plugin; the provenance pin already set that precedent.
- A newer vendored body may add another conflicting flow → the update script review must re-read the
  adapter note against the new body. Recorded as an update-step check, not automated.

## Migration Plan

1. Apply the text, test, doc, locale, and README edits; run `pnpm build` and `pnpm gen`; commit the
   generated `lib/**` and `packages/setup/**`.
2. Run the repository gate and `openspec validate --strict`; release through the normal flow.
3. Rollback is a revert of the text change and a normal release; no data migration, no stored state,
   no installation step depends on the wording.

## Open Questions

None. The exact new description and adapter paragraphs are fixed in the tasks and the delta spec.
