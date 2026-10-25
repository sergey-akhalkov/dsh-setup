# Tasks

## 1. Generation rule: an approved adapter row beside an owned row

- [x] 1.1 Delete the Host/Client-entry rejection for approved adapter rows in `scripts/lib/generate.ts` and the matching validator message in `scripts/lib/fragments.ts`, leaving one rule: a row names its owning package or a name from `ADAPTER_ROW_NAMES`. Verify with `pnpm exec vitest run scripts/test` that the existing generation and fragment tests pass unchanged.
- [x] 1.2 Add a generation test covering both shapes: a package with `main` plus one approved adapter row produces a patch mounting two rows, and an unapproved row name still throws with the offending row id. Verify with `pnpm exec vitest run scripts/test/<new-file>.test.ts`.

## 2. `@dsh-setup/plugin-working-principles`

- [x] 2.1 Scaffold the package from `packages/plugin-composer-clock` (manifest with `dsh.bundle`, fragment with one row id `dsh-setup-working-principles`, `tsconfig.json`, root `tsconfig.json` reference, `icon.svg`, `locale/en.json` naming the bundle and its opt-out). Verify `pnpm build` emits `packages/plugin-working-principles/lib/index.js` and `lib/index.d.ts`.
- [x] 2.2 Vendor the packaged text as `assets/working-principles/contract.md` using the draft in `design.md` §D2, and list it in `files`. Verify a byte count between 3,200 and 4,800 UTF-8 bytes, so the draft is neither truncated nor silently grown.
- [x] 2.3 Add the two skill assets: `assets/working-principles/SKILL.md` (the elaborated text with the rationale and the adaptation pointer) and `assets/verify-change/SKILL.md` (reproduce before fixing, reduce one dimension at a time, judge a run by whether its trigger fired, process triage rules). Verify each body stays under 12,000 UTF-8 bytes and its `description` names its trigger.
- [x] 2.4 Implement the host half: register the `contract.md` text as a system-prompt section at order `110` unless `config.alwaysOn === false`, and register a provider listing both skills. Verify a host test asserts the section text, its order, the two catalog entries, and that `alwaysOn: false` removes only the section.
- [x] 2.5 Add the budget test: read every packaged ruleset asset and fail when `utf8Bytes / 4` exceeds 1500, naming the plugin and the measured size. Verify the test passes today and fails when a scratch copy is padded past the limit.
- [x] 2.6 Write `docs/principles.md`: what the bundle contributes, the measured size, the `alwaysOn: false` override, suspension in conversation, and the table of source skills deliberately not shipped with a one-line reason each. Verify `pnpm lint` passes and every intra-repo link resolves.

## 3. `@dsh-setup/plugin-rust`

- [x] 3.1 Scaffold the package the same way (row id `dsh-setup-rust`, `icon.svg`, `locale/en.json` with a trigger-first description). Verify `pnpm build` emits its `lib/**` and `pnpm validate:repo` accepts its `engines.dsh` copy.
- [x] 3.2 Write `assets/rust/SKILL.md` merging the source's two Rust skills: MSRV-gated use of newer standard features, narrowest `cargo check`/`test`/`clippy` choice, build-test-disk cost diagnosis, profile and target-directory hygiene, and the five non-obvious rules named in `design.md` §D4. Verify it names no stabilization release and no other repository's benchmark.
- [x] 3.3 Write `assets/rust/references/cargo-workflows.md` (from the source's workflow reference) and `assets/rust/references/std-replacements.md` (only the replacement mapping). Verify no version-pinning assertions remain, and that both paths appear in `files`.
- [x] 3.4 Implement the host half and its test: the catalog lists `rust`, the body loads on demand, and the manifest declares no dependency on the ruleset bundle. Verify `pnpm build` plus the package test pass, and that a profile containing only this bundle composes.

## 4. Guidance beside the two MCP adapters

- [x] 4.1 Convert `packages/plugin-serena` into a code-bearing bundle with a second row: add `main`, `types`, `src/host/index.ts`, `tsconfig.json`, root reference, `assets/serena-discipline/SKILL.md`, and `lib/**` plus the asset path in `files`, keeping the existing adapter row id unchanged. Verify `pnpm build` emits its `lib/**` and a host test asserts the skill is cataloged and the adapter row id is byte-identical to today's patch.
- [x] 4.2 Do the same for `packages/plugin-nuphus-mcp` with `assets/nuphus-discipline/SKILL.md` covering the five rules: fresh snapshot after navigation, per-step `success`/`detail` inspection, redo only the failed step after a partial failure, screenshots only for visual questions, batch only to the next semantic checkpoint. Verify as in 4.1.
- [x] 4.3 Add one test per converted bundle proving the adapter row mounts independently of the host module: with the module row disabled, the adapter row still mounts and the server configuration is unchanged. Verify both tests pass.
- [x] 4.4 Update the two plugins' documentation pages to name the new skill and the fact that the adapter works without it. Verify `pnpm lint` passes.

## 5. Integration

- [x] 5.1 Run `pnpm gen` and confirm the generated output covers exactly four plugins, the setup patch/manifest, and the vendored tree with no stale entries. Verify `pnpm gen:check` exits 0 on a second run.
- [x] 5.2 Run `pnpm build` and confirm the committed `lib/**` for the two new and two converted packages matches a fresh build. Verify `git diff --exit-code` is clean after committing the build output.
- [x] 5.3 Run `pnpm check`, `pnpm validate:repo` and `pnpm validate:composition`. Verify all exit 0.
- [x] 5.4 Measure the delivered always-on cost: `docs/principles.md` states the packaged size and the combined per-step cost with the installed ruleset. Verify the numbers match the budget test's measurement.
- [x] 5.5 Bump the set with `pnpm release:prepare --version X.Y.Z`, then `pnpm gen` and `pnpm build`. Verify `git diff` shows the one version across root, every plugin and the setup manifest, and `pnpm gen:check` exits 0.

## Workflow follow-up

- At sync: edit `openspec/specs/mcp-adapters/spec.md`'s Purpose sentence, which still says an adapter bundle ships "without shipping a Host or Client module", to permit a guidance module; then archive this change.
- After release: confirm the market lists both new cards and that `plugin-working-principles` appears in the setup bundle's composed patch.
