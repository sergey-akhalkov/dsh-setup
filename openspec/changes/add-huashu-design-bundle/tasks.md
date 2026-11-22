# Tasks

Serial plan: one owner (`lead`) and one lane — the declaration, the installer, the validators, and
the docs all depend on the same decision, and `dsh.json`/`install.ps1` are the shared hot files.

## 1. Declaration and installer (owns dsh.json, install.ps1)

- [x] 1.1 Add `installBundles.git` with `{ name: "huashu-design", spec: "github:alchaincyf/huashu-design#937113133ae446a69ea19d4ceed6cbd2ed3c7735" }` to `dsh.json`, and the matching `$GitBundles` entry written as `'<name>=<spec>'` to `install.ps1`'s repository-metadata block
- [x] 1.2 Install each declared entry with `dsh plugin add <spec>` in the step that enables the bundles the setup expects, warn and continue on a failed fetch, assert the profile selection after a successful add, and keep the setup bundle last; print `enable`/`keep` per entry in the plan
- [x] 1.3 Verify the installed bundle's selection in the profile verification, but only when the profile has its dependency; verify `install.ps1` parses (`Parser::ParseFile`), `-DryRun` prints the entry, and `pnpm validate:repo` reports no `GitBundles` or pin problem

## 2. Validation and owner-copy checks (owns scripts/**, two test fixtures)

- [x] 2.1 Type `installBundles.git` as `GitBundle[]` in `scripts/lib/workspace.ts` and update the `DshVersions` fixtures in `scripts/test/adapter-guidance.test.ts` and `scripts/test/generate.test.ts`
- [x] 2.2 Compare `install.ps1`'s `$GitBundles` with `dsh.json` in `scripts/validate-repo.ts`, and reject a spec that is not commit-pinned or whose declared name does not match the package the spec installs
- [x] 2.3 Expect the declared names in `scripts/validate-installer.ts` (manifest expectation and composed-dump markers) and in `scripts/dogfood.ts`; verify `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass

## 3. Documentation (owns README.md, docs/install.md)

- [x] 3.1 Document the bundle in `docs/install.md`: what it is, why it is a separate pinned dependency, the failure behavior, prerequisites (Python/Playwright/`ffmpeg`), the update procedure, and removal; note that the market path does not add it and give the manual command
- [x] 3.2 Add the short section and link to `README.md`'s shipped-bundles area; verify `pnpm lint` passes

## 4. Acceptance (verification only; owns no source path)

- [x] 4.1 Run `pnpm validate:installer`: the real installer installs the pinned bundle into a throwaway home, the manifest selects it before the setup bundle, and the composed profile contains its row
- [x] 4.2 Run `pnpm dogfood`: the owner-copy installation enables the declared bundle without touching the live profile
