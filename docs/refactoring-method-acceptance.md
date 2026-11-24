# Refactoring method acceptance

Reviewable acceptance evidence for the `add-refactoring-method` change. This page lives outside the
change directory on purpose: recording it here does not change the change-artifact digest the spec
review reports on.

## Platform prerequisites

The method depends on the spec-less change path from `add-exploratory-testing`; it was present and
green before any refactoring artifact was written:

- `pnpm exec vitest run packages/plugin-exploratory-testing/test/method-acceptance.test.ts` — 3/3
  pass. The first case builds a throwaway OpenSpec root with an `audit-style` change that declares
  `skip_specs: true`, validates it strict, verifies intake spec evidence, adopts it, authorizes the
  user-click archive, and runs a real `openspec archive`.
- `pnpm exec vitest run packages/plugin-workflows/test/assets.test.ts` — 6/6 pass, including the
  whole-spec review scope: `findings/**/*.md` is read, and `proposal.md`, `design.md`, `tasks.md`, and
  the delta-or-`skip_specs` decision are the reviewed artifacts.
- `packages/plugin-workflows/src/host/evidence.ts` (`specDigest`) hashes every file under the change
  directory except `reviews/`, normalizes `tasks.md` checkboxes, and binds the effective `skip_specs`
  marker, so an edit to a finding record or the marker invalidates a PASS.

## Integration gate

Run at revision `7b2f6041` (the fix commit) with a clean worktree:

| Command                                         | Result                                              |
| ----------------------------------------------- | --------------------------------------------------- |
| `pnpm check` (typecheck → lint → build → test)  | exit 0; 176 test files, 3289 tests passed           |
| `git diff --exit-code` right after `pnpm build` | exit 0 — no generated drift                         |
| `pnpm gen:check`                                | exit 0; 696 generated files match for 20 plugins    |
| `pnpm validate:repo`                            | exit 0; 1416 files, 20 plugin packages, no problems |
| `pnpm validate:composition`                     | exit 0; setup bundle composes on DSH 0.2.2-rc.2     |

The dry-run and package numbers below were re-confirmed at the same revision; the later review
fixes (adapter-note assertion, the refactor B task template, the anti-repetition wording) are
covered by `pnpm check` above.

## Method dry run

Executed on 2026-11-24 in the disposable git workspace `.tmp/refactor-dry-run` (its own repository, a
minimal `openspec init --tools none` root, no dependencies, `node --test` as the only tool). Its
baseline was a two-field name formatter duplicated byte-identically in `src/format.js` and
`src/legacy.js`, covered by two public-seam oracle suites.

Order of events, from the workspace's own `git log` and recorded artifacts:

1. **Baseline** `88430c7` — `node --test`: 5 pass, 0 fail, 72 ms. Recorded as the green baseline.
2. **Audit A** `audit-names-2026-11-24` written from `templates.md`: `proposal.md`, `design.md` (ROI
   register, selection, rejected candidate, pending gate 1), `audit.md`, `brief.md`, two
   `findings/P-*.md` records, `tasks.md`, and `.openspec.yaml` with `skip_specs: true`.
   `openspec validate audit-names-2026-11-24 --strict` → valid.
   `git status --porcelain -- src test` → empty: no production file touched before gate 1.
3. **Gate 1** recorded in A's `design.md` as approved; `findings/P-1.md` moved to `selected`.
4. **Refactor B** `refactor-names-2026-11-24` written: `proposal.md`, `design.md` (target structure,
   Mikado edge, four-proof safety-net table, pending gate 2, verification contract, ratchet, decision
   log), `tasks.md`, `.openspec.yaml` with `skip_specs: true`.
   `openspec validate refactor-names-2026-11-24 --strict` → valid.
5. **Mutation proof** — the implementation was changed to return `first, last`; `node --test` exited 1
   with 2 failing oracles; the file was restored byte-identically (`git status` empty, 5/5 pass).
   The performance or data baseline was recorded as not applicable: the path is a pure display
   function, neither hot nor stateful.
6. **Gate 2** recorded in B's `design.md` as approved. No refactor edit preceded it.
7. **Step 1** `c2a5bfd` — one implementation in `src/names.js`, both modules re-export it. Narrow
   suite 3/3, full suite 5/5, 77 ms. The first attempt was red because of a shell escaping mistake in
   the written file; it was repaired before the commit, so no red state was committed.
8. **Ratchet** — `test/architecture.test.js` asserts exactly one `export function formatName` under
   `src/` and that both public modules re-export it. It passed on the target (2/2) and failed on a
   deliberately reintroduced second definition (`pass 1, fail 1`); after removal the suite was 7/7.
9. **Close** `766d92f` — verification, metrics, ratchet, and close record appended to B's `design.md`;
   the audit change closed with the link to B.

Final checks in the dry-run workspace: `node --test` → 7 pass, 0 fail; `git status --porcelain` →
empty; the public exports of `src/format.js` are `formatName` before and after; `git diff 88430c7 --
test/format.test.js test/legacy.test.js` → empty, so the baseline oracles were never edited. Every
`src/` commit after the baseline is the approved Step 1.

What the dry run does **not** prove: it was driven by an operator script, not by a fresh agent reading
the packaged skill, so it proves the artifact contracts and the gate ordering, not that a model
follows the prose. The method prose is covered by `test/skill-content.test.ts` and the review.

## Skill load

- **Catalog and body** — `pnpm exec vitest run packages/plugin-refactoring/test` (23 tests): the
  provider lists one `refactoring` candidate at bundled rank 600 with `assets/refactoring` as its
  resource base and `SKILL.md` as its locator, keeps the catalog description identical to the asset
  frontmatter, returns the body only through `get`, rejects an unknown name, injects only `skills`,
  and reads no `systemPrompt`. The loaded content is asserted as the asset body followed by exactly
  the adapter note; emitting the body alone makes that test fail (`expected '' to be '\n\n---\n\n…'`),
  which was checked by mutating the built provider and restoring it.
- **Throwaway profile composition** — with `DSH_HOME` pointing at the kept dogfood home,
  `dsh --profile owner-copy --dump-config` composes the `dsh-setup-refactoring` row mounting
  `@dsh-setup/plugin-refactoring` from the vendored setup tree.
- **Real headless run through the throwaway profile** — provider credentials are unavailable for a
  throwaway home, so a local test provider served the model route: a private package
  `dsh-local-test-provider` in the `probe` profile registers an adapter for the `local-test` route
  with `ctx.llm.registerAdapter(['local-test'], adapter)` and streams one `skill` tool call for
  `refactoring` followed by a final text answer. Its `resolveModel` declares an 8192-token context,
  its `prepareCall` returns the same stream, and every request's `system` and `messages` are appended
  to `DSH_LOCAL_TEST_LOG`. The `probe` profile was created from the shipped `headless` template,
  `dsh plugin --profile probe add link:<checkout>/packages/setup` installed this repository's setup
  bundle, and its `cordis.patch.yml` held:

  ```yaml
  - id: agent-default-model
    config:
      provider: local-test
      model: fake
  - insert:
      - id: local-test-provider
        name: dsh-local-test-provider
  ```

  Run: `DSH_HOME=<throwaway-home> dsh probe "Load the refactoring skill and answer done."` → exit 0,
  answer `done`, three recorded model calls (the main agent, the session-title call, the main agent
  after the tool result). The assertions on that log all passed (11/11):

  | Assertion                           | Evidence                                                                                                                            |
  | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
  | catalog entry, shipped description  | the assembled request carries `` `refactoring`: State-driven, behavior-preserving refactoring `` and `leave an enforceable ratchet` |
  | body absent before invocation       | no `## Ratchet baseline`, `## Safety net: four proofs`, or mutation wording in the first assembled request                          |
  | body load through the real service  | the model's `skill` call with `{"name":"refactoring"}` returned 18,527 characters of the packaged body, including its formula line  |
  | body stays out of the system prompt | the post-invocation system message still has no body                                                                                |

  The test provider, the profile copy, and the log are throwaway artifacts under `.tmp/`; the
  acceptance is reproducible by following this section, and the shipped bundle itself is unchanged by
  it.
- The live profiles were not modified: `pnpm dogfood` round-trips a copy and reports the live profile
  untouched, the installer was never run against a real profile from this session, and every probe
  write went to `DSH_HOME` pointing at the throwaway home.
