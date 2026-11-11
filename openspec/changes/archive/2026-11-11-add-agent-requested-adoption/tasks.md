# Tasks

The change is one Host package with shared adoption, tool, and wiring files; it is a single lane. Tests and docs land with the code that owns the behavior; the generated output tail stays serial.

## 1. Adoption through the tool

- [x] 1.1 Remove the `userStarted` gate from `adoptChange` (the host user answer is the authorization) while keeping the artifact and whole-spec verification, the question, the post-answer re-verification, and the signed receipt; update the command wiring and the adoption tests; verify with `pnpm exec vitest run packages/plugin-workflows/test/adoption.test.ts`.
- [x] 1.2 Add the `adopt` action with its `change` argument to the `workflows` tool (action set, parser, executor calling `adoptChange`, host wiring, tool schema and description); verify with `pnpm exec vitest run packages/plugin-workflows/test/tools.test.ts`.
- [x] 1.3 Cover every refusal and the success path: an invalid name, a missing artifact, a stale whole-spec PASS, a no/timeout/missing question service, a changed digest, and a yes that writes exactly one receipt; verify the archive gate accepts the later archive in the tests.
- [x] 1.4 Document the tool action and the UI-confirmed adoption in `docs/workflows.md` and `docs/plugins.md`; verify the documented action and refusal names match the tool schema.

## 2. Generated output and integration checks

- [x] 2.1 Run `pnpm build` and `pnpm gen`, commit the regenerated `lib/**`, setup vendored tree, and patch, and verify `pnpm gen:check`.
- [x] 2.2 Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm workflows:parity --check`; verify all pass.
- [x] 2.3 Run `pnpm validate` and record the result; fix any failure before the change is proposed for archive.
- [ ] 2.4 Verify the new adopt action end-to-end in a live installed profile after the release; the unit tests are not that check.
