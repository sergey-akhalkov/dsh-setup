# Tasks

## 1. Installer gate — `install.ps1`, `scripts/validate-installer.ts`

- [x] 1.1 Replace `$SupportedDshVersions` in `install.ps1` with a `$DshEngineRange` literal and a Windows PowerShell 5.1-safe SemVer range check (dotted numeric core, prerelease identifiers, `>=`/`>`/`<=`/`<`/`=` clauses); the refusal names the range and the next action. Verify `validate:installer` proves an in-range prerelease that was never listed (`0.2.2-rc.1`) proceeds, `0.2.1-rc.2` (below floor) and `0.3.0` (ceiling) are refused before changing anything, and the existing supported round-trip still passes.

## 2. Repository and CI — `dsh.json`, `scripts/**`, `.github/workflows/**`, `docs/**`, `AGENTS.md`

- [x] 2.1 Remove `supportedVersions` from `dsh.json`, `DshVersions`, and the test fixtures; add `scripts/ci-versions.ts` that prints the matrix (range floor via `semver.minVersion`, `runtime`, and the newest published `@deepseek-ai/dsh` version satisfying the range from `npm view`, deduped and sorted, with a visible floor+runtime fallback when the registry cannot be read) with a unit test for the pure selection. Verify `pnpm typecheck`, `pnpm test`, and a local dry run that prints the matrix.
- [x] 2.2 Point both workflows' `versions` job at the script; replace `validate:repo`'s exact-array comparison with a check that `install.ps1`'s `$DshEngineRange` equals `dsh.json.enginesDsh`; update `AGENTS.md`, `docs/contributing.md`, `docs/releasing.md`, and `docs/install.md` so the engines range is described as the only allowlist. Verify `pnpm validate:repo` and `pnpm lint` pass.

## 3. Integration — generated tree, full gate, release 0.26.1

- [ ] 3.1 Run `pnpm gen`, `pnpm build`, `pnpm gen:check`, the full `pnpm validate` with `DSH_CLI` pinned to a supported CLI, and `pnpm dogfood`; commit; `pnpm release:prepare --version 0.26.1`, rebuild, re-validate, commit, tag `v0.26.1`, push main and the tag. Verify the release and validate workflows pass and the published index serves setup 0.26.1 on DSH 0.2.2-rc.1 as well as the floor.

## Workflow follow-up

- Owner smoke: run the published 0.26.1 installer from an external PowerShell on the updated desktop app; confirm it no longer refuses 0.2.2-rc.1 and that the OpenSpec panel still opens.
- Archive after `pnpm reviews:check --change widen-dsh-support-to-engine-range` reports every checked task approved.

