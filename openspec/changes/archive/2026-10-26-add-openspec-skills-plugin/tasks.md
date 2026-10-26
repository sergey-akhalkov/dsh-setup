# Tasks

## 1. Pinned OpenSpec asset set

- [x] 1.1 Add `scripts/lib/openspec.ts` with the lock types, the six core workflow names, and validators for repository/version/tag/commit/integrity, LF endings, size ceilings, skill names, and per-file SHA-256; verify `pnpm exec vitest run scripts/test/openspec.test.ts` passes the validator cases.
- [x] 1.2 Add `scripts/update-openspec.ts` and the root `openspec:update` script; run `pnpm openspec:update --version 1.15.0` and verify it writes the six `assets/openspec/<name>/SKILL.md` files, the MIT `LICENSE`, and `openspec.lock.json` with upstream and generator records.
- [x] 1.3 Re-run the same update command and verify `git status --short packages/plugin-openspec` stays unchanged, proving a byte-identical refresh.
- [x] 1.4 Add the offline provenance test covering the six expected names, the license marker, LF endings, sizes, and SHA-256 of every committed asset; verify `pnpm exec vitest run scripts/test/openspec.test.ts` passes without network access.

## 2. Plugin package and skill provider

- [x] 2.1 Create `packages/plugin-openspec` with `package.json` (engines equal to `dsh.json`, `files` covering the assets and generated output), `cordis.fragment.yml` with row `dsh-setup-openspec`, `tsconfig.json`, `locale/en.json` naming the CLI prerequisite and upstream attribution, an original `icon.svg`, and the host provider in `src/host/index.ts`; add the root `tsconfig.json` reference and verify `pnpm build` emits `lib/index.js` and `lib/index.d.ts`.
- [x] 2.2 Implement the provider details: lock-driven candidates, on-demand body reads, frontmatter removal, adapter note with the pinned version/install command/`--tools none` and the stale `.dsh/skills/openspec-*` cleanup instructions, bundled rank 600, and no `systemPrompt` contribution; verify the built module exports the package name, `inject`, and `apply`.
- [x] 2.3 Add `test/host.test.ts` with a fake `ctx.skills` registry: assert the provider name, the six candidates and lock descriptions, a loaded body without frontmatter, the adapter note (including the stale-copy cleanup text), and the bundled rank; verify `pnpm exec vitest run packages/plugin-openspec/test` passes after `pnpm build`.

## 3. Per-project root documentation and attribution

- [x] 3.1 Add `docs/openspec.md` covering the CLI prerequisite, the pinned global install, `openspec init --tools none` in the workspace root, the stale `.dsh/skills/openspec-*` cleanup command, the no-store statement, and the `pnpm openspec:update` release command; verify every documented flag exists in `openspec init --help` and the quoted version matches the lock.
- [x] 3.2 Add the OpenSpec entry to `docs/install.md` (prerequisites, per-project first use, "What is not included") and verify `pnpm lint` and `pnpm validate:repo` pass with the new text.
- [x] 3.3 Update `AGENTS.md` §11 to state that the OpenSpec skills come from the packaged plugin (six core skills) and that per-project init uses `--tools none`; verify `pnpm lint` passes.

## 4. Bundled distribution and repository gates

- [x] 4.1 Regenerate the composition with `pnpm gen` and keep the generated plugin patch, setup manifest, setup patch, and vendored package in the tree; verify `pnpm gen:check` passes and the setup manifest lists the plugin dependency.
- [x] 4.2 Commit the built output, run `pnpm build` again, and verify `git diff --exit-code -- packages/plugin-openspec/lib` passes.
- [x] 4.3 Run `pnpm check` and `pnpm validate:repo`; verify both pass and every packaged asset is listed in the plugin `files` array.
- [x] 4.4 Run `pnpm validate:composition` (set `DSH_CLI` when the published CLI is not reachable) and verify the composed profile contains the `dsh-setup-openspec` row.
- [x] 4.5 Run `pnpm dogfood` and verify the throwaway desktop profile copy contains the row and the live owner profile is unchanged.

## 5. Adopt the packaged set in this checkout

- [x] 5.1 Delete the existing `.dsh/skills/openspec-*` directories in this checkout and verify `Get-ChildItem .dsh\skills` lists no `openspec-*` entry; confirm the docs and adapter-note test carry the same cleanup for users, and note that the running Harness must restart to recompose the rebuilt setup.

## Workflow follow-up

- Release the new set version through `pnpm release:prepare`, `pnpm validate`, and the `v<version>` tag, then verify the published market lists the plugin.
- Archive the change after the project's review requirements are satisfied.
