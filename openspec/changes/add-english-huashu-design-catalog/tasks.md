# Tasks

Serial plan: one owner (`lead`) and one lane — the package, the generated composition, and the docs
travel together, and `packages/setup/**` is a shared hot path.

## 1. Package and provider (owns packages/plugin-huashu-design/**)

- [x] 1.1 Create `packages/plugin-huashu-design` with `package.json` (`@dsh-setup/plugin-huashu-design`, the repository version, `engines.dsh`, `dsh.bundle.patch`, a files list with no assets and no install scripts), `cordis.fragment.yml` with row `dsh-setup-huashu-design`, `tsconfig.json`, `locale/en.json`, and `icon.svg`; add the package reference to the root `tsconfig.json`; verify `pnpm install` links the package
- [x] 1.2 Implement `src/host/index.ts` to resolve the installed upstream package from the profile, register provider `dsh-setup-huashu-design` with an English description and English trigger words at rank 550, load the installed body with its frontmatter removed plus the separated English directive, and list nothing while the upstream is absent; verify `pnpm exec tsc -b packages/plugin-huashu-design` passes
- [x] 1.3 Add `test/catalog-entry.test.ts` covering the identity and single injected service, an English-only description, the empty catalog without the upstream, the candidate fields and the rank inequality (above a user skill, below the bundled root), the loaded body with the directive, the resource base, and the no-network rule; verify `pnpm exec vitest run packages/plugin-huashu-design/test/catalog-entry.test.ts` passes

## 2. Composition, docs, and the package row (owns packages/setup/**, README.md, docs/install.md)

- [x] 2.1 Run `pnpm gen` and `pnpm build`, then commit the generated bundle patch, the setup patch and manifest, and the vendored setup copy; verify `pnpm gen:check` passes and the setup patch contains `dsh-setup-huashu-design`
- [x] 2.2 Add the root `README.md` plugin row and correct the meta-bundle plugin count, and document the adapter in `docs/install.md`: English catalog line, the language directive, the precedence boundary, the no-vendored-bytes rule, that the manual stays Chinese, and that a pin bump must re-sync the description; verify `pnpm lint` passes

## 3. Acceptance (verification only; owns no source path)

- [x] 3.1 Verify the checkout's full gate: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:repo`, `pnpm validate:composition`, `pnpm gen:check`
- [x] 3.2 Verify the installed behavior in a throwaway profile: with the upstream bundle installed, the catalog resolves the English description and the loaded body ends with the directive; with the upstream removed, the entry disappears; `pnpm dogfood` stays green

## Verification record

Executed on 2026-11-22 against this change's tree, at `37e4164` plus the review fixes:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | pass — `tsc -p tsconfig.check.json`, no errors |
| `pnpm lint` | pass — 506 files checked, 21 warnings and 22 infos, no errors |
| `pnpm test` | pass — 171 files, 3177 tests, including the real-registry precedence test (the shipped `@deepseek-ai/dsh-skill` registry resolves the adapter entry over the bundled one and lets a rank-500 user copy win) |
| `pnpm validate:repo` | pass — 1387 files, 19 plugin packages, no problems |
| `pnpm validate:composition` | pass — the setup bundle composes on DSH 0.2.2-rc.2 |
| `pnpm gen:check` | pass — 686 generated files match 19 plugins |
| `pnpm validate:installer` | pass — including `the installed English catalog adapter resolves, and disappears without the upstream`: the installed vendored copy lists one English entry at rank 550 with the directive appended and a base directory that exists; the upstream package is then removed from that same profile while the adapter stays, the entry disappears, and the package is reinstalled so the next step runs on a complete profile |
| `pnpm dogfood` | pass — installer round-trip against a copy of the `desktop` profile; the live profile and the running Harness were not touched |

The throwaway-profile probe that first surfaced the linked-checkout gap ran against a profile whose
setup was added by path: the adapter listed nothing because the linked module sits outside the profile
tree. The profile anchors (`DSH_PROFILE_DIR`, then `DSH_HOME`/`DSH_PROFILE`) were added for that case,
the unit test covers both, and the acceptance step above now asserts the installed layout.
