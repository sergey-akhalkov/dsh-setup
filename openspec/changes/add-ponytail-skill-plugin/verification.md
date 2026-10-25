# Verification Notes

Integration evidence for tasks 4.1-4.4 of `add-ponytail-skill-plugin`. Recorded on 2026-10-25.

- Checkout under test: `main`, implementation commit
  `d099146` (`feat(ponytail): package the pinned Ponytail prompt as a plugin bundle`) plus the
  verification/metadata corrections recorded in this session.
- Toolchain: Node `v24.18.0`, pnpm `11.9.0`, Windows PowerShell 7, published DSH CLI
  `0.2.1-rc.3` (`pnpm dlx @deepseek-ai/dsh@0.2.1-rc.3`), Desktop-bundled CLI runtime
  (`%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`).
- Pre-existing working-tree state: the checkout also carried unrelated uncommitted changes for the
  pending `add-portable-dsh-setup` change. They were left untouched. Every command below was run on
  top of that state, and the literal clean-tree build check was repeated in a pristine worktree at
  `HEAD` (4.1), so the result does not depend on the dirty tree.
- Raw command-output logs, session logs, and the throwaway Harness homes are local gitignored scratch
  under `.tmp/` (`ponytail-*.log`, `ponytail-43/`, `ponytail-43-evidence.json`,
  `inspect-session.mjs`, `ponytail-pre44*-backup/`).

## 4.1 Full local gate

Run from the repository root; every command exited zero.

| Command | Result |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm check` | typecheck + lint + build + 111 tests (10 files) pass; `build: 2 workspace package(s)`, 1 client bundle |
| `pnpm gen:check` | `gen:check: 23 generated files match (2 plugin(s))` |
| `pnpm validate:repo` | `validate-repo: 98 file(s) scanned, 2 plugin package(s), no problems` |
| `pnpm validate:composition` | 5/5 steps ok; `setup bundle composes on DSH 0.2.1-rc.3` |

The dirty-tree `pnpm build` left the working tree exactly as it was (same `git status --porcelain`
before and after; no diff under `packages/`). For the literal `git diff --exit-code` requirement, a
pristine worktree at the change commit was used:

```sh
git worktree add .tmp/ponytail-cleancheck HEAD
cd .tmp/ponytail-cleancheck
pnpm install --frozen-lockfile   # exit 0, "Already up to date"
pnpm build                       # exit 0, 2 workspace packages, 1 client bundle
pnpm gen:check                   # exit 0, 23 generated files match
git diff --exit-code             # exit 0, clean
```

## 4.2 Individual plugin in a throwaway profile

The plugin package was installed by its absolute workspace path (the published CLI resolves the
checkout path) into a fresh throwaway Harness home, with the app-hosted profile variables removed:

```powershell
$plugin = '<checkout>/packages/plugin-ponytail'
$env:DSH_HOME = '<checkout>/.tmp/ponytail-42-home'
Remove-Item Env:DSH_PROFILE, Env:DSH_PROFILE_DIR, Env:DSH_SESSION_ID, Env:DSH_SHELL, Env:DSH_WEB_URL
$cli = 'pnpm dlx @deepseek-ai/dsh@0.2.1-rc.3'
pwsh -NoProfile -Command "$cli --profile ci --from-default-profile web --dump-config"  # exit 0
pwsh -NoProfile -Command "$cli plugin --profile ci add `"$plugin`""                    # exit 0
pwsh -NoProfile -Command "$cli --profile ci --dump-config"                             # exit 0
```

Results:

- Profile bundle selection after the install:
  `@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, @dsh-setup/plugin-ponytail` (the setup bundle
  was not selected, so only the individual plugin contributes).
- `--dump-config` contains the composed row without composition errors:

  ```yaml
  # == @dsh-setup/plugin-ponytail
  - id: dsh-setup-ponytail
    name: '@dsh-setup/plugin-ponytail'
  ```

- The installed profile copy under `profiles/ci/node_modules/@dsh-setup/plugin-ponytail/` ships
  `assets/ponytail/SKILL.md`, `assets/ponytail/AGENTS.md`, `assets/ponytail/LICENSE`, and
  `ponytail.lock.json`.

## 4.3 Runtime behavior verification (off-desktop) and owner dogfood step

A one-shot `dsh --profile headless --json` run in a throwaway `DSH_HOME` persists the model-facing
facts to its session log before provider dispatch: the rendered system prompt (`system/message`),
the skill catalog (`user/message` with `source.kind = skill-catalog`), and the injected skill body
(`user/message` with `source.kind = skill-invocation`). The run then exits non-zero with
`MISSING_CREDENTIAL`/`ACCOUNT_SIGN_IN_REQUIRED`, so no network access and no model call happen. The
persisted log was decoded with the scratch helper `.tmp/inspect-session.mjs`.

```powershell
$dsh = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
$env:DSH_HOME = '<throwaway home under .tmp/>'
Remove-Item Env:DSH_PROFILE, Env:DSH_PROFILE_DIR, Env:DSH_SESSION_ID, Env:DSH_SHELL, Env:DSH_WEB_URL
& $dsh --profile headless --dump-config                                   # initialize profile
& $dsh plugin --profile headless add '<checkout>/packages/plugin-ponytail' # or packages/setup
& $dsh --profile headless --json "/ponytail reply with exactly PONG"      # expected exit 1
node .tmp/inspect-session.mjs <newest session.v4.jsonl.zstd> check
```

Observed facts (`.tmp/ponytail-43-evidence.json`):

| Scenario | System prompt | Catalog | Invocation |
| ------------------------------------------ | ---------------------------------------------------------- | -------------------- | ------------------------------- |
| 1. Individual plugin, default config | 5,808 B; ruleset + footer once | `ponytail` listed once | body + adapter note once |
| 2. Profile patch `alwaysOn: false` | 2,743 B; no ruleset, no footer | `ponytail` listed once | body + adapter note once |
| 3. Profile patch row `disabled: true` | 2,743 B; no ruleset, no footer | `ponytail` absent | no injection |
| 4. Full `packages/setup` instead | 5,808 B; footer exactly once | `ponytail` listed exactly once | body + adapter note exactly once |

The v4 session-log format was also decoded for a real desktop-app session, so the same inspection
works for the owner step below.

Status of the literal owner dogfood step (install into the running Desktop profile, restart, GUI
Discover, real model-driven skill call): not executed in this session, by owner decision. Installing
into the Electron-owned desktop profile from a shell hosted by the running app is forbidden by the
repository rules (it would stop/restart the Harness and abort the session), and the design's migration
plan (step 4) describes the desktop-profile dogfood as optional. The off-desktop runtime checks above
cover every observable behavior required by the `packaged-skills` scenarios (assembled ruleset,
catalog entry, loaded body plus note, `alwaysOn: false` opt-out, row removal, and exactly one catalog
entry for the full setup), so task 4.3 is recorded against them and the live desktop install remains
an optional owner step for the next release. The owner procedure, if it is ever wanted, is:

```powershell
$dsh = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
# Quit DeepSeek Harness first; run from an external PowerShell.
Copy-Item "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml" "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml.bak"
& $dsh plugin --profile desktop add '<checkout>\packages\plugin-ponytail'
# Start the app, open a NEW session, send: /ponytail reply with exactly PONG; then quit the app.
node .tmp\inspect-session.mjs (newest session.v4.jsonl.zstd) check
# Expect the same facts as scenario 1. Repeat with the documented profile-patch overrides
# (alwaysOn: false, then disabled: true) and finally with '<checkout>\packages\setup'
# (exactly one catalog entry / footer). Restore cordis.patch.yml and remove the installed bundle.
```

## 4.4 Release dry-run

The next set version after `v0.1.6` is `0.1.7`; the bump was attempted and reverted because this
change is not being released in this session (the full sequence was run twice: once before and once
after the metadata/test corrections, with identical results).

```sh
pnpm release:prepare --version 0.1.7   # exit 0; gen: wrote 23 files for 2 plugin(s)
pnpm build                             # exit 0
pnpm gen                               # exit 0 (no further change)
pnpm check                             # exit 0, 111 tests
pnpm gen:check                         # exit 0, 23 generated files match
pnpm validate:repo                     # exit 0, 98 files, 2 plugins, no problems
pnpm validate:composition              # exit 0, setup bundle composes
node scripts/generate-market.ts --output .tmp/market-ponytail-44b   # exit 0
```

- Release diff was limited to version fields: `package.json`, both plugin manifests, the setup
  manifest (version plus the two dependency pins), and the two vendored `package.json` copies. No
  sources, generated patches, lockfile, or build output changed. The only other (pre-existing)
  non-version line in the diff is the unrelated `dogfood` script entry from the parent change.
- Market dry run: 3 plugin(s), 3 listed version(s); `@dsh-setup/plugin-ponytail` is listed at
  `0.1.7` with the `en` title `Ponytail`, the `en` description (now naming the source URL), the
  relative icon `icons/dsh-setup-plugin-ponytail.svg`, the git source path
  `packages/plugin-ponytail` at the change commit, and `engines.dsh: >=0.2.1-rc.3 <0.3.0`.
- Revert: the root manifest was restored from a snapshot and the release-touched generated manifests
  from git; afterward every tracked file was SHA-256-identical to the pre-dry-run snapshot, the
  `git status --porcelain` output matched the pre-dry-run output, `pnpm gen:check` passed, and
  `pnpm build` left the tree unchanged. The market dry-run directory was removed.

## Post-audit corrections folded into this record

An independent read-only audit of the implementation found no blocking gaps but listed four minor
mismatches between the artifacts and the implementation; each was fixed and re-verified:

- Display metadata now links the upstream source (the market description ends with
  `github.com/DietrichGebert/ponytail`), matching the spec's attribution requirement and design D6;
  `pnpm gen` regenerated the vendored copy and generation is verified.
- The proposal no longer claims an extra `portable-setup` delta for single-bundle installation; that
  behavior needs no requirement change, and the new `packaged-skills` capability specifies it.
- "Atomic write" wording in the proposal, design, and task 1.2 now matches the update script
  (all files validated before writing, staged files renamed into place; failed fetch or validation
  leaves the previous pin untouched).
- Tests were tightened to the checked claims: a missing skill name case, license CRLF and oversize
  cases, the exact committed copyright line in the offline provenance test, and literal equality of
  the loaded skill body plus adapter note.

## Final committed state

The implementation is committed as `d099146` (feature), `11e514d` (display metadata and test
hardening), and the commit that records this note. A pristine worktree at that tip passed the
CI-equivalent sequence: `pnpm install --frozen-lockfile`, `pnpm build`, `git diff --exit-code`,
`pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm validate:repo` — all exit 0.
The unrelated `add-portable-dsh-setup` working-tree changes were preserved and not committed as part
of this change.

## OpenSpec validation

`openspec validate add-ponytail-skill-plugin --type change --strict` reports the change as valid. It
also prints the expected advisory recorded in the workflow follow-up: archiving this change is
refused until the parent `add-portable-dsh-setup` deltas are synced, because
`specs/portable-setup/spec.md` here is a MODIFIED delta against a spec that does not exist yet.
