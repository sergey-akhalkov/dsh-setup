# Tasks

Serial plan: one owner (`lead`) and one lane — the declaration, the installer, the validators, and
the docs all depend on the same decision, and `dsh.json`/`install.ps1` are the shared hot files.

## 1. Declaration and installer (owns dsh.json, install.ps1)

- [x] 1.1 Add `installBundles.git` with `"github:alchaincyf/huashu-design#937113133ae446a69ea19d4ceed6cbd2ed3c7735"` to `dsh.json`, and the same spec to `install.ps1`'s `$GitBundles` in the repository-metadata block
- [x] 1.2 Install each declared spec with `dsh plugin add <spec>` in the step that enables the bundles the setup expects, warn and continue on a failed fetch, read the package name back from the profile dependency that records the spec, append that name to the selection, and keep the setup bundle last; print `enable`/`keep` per spec in the plan
- [x] 1.3 Verify an installed bundle's selection in the profile verification, skipping a spec the profile never recorded; verify `install.ps1` parses (`Parser::ParseFile`), `-DryRun` prints the spec, and `pnpm validate:repo` reports no `GitBundles` or pin problem

## 2. Validation and owner-copy checks (owns scripts/**, two test fixtures)

- [x] 2.1 Type `installBundles.git` as `string[]` in `scripts/lib/workspace.ts`, add the spec-to-package-name resolver to `scripts/lib/install-bundles.ts`, and update the `DshVersions` fixtures in `scripts/test/adapter-guidance.test.ts` and `scripts/test/generate.test.ts`
- [x] 2.2 Compare `install.ps1`'s `$GitBundles` with `dsh.json` in `scripts/validate-repo.ts` and reject any spec that is not exactly `<source>:<path>#<40-hex commit>`; the package name is not derived from the spec here, because only the profile knows it
- [x] 2.3 Expect the resolved package name in `scripts/validate-installer.ts` (manifest expectation and composed-dump markers), check the rows the installed bundle's own patch declares, fail when a declared spec is absent from the installed profile, and expect the resolved name in `scripts/dogfood.ts`; verify `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass
- [x] 2.4 Add the stub-CLI acceptance step: a failed fetch warns and leaves the setup installed, a stale pin is reinstalled at the declared spec, a current pin is skipped, a dependency-only add is still selected before the setup bundle, and a dropped selection fails the verification; the stub records a scoped package name the spec does not carry; verify `pnpm validate:installer` passes

## 3. Documentation (owns README.md, docs/install.md)

- [x] 3.1 Document the bundle in `docs/install.md`: what it is, why it is a separate pinned dependency (asset volume, upstream ownership of the provider and dependencies), the failure behavior, prerequisites (Python/Playwright/`ffmpeg`), the update procedure, and removal; note that the market path does not add it and give the manual command
- [x] 3.2 Add the short section and link to `README.md`'s shipped-bundles area; verify `pnpm lint` passes

## 4. Acceptance (verification only; owns no source path)

- [x] 4.1 Run `pnpm validate:installer`: the real installer installs the pinned bundle into a throwaway home, the manifest selects it before the setup bundle, and the composed profile contains every row its patch declares
- [x] 4.2 Run `pnpm dogfood`: the owner-copy installation enables the declared bundle without touching the live profile
