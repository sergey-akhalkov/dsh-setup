# Sources and adaptation record

This skill is first-party guidance adapted for DeepSeek Harness. It is not verbatim upstream text
and carries no provenance pin. This record names what each reference used, what was removed, and
why.

## Sources by reference

### SKILL.md

- Steve Krug, *Don't Make Me Think* — the "obvious / self-evident / requires thought" levels, the
  first-time test, scanning and satisficing, and the ten review lenses. Ideas only; no book text.
- Don Norman, *The Design of Everyday Things* — affordances, signifiers, feedback, mapping, and
  error prevention. Ideas only.
- Jakob Nielsen, the ten usability heuristics — the review questions behind status, language,
  consistency, error prevention, recognition, and recovery. Ideas only.
- [clig.dev](https://clig.dev/) — the CLI principles (human-first, consistency, say just enough,
  discovery, conversation, robustness, empathy). Referenced, not copied; the text is CC-BY-SA 4.0.
- [`luongnv89/skills` — `dont-make-me-think`](https://github.com/luongnv89/skills/blob/main/skills/dont-make-me-think/SKILL.md)
  (MIT) — the ten lenses, the Thinking Cost and severity review shape, and the one-line finding
  format were adapted. Removed: the `/browse` and `asm` dependency preflight, the screenshot
  script, Claude-specific paths, the report templates, and the UI-only boundary.
- [`markphelps/agent-plugins` — `cli-design`](https://github.com/markphelps/agent-plugins/blob/main/skills/cli-design/SKILL.md)
  (MIT) — the four-surface model and the help, error, and exit-code checklists were adapted.
  Removed: the clig.dev restatement, the implementation-library list, and the CLI-only boundary.

### references/ui.md

- Krug's ten lenses (adapted wording) and the `dont-make-me-think` review shape, as above.
- [Vercel web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) (MIT) —
  selected interaction, state, and content rules were adapted; framework-specific guidance was not
  used.
- [Anthropic `frontend-design`](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)
  (Apache-2.0) — the copy rules (active voice, errors name the fix, empty states as invitations)
  informed the copy section; the aesthetic direction was not used.
- `packages/plugin-admin-indicator` and `openspec/specs/admin-indicator/spec.md` — the house
  primitives, tokens, slots, locale, visual contract, and fail-open pattern. First-party.

### references/cli.md

- [clig.dev](https://clig.dev/) — the principles are referenced, not copied (CC-BY-SA 4.0).
- `markphelps/agent-plugins` `cli-design` (MIT) — the four-surface model and the error and
  interactivity rules were adapted; the clig.dev restatement and library list were removed.
- `install.ps1`, `docs/install.md`, and `openspec/specs/portable-setup/spec.md` — the one-command,
  dry-run, idempotent, skip-when-healthy installer contract. First-party.

### references/api.md

- John Ousterhout, *A Philosophy of Software Design* — deep modules, information hiding, and
  interface simplicity. Ideas only.
- Joshua Bloch, "How to Design a Good API and Why It Matters" — the API-as-contract view, naming,
  and compatibility. Ideas only.
- This repository's source and specs — the naming, error, and stability examples. First-party.

### references/agent-tools.md

- The DeepSeek Harness `agent-experience` skill — tool and skill definition rules, bounded outputs,
  locality, and failure guidance were adapted.
- `openspec/specs/session-guidance/spec.md` and the working contract — the on-demand body, always-on
  budget, and evidence rules. First-party.

## What was removed or rewritten

- All upstream prose was rewritten in this repository's voice; no paragraph is copied.
- Claude-specific paths, `/browse`, `asm`, the screenshot script, and the report-template files
  were removed: they are runtime plumbing for another agent, not design guidance.
- The CC-BY-SA clig.dev text was not copied; only the principles are referenced.
- The UI-only and CLI-only boundaries were removed: one skill covers UI, CLI/installer, API/code,
  and agent-facing definitions.
- The community review scores were reduced to a Thinking Cost rating and a three-level severity;
  the full report template and the orchestration modes were removed as process, not design.
- The framework-specific Vercel rules and the aesthetic direction of `frontend-design` were not
  used; only the copy rules that fit this repository were kept.

## Boundary

Adapted content is first-party; the MIT and Apache-2.0 sources are credited above but not vendored,
so this skill does not carry their license text or a provenance pin. If a future change wants to
vendor an upstream skill verbatim, it belongs in the packaged-skills mechanism, not here.
