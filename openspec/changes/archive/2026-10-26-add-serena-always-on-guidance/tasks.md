# Tasks

## 1. Planning artifacts

- [x] 1.1 Record the measured adoption failure, the rule shape and the source adaptation in `proposal.md` and `design.md`. Verify `openspec change validate add-serena-always-on-guidance` passes.
- [x] 1.2 Amend the `session-guidance` delta: the new always-on rule requirement and the 400-token entry in the bounded-cost requirement. Verify the delta restates the modified requirement in full.

## 2. Plugin content

- [x] 2.1 Add `assets/serena-discipline/rules.md` (activation, symbol reads and edits, bounds, text boundary, unavailable fallback, suspension) and list it in `files`. Verify it stays within 1,600 UTF-8 bytes and names no slash command.
- [x] 2.2 Strengthen `assets/serena-discipline/SKILL.md` with the activation-first sequence, the why for symbol operations, the generated-output boundary and the ripgrep-backed text boundary. Verify the frontmatter description still matches the catalog constant.
- [x] 2.3 Rewrite `src/host/index.ts`: inject `systemPrompt`, register the rule at order 130, keep the skill provider, and skip only the rule when `config.alwaysOn === false`. Verify `pnpm build` emits `lib/index.js` and `lib/index.d.ts`.
- [x] 2.4 Add `test/section.test.ts` and `test/budget.test.ts`; update `test/skill-provider.test.ts` for the second injected service. Verify `pnpm exec vitest run packages/plugin-serena/test`.

## 3. Documentation

- [x] 3.1 Write `docs/serena.md` (what ships, why always-on, what the agent is told, prompt cost, opt-out, suspension, adaptation record, limits) and link it from `docs/install.md`; add the activation note and the guidance-row opt-out there. Verify `pnpm lint` passes.
- [x] 3.2 Refresh the prompt-cost tables in `docs/rtk.md` and `docs/principles.md` for the fourth contribution and the corrected working-contract size.

## 4. Generated output and checks

- [x] 4.1 Run `pnpm install` (new dev dependency), `pnpm build` and `pnpm gen`; commit the emitted `lib/**`, the rewritten patch, the setup manifest/patch and the vendored copy with the new asset. Verify `pnpm gen:check` passes.
- [x] 4.2 Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm validate:repo`; fix any failure before archiving.

## 5. Archive

- [x] 5.1 Sync the delta into `openspec/specs/session-guidance/spec.md` and archive the change; add the archive sentence to `AGENTS.md` §11.
