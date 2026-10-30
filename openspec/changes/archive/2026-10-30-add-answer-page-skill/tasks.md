# Tasks

## 1. Vendoring and provenance

- [x] 1.1 Add `scripts/update-answer-page.ts` that fetches the pinned upstream files by 40-hex commit
      from `raw.githubusercontent.com`, writes them under
      `packages/plugin-answer-page/assets/answer-me-with-html/`, and writes
      `answer-page.lock.json` with repository, tag, commit, and per-file size and SHA-256 sorted by
      path. Follow the Ponytail and OpenSpec update-script shape (`.ts` relative imports).
- [x] 1.2 Add the `answer-page:update` script to `package.json` and run it for the pinned version;
      commit the vendored files, the upstream `LICENSE`, and the lock.
- [x] 1.3 Confirm the vendored skill directory contains `SKILL.md`, `references/`, `scripts/am.mjs`,
      and the license. Record in the provenance document that the upstream `SKILL.md` carries one
      example Windows path, which is the only machine-path exception and is covered by the scan
      exception in task 4.3.

## 2. Package

- [x] 2.1 Create `packages/plugin-answer-page/` from the OpenSpec package shape: `package.json`
      (`@dsh-setup/plugin-answer-page`), `cordis.fragment.yml` with the row id
      `dsh-setup-answer-page`, `tsconfig.json`, `locale/en.json`, `icon.svg`.
- [x] 2.2 Host module: register the skill through `ctx.skills.registerProvider` with the vendored
      `SKILL.md` body, our catalog description, clearly separated adapter text, and a directory
      `resourceBase` for the vendored skill folder; validate the lock at load and fail loudly on a
      mismatch.
- [x] 2.3 Add the package to the root `tsconfig.json` references and run `pnpm gen`; confirm both
      generated patches list the row.

## 3. Usage policy

- [x] 3.1 Adapter text: write the draft to `<workspace>/.tmp/answers/<slug>.md` and render that path
      (never stdin); pass `-o <workspace>/.tmp/answers/<slug>.html`, `AM_HOME=<workspace>/.tmp/answers/.am`,
      `AM_NO_UPDATE_CHECK=1`, and `--no-open`; render only on request or for a diagram-shaped
      explanation; no page for code answers, delegated reports, or one-line answers; cap fixes at
      two; call `present` and end the reply with the path link; no video unless asked.
- [x] 3.2 Confirm no always-on contribution and no system-prompt section is registered.

## 4. Validation and tests

- [x] 4.1 Provider test: the catalog lists the skill with our description, the body loads only on
      invocation, and the adapter text follows the vendored bytes unchanged.
- [x] 4.2 Provenance test: every vendored file matches its recorded size and SHA-256, the lock carries
      the tag and 40-hex commit, and a corrupted byte fails the test.
- [x] 4.3 Scan exception: `scripts/lib/scan.ts` skips the machine-path check only for files listed in
      the answer-page lock, in the source package and in the generated setup copy. Tests assert that
      the vendored example passes, an arbitrary machine path in another file still fails, and secret
      scanning still covers the skipped files.
- [x] 4.4 Offline test: run the vendored CLI with the adapter environment (no `CI`) and assert it
      starts no update process and makes no request; run it with an unwritable `AM_HOME` and assert
      the page and the draft still stay inside the workspace.

## 5. Documentation

- [x] 5.1 Add `docs/answer-pages.md`: usage, the narrow policy, the workspace output location and
      draft path, the offline guarantee, limits, and attribution.
- [x] 5.2 Add the row to `docs/plugins.md`, the README plugin table, and the package locale
      description naming the upstream project, author, version, license, and source link.

## 6. Verification

- [x] 6.1 `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, `pnpm validate:composition`, and
      `pnpm build && git diff --exit-code`.
- [ ] 6.2 Manual smoke in a dev profile: render one page into `.tmp/answers/`, confirm the file
      exists, nothing was written under the user home or the system temporary directory, and the
      `present` card plus path link open the page.
