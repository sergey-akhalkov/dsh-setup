# OpenSpec status

The accepted requirements live in `openspec/specs/*/spec.md`; this page records how they got there,
which archive entry holds the history, and the owner follow-ups that outlive a change.
[AGENTS.md](../AGENTS.md) carries the workflow summary. Active changes under `openspec/changes/` are
not part of this history until they are archived.

## Accepted requirements and change history

`openspec/config.yaml` requires **English** for all artifacts and keeps structural headings and
SHALL/MUST keywords in English. The main specs under `openspec/specs/` hold the accepted
requirements: `portable-setup` and `plugin-market` were synced from the parent change on 2026-10-25,
the archived `2026-10-25-add-ponytail-skill-plugin` change added `packaged-skills` plus its
`portable-setup` amendment, an earlier change added `mcp-adapters` and amended `portable-setup`'s
dependency-containment requirement, the archived `2026-10-26-add-nuphus-mcp-plugin` change added the
strict-confirmation requirement to `mcp-adapters`, the archived
`2026-10-26-add-working-ruleset-plugins` change added `session-guidance` and relaxed `mcp-adapters`'
approved-adapter-target rule so a code-bearing bundle may mount the approved adapter row, the
archived `2026-10-26-add-openspec-skills-plugin` change added `openspec-skills` and the packaged
`@dsh-setup/plugin-openspec` bundle, the archived `2026-10-26-add-delegation-rules` change added
`delegation-rules` and `codex-subagent`, the archived
`2026-10-26-add-codex-bundle-and-target-options` change bundled the Codex CLI and added per-target
model/reasoning effort, the archived `2026-10-26-fix-delegation-thread-scope` change scoped the gated
reviews to the change's owning thread, and the archived
`2026-10-26-fix-delegation-async-and-review-session` change made review delegation asynchronous with
explicit task selection, stable reviewed inputs, and Codex review-thread reuse. The archived
`2026-10-27-add-one-line-installer` change added the one-line install and update contract to
`portable-setup`: the documented pipeline form must not terminate the caller's session, rerunning the
command updates to the newest release, and the installer verifies the resolved version against the
installed one. The archived `2026-10-27-fix-delegation-foreign-change-digest` change made the
turn-start baseline and the turn-end snapshot owner-only and moved missing or unreadable change
artifacts out of the worktree digest into a per-change hint that names the change and its owner. An
archived 2026-10-28 change added the optional `disabled` fragment row field and amended
`session-guidance` and `mcp-adapters`, and the archived `2026-10-28-add-goal-continuity` change added
`goal-continuity`, the loop-guard machine-readable abort cause, and the goal-round guidance in
`session-guidance`. The archived `2026-10-28-lazy-only-mcp-servers` change made both MCP bundles
guidance-only and configured `nuphus-mcp` and `serena` in the shipped lazy row: no static
`@deepseek-ai/dsh-mcp-client` row is mounted, the dogfood check treats the retired
`dsh-setup-nuphus-mcp`/`dsh-setup-serena` rows as absentable, and the Serena trigger is narrowed to
large-file/cross-file refactors at 200 estimated tokens. Its live one-home guard check (task 6.4) is
deferred to a future throwaway-profile session.

The latest archived changes on 2026-10-29 are `add-hindsight-memory`, which added the bundled Hindsight
memory integration and the `hindsight-memory` spec, `add-goal-block-review`, which added the
goal-continuity block-review gate, the read-only `goal-reviewer` preset, and the user-only blocker
guidance to `session-guidance`, `adopt-agent-best-practices`, which added the `verification-gate`
bundle, the AGENTS.md instruction budget and its split into `docs/contributing.md` and this page, the
plan checkpoint, and the parallel-writer isolation guidance, and `fix-delegation-review-build-inputs`,
which made the reviewed worktree inputs the git-visible set. `add-hindsight-memory` tasks record 25/28
and the three live owner checks (clean-machine install, isolated-profile acceptance, live desktop
install) remain open. Earlier archived changes on 2026-10-28 are `add-goal-continuity`, `add-lazy-mcp`,
and `ship-serena-disabled`. Archived changes on 2026-10-27 are `add-admin-indicator` (authenticated
shortcut POST with native Toast; restart behind the default-off `restart` row flag pending live UAC
verification), `add-loop-guard`, `fix-delegation-session-scope`, `fix-delegation-test-run-flake`, and
`publish-first-market-index`. Cite `openspec/specs/` for accepted requirements and an archived
change's delta specs for its history.

Before archiving, the parent delta restated `Dependency-contained plugins` and `No secrets or machine
data` as MODIFIED with the current main-spec text (the later amendments), so the archive applied
without spec changes.

## Archive index

Every directory under `openspec/changes/archive/`, with its recorded task count at the time this page
was written (2026-10-29). Read the entry's `proposal.md` and `design.md` for what it changed, and its
`tasks.md` for the open boxes.

| Change                                               | Recorded tasks |
| ---------------------------------------------------- | -------------- |
| `2026-10-25-add-ponytail-skill-plugin`               | 15/15          |
| `2026-10-26-add-codex-bundle-and-target-options`     | 15/19          |
| `2026-10-26-add-delegation-guidance`                 | 6/6            |
| `2026-10-26-add-delegation-rules`                    | 51/61          |
| `2026-10-26-add-nuphus-mcp-plugin`                   | 8/8            |
| `2026-10-26-add-openspec-skills-plugin`              | 16/16          |
| `2026-10-26-add-portable-dsh-setup`                  | 32/35          |
| `2026-10-26-add-rtk-token-workflow-guidance`         | 12/12          |
| `2026-10-26-add-serena-always-on-guidance`           | 11/11          |
| `2026-10-26-add-serena-mcp-plugin`                   | 11/11          |
| `2026-10-26-add-working-ruleset-plugins`             | 21/21          |
| `2026-10-26-fix-delegation-async-and-review-session` | 8/10           |
| `2026-10-26-fix-delegation-thread-scope`             | 6/8            |
| `2026-10-27-add-admin-indicator`                     | 12/12          |
| `2026-10-27-add-loop-guard`                          | 19/19          |
| `2026-10-27-add-one-line-installer`                  | 8/8            |
| `2026-10-27-fix-delegation-foreign-change-digest`    | 4/4            |
| `2026-10-27-fix-delegation-session-scope`            | 14/14          |
| `2026-10-27-fix-delegation-test-run-flake`           | 4/4            |
| `2026-10-27-publish-first-market-index`              | 8/8            |
| `2026-10-28-add-goal-continuity`                     | 22/24          |
| `2026-10-28-add-lazy-mcp`                            | 29/29          |
| `2026-10-28-lazy-only-mcp-servers`                   | 25/26          |
| `2026-10-28-ship-serena-disabled`                    | 5/5            |
| `2026-10-29-add-goal-block-review`                   | 17/18          |
| `2026-10-29-add-hindsight-memory`                    | 25/28          |
| `2026-10-29-adopt-agent-best-practices`              | 20/21          |
| `2026-10-29-fix-delegation-review-build-inputs`      | 11/11          |

## Review approval: the v0.12.0 exception and the pre-cutoff baseline

The repository opts in to the archive approval gate with `openspec/review-approval.json`
(`archiveGate: true`, `taskRule: task-review`, cutoff `v0.12.0`). `pnpm reviews:check --all` reports
two accepted, non-enforced categories and enforces everything else:

- **The v0.12.0 exception**: the three changes archived at the `v0.12.0` tag carry no per-task
  portable records and are not backfilled: `add-goal-block-review` (17 checked tasks),
  `adopt-agent-best-practices` (20), and `fix-delegation-review-build-inputs` (11) — 48 checked tasks
  in total. Their evidence is a post-hoc integration review `PASS` for each change (verdict `PASS`,
  target `codex-subagent`) in the `review-v0-12-0` git worktree's
  `.dsh/delegation/integration-review/<change>/integration.json`, after the fixes on branch
  `review-v0-12-0` (`6b4e4f9 fix: address v0.12.0 integration review findings`). The worktree
  evidence is not copied into this repository.
- **The pre-cutoff historical baseline**: every archive whose first archive commit is an ancestor of
  the `v0.12.0` tag is reported with its checked-task count and no retroactive records, and is not
  enforced. `add-hindsight-memory` (25 checked tasks) is the most recent of these; the `--all` output
  lists the whole baseline.

A change archived after the cutoff, or a later modification of any archive, is checked under the
normal rule and fails without a portable task-review `PASS` for every checked task. The rule, the
portable record, and the audit commands are in [review-approval.md](review-approval.md).

## Open owner follow-ups

The archived parent change (`2026-10-26-add-portable-dsh-setup`) tasks record 32/35. Open owner
follow-ups: 7.1 first published release/tag verification, 7.4 second release update visibility, 8.1
clean-machine rehearsal. (7.2 dogfood verification, 7.3 commit-pinned throwaway-profile install, and
9.4 the committed `pnpm dogfood` command are done.) Keep `docs/` consistent with spec changes; the
design's D8 layout is stale about the Client bundle path (actual: `lib/client.js`, not
package-root `client.js`). Trust the code and [plugins.md](plugins.md).

The archived `2026-10-27-add-one-line-installer` tasks record 8/8; its remaining owner step is a live
run of the documented one-liner from an external PowerShell window, after the dogfood round-trip
against a copy of the desktop profile passed.

The archived `2026-10-27-fix-delegation-foreign-change-digest` tasks record 4/4; its Host fix is in
the committed `lib/` and the vendored setup copy, so a linked profile picks it up after a full
restart, while other machines need a separate release of the setup bundle.

The archived `2026-10-28-add-goal-continuity` tasks record 22/24; the open 8.2 live owner acceptance
was partially run (post-restart load, pause/resume, and goal-driver continuation passed; the non-goal
Stop, restart-default, and terminal-stop checks were not all exercised) and the optional 8.3
forced-reset check was not run. The plugin is in the setup bundle; completing live acceptance remains
an owner follow-up.

The archived `2026-10-26-add-delegation-rules` tasks record 51/61; the open 8.x tasks are the live
DSH-profile acceptance (real review/patch/gate/non-Codex target). Codex sign-in, a completed
app-server turn, and the standalone `.cmd`/`.exe`/PATH/status probe are verified. The final delegation
Host was edited after its recorded 3.3 live acceptance, so a live re-acceptance of the final Host
remains an owner follow-up.

The archived `2026-10-29-add-hindsight-memory` tasks record 25/28; the open 4.7, 6.2, and 6.5 checks
are the clean-machine install, isolated-profile live acceptance, and live desktop install
respectively.

The archived `2026-10-29-add-goal-block-review` tasks record 17/18; the open 6.3 live owner acceptance
needs a full quit and relaunch after the release: a real goal with an authorized code alternative
continues on a denied block, a genuine restart block is allowed with the exact action, a standing grant
prevents a repeated permission block, a premature goal-round block spends no review, a below-threshold
direct-human continue turn is reviewed, the reviewer allowlist excludes global mutation tools, and the
local record is present.

The archived `2026-10-29-adopt-agent-best-practices` tasks record 20/21; the open 5.3 live owner
acceptance needs a full quit and relaunch plus `commands` on the profile row: a source edit without a
successful check is refused with the named command, a successful check allows the close, and the ninth
consecutive refusal closes with the unverified notice.

The archived `2026-10-29-fix-delegation-review-build-inputs` tasks record 11/11; the remaining owner
step is the live re-acceptance on the affected Rust repository. After a release and install, run two
task-review delegations while `cargo check` runs and confirm two `PASS` results with the second reused
from its record.
