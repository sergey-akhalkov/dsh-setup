# Issue triage acceptance

Reviewable acceptance evidence for the `add-issue-triage-skill` change: the packaged `issue-triage`
skill body run against the `gh` stub that ships beside it. Recorded on 2026-11-25 on Windows with
Node 24.18.0, pnpm 11.28.5, and the schema `spec-driven` change artifacts. This page lives outside
the change directory on purpose: recording it here does not move the change digest a spec review
binds.

The stub is `packages/plugin-issue-triage/test/fixtures/gh-stub/`: `gh.cmd` plus `gh.js` (a Windows
shim only), a fixture inventory, and a write-path scenario. It never reaches the network.
`GH_STUB_LOG` appends one JSON line per invocation with the arguments and the exit code,
`GH_STUB_ISSUES` selects the fixture, `GH_STUB_STATE` persists posted comments and closes, and
`GH_STUB_EXIT` simulates a broken or unauthenticated `gh`.

The change was proposed against seven open issues; the backlog held eleven on 2026-11-25 (#1, #9,
#13-#21), and the run read the current set, which is what the procedure is defined to read.

## Run 1: preflight, inventory, and verdicts (read-only)

The stub directory was first on `PATH`, `GH_STUB_LOG` pointed at `.tmp/issue-triage-acceptance/read.log`,
and `GH_STUB_ISSUES` was left at the default inventory.

```text
## preflight: gh auth status
github.com
  ✓ Logged in to github.com account stub (GH_TOKEN)
  - Active account: true
## preflight: gh repo view --json nameWithOwner
repo: {"nameWithOwner":"sergey-akhalkov/dsh-setup"}
## preflight: openspec list --json (active changes)
add-issue-triage-skill, add-releases-and-discover-screenshot, rebrand-to-dsh-studio, add-worktree-cleanup
## inventory: gh issue list --state open --limit 1000
open issues: 11
## existing links: git grep -n "Fixes #" -- openspec/changes
openspec/changes/add-releases-and-discover-screenshot/proposal.md:12:Fixes #1
```

The grep also matched archived change artifacts (`openspec/changes/archive/close-issues-on-release`).
Those are historical: only the active-change match is a live link, and `openspec list --json`
resolved the four active names above.

The run then read every issue with
`gh issue view <n> --json number,title,body,state,labels,comments` and derived one verdict per issue
from repository evidence: source and workflow files, `.gitignore` and `biome.json`, the run history
in the issue bodies, and the full test suite (3367 tests in 183 files, 164.3 s, exit 0).

### The stub log

Fourteen invocations: `auth status`, `repo view --json nameWithOwner`, `issue list --state open
--limit 1000 …`, and eleven `issue view` calls, one per issue. Each required preflight and inventory
read is present exactly once, and **mutating calls: 0** (`issue comment`, `issue close`,
`issue edit`). No issue was closed and no comment was posted.

### Backlog completeness beyond one page

`gh issue list` has no `--paginate` flag (the installed CLI exits 1 with `unknown flag: --paginate`),
so the inventory uses `--limit` and raises it when the read hits the limit. A generated 101-issue
fixture at `.tmp/issue-triage-acceptance/backlog-101.json` drove the sequence:

```text
page at limit 100: 100
raised to limit 1000: 101 (below the limit, so the inventory is complete)
logged: issue list --state open --limit 100 --json number | issue list --state open --limit 1000 --json number
```

The stub mirrors the real contract: it honors `--limit`, caps the read at it, and refuses
`--paginate` with the same message. The skill body requires the raised read before any verdict, and
`test/skill-content.test.ts` rejects any `--paginate` in the body.

### Verdict table

Ordered by severity: gate-breaking, visible breakage, then flake, then the closures.

| Issue | Verdict      | Evidence                                                                                                                                                                                                                                      | Change or draft                         | Next step                                                |
| ----- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| #20   | needs-change | `packages/plugin-workflows/src/host/index.ts:5421` refuses a VCS command that names an archived path; reproduced when a `git log … -- openspec/changes/archive/<name>` call was refused with `the archive command could not be parsed safely` | draft `guard-command-text-is-data`      | promote the draft                                        |
| #9    | needs-change | the same parser; the issue reproduces it with a `git commit -m` body that names the change path and the word archive                                                                                                                          | draft `guard-command-text-is-data`      | promote the draft                                        |
| #15   | needs-change | probe: a `.huashu-design/probe.md` file makes `pnpm exec biome check .huashu-design` report 1 error and `pnpm lint` exit 1, although `.gitignore:31` lists the directory (Biome's `files.includes` does not)                                  | draft `skip-ignored-local-artifacts`    | promote the draft                                        |
| #17   | needs-change | `scripts/lib/scan.ts` `SKIP_DIRECTORIES` has no `.agents` and the walk has no `.gitignore` awareness; `.agents/worktrees/verify-quiet-gate` held only `.dsh` state today, so the machine-path failure is latent                               | draft `skip-ignored-local-artifacts`    | promote the draft                                        |
| #16   | duplicate    | byte-identical to #17 (same title and body); `docs/openspec-status.md:1144` references #17, and no artifact links #16 with a `Fixes`/`Refs` line (it is named only in prose)                                                                  | —                                       | close now (proposed; not executed in this read-only run) |
| #21   | needs-change | `.github/workflows/release.yml` uploads the Pages artifact (`upload-pages-artifact@v3`) then deploys (`deploy-pages@v4`) with no retry or stale-artifact cleanup; v0.59.0 run 45590026312 failed twice                                        | draft `release-pages-artifact-race`     | promote the draft                                        |
| #18   | deferred     | the archived `stop-close-steer-loops` bounds the refusal (`Refs #18`) but does not add the "a current PASS satisfies a fully checked plan" rule in `packages/plugin-workflows/src/host/engine-gates.ts`                                       | deferred: visible breakage, cap reached | re-rank next run                                         |
| #14   | deferred     | the fixed 10 s poll is still at `packages/plugin-workflows/test/recovery-completion.test.ts:176`; the v0.54.0 release failed twice on it                                                                                                      | deferred: flake tier, cap reached       | re-rank next run                                         |
| #19   | deferred     | three failing `pnpm test` runs named tests in `packages/plugin-workflows/test/host-wiring.test.ts` and `review-host.test.ts`; no failure reproduces now                                                                                       | deferred: flake tier, cap reached       | re-rank next run                                         |
| #13   | needs-info   | the CI failure in host-wiring `run admission at capacity` does not reproduce locally (the same suite passed today); the issue names the rerun as the deciding step                                                                            | —                                       | rerun run 45023098137; close as a flake if green         |
| #1    | tracked      | `openspec/changes/add-releases-and-discover-screenshot/proposal.md:12` carries `Fixes #1`, and the change is active with 14/14 tasks                                                                                                          | `add-releases-and-discover-screenshot`  | wait for the archive and the release closeout            |

### Items closed in this run

None. Run 1 is read-only by design; the proposed closure is #16 (duplicate of #17), and it stays
open in the stub inventory.

### Clustering and the cap

Five `needs-change` issues formed three path clusters, the cap:

- `guard-command-text-is-data` — #9 and #20, both fixed in `packages/plugin-workflows/src/host/index.ts`
  (the pre-execute archive parser). Gate-breaking: it blocks ordinary commits and staging.
- `skip-ignored-local-artifacts` — #15 and #17, one ignore policy across `biome.json`, `scripts/lib/scan.ts`,
  and `scripts/validate-repo.ts`. Gate-breaking for a working checkout: `pnpm lint` and the validators
  disagree with CI.
- `release-pages-artifact-race` — #21, `.github/workflows/release.yml`. Visible breakage: a release
  needed two manual recovery steps.

Deferred beyond the cap: #18 (visible breakage, mitigated by the shipped per-turn bound) and the flake
cluster #14/#19 (tier last). #13 is `needs-info`, so it belongs to no cluster.

## Run 2: the write path with the stub

`GH_STUB_ISSUES` pointed at `packages/plugin-issue-triage/test/fixtures/gh-stub/scenarios/write-path/issues.json`
(#16 duplicate, #17 canonical with an owner comment, #99 a usage question), `GH_STUB_STATE` at
`.tmp/issue-triage-acceptance/write-state.json`, and `GH_STUB_LOG` at `…/write.log`.

### Transcript 1 — duplicate close, marker link, invalid without an owner answer

```text
### Run 1
github.com
inventory: 16, 17, 99
#17 comments before the marker check: 1
(#16 and #17 share the title and both are open)
https://example.invalid/issues/16#issuecomment-stub
✓ Closed issue #16
https://example.invalid/issues/17#issuecomment-stub
state after run 1: {"comments":{"16":["<!-- dsh-setup:change=none --> Duplicate of #17. Closing this one; the canonical issue carries the fix."],"17":["<!-- dsh-setup:change=ignored-artifacts --> Tracked in ignored-artifacts. Scope: repository checks must skip ignored local artifacts. Next step: promote the draft."]},"closed":{"16":"duplicate of #17"}}
```

Log:

```text
auth status
issue list --state open --limit 1000
issue view 17 --json number,comments
issue view 16 --json number,title,state
issue view 17 --json number,state
issue comment 16 --body <!-- dsh-setup:change=none --> Duplicate of #17. Closing this one; the canonical issue carries the fix.
issue close 16 --duplicate-of 17
issue comment 17 --body <!-- dsh-setup:change=ignored-artifacts --> Tracked in ignored-artifacts. Scope: repository checks must skip ignored local artifacts. Next step: promote the draft.
issue view 99 --json number,title,state
```

Assertions: nine calls, exactly one close — #16 with `--duplicate-of 17`, which is the reason the
spec requires; both comments carry the required marker (the duplicate close `change=none`, the #17
link `change=ignored-artifacts`); **zero mutating calls on #99** (one view, no comment or close),
because an `invalid` verdict waits for the owner's answer and the run asked in the report instead.

### Transcript 2 — the rerun over the same marker

```text
### Run 2
marker found: True -> <!-- dsh-setup:change=ignored-artifacts -->
### Rerun log
issue view 17 --json number,comments
issue view 16 --json number,state
rerun mutating calls: 0
```

The rerun read both issues and posted nothing: the marker on #17 suppressed a second triage comment,
and the closed state on #16 suppressed a second close.

## Verification

- `pnpm exec vitest run packages/plugin-issue-triage/test` — 28 tests in 3 files pass: the skill
  content pins every section, the verdict vocabulary, the evidence rule, the supported complete
  inventory, the closes, the cap, the drafts path, the promotion call, the subagent brief, the four
  templates, the report columns, and the worked example's placeholders; the provider test pins the
  catalog candidate, the frontmatter description, the adapter note, no import-time registration, and
  the generated enabled row; the stub test pins PATH precedence, the exit code, the recorded
  arguments, the `--limit` cap, the `--paginate` refusal, and the persisted comment.
- `pnpm validate:composition` — exit 0 against DSH 0.2.2-rc.2, including the new `issue-triage` steps:
  the setup composes the row enabled with no configuration, and a profile patch with `disabled: true`
  composes it disabled. That is the real loader's decision that keeps the skill out of the catalog,
  which a unit test cannot observe.
- `openspec validate add-issue-triage-skill --strict` — valid.

## Full gate

Recorded on a worktree whose tracked files are clean (only untracked review records remain), so `git diff --exit-code` is exact.

| Command                                | Result                                               |
| -------------------------------------- | ---------------------------------------------------- |
| `pnpm build`                           | exit 0; 22 workspace packages, 4 client bundles      |
| `git diff --exit-code` after the build | exit 0 — the build wrote no tracked file             |
| `pnpm gen:check`                       | exit 0; 713 generated files match for 22 plugins     |
| `pnpm typecheck`                       | exit 0 — no errors                                   |
| `pnpm lint`                            | exit 0 — warnings and infos only, no errors          |
| `pnpm test`                            | exit 0; 183 files, 3367 tests (164.3 s)              |
| `pnpm validate:repo`                   | exit 0; 1462 files scanned, 22 plugin packages, none |

## What this does not prove

- The stub is not GitHub: it proves which calls the procedure makes, not that GitHub accepts them.
  It mirrors the installed CLI for the flags it exercises — `--limit` caps the read, `--duplicate-of`
  is recorded, and `--paginate` is refused — but the real binary owns the network and the pages.
- The verdicts are one lead's judgement over the evidence above. A worker never decides a verdict, and
  no worker ran in this acceptance, so the subagent brief is pinned by content only.
- The acceptance ran no drafts: a draft is the owner's commitment, and this read-only run recorded the
  three cluster names and paths instead of writing `.dsh/workflows/drafts/<name>/`.
- Run 1 used the current eleven issues rather than the seven the change was proposed against.
