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
