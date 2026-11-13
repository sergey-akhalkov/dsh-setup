# Proposal

## Why

`@dsh-setup/plugin-answer-page` is mounted and its renderer works — the v0.17.0 live acceptance rendered a
132 KB page into `.tmp/answers/` — but in real coding work the skill is never used. The catalog
description says "Use only when the user asks ... No always-on use" and the adapter note requires a
"genuinely diagram-shaped" answer. The accepted `answer-pages` spec already allows a page when an
explanation is complex enough that a diagram or comparison carries it; the loaded policy is narrower than
the contract, so the plugin costs a catalog line and returns nothing.

## What Changes

- The catalog skill description invites proactive use for a complex explanation (a flow, architecture,
  comparison of three or more options, ranked findings, hierarchy, or state machine) without being asked.
- The loaded adapter note prefers a page for such an explanation, keeps the simple-answer exclusions
  (one-line facts, pure code answers, small talk, plain-text requests, delegated reports), and keeps the
  upstream always-on reminder disabled.
- The adapter note names the deployment's render flow (workspace draft file, `-o`, `AM_HOME`,
  `AM_NO_UPDATE_CHECK=1`, `--no-open`) as authoritative over the vendored body's stdin and default
  `~/.answer-me-with-html` flow.
- Docs, the market locale, the README row, and the plugin tests follow the new policy.
- The vendored `SKILL.md`, the renderer, the provenance lock, and the offline and workspace guarantees
  are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `answer-pages`: the trigger becomes proactive for complex explanations while the no-always-on and
  simple-answer boundaries stay; the loaded skill text must make the deployment render flow win over the
  vendored body where they conflict.

## Impact

- `packages/plugin-answer-page/src/host/index.ts` (catalog description and adapter note),
  `locale/en.json`, `test/skill-provider.test.ts`.
- `README.md` and `docs/answer-pages.md`; `docs/plugins.md` only if its wording changes.
- Generated `packages/setup/**` through `pnpm gen` and `packages/plugin-answer-page/lib/**` through
  `pnpm build`.
- No API, dependency, renderer, or install-time change. Users see more pages for complex explanations,
  each as a file under the workspace `.tmp/answers/`.
