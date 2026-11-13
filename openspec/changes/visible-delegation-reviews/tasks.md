# Tasks

## 1. Engine and tests (lane 1, owns `packages/plugin-delegation-rules/src/host/index.ts`, `packages/plugin-delegation-rules/test/**`)

- [x] 1.1 In `startTarget()`, start the activation with `delivery: 'parent'` for the `review` contract and `delivery: 'caller'` for `answer`/`patch`, sending no explicit child name. Verify the engine's activation spec for each contract in the existing fake and `pnpm typecheck`; note that the service catalogs in-process children regardless, so the delivery assertion covers the external-provider behavior only.
- [x] 1.2 Add assertions that a review activation uses parent delivery with no name, and that answer and patch activations stay caller-delivered; keep the queue, record, and gate tests. Verify `pnpm exec vitest run packages/plugin-delegation-rules/test` passes.

## 2. Documentation (lane 2, owns `docs/delegation-rules.md`, `docs/codex-subagent.md`)

- [x] 2.1 Document that external review runs appear as `delegation:<rule>` children and deliver their answer as a settlement notice, that they are leaves without metrics or follow-up, and that external answer/patch stay caller-delivered while in-process providers keep their existing local-child catalog behavior; update the Codex doc's "delegate stays invisible" wording. Verify the docs contain no remaining claim that rule-driven reviews are invisible or that local providers are uncataloged.

## 3. Serial release (serial, owns `package.json`, `packages/*/package.json`, `packages/setup/**`)

- [x] 3.1 Run `pnpm release:prepare --version 0.38.1`, then `pnpm build`, `pnpm validate` (or the individual gates plus a green test run), `pnpm gen:check`, and `git diff --exit-code` from the committed tree; commit the version bump and regenerated setup.
- [x] 3.2 Tag `v0.38.1`, push `main` and the tag, watch the release workflow, and verify the published index lists 0.38.1 over HTTPS.
- [ ] 3.3 Owner installs 0.38.1 from an external PowerShell and runs one review; verify the Session's subagent list shows a `delegation:<rule>` external entry and its settlement notice, and that an answer run creates no entry.

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied (`pnpm reviews:check --change visible-delegation-reviews`).
- Sync the delta spec into `openspec/specs/delegation-rules/spec.md` on archive.
