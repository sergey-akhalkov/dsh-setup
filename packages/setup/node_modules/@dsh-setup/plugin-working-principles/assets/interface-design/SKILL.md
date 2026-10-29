---
name: interface-design
description: >
  Use when designing, changing, or reviewing any interface: a client UI control, a CLI or
  installer, an API or function signature, an error message, a README, or a skill or tool
  definition. Applies the first-time test: a person with no documentation must not have to ask
  what this is, what the one next action is, what will happen, what happened, or how to recover.
---

# Interface design

An interface is good when its correct use is the path of least resistance and its incorrect use
takes deliberate effort. "Don't make me think" is one instruction: move the knowledge out of the
user's head and into the interface. Decide for them when the answer is knowable, make the wrong
action hard, show the state and the consequence at the moment of decision, and leave a way back.

This skill applies to every interface this repository ships: a client control, a CLI or installer,
an API or function signature, an error message, a README, a skill description, a tool definition.
The user may be a person at the app, a person in a terminal, the next developer reading the call
site, or a model deciding whether to load a skill.

## The first-time test

Put a stranger in front of the interface: no documentation, no memory of the last session, a
half-attention span, and a task to finish. They must be able to answer five questions without
asking or reading source:

1. What is this? — one visible line names the purpose.
2. What is the one next action? — the primary action is obvious; alternatives do not compete with it.
3. What will happen? — the consequence is predictable; destructive or irreversible actions say so.
4. What happened? — the state, result, and progress are visible.
5. How do I recover? — undo, retry, or an error that names the cause and the next action.

Three levels: obvious (no thought), self-evident (a glance), requires thought (a bug). Aim for
obvious. If the answer needs the source, the docs, or a question, it is a design bug, not a docs bug.

## The five costs

| Cost | The question the interface forces | The fix |
|---|---|---|
| Recall | What was the name, flag, parameter, or command? | Recognition: labels, help, examples, completion, visible state |
| Decision | Which of these options? | A default when the answer is knowable; one primary action; depth on request |
| Prediction | What will happen if I do this? | Affordances, previews, dry runs, confirmation for irreversible actions |
| Interpretation | What does this word or state mean? | Domain language, one term per concept, visible state, units in names |
| Recovery | What went wrong, and how do I undo it? | Errors that name the cause and next action; undo; idempotence; backups |

Apply the same five costs to every surface. The surface changes; the cost does not.

## UI

- Reuse the house component and tokens before inventing one. In this repository that means
  `@deepseek-ai/dsh-client-ui-primitives` (`Button`, `Menu`, `Modal`, `Toast`), the `--dsw-*`
  variables, `ctx.slots`, and the locale service. Copy the nearest existing control, not its
  behaviour only: the administrator indicator is the reference for a composer control with a menu,
  a confirmation modal, a toast, and a narrow-width collapse.
- One primary action per view. Secondary actions sit beside it; destructive actions are separated
  and confirmed in proportion to their consequence.
- Design every state: first-run or empty, loading, success, error, disabled, partial, narrow,
  keyboard-only. A missing state is a missing screen.
- Labels are UI. An icon-only control needs an accessible name and a tooltip. Visible text beats a
  legend the user must learn.
- Accessibility is the same law for keyboard and screen-reader users: focus order, focus ring,
  contrast, reduced motion, and an accessible name are not a later checklist.
- Write the visual contract into the spec as a scenario, as `admin-indicator` does. A design that
  exists only in a mock or a chat message can regress silently.
- Fail open for non-critical chrome: a broken badge must not block the app.

Detail and the review checklist: [references/ui.md](references/ui.md).

## CLI and installer

- The common case is one command with no flags; flags are for the uncommon case, and the advanced
  form must be copy-pasteable, not a four-line ceremony.
- The default path must not be a dead end: if the one-liner cannot pass options, document an
  equally simple one-line advanced form.
- Plan before acting: `-DryRun` or an equivalent, an explicit plan, and a summary of what changed.
- Make it idempotent and skippable: rerunning updates; an already-configured component is skipped
  without a prompt or a write.
- Prompt only in an interactive terminal, only for the phase that needs the value, and never in a
  non-interactive path. A missing value in a script is an error that names the flag.
- Errors say what failed, what state the machine is in, and what to run next; a real failure exits
  non-zero. Best-effort phases warn, skip, and still exit zero.
- Respect the caller: no bare `exit` under `| iex`, no killing the shell, no destructive write
  without a backup.
- Keep existing option names and old entry points working; a forwarder is cheaper than a break.

Detail and the installer anchors: [references/cli.md](references/cli.md).

## API and signatures

- The signature is a UI. Required parameters are the decisions the caller must make; every optional
  parameter is a decision you failed to make for them.
- One obvious way. If two functions do the same job, one should not exist. Prefer a smaller surface
  over an options bag.
- Defaults do the right thing. Booleans that switch behaviour are a smell; split the function or
  name the choice.
- Names are the documentation: verb and noun, domain language, units in the name (`timeoutMs`),
  no `data`, `info`, `options`, or abbreviations the caller must learn.
- Make illegal states unrepresentable. Validate at the boundary; do not make the caller re-check
  what the interface already knows.
- Errors are part of the contract. Return a typed, named failure with the cause and the next
  action; never a silent `undefined` or a bare throw from deep inside.
- Least surprise: a `get` does not write, a `close` is idempotent, a `parse` does not fetch. Keep
  effects local and visible at the call site.
- Keep changes additive; a released name, flag, field, or error is an interface.

Detail and the review checklist: [references/api.md](references/api.md).

## Code

Code is an interface for the next reader and the next caller.

- A deep module has a simple interface and hides its complexity. The caller should not need the
  implementation to use it correctly.
- Names, types, and tests are the documentation; comments explain why, not what.
- No action at a distance: the effect of a call is visible near the call, not in a hook three files
  away.
- One obvious way through the code; deletion beats a new option, wrapper, or abstraction nobody
  asked for.
- Fail fast at the boundary, preserve data on the way out, and leave the state safe when a step
  fails.
- A call site should read like the intent. If the reader must open three files to understand the
  call, the interface is the problem.

## Docs, skills, and tools

- A README, a help page, a skill, and a tool definition are interfaces too.
- The description is the trigger. A skill or tool description names when to use it and what it
  returns; the body carries the procedure. Detail loads on demand, not on every step.
- Lead with the example, then the rule. The common path comes first; the advanced path is linked.
- One authoritative home per fact; link instead of duplicating.
- Tool and parameter descriptions carry their own rules: defaults, ranges, pairing, and when to set
  them. Say each fact once.
- Bounded outputs with locality: return the result and a little surrounding context, mark
  truncation, and give a path to the rest.
- A failure names the cause and the next action. A report, a status label, or a successful call is
  not evidence of the effect; read the state.

Detail: [references/agent-tools.md](references/agent-tools.md).

## Repository anchors

- Client UI: `packages/plugin-admin-indicator/src/client/index.tsx` for the primitives, `--dsw-*`
  tokens, slot registration, locale, menu, modal, toast, and narrow-width behaviour.
- Visual contract: `openspec/specs/admin-indicator/spec.md` for the pattern of a native-styled
  control whose look and states are fixed by scenarios.
- Installer: `install.ps1`, `docs/install.md`, and `openspec/specs/portable-setup/spec.md` for the
  one-command, dry-run, idempotent, skip-when-healthy contract.
- Skills: `packages/plugin-working-principles` and `openspec/specs/session-guidance/spec.md` for
  the on-demand body, bounded always-on text, and reference-on-read pattern.
- Agent-facing definitions: the `agent-experience` skill for tool descriptions, parameter rules,
  bounded outputs, and locality.
- Sources and adaptation: [references/sources.md](references/sources.md).

## Red flags

- The common case needs a flag, a download, or a paragraph of docs.
- Two equal primary actions, or a menu of equally weighted choices.
- A prompt in a non-interactive path, or a prompt before the main work.
- An error that says "failed" without the cause and the next action.
- A control that looks 90% like an existing one but is not it.
- A new visual language, token, or component where the house pattern exists.
- An optional parameter that exists only for a caller that might appear later.
- A destructive action without confirmation; a reversible action that still asks.
- An icon-only control with no accessible name.
- An empty state with no next action.
- A skill or tool description that summarizes the topic instead of naming the trigger.
- A test that passes because the original trigger no longer runs.

## Before you ship

1. Name the user's job in one sentence.
2. Walk the path and count the decisions; remove or default every one you can.
3. Make the common path one action.
4. Design the five states: first-run, loading, success, error, recovery.
5. Write the words last; they are the interface.
6. Test with a stranger, no docs, narrow width, keyboard only.
7. Put the visual or behavioural contract into the spec as a scenario.

## Review output

When asked to review an interface, report:

- **Thinking Cost**: high, moderate, or low.
- **Severity** per finding: critical (blocks the main task, or causes an error or exit), moderate
  (the user finishes but pauses, rereads, or backtracks), minor (polish).
- **One line per finding**: Problem, Impact, Fix, Where (selector, file, command, or parameter).

Sort by impact. Do not report a finding without a concrete fix and a location. If the evidence
cannot support a judgment, say "not assessed" instead of guessing.
