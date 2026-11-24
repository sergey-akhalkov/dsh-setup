# Tasks

## 1. Package skeleton (lane 1, owns `packages/plugin-issue-triage/package.json`, `packages/plugin-issue-triage/cordis.fragment.yml`, `packages/plugin-issue-triage/tsconfig.json`, `packages/plugin-issue-triage/locale/**`, `packages/plugin-issue-triage/icon.svg`, `packages/plugin-issue-triage/src/host/index.ts`, `tsconfig.json`)

- [ ] 1.1 Create `packages/plugin-issue-triage` with the `plugin-refactoring` manifest shape and a
      Host entry that registers one skill candidate from `assets/issue-triage/SKILL.md`; verify
      `pnpm install` links the package and `pnpm typecheck` accepts the project reference.
- [ ] 1.2 Register the root `tsconfig.json` reference; verify a fresh `pnpm typecheck` passes.

## 2. Skill body (lane 2, owns `packages/plugin-issue-triage/assets/issue-triage/SKILL.md`, `packages/plugin-issue-triage/test/skill-content.test.ts`)

- [ ] 2.1 Write `assets/issue-triage/SKILL.md` with the sections and contracts named in the delta
      spec: When to use it, Preconditions, The run, Verdicts, Evidence, Closes, Clustering and the
      cap, Subagent brief, Write-back, Report, Safety, Failure modes; verify the content test pins
      every section and the full verdict vocabulary.
- [ ] 2.2 Write the subagent brief and the four comment templates as copy-ready fenced blocks;
      verify the content test names them and the brief forbids a GitHub write.
- [ ] 2.3 Write the worked example as an evidence-shaped template whose verdicts are derived from the
      run and whose proposal count is the observed count up to the cap of three — not fixed
      outcomes; verify the content test pins the table columns, the cap, and the absence of a
      hard-coded issue-to-draft mapping.

## 3. Tests and packaging (lane 3, owns `packages/plugin-issue-triage/test/skill-provider.test.ts`, `packages/setup/**`, `docs/plugins.md`, `README.md`)

- [ ] 3.1 Add the provider test: one candidate, the catalog description equal to the body's
      frontmatter, no always-on contribution, and no candidate when the row is disabled; verify
      `pnpm test` passes.
- [ ] 3.2 Add the bundle to the setup composition and the `docs/plugins.md` and `README.md` rows, run
      `pnpm gen`; verify `pnpm gen:check`, `pnpm validate:repo`, and `pnpm lint` pass.

## 4. Acceptance (serial, owns `packages/plugin-issue-triage/test/fixtures/gh-stub/**` and the recorded acceptance)

- [ ] 4.1 Add a `gh` stub fixture that records every argument to a log file, exits with a configured
      code, and serves fixture payloads for `auth status`, `issue list`, `issue view`, and
      `issue comment`; verify the stub records an `issue comment` invocation and is used instead of
      the real binary when it is first on `PATH`.
- [ ] 4.2 Run the procedure over the current seven issues with the stub first on `PATH`; assert the
      log contains no mutating call (`issue comment`, `issue close`, `issue edit`) while the required
      preflight and inventory reads are present, record the evidence-derived verdict table, and
      verify no issue was closed.
- [ ] 4.3 Run the write-path acceptance with the stub: one duplicate close, one `invalid` issue
      without an owner answer, then a second run over the same marker; verify the log contains no
      close for the `invalid` issue and the rerun adds no second comment, and record the three
      transcripts.
- [ ] 4.4 Run the full gate (`pnpm build`, `git diff --exit-code`, `pnpm gen:check`,
      `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:repo`) and record the result.
