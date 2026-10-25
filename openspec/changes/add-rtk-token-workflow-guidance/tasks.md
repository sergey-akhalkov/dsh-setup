# Tasks

## 1. Package scaffold and composition

- [x] 1.1 Scaffold `packages/plugin-rtk` from the `packages/plugin-working-principles` shape: manifest with `name`, version equal to the set, `main`/`types`, exports, `files` (icon, locale, lib, both YAML files, no assets yet), `engines.dsh` copied exactly from `dsh.json`, `@deepseek-ai/cordis` peer, `dsh.bundle.patch`, and dev dependencies `@deepseek-ai/dsh-skill` and `@deepseek-ai/dsh-system-prompt`; add `cordis.fragment.yml` with the single row `dsh-setup-rtk`, `tsconfig.json`, the root `tsconfig.json` project reference, `icon.svg`, and `locale/en.json`. Verify `pnpm build` emits `packages/plugin-rtk/lib/index.js` and `lib/index.d.ts`, and `pnpm validate:repo` accepts the manifest and `engines.dsh`.
- [x] 1.2 Run `pnpm gen` and confirm the generated package patch, `packages/setup/cordis.patch.yml`, `packages/setup/package.json`, and the vendored setup tree contain exactly the one new `dsh-setup-rtk` row and the new package copy. Verify a second `pnpm gen:check` exits 0.

## 2. Always-on rule

- [x] 2.1 Write `assets/rtk/rules.md` from design D2, add it to the manifest `files`, and extend `src/host/index.ts` to export `name`, `inject = ['skills', 'systemPrompt']`, and `apply(ctx, config)`: read the asset, register section `dsh-setup:rtk` at order `120` with `interpolate: false`, and skip the section only when `config.alwaysOn === false`; register the skill provider in the same module so the asset is available later. Verify `pnpm build`, `pnpm gen`, and a host test that asserts the section name, order, exact text, the suspension phrase, and that `alwaysOn: false` removes only the section.
- [x] 2.2 Add `packages/plugin-rtk/test/budget.test.ts`: measure `assets/rtk/rules.md` as `Buffer.byteLength(text, 'utf8') / 4`, fail above `300` estimated tokens with the plugin name and measured size, and fail when the text contains a slash command the Harness does not provide. Verify the test passes today and fails when a scratch copy is padded past 300 tokens.

## 3. Skill body and provider

- [x] 3.1 Write `assets/rtk/SKILL.md` with frontmatter (`name: rtk`, trigger-first folded description) and the body from design D3: supported command groups, the native fallback, `rtk proxy` recovery, the Windows `rtk run` warning, the `rtk trust` security boundary, and `rtk --version` as the version authority with the date the text was checked. Add the asset to the manifest `files`. Verify the body is between 1,200 and 4,000 UTF-8 bytes, names `rtk proxy`, `rtk trust`, `rtk --version`, and the native fallback, and does not assert a current rtk version.
- [x] 3.2 Extend the skill provider: one `rtk` candidate with `rank: 600`, `source: 'bundled'`, provider `dsh-setup-rtk`, a directory `resourceBase`, and the body read on `get`; return `undefined` for an unknown name. Verify `pnpm build`, `pnpm gen` (so the asset is vendored), and a provider test that asserts the one catalog entry, the frontmatter/catalog description match, the body is absent until `get`, the body is returned on invocation, and `alwaysOn: false` keeps the provider while removing only the section.
- [x] 3.3 Add the no-interception test or static check: the Host module and package contain no `child_process`, `ctx.shell`, `tools/pre-execute`, `tools/post-execute`, result filter, or rtk package/binary dependency; the fake context exposes only `skills` and `systemPrompt`. Verify the package test and `rg` over `packages/plugin-rtk` find no interception path.

## 4. Documentation and market metadata

- [x] 4.1 Write `docs/rtk.md`: what the bundle ships, why it is guidance rather than an adapter, the rtk prerequisite and install routes, the measured always-on size and 300-token budget, the combined prompt-cost table with Ponytail and the working contract (update `docs/principles.md` if its table would otherwise be stale), the `alwaysOn: false` override, the suspension phrase, removal, skill-name precedence for a local `rtk` skill, measurement with `rtk gain` and the DSH token meter, output-detail and sandbox limits, and the `rtk trust` security boundary. State the date the command guidance was checked and defer to `rtk --version`. Verify `pnpm lint` and that every intra-repo link resolves; the measured numbers match the budget test.
- [x] 4.2 Refine `locale/en.json` so the market card names the default-on rule, the `rtk` skill, the external rtk prerequisite, and the `alwaysOn: false` opt-out; use an original `icon.svg`. Verify `pnpm validate:repo` and the market mapping test accept the card.

## 5. Integration and acceptance

- [x] 5.1 Run the full package and repository gate: `pnpm build`, `git diff --exit-code`, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:repo`, and `pnpm validate:composition`. Verify every command exits 0 and the composed `--dump-config` contains the `dsh-setup-rtk` row exactly once.
- [ ] 5.2 Exercise the change in a throwaway `dev` profile, never in the live desktop profile: verify the assembled prompt contains the RTK rule, the catalog lists `rtk`, and the body is absent until invoked; run a large `git diff`/`git log`/repo search through rtk and confirm `rtk gain --history` records it and the DSH token meter reflects the smaller result; verify a failing test still shows its failure and exit code; verify `alwaysOn: false` removes only the section; verify a profile started with rtk removed from PATH still boots and the guidance names the native fallback.
- [x] 5.3 Bump the set version with `pnpm release:prepare --version X.Y.Z`, then run `pnpm gen` and `pnpm build`. Verify the one version appears in the root, every plugin, and the generated setup manifest, and `pnpm gen:check` exits 0. Do not tag or publish without the owner's release decision.

## Workflow follow-up

- At sync/archive, update the `session-guidance` main-spec Purpose sentence, which still describes "a bounded always-on ruleset"; the delta cannot change Purpose, and the capability now covers more than one always-on contribution.
- Live model-session acceptance remains open: the throwaway `rtk-live` headless profile booted and composed `dsh-setup-rtk`, but the fresh Harness home has no account sign-in and the run stopped with `ACCOUNT_SIGN_IN_REQUIRED`. Run task 5.2 in a signed-in throwaway profile; the package tests, `validate:composition`, and `validate:installer` already cover the section/catalog/budget/no-interception/install contracts.
- After archive and release, confirm the market lists the new card and the setup bundle's composed patch contains `dsh-setup-rtk`; monitor the first sessions with `rtk gain` and the session log for adoption.
- If supported bulky commands still bypass rtk, open a separate change for a narrow, opt-in post-execute filter or a wording revision; do not silently widen the always-on prompt.
- If rtk changes its command surface materially, refresh the skill text and the checked date; do not pin a version.
- Keep `docs/principles.md` and the combined prompt-cost table consistent with the measured contributions.
