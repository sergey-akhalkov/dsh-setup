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

The `add-task-lane-guidance` change added the portable task-lane guidance addendum to
`openspec-skills`: the propose, update-change, and apply-change bodies append a plugin-owned asset
outside the pinned directory before the adapter note, the release-pinned update contract now
distinguishes vendored upstream content from plugin-owned runtime additions, and the change carries
9/9 portable task approvals. The temporary project-local lane rule in `openspec/config.yaml` was
removed.

The archived `2026-10-30-add-lane-boundary-gate` change carries 8 tasks and 8/8 portable task
approvals; it extends `@dsh-setup/plugin-delegation-rules` inside the existing plugin rather than
adding a row or a plugin: `lane-boundary` becomes the seventh trigger, the shipped `lane-fanout`
note rule turns a completed `tasks.md` lane into a fan-out decision, the steer prints one ready
`subagent` call per remaining lane, and the ordinary `task_progress` note is the serial escape.
Lane shape comes from the level-2 headings the task-lane guidance already requires, and parsing
fails open on a plan without lanes. The setup composition is unchanged.

The archived `2026-10-30-add-snapshot-task-review` change carries 9 tasks and 9/9 portable task
approvals; it moves a task-scoped review onto an immutable detached-worktree snapshot built from the
exact review input set and a frozen change directory, so a write during a run no longer discards the
verdict. The digest is the content tree plus the frozen artifact digest, the lease-backed snapshot
lifecycle removes the checkout on settle and sweeps leftovers, and the live-worktree mutation guard
remains for whole-scope reviews and the fallback. It ships inside
`@dsh-setup/plugin-delegation-rules` with no composition change.

The archived `2026-10-30-fix-delegation-review-fallback` change carries 5 tasks and 5/5 portable task
approvals; it keeps the reviewed change's `reviews/` approval directory out of the Git-visible
reviewed input set, so a portable task `PASS` can no longer discard a concurrent live or fallback
review with `reviewed inputs changed`. A skipped task snapshot now names its bounded reason in the run
detail while it runs and after it settles, including the missing `.dsh/` ignore rule and its fix, and
the default `timeouts.review` rises from 10 to 20 minutes. It ships inside
`@dsh-setup/plugin-delegation-rules` with no composition change.

The 2026-10-29 changes archived with release v0.13.2 are `add-review-approval-gate`, which added
portable task approvals, change-level coverage, the archive gate, and the pre-push/CI audit
(`review-approval` spec and `delegation-rules` amendments; 24/24 portable PASS records),
`add-hindsight-export`, which added the default-on durable export to a private Git repository and the
manual restore path (`hindsight-memory` amendments; 18/18 records), and `add-codex-advisor-rule`,
which added the manual advisor rule and the shipped strong Codex targets (`delegation-rules`
amendments; 6/6 records). The Hindsight change's owner acceptance used a throwaway Hindsight home and
a dedicated pg0 database, and the live configuration exported and pushed three banks; the installed
desktop profile remains at 0.12.0 until the owner installs 0.13.2.

Release workflow retries: the v0.13.0 tag failed the CI unit tests on the restore short/long
checksum walk and the missing push-rebase identity; v0.13.1 fixed the identity but the restore tests
still failed on short (8.3) Windows paths; v0.13.2 derives archive-relative entries from the bank
folder name and is the published release. The v0.13.0 and v0.13.1 tags remain failed, unpublished
tags.

Before archiving, the parent delta restated `Dependency-contained plugins` and `No secrets or machine
data` as MODIFIED with the current main-spec text (the later amendments), so the archive applied
without spec changes.

The changes archived on 2026-10-30 are `add-answer-page-skill`, which added the `answer-pages`
capability and the `@dsh-setup/plugin-answer-page` bundle (the vendored `answer-me-with-html` v0.5.10
skill with its `am.mjs` runtime and license, workspace-only `.tmp/answers/` output, an offline render
with the update check disabled, and a scan exception bounded by the provenance lock) and amended
`packaged-skills` so an always-on ruleset is optional and the vendored runtime and license are part of
the pin; `add-effort-tiers`, which added the shipped `reasoningEffort: max` owner default and the
`worker-fast`/`worker-deep` in-process worker targets with two manual `answer` rules and a selection
policy in the bundled skill; `add-goal-round-retro`, which added the goal-continuity speed review
(round cost metrics, one read-only review child per qualifying goal round, a bounded next-round brief,
a follow-through gate, the shared `goal-reviewer` preset, and the `speedReview` off switch); and
`add-lane-assignment-ledger`, which added the `lane-assignment` trigger with a session-scoped lane
ledger, `lane-tag` worker evidence, a per-lane `task_progress` serial escape, and the deprecation of
`lane-boundary` while the shipped `lane-fanout` rule moves to the new trigger.

The archived `2026-10-31-add-observability` change carries 19 tasks and 19/19 portable task
approvals; it added the `observability` capability and the `@dsh-setup/plugin-observability` bundle: a
Conversation dashboard derived on demand from session logs (health verdict, KPI strip, activity/error
chart, plugin health cards grouped by attention, tool distribution, collapsed blind spots, and at most
five metadata-only recent traces per row), the shipped per-plugin signal map in the setup owner
defaults, and the abort-token rule that keeps streamed model text out of row ids and labels. It amends
`portable-setup` with the signal-map default and adds no telemetry pipeline or second log.

The archived `2026-10-31-add-observability-outcomes` change carries 35 tasks and 35/35 portable task
approvals (the owner verified the view in the running Desktop app after an external install); it
extended the `observability` capability from a signal dashboard into an outcome view derived from the
same session logs: episodes from human messages with the configurable idle gap and joined subagent
children, window accounting by start versus work by event time with cutoff labels, token and cost
metrics with coverage, quality/speed/autonomy summaries, scorecards with goals and eligibility matched
cohorts, baselines (previous equal window or previous completed session), the declarative hypothesis
catalog with guardrails and per-window evaluation, data-quality coverage, the serial-long-run attention
finding, and the four sub-views (Overview, Plugins, Tasks, Hypotheses). It also added the shipped row
goals, eligibility predicates, and two default hypotheses to the setup owner defaults, and bounded the
view's cost: the hypothesis windows load only for their tab, the session baseline probe stops at the
first completed candidate, and a short-lived report cache serves a repeated view switch. The delta
added 16 and modified 7 requirements in `openspec/specs/observability/spec.md`; the owner follow-up is
the archive index entry below.

The archived `2026-10-31-add-observability-outcomes` change carried the performance follow-ups as
commits on top of the reviewed tasks (lazy hypothesis windows, the bounded baseline probe, the report
and client caches, and the Overview's masonry layout), so its review records cover the change text
while the follow-ups are recorded in the git history (`a7143ad`, `d24ccee`, `16a6dd6`).

The changes archived on 2026-10-31 are `improve-observability-actionability`, which sharpened
`observability` into an action surface: a failure list with severity (`turn failure`, `turn cut`, `tool
failure`) and per-turn recovery, session titles, per-tool call outcomes that keep the failing share
inside the call count, inspector/session/prefilled-draft actions with copy-only degradation, declared
`trigger` sentences and `mounted` readiness for shipped rows checked against the live prompt and skill
registries, and proportional stacked tool bars (15 tasks, 15/15 portable approvals; the owner verified
the view in the running Desktop app), and
`replace-rare-triggers-with-work-checkpoints`, which removed the goal-continuity speed review and the
shipped `task-progress`/`lane-fanout` delegation rules, and added the `work-checkpoints` capability
delivered by the existing goal-continuity bundle: the substantial-pause trigger and bounded non-waking
request, the `work_checkpoint` tool with its atomic local record, the close gate with the shared
`UNCHECKED` cap, the parallel-action gate with the tagged-worker or serial-reason escape, the
goal-as-work-unit and checkpoint clauses in the always-on contract within the 1500 estimated-token
budget, and the `work_checkpoint` observability attribution (19 tasks, 18/19 portable approvals).

## Archive index

Every directory under `openspec/changes/archive/`, with its recorded task count at the time this page
was written (2026-11-10). Read the entry's `proposal.md` and `design.md` for what it changed, and its
`tasks.md` for the open boxes.

| Change                                                   | Recorded tasks |
| -------------------------------------------------------- | -------------- |
| `2026-10-25-add-ponytail-skill-plugin`                   | 15/15          |
| `2026-10-26-add-codex-bundle-and-target-options`         | 15/19          |
| `2026-10-26-add-delegation-guidance`                     | 6/6            |
| `2026-10-26-add-delegation-rules`                        | 51/61          |
| `2026-10-26-add-nuphus-mcp-plugin`                       | 8/8            |
| `2026-10-26-add-openspec-skills-plugin`                  | 16/16          |
| `2026-10-26-add-portable-dsh-setup`                      | 32/35          |
| `2026-10-26-add-rtk-token-workflow-guidance`             | 12/12          |
| `2026-10-26-add-serena-always-on-guidance`               | 11/11          |
| `2026-10-26-add-serena-mcp-plugin`                       | 11/11          |
| `2026-10-26-add-working-ruleset-plugins`                 | 21/21          |
| `2026-10-26-fix-delegation-async-and-review-session`     | 8/10           |
| `2026-10-26-fix-delegation-thread-scope`                 | 6/8            |
| `2026-10-27-add-admin-indicator`                         | 12/12          |
| `2026-10-27-add-loop-guard`                              | 19/19          |
| `2026-10-27-add-one-line-installer`                      | 8/8            |
| `2026-10-27-fix-delegation-foreign-change-digest`        | 4/4            |
| `2026-10-27-fix-delegation-session-scope`                | 14/14          |
| `2026-10-27-fix-delegation-test-run-flake`               | 4/4            |
| `2026-10-27-publish-first-market-index`                  | 8/8            |
| `2026-10-28-add-goal-continuity`                         | 22/24          |
| `2026-10-28-add-lazy-mcp`                                | 29/29          |
| `2026-10-28-lazy-only-mcp-servers`                       | 25/26          |
| `2026-10-28-ship-serena-disabled`                        | 5/5            |
| `2026-10-29-add-goal-block-review`                       | 17/18          |
| `2026-10-29-add-hindsight-memory`                        | 25/28          |
| `2026-10-29-add-codex-advisor-rule`                      | 6/6            |
| `2026-10-29-add-hindsight-export`                        | 18/18          |
| `2026-10-29-add-review-approval-gate`                    | 24/24          |
| `2026-10-29-adopt-agent-best-practices`                  | 20/21          |
| `2026-10-29-fix-delegation-review-build-inputs`          | 11/11          |
| `2026-10-29-add-task-lane-guidance`                      | 9/9            |
| `2026-10-30-add-lane-boundary-gate`                      | 8/8            |
| `2026-10-30-add-answer-page-skill`                       | 15/16          |
| `2026-10-30-add-effort-tiers`                            | 11/11          |
| `2026-10-30-add-goal-round-retro`                        | 10/10          |
| `2026-10-30-add-lane-assignment-ledger`                  | 8/8            |
| `2026-10-30-fix-delegation-review-fallback`              | 5/5            |
| `2026-10-31-add-observability`                           | 19/19          |
| `2026-10-31-add-observability-outcomes`                  | 35/35          |
| `2026-10-31-improve-observability-actionability`         | 15/15          |
| `2026-10-31-replace-rare-triggers-with-work-checkpoints` | 18/19          |
| `2026-11-05-guarantee-work-gates`                        | 14/14          |
| `2026-11-05-add-openspec-panel`                          | 18/18          |
| `2026-11-05-widen-dsh-support-to-engine-range`           | 5/5            |
| `2026-11-05-redesign-openspec-panel`                     | 14/14          |
| `2026-11-07-add-workflow-observability`                  | 23/25          |
| `2026-11-07-harden-review-queue`                         | 17/17          |
| `2026-11-07-add-openspec-live-list`                      | 7/7            |
| `2026-11-07-learn-from-review-findings`                  | 23/23          |
| `2026-11-09-add-workflow-obligations`                    | 36/36          |
| `2026-11-09-add-section-scoped-task-review`              | 10/10          |
| `2026-11-09-add-workflow-editor`                         | 24/27          |
| `2026-11-10-retire-legacy-gates`                         | 17/21          |

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
normal rule and fails without a portable task-review `PASS` for every checked task. The three
v0.13.2 archives are post-cutoff and carry 24/24, 18/18, and 6/6 portable PASS records; later
2026-10-29 archives, including `add-task-lane-guidance` (9/9), are checked under the same rule. The
rule, the portable record, and the audit commands are in [review-approval.md](review-approval.md).

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

The archived `2026-10-29-add-review-approval-gate` tasks record 24/24; the full audit, the portable
records, the hook installer, and the CI steps are committed. After installing 0.13.2 externally, run
the live archive-gate acceptance in a throwaway workspace (deny without a portable PASS, allow with
one, and confirm the pre-push/CI refusal), then archive the next change through the live guard.

The archived `2026-10-29-add-hindsight-export` tasks record 18/18. The first real export and push are
recorded at export-repository commit `8178372` (three banks); the owner acceptance used a throwaway
Hindsight home and a dedicated pg0 database and passed. After installing 0.13.2, confirm the automatic
exporter runs in a real session and pushes the project bank; the machine-local export configuration
and the private remote are already validated.

The archived `2026-10-29-add-codex-advisor-rule` tasks record 6/6. After installing 0.13.2, smoke-test
one `delegate(rule: "advisor", ...)` call and confirm the account can use the shipped `codex` /
`codex-write` defaults (`gpt-6-astra`, `xhigh`); override those targets in the profile if the model is
unavailable, leaving `codex-astra` for the advisor.

The archived `2026-10-29-add-task-lane-guidance` tasks record 9/9. After installing v0.15.0, load
`openspec-propose` in a workspace and confirm the task-lane addendum appears before the adapter note;
this live check remains an owner step.

The four changes archived on 2026-10-30 shipped in v0.17.0 (tag on commit `73ae017`) and were
installed on the desktop profile the same day. The live acceptance passed: the profile lists
`@dsh-setup/setup` 0.17.0 and keeps its own `cordis.patch.yml` untouched; the `dsh-setup-answer-page`
row mounts and its `answer-me-with-html` skill appears in the catalog; a real page rendered with the
installed CLI into `.tmp/answers/` (132 KB, presented as a card, with no write under the home or
temporary directory); the delegation status lists `worker-fast` / `worker-deep` and a live
`worker-fast` answer returned; and the installed patch carries `speedReview`, the `goal-reviewer`
preset row, and `lane-fanout` with `lane-assignment`. That satisfies the intent of
`add-answer-page-skill` task 6.2; its archived box stays unchecked because editing an archive would
need its own task-review record. The remaining owner step is the goal-continuity live acceptance: a
real goal with an expensive round that shows the brief, the worker start and the follow-through gate.
The v0.17.0 release workflow passed the published-CLI `validate:composition` and `validate:installer`
steps after one re-run of a flaky `hindsight` export-push test, so the earlier local registry failure
did not affect the release and needs no follow-up.

The `2026-10-30-fix-delegation-review-fallback` change shipped in v0.17.1 (tag on commit `4dd1e0b`)
after the release workflow passed both supported DSH versions and the publish job. The published index
at https://sergey-akhalkov.github.io/dsh-setup/index.json returns HTTP 200, lists
`@dsh-setup/setup` and `@dsh-setup/plugin-delegation-rules` at 0.17.1 with the release commit, and
retains the earlier versions. The owner install of v0.17.1 remains the step that activates the 20-minute
review default and the fallback detail; the live fallback text needs a repository that does not
gitignore `.dsh/`, so it is verified by the shipped tests and awaits the next such repository.

The `2026-10-31-add-observability` change shipped in v0.18.0 (tag on commit `56c5590`) after the release
workflow passed DSH 0.2.1-rc.3 and 0.2.1-rc.5 and the publish job. The published index returns HTTP 200,
lists `@dsh-setup/setup` and the new `@dsh-setup/plugin-observability` at 0.18.0 pinned to that commit,
and retains every earlier setup version. The owner installed the dashboard during the change and
accepted it; installing the published 0.18.0 from the market is the step that keeps the desktop profile
on the tagged build.

The archived `2026-10-31-replace-rare-triggers-with-work-checkpoints` tasks record 18/19; the open 10.3
is the post-install measurement for one to two weeks (eligible turns by the trigger definition, the
checkpointed share, the parallel share and worker-start conversion, the serial rate, UNCHECKED cap hits,
and median steps and wall time against the pre-change baseline), with the keep/tune/revert decision
recorded in its task review. The comparison baseline is `.dsh/work-checkpoint-baseline.json` (gitignored
local scratch): 12 root sessions over 14 days, 21 closed substantial pauses, 10 followed by a next turn,
5 next-turn worker starts, median 51 steps and 967,566 ms. The installed build was verified live before
archiving: the close gate refused a substantial pause with the evidence and the five questions, a
`work_checkpoint` call recorded (and replaced) the same turn file, the parallel gate refused a parallel
declaration by naming its id, and the serial amendment was accepted. The cap and the block-review
coexistence were covered by the shipped tests, as the owner accepted.

The `2026-10-31-improve-observability-actionability` and
`2026-10-31-replace-rare-triggers-with-work-checkpoints` changes shipped in v0.19.0 (tag on commit
`b920e18`) after the release workflow passed DSH 0.2.1-rc.3 and 0.2.1-rc.5 and the publish job. The
published index returns HTTP 200, lists every setup and plugin package at 0.19.0 pinned to that
commit, and retains the earlier versions. The owner's desktop profile runs the code through the linked
setup bundle; installing the published 0.19.0 from the market (or re-running the installer from an
external PowerShell with the app closed) is what makes the tagged build the installed one.

The `2026-10-31-add-observability-outcomes` change shipped in v0.20.0 (tag on commit `0e20823`) after
the release workflow passed DSH 0.2.1-rc.3 and 0.2.1-rc.5 and the publish job, and the `validate`
workflow on `main` passed. The published index returns HTTP 200, lists every setup and plugin package
at 0.20.0 pinned to that commit, and retains the earlier versions. The release also carries the
installer fix that selects the setup bundle last when the CLI adds only the dependency. The owner's
desktop profile runs the code through the linked setup bundle; installing the published 0.20.0 from the
market (or re-running the installer from an external PowerShell with the app closed) is what makes the
tagged build the installed one.

The `2026-10-31-add-goal-question-review`, `2026-10-31-add-process-timeline` and
`2026-10-31-decompose-before-apply` changes were implemented in one session by five parallel lane
workers and committed as `40c0ca8`; the archived tasks record 11/11, 7/7 and 16/16, every checked task
carries a portable task-review PASS (11, 7 and 16 of them), and `openspec archive` synced the deltas
into `goal-continuity` (+3 requirements, 3 modified), `observability` (+2), `delegation-rules` (+2),
`openspec-skills` (1 modified), `session-guidance` (+2) and `work-checkpoints` (+1, 5 modified). The
goal-continuity review now has a second subject: an `ask_user_question` in an active goal round is
denied when an authorized route lets the agent decide (new `blockReview.reviewQuestions`, default
true), records keep the `block` or `question` subject, and the mid-turn checkpoint counts steps per
turn, asks once per `stepInterval` (default 40), requires a `bottleneck` for `continue`, and accepts
only a fresh checkpoint at the close. The observability change adds a pure process timeline, the
process summary, and the Overview panel with its concurrency axis, step-rate strip and summary table.
The gate was green before archiving: `pnpm check` (1469 tests), `pnpm gen:check` (324 files),
`validate:repo`, `validate:composition`, `validate:installer`, `pnpm dogfood`, and a repeat
`pnpm build` plus `pnpm gen` left no diff. Four review rounds returned 12 P1 findings in total, all
fixed with regression tests before their PASS. No release followed; installing the next release from
the market (or re-running the installer from an external PowerShell with the app closed) is the owner
step that activates the shipped defaults.

Those three changes shipped in v0.21.0 (tag on commit `cc178fd`) after the release workflow passed
DSH 0.2.1-rc.3 and 0.2.1-rc.5, the publish job and the Pages deployment, and the `validate` workflow
on `main` passed. The published index returns HTTP 200, lists all 18 setup and plugin packages at
0.21.0 pinned to that commit, and retains the earlier versions. The owner's desktop profile runs the
code through the linked setup bundle; installing the published 0.21.0 from the market (or re-running
the installer from an external PowerShell with the app closed) is what makes the tagged build the
installed one, and it is also the first live check of the question gate and the Process panel.

The `2026-11-02-add-plan-bottleneck-checkpoints` change was implemented in one session by three
lanes (goal-continuity in the lead, the always-on working contract, and observability) and archived
after ten task-review rounds; the archived tasks record 20/20 and every checked task carries a
portable task-review PASS. `openspec archive` synced the deltas into `work-checkpoints` (+4
requirements, 6 modified), `session-guidance` (3 modified) and `observability` (+1, 1 modified).
The checkpoint tool is now v2: a lane plan with owners, scopes, states and blocking ids, a bottleneck
with an executable remedy, a parallel obligation computed from the plan, a bottleneck-age refusal
with a route-change escape, stalled-lane evidence in the request, and a session-wide record revision
that a failed write cannot fake. The `work_checkpoint` schema break rejects `parallel`,
`serialReason`, `remaining` and `speedup` with the replacement named; local v1 records stay
readable. The observability row now derives parallel share, blocked-lane rate, remedy resolution and
dispatch per checkpoint, and exposes `parallel-share` and `remedy-resolution` in the hypothesis
catalog. The gate was green before archiving: `pnpm test` (1600 tests), `pnpm build` with no
diff, `pnpm gen:check` (324 files), `validate:repo`, `validate:composition`,
`validate:installer`, and the change's `openspec validate --strict`. Each review round's P1
findings (path normalization across dot segments, the UNC share and drive roots, redaction versus
match identity, the age rule over owner, blocking set and lane state, failed-write persistence, and
bounded steer content) were fixed with regression tests before their PASS. `openspec validate --all
--strict` still reports long-requirement warnings across existing specs, including
`admin-indicator`; they predate this change and the repository's CI does not run that command.

It shipped in v0.22.0 (tag on commit `e05b8a6`) after the release workflow passed DSH 0.2.1-rc.3
and 0.2.1-rc.5, the publish job and the Pages deployment, and the validate workflow on `main`
passed. The published index returns HTTP 200, lists all 18 setup and plugin packages at 0.22.0 pinned
to that commit, and retains the earlier versions. The owner's desktop profile runs the code through
the linked setup bundle; installing the published 0.22.0 from the market (or re-running the installer
from an external PowerShell with the app closed) is what makes the tagged build the installed one,
and it is also the first live check of the breaking `work_checkpoint` v2 schema and the plan panel.

An installer-only bugfix shipped in v0.22.1 (tag on commit `69cbaa2`). A Hindsight daemon that owned
`127.0.0.1:8888` with a dead embedded database made the Hindsight phase throw "does not answer as
Hindsight. Stop that process", which told the owner to kill the daemon the installer manages and made
every rerun fail the same way; the supplied daemon log showed a competing start stopping the shared
`pg0` while the surviving API kept serving. `install.ps1` now resolves the listener first: an
identified Hindsight daemon is reused when healthy and stopped and started again when unhealthy; a
listener that cannot be identified as Hindsight is still never terminated, and its error now names
the owning process and path. No OpenSpec delta: this restores the documented provisioning behavior
rather than changing a requirement. The release workflow passed DSH 0.2.1-rc.3 and 0.2.1-rc.5, the
publish job and the Pages deployment; the validate workflow on `main` passed; the published index
returns HTTP 200 and lists all 18 packages at 0.22.1 pinned to `69cbaa2`, retaining 0.22.0. The
recovery path is covered by `install.ps1 -SelfTest` and a stub harness over the real
`Start-HindsightDaemon`; the live rerun on the affected PC is the remaining acceptance, since
reproducing the poisoned state here would require stopping the owner's live `pg0`.

An exporter bugfix shipped in v0.22.2 (tag on commit `4a20cab`). Every export cycle left its
transfer archive in the server's `file_storage` because the completed `export_bank` operation that
names the blob was never deleted: the live database held 6,929 archive rows (16 GB) when measured.
The exporter now deletes each completed export operation right after the download and before
unpack, commit and push; a failed delete is reported and retried by the next cycle; each cycle
sweeps completed export operations older than an hour, one page of 100 deletions per bank, walking
past recent pages; and a server without the operation routes is reported once as archive cleanup
unavailable. The change is archived as `2026-11-03-fix-hindsight-export-archive-leak` and its two
requirements are merged into the `hindsight-memory` spec. Review found and the change fixed a
NaN-timestamp sweep case, a full page of recent operations blocking the backlog, and a 404
classification that could swallow a missing route. Acceptance ran on a throwaway `pg0` instance
(archive rows returned to zero after every cycle, the relation stayed flat at 32 kB, a 150-operation
backlog drained 100 then 50, and the documented prune went 88 kB -> 88 kB -> 16 kB); the owner's
live database was only read. The release workflow passed DSH 0.2.1-rc.3 and 0.2.1-rc.5, the publish
job and the Pages deployment; the validate workflow on `main` passed; the published index returns
HTTP 200 and lists all 18 packages at 0.22.2 pinned to `4a20cab`, retaining 0.22.1. Installing the
published 0.22.2 from the market (or re-running the installer from an external PowerShell with the
app closed) is what makes the tagged exporter the installed one; until then the live daemon keeps
accumulating archives, and the manual prune documented in `docs/hindsight.md` reclaims the storage
already consumed.

An export-size change shipped in v0.23.0 (tag on commit `a088a3f`). On the owner's PC the durable
export repository had grown to 3.29 GB while the memory it protects was about 235 MB: `.git` carried
9,065 loose objects (2.85 GB) because every five-minute cycle re-committed the 187 MB
`mental_model_history.json` in full and nothing packed it, and the private remote had been frozen
since 2026-10-31 because that file crossed GitHub's 100 MB blob limit — the last pushed snapshot
carried it at 99.6 MB, the next commit at 101.0 MB, so 398 commits queued locally and every cycle
retried a multi-gigabyte push. The default export scope now drops the per-model refresh history and
the operation log unless `includeHistory` is set, every cycle that holds the repository lock packs
loose objects above 500, and a push whose range carries an over-100 MB blob — or cannot be inspected
— is skipped and reported instead of retried. The change is archived as
`2026-11-03-bound-hindsight-export-growth` and its two modified requirements are merged into the
`hindsight-memory` spec. Review found and the change fixed commit-only packing that skipped failed
and empty-bank cycles, an object-inspection failure that bypassed the guard, and a post-rebase range
that can merge two fitting files into an oversized one. Operational cleanup on the owner's PC:
7,364 orphaned transfer archives deleted and `file_storage` vacuumed (database 19.4 GB -> 292 MB and
19.4 GB -> 1.3 GB on disk at cleanup time), the export repository reset to the last pushed snapshot
and repacked (3.16 GB -> 61 MB), and the still-installed 0.22.0 exporter paused with the export
lock so it stops re-creating either problem. The release workflow passed DSH 0.2.1-rc.3 and
0.2.1-rc.5, the publish job and the Pages deployment; the validate workflow on `main` passed; the
published index returns HTTP 200 and lists all 18 packages at 0.23.0 pinned to `a088a3f`, retaining
0.22.2. Installing the published 0.23.0 (or re-running the installer from an external PowerShell
with the app closed) is what makes the bounded exporter the installed one and resumes the export;
until then the live 0.22.0 keeps its lock, and the new sweep deletes the 51 archives the paused
exporter left in `file_storage`.

The `2026-11-05-guarantee-work-gates` change carries 14 tasks and 14/14 portable task approvals; it
was implemented in one session by three parallel lane worktrees merged into `main`, with the lead
integrating the generated setup tree. It makes the three advisory guarantees machine-checked: the
shipped defaults gain the strict `lane-fanout` rule on `lane-assignment` (one tagged worker per
unassigned multi-lane lane, or a per-lane serial note naming a shared hot file, generated output, or a
serial gate); a `continue` checkpoint with a non-`lead` bottleneck must use `worker_start` or
`user_decision`, a worker start must carry both the checkpoint id and the bottleneck id, and a
checkpoint lane covering a worker-assigned task lane must be non-`lead`; and a portable task-review
PASS is bound to the marker's reviewer (`reviewerProvider: codex-subagent` here), with a `--staged`
archive audit and a tracked pre-commit hook backed by the existing pre-push and CI `--all` audits.
The gate was green before archiving: `pnpm check` (93 files, 1678 tests), `pnpm gen:check` (324
files), `validate:repo`, `validate:composition`, `validate:installer`,
`openspec validate guarantee-work-gates --strict`, and `pnpm reviews:check --all`. Seven review
rounds fixed P1 findings (user_decision remedy evidence, JSON-escaped id matching, completed-lane fire
conditions, unreadable-marker fail-closed and reviewer-bound task selection, staged-audit deletions,
rename sources and non-ASCII paths, and worker-lane path bases) with regression tests before their
PASS. Open owner follow-ups: install the published release so the shipped rule and marker binding are
live, then set `interventionAt` to the archive date and read the Observability process summary after
at least 20 episodes on each side (record the association, not proof). The review-start queue, retro
command, and all-tasks-checked policy remain separate decisions.

It shipped in v0.24.0 (tag on commit `36c356a`) after the release workflow passed DSH 0.2.1-rc.3 and
0.2.1-rc.5, the one-command installer exercise, the publish job and the Pages deployment, and the
validate workflow on `main` passed. The installer round-trip (`pnpm dogfood`) passed against a copy
of the live desktop profile without touching the live profile or the running Harness. The published
index returns HTTP 200, lists all 18 setup and plugin packages at 0.24.0 pinned to that commit, and
retains the earlier versions. The owner installs the published 0.24.0 from the market (or re-runs the
installer from an external PowerShell with the app closed); that install is what activates the shipped
strict lane-fanout rule, the stricter checkpoint remedy, and the reviewer-bound approval audit. Until
then the live desktop profile still runs the pre-change plugin, whose archive and completion gates
cannot parse the new `reviewerProvider` marker field.

The `2026-11-05-add-openspec-apply-picker` change carries 10 tasks and 10/10 portable task approvals.
It adds the plugin's first Client half: `/openspec-apply` opens DSH's native `popupSelect` shell with
one row per unfinished change in the open session's workspace, labeled with the change name and its
`completed/total` task progress, and a pick writes `/openspec-apply-change <name>` into the composer
draft without submitting. The rows come from the read-only, session-scoped
`GET /plugins/dsh-setup-openspec/changes` route, which runs the documented `openspec list --json` CLI
in the session workspace under a 10-second process-tree timeout and reports an ancestor root, a
declared store, or a default store as the no-root error instead of listing another root's changes.
The client half is inert without the client command service and the route stays unregistered on
non-Web hosts, so the six skills still ship everywhere; the new `openspec-apply-picker` spec holds the
requirements. The gate was green before archiving: `pnpm validate` (95 files, 1708 tests),
`pnpm gen:check` (327 files), `pnpm reviews:check --change add-openspec-apply-picker` (10/10 PASS,
archive-ready), `pnpm build && git diff --exit-code` on the committed tree, and `pnpm dogfood`. Review
rounds fixed a missing `lib/change-list.js` packaging entry, a client typecheck error, stale-PID
taskkill safety, cross-platform timeout tests, and a `"root": null` mapping on a non-zero exit. The
live profile's 0.22.0 delegation plugin cannot parse the marker's `reviewerProvider` field, so the
archive used the repository's 10/10 portable audit plus a temporary local marker parse workaround; the
committed marker is unchanged. Open owner follow-up: install the release that carries the picker and
open `/openspec-apply` in a workspace with an `openspec/` root.

It shipped in v0.25.0 (tag on commit `2d87c9b`) after the release workflow passed DSH 0.2.1-rc.3 and
0.2.1-rc.5, the one-command installer exercise, the publish job and the Pages deployment, and the
validate workflow on `main` passed. The first release run failed only the rc.3 unit-test job on two
pre-existing `plugin-hindsight` export-end-to-end timeouts; a full re-run passed and deployed. The
installer round-trip (`pnpm dogfood`) passed against a copy of the live desktop profile without
touching the live profile or the running Harness. The published index returns HTTP 200, lists all 18
setup and plugin packages at 0.25.0 pinned to that commit, and retains 0.24.0 and earlier versions.
The owner installs the published 0.25.0 from the market (or re-runs the installer from an external
PowerShell with the app closed); that install is what makes the picker and the reviewer-bound
delegation plugin live.

The picker route was fixed in v0.25.1 (tag on commit `fa73c09`). The 0.25.0 route was registered on
`webServer`, which the desktop shell host does not mount, so the desktop picker showed
`The OpenSpec change list request failed (404)` while the Web GUI worked. The route now registers on
the carrier-neutral `connection.fetch` registry under
`/api/plugins/dsh-setup-openspec/changes`, and the Client addresses it document-relative, the same
contract the shipped feature Fetch routes use; the Web `/api` bridge and the desktop shell carrier
both serve it, and the carrier admits origin and cookie before dispatch. A regression test covers a
host with `connection.fetch` but no `webServer`. The release workflow passed DSH 0.2.1-rc.3 and
0.2.1-rc.5, the publish job and the Pages deployment; the published index returns HTTP 200, lists all
18 packages at 0.25.1 pinned to that commit, and retains 0.25.0 and earlier. The owner installs
0.25.1 the same way; the picker then opens on both carriers.

The `2026-11-05-add-openspec-panel` change carries 18 tasks and 18/18 portable task approvals; it was
implemented in one session by two lane workers (host reads, Client panel) with the lead integrating
the generated setup tree. It adds the plugin's second Client surface and the `openspec-panel`
capability: one right-sidebar tab type opened from a Start-page guide card, a `Changes | Specs` root
view, one address-keyed tab per change with Why/Design/Specs/Tasks Markdown and per-capability delta
switching, capability tabs, the `/openspec-apply-change <name>` and `/openspec-propose ` composer
drafts without submitting, the native `page.refresh` binding, and live updates through the shipped
`file` resource provider over `workspaceFiles.changes` (300 ms debounce, last-updated fact, no polling
or plugin-owned watcher). Two read-only session-scoped Host routes serve one change's
artifacts/progress/last-modified times and the capability inventory or one spec, guarded by the
CLI-reported item plus canonical-path containment. The integration check found and fixed a real
late-service defect: the routes now register through cordis `ctx.inject`, so a Web profile whose
`connection` service appears after the row mounts still serves them. The `openspec-apply-picker`
requirement is scoped so another client surface may use the shipped component library. The gate was
green before archiving: `pnpm validate` (97 files, 1794 tests), `pnpm build` with no diff,
`pnpm gen:check` (329 files), `pnpm reviews:check --change add-openspec-panel` (18/18 PASS,
archive-ready), `pnpm dogfood`, and `openspec validate add-openspec-panel --strict`. Live checks in
throwaway rc.5 and rc.3 web Harnesses passed the Start card, change list, change tab, and the native
`Ctrl+Alt+R` refresh; rc.5 also passed live updates, the exact Apply draft, and the 480 px layout, while
rc.3 lacks the standard `useResource` hook so its live observation degrades to manual refresh as
designed. Open owner follow-up: install the release and smoke the panel in the desktop app.
The `2026-11-05-widen-dsh-support-to-engine-range` change (5/5 approvals) removed the manual DSH
version list: `enginesDsh` is now the installer's only allowlist, `install.ps1` compares the
installed version against the range with a Windows PowerShell 5.1-safe SemVer check, and both CI
workflows resolve their matrix at run time (range floor, runtime, and the newest published matching
version) with a tested and visibly reported fallback when the registry is unavailable. `validate:repo`
keeps `install.ps1`'s embedded `$DshEngineRange` equal to `dsh.json`; `supportedVersions` no longer
exists. The motivating case was the desktop app moving to DSH 0.2.2-rc.1: every plugin row and
observable surface already worked there, but the exact list refused the install. v0.26.1 (tag
`v0.26.1`, setup 0.26.1 pinned to `e9b4dd6`) validated 0.2.1-rc.3, 0.2.1-rc.5 and 0.2.2-rc.1 in one
release run and published the index; an in-range DSH update now needs no `dsh.json` or `install.ps1`
edit.

The `2026-11-05-redesign-openspec-panel` change carries 14 tasks and 14/14 portable task approvals; it
lifts the shipped read-only OpenSpec panel into a reading surface without adding a package, row,
dependency, or write. The main `openspec-panel` spec gained 8 and modified 6 requirements: a counted
`Changes | Specs | Archive` root with remembered segmentation, change cards with derived phase,
proposal `Why` summary, progress, last-updated time and git commit, openable archived changes, a
capability purpose/provenance/History view, structured requirement and scenario cards with
SHALL/MUST marking, a grouped task checklist parsed with the pinned CLI grammar, and optional
read-only git provenance. Host reads stay workspace-scoped and additive — the apply picker's
active-only `changes` contract is untouched — and the client decodes every new field defensively; a
`git` failure or an absent `connection.fetch` never fails a route. The serial tail regenerated the
bundles and vendored setup and passed `pnpm validate` (98 files, 1877 tests), `pnpm build` with no
diff, `pnpm gen:check` (329 files), `pnpm dogfood`, and `openspec validate --strict`. Live acceptance
ran in a throwaway Web Harness and recorded eight screenshots under the archive: the full light
checklist, the empty Changes state, dark appearance, the real 0.2.1-rc.3 floor host (which serves
the routes, so no supported host lacks `connection.fetch`), and the defensive missing-route
degradation (panel 404 state and picker error strip). Open follow-ups: the advisory
integration-review findings (proposal-only renames, nested task-file live updates, mixed unparsed
archived deltas, capability acceptance dates, per-spec requirement filtering) were accepted
unresolved by the owner for this release, and the desktop install smoke remains an owner step.

v0.28.0 raises the supported DSH floor to `0.2.2-rc.1` because the installer now selects two bundles
that first ship in 0.2.2: `@deepseek-ai/dsh-experimental-forge-bundle` (Change requests & worktrees)
and `@deepseek-ai/dsh-experimental-session-titles-bundle` (Conversation-following titles).
Personalized recommendations stays out of the shipped selection. DSH 0.2.1 is refused with the
update message; `enginesDsh`, `install.ps1`, every plugin manifest, and the client devDependencies
moved together, and the vendored setup was regenerated. The gate was green before the release:
`pnpm validate` (98 files, 1883 tests), `pnpm build` with no diff, `pnpm gen:check` (329 files),
`pnpm validate:repo`, `pnpm validate:composition`, and `pnpm validate:installer` on DSH
0.2.2-rc.1, whose composed profile contains every shipped bundle. Open owner follow-up: run the
installer on the second machine from an external PowerShell with the app closed and confirm the
Experimental plugins page shows the same on/off set.

On 2026-11-07 four planned changes were archived together. `add-workflow-observability` created the
`workflow-observability` capability and shipped `@dsh-setup/plugin-workflows`: a read-only Workflows
conversation view, a bounded per-session event journal with redaction and retention, a shadow trigger
catalog with a fixed Why-not vocabulary, a unified checkpoint/delegation/review timeline, and listener
health. `harden-review-queue` added the queue, typed failure classification and retries, timeout
quarantine, restart reconciliation and queue facts to `delegation-rules`. `add-openspec-live-list` made
the OpenSpec panel's Changes segment follow its active rows' files through the shipped observation with
one 300 ms debounced re-read. `learn-from-review-findings` added finding classes, the bounded finding
history, the `review-learning` capability (lesson store, user-approved decisions, deterministic retro
report) and bounded prompt injection. Their serial integration regenerated the setup and passed
`pnpm check` (2247 tests), `pnpm build` with no diff, `pnpm gen:check` (365 files), `validate:repo`,
`validate:composition` and `validate:installer`; the archived task counts are 23/25, 17/17, 7/7 and
23/23. Open owner follow-ups: `add-workflow-observability` 5.1 real-carrier verification (the routes
are unit-tested; the desktop Fetch carrier and browser admission matrix needs a throwaway installed
host) and 7.3 live Workflows view smoke; `harden-review-queue` live queue-under-shortage smoke;
`add-openspec-live-list` owner smoke on the installed setup; `learn-from-review-findings` one real
classed review plus `/review-retro` acceptance.

On 2026-11-09 `add-workflow-obligations` added the `workflows` engine to
`@dsh-setup/plugin-workflows` and extended `workflow-observability`: stored JSON definitions with
host-signed approvals, a durable run store, deterministic triggers evaluated through the same journal,
the `main`, `subagent`, `tool`, `human`, `branch` and `loop` executors, file/record/tool/check/human
and recursive `all` evidence, turn-close and pre-execute gates, host-authenticated receipts, the
`workflows` tool and the `/workflows` command family, the shipped `change-intake` definition, and the
deferred `task-review`/`retro` definitions. Its serial integration regenerated the setup, passed the
full gate (135 files / 2576 tests, build with no diff, `gen:check` 404 files, `validate:repo`,
`validate:composition`, `validate:installer`, `openspec validate --strict`), and normalized 15 legacy
portable review records to the portable schema (verdicts and digests unchanged). Open owner
follow-ups: install the generated setup in a throwaway profile and exercise the refusal -> draft ->
create-change -> strict spec -> whole-spec review -> approval receipt path, adopt a pre-existing
change, restart after `create-change` without recreating the directory, and confirm the deferred
`task-review`/`retro` definitions add no second steer; the live 5.1-style carrier check for the
workflow routes remains owner scope.

On 2026-11-09 `add-section-scoped-task-review` added section-scoped task review to `delegation-rules`:
a `delegate` call can name a `tasks.md` section (for example `1` or `1.x`), one run reviews all its
checked tasks in one frozen snapshot with one prompt and verdict, and a PASS publishes the existing
per-task portable approvals transactionally — matching approvals preserved byte-identically,
nonmatching ones replaced, failures rolled back, and section/per-task publications serialized under
the shared lock. A section ERROR is visible to the turn gate but grants no approval, and the archive
gate is unchanged. The change's six requirements were added to `delegation-rules`; per-task review
remains the live gate until the owner installs the regenerated setup, and the workflow follow-up runs
one real section review on an installed profile.

On 2026-11-09 `add-workflow-editor` added the Design mode to `@dsh-setup/plugin-workflows`: a React Flow
canvas bundled into the single client artifact (pinned 12.12.1, single-artifact budget documented and
enforced at 539,493 B bundle / 591,739 B artifact), an equivalent List form editor, templates and local
definitions through the revision-checked host write API, a layout sidecar, the run overlay with the
recorded definition name/version, structured evidence, failure class, violations and an orphan badge,
and keyboard/screen-reader support. Every save goes through the host-signed install/approve path, create
is create-only, and a conflict returns 409 without a write. The `workflows` spec gained 10 requirements;
the serial integration passed the full gate (146 files / 2750 tests, build with no diff, `gen:check`
407 files, validators, strict OpenSpec validation) and archived 24/27. Open owner follow-ups: the
rendered DesignMode accessibility interaction check (7.1/7.2 are covered by pure logic until the 8.4
owner browser pass) and the live visual check (8.4); the client bundle budget is documented as the
single-artifact trade-off.

On 2026-11-10 `retire-legacy-gates` switched the shipped setup to the workflow-owned gates: the setup
defaults disable the task-review and archive legacy signals, turn off the checkpoint automation, and
keep the verification-gate row installed but disabled, while the retained spec-review, task-progress
and lane-boundary rules stay strict. The workflow definitions `task-review`, `retro` and `verify` load
from the tracked parity report (all gate cases pass; `pnpm workflows:parity --check` runs after every
build in both CI workflows), the verify settings accept profile command/cap overrides (including a
cap above 128), and the verification-gate capability spec was retired. The serial integration passed
the full gate (153 files / 2840 tests, gen 411, validators, strict validation) and archived 17/21.
Open owner follow-ups: the four held gaps — bottleneck-target normalization (4.2), preserving a
pending verification obligation across turns (5.1), and the installed-runtime activation test with
the lane-fanout assertion (6.2/6.5) — plus the one-release owner steps: install the release into a
throwaway DSH_HOME, exercise the retired and retained gates, delete the legacy verification row
after one release, and use the documented per-signal switch to roll back. The gates are switched on
by default in this release, so the throwaway-DSH_HOME check is the first post-install verification.

On 2026-11-10 `redesign-workflows-ui` turned the Workflows tab into the session's run history and moved
authoring to a right-sidebar page: one status line (StateDot plus a details tooltip), the session's
attributed runs newest first with composed titles, trigger, relative start time and duration, a run
detail page whose Back control restores the list scroll and focus, and a Journal segment whose trigger
evaluations render inline with a run link only for an evaluation carrying a run id. The view reloads on
open, on demand and on visibility, re-reads the pages already loaded, resolves the open run by id
through the runs route's `run=` lookup, and keeps the loaded rows on a failed background refresh. The
editor moved to the `Workflow design` page opened from its Start guide card (kept mounted across
hiding, list mode below the shipped narrow threshold, an `Add step` menu, a collapsible property panel,
and a per-tab dirty close guard); that page also shows the definition list, trigger catalog and
receipts. Host projection gained the recorded trigger, a terminal time derived only from settled steps,
and titles composed from the definition name and subject; the runs route gained `order=newest` and the
session-scoped `run=` lookup. The integration passed the full gate (155 files / 2881 tests, gen 411,
build with no diff, validators, strict validation) with 19 portable task-review PASS records and
shipped in v0.30.0; the two delta specs are synced into the main specs and the change is archived.
Open owner follow-up: 5.2, the installed-build visual check of both surfaces.

On 2026-11-10 `add-workflow-overview` replaced the session view's journal with a workflow overview: two
segments, `Workflows` (definitions grouped by trigger kind, each workflow's own mode/filter, the group
firing count as the sum of its bound definitions' `definition:<id>` matched/total evaluation counts,
and `completed / all runs` with separate failed/running/cancelled/interrupted/blocked counts) and
`Runs` (the all-runs feed); selecting a workflow opens its page with the description, ordered
architecture chain, trigger binding, its runs newest first, and its definition-scoped evaluation
history where only a run-carrying evaluation links to the run. The session-wide `Journal` segment was
removed as a breaking change. The host read API gained `counts {matched,total}` on the trigger
entries, an additive `lifecycle` field on projected runs and the `stats=1` per-definition status
buckets. The integration passed the full gate (156 files / 2941 tests, gen 411, build with no diff,
validators) with 9 portable task-review PASS records and released in v0.31.0, archived 9/11 (the
archive and release steps were completed after the tick). Open owner follow-up: the installed-build
visual check of both segments and the workflow page.

On 2026-11-11 `redesign-workflow-design-surface` turned the `Workflow design` page into a workbench:
a left rail listing the installed workflows (name, description, trigger, step count, source, last
run) and the building blocks (trigger kinds and step executors), a center canvas opening on the
selected or first installed workflow (a blank canvas beside the rail when none is installed), and an
inspector. The read-only definitions table is gone and the trigger catalog and receipts moved into a
secondary `Diagnostics` disclosure; the narrow-width list fallback and the dirty-document guard stay.
The definition schema gained an optional 500-character `description` that the editor, the workflow
list, the inspector and the session workflow page show, the four shipped definitions carry one, and
the parity report was regenerated. The session workflow page renders the ordered steps as the same
node canvas in read-only mode with a selected-run overlay (latest by default, an older run changes
only the overlay) and keeps the ordered step table as the fallback. The change shipped in v0.31.5
(`c2b291b6` fixed each workflow's trigger in the design rail) with 15 portable task-review PASS
records, the delta specs are synced into the main specs (the archive reported them already in sync),
and it archived 15/16. Open owner follow-up: 4.5, the live-session visual check of the workbench at
wide and narrow sidebar widths.

On 2026-11-11 `add-agent-requested-adoption` added the user-confirmed `adopt` action to the
`workflows` tool: one `change` argument reaching the same `adoptChange` path as the
`/workflows adopt <name>` command, which keeps the four-artifact and current whole-spec `PASS`
verification, the host question, the post-answer re-verification with the same digest, and the
host-signed receipt, so the model may request adoption but cannot supply the confirmation answer
and cannot write a receipt without the user's yes. The `userStarted` flag is gone because the
user's host-UI answer is the authorization; the command's behavior, the receipt format, and the
archive gate are unchanged. A change whose directory, or any path beneath it, is a symbolic link —
including one that becomes a link while the question is open — is refused, because the evidence
reader follows an in-workspace link while the spec digest skips it. It released in 0.31.6/0.31.7
with 7/8 tasks, and the delta spec is synced into `workflows` (the archive reported it already in
sync). Open owner follow-up: 2.4, the end-to-end adopt check in a live installed profile.
