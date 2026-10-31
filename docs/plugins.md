# Adding a plugin package

Every plugin lives in `packages/plugin-<name>` and is an ordinary DeepSeek Harness plugin package
that also declares a bundle patch, so it can be installed on its own or aggregated by the setup
bundle.

## Package layout

```
packages/plugin-<name>/
├─ package.json          # identity, dsh.bundle, dsh.client, engines.dsh, exports, peers
├─ cordis.fragment.yml   # the row ids this package mounts (source of truth)
├─ cordis.patch.yml      # GENERATED bundle patch; do not edit
├─ src/
│  ├─ host/index.ts      # Host plugin module (export name + apply)
│  └─ client/index.tsx   # optional Client half, compiled into lib/client.js
├─ test/                 # unit tests (Vitest)
├─ locale/en.json        # display metadata used by Plugins and the market
├─ icon.svg              # package icon referenced from package.json
├─ lib/                  # GENERATED host output and client bundle; committed
└─ tsconfig.json         # composite project for Host compilation
```

Generated files are committed because the package is installed from git and must not need an
install-time build. CI rebuilds and rejects a commit whose generated files do not match.

A configuration-only MCP adapter omits `src/`, `lib/`, `test/`, and `tsconfig.json`; see
[Configuration-only MCP adapter](#configuration-only-mcp-adapter).

## package.json contract

- `engines.dsh` must equal the range in `dsh.json`; the manifest validator rejects a mismatch.
- `dsh.bundle.patch` points at the generated bundle patch.
- `dsh.client` is present only for packages with a Client half:
  - `platform: "web"`,
  - `inject` lists Client packages whose slots or services the plugin uses,
  - `external` lists non-baseline runtime imports that must not be bundled.
- `exports["./client"]` must exist whenever `dsh.client` exists.
- `peerDependencies` pin the shared DSH packages (`@deepseek-ai/cordis`); the same versions appear
  in `devDependencies` for type checking.
- `files` must include `lib/`, both YAML files, `locale/`, and the icon. A package may also list exact
  asset paths (for example a vendored upstream prompt); the setup generator vendors those files the
  same way.
- No `prepare`, `preinstall`, `install`, or `postinstall` scripts: git installs cannot run them.
- A plugin may declare an exact-pinned third-party runtime dependency. The generator hoists it into
  the setup manifest and does not vendor it; the profile installation fetches that exact version.
  See [`packages/plugin-hindsight`](../packages/plugin-hindsight) and
  [Hindsight](hindsight.md).

## Composition fragment

The fragment names the row ids the package mounts. A row mounts the package itself, or names the
approved Harness-provided adapter package, currently only `@deepseek-ai/dsh-mcp-client`. One fragment
may do both: an adapter bundle can also mount its own Host module. Generation rejects any other
foreign name, so a fragment cannot mount arbitrary package code.

```yaml
rows:
  - id: dsh-setup-<name>
```

An adapter row names the approved package instead of the owning one:

```yaml
rows:
  - id: dsh-setup-<name>
    name: "@deepseek-ai/dsh-mcp-client"
```

Rules:

- Row ids start with `dsh-setup-` and are globally unique across the repository.
- Unknown fragment or row fields are errors, not warnings.
- Optional `name` is allowed only with the approved adapter target; omit it for a row that mounts
  the package itself.
- Optional `config` on a row maps to the Loader row configuration.
- Optional `disabled: true` ships the row mounted but inactive; a profile patch enables it with
  `disabled: false`. The setup currently ships no disabled row; the field remains for standalone
  bundles that must stay installable without paying a per-step cost.

`pnpm gen` writes both this package's `cordis.patch.yml` and the aggregated
`packages/setup/cordis.patch.yml` from every fragment. Run it after changing a fragment.

## Source conventions

Host half: export the plugin `name` and an `apply(ctx)` function. Keep the plugin object free of
side effects at module scope.

Client half: export `inject` (services it needs) and `apply(ctx)`; register into an existing slot
through `ctx.slots.inject(...)` and `ctx.slots.register(...)`. The Client build emits the
`window.__ModuleLoader__.load({ id, factory })` format the Harness expects. React and its runtime
come from the browser module table and are never bundled.

Verify the slot name and props against the running Harness (`cordis_inspect_query` with the Client
`Slots` provider) before relying on them, and route visible text through the Client locale service.

## MCP adapter and guidance bundles

A bundle that owns an external MCP server mounts the Harness-provided
`@deepseek-ai/dsh-mcp-client` row, so the loader never imports the package for that row. In its
smallest form the package contains `package.json`, `cordis.fragment.yml`, `locale/en.json`, and
`icon.svg` and nothing else handwritten: the manifest omits `main`, `types`, `dsh.client`, and the
`./client` export, lists only those four files plus the generated patch in `files`, and keeps the
usual `engines.dsh` and `dsh.bundle.patch`. The generated `cordis.patch.yml` is the only build
artifact.

The adapter capability remains available, but the setup no longer uses it: a bundle may ship a Host
module that contributes guidance while the server itself is configured elsewhere. That is the shape
of [`packages/plugin-serena`](../packages/plugin-serena) and
[`packages/plugin-nuphus-mcp`](../packages/plugin-nuphus-mcp): one guidance row mounting their own
module, the `serena-discipline` / `nuphus-discipline` skill (and, for Serena, the always-on trigger),
and no adapter row. The setup's `dsh-setup-mcp-lazy` row carries the servers; a standalone user adds
a lazy entry or a static adapter row. A bundle that owns its server may still combine the two row
shapes: the adapter row mounts the approved package and the guidance row mounts its own module, and
the rows stay independent.

The adapter's configuration is static and machine-independent: it names the executable and arguments,
not a project path. Project activation happens at runtime, and the shared MCP client instance serves
the whole profile, so switching the active project in one session changes it for the others. An
adapter that needs an external runtime documents it in its locale description and
[docs/install.md](install.md) instead of installing or vendoring it; the package must ship no
install-time script, and its configuration must keep the Harness bootable when the runtime is
unavailable.

To change the configuration or turn an adapter row off, override its row in the profile's own
`cordis.patch.yml`; a patch replaces the whole `config` object, so restate every field the row needs.
Disabling it takes only the row id:

```yaml
- id: dsh-setup-my-adapter
  disabled: true
```

Do not install the setup bundle and an individual plugin bundle for the same plugin at once: the same
row id would mount twice.

A server that should stay dormant until the model needs it has its own bundle instead of a static
adapter row: [`packages/plugin-mcp-lazy`](../packages/plugin-mcp-lazy) mounts no per-server tools and
reaches configured stdio servers through `mcp_tools` and `mcp_call`, so the model-facing tool set
never grows with the server count. See [lazy-mcp.md](lazy-mcp.md).

## Host-only behavior bundle

A Host-only bundle that changes runtime behavior rather than adding skills or UI needs the standard
package shape (`package.json`, a fragment row, `src/host/index.ts`, tests, locale, icon). Its `apply`
registers lifecycle listeners and keeps module scope free of side effects; it ships no Client half and
no prompt section. [`packages/plugin-loop-guard`](../packages/plugin-loop-guard) is the reference: it
observes `llm/stream` and `session/event`, delivers recovery through agent steering and cancellation,
and carries its documented defaults in the fragment row. Its behavior is documented in
[loop-guard.md](loop-guard.md).

## Answer pages

[`packages/plugin-answer-page`](../packages/plugin-answer-page) is the skill-only shape: it registers
one on-demand skill from a pinned upstream release, with its vendored skill directory as the resource
base so the skill's own `scripts/am.mjs` resolves. It ships no always-on section, no tool, no Client
half, and no configuration. The upstream renderer, prompt, references, and licenses are vendored
byte-identically under `assets/answer-me-with-html/` and pinned by `answer-page.lock.json`. Because
the vendored prompt carries one upstream example Windows path, `scripts/lib/scan.ts` exempts exactly
the lock-listed files from the machine-path check while secret scanning still runs. Usage, policy, and
attribution are in [answer-pages.md](answer-pages.md).

## Goal continuity

[`packages/plugin-goal-continuity`](../packages/plugin-goal-continuity) is the Host-only supervisor
for an existing root-agent goal. It reconciles an active but disarmed goal after recoverable harness
stops, prevents the goal driver's pause for a loop-guard reset, extends a reached round cap under a
bounded budget, and records a visible `continuity-stopped` block on real stops. Notices are
non-waking (`agent.inject`); the supervisor never starts a turn, forks the driver, or calls the
model.

The same row makes one bounded, read-only review call and delivers the work-checkpoint capability:

- a **user-decision review** gates both a proposed `blocked` update and an `ask_user_question` call
  through a `tools/pre-execute` decision, using the shared `goal-reviewer` preset: a `blocker`
  verdict allows the call, and a `not-blocker` verdict denies it with the reviewer's next action, so
  an unjustified question never holds the turn open; the block and the question share the
  digest-bound record (which keeps the `block` or `question` subject), the per-goal review bound, and
  the error, unavailable, and exhausted policies;
- a **work checkpoint** requires one structured `work_checkpoint` decision at a substantial root
  turn close: it steers a bounded request naming the turn's tool calls, written paths, last shell
  result, failed tool, and worker starts, refuses the close until a successful checkpoint exists for
  the turn (at most `maxBlocks` refusals, then a visible UNCHECKED notice), and, when the decision
  declares parallel remaining work, requires a tagged worker start or a serial reason. The request is
  non-waking, and the record stays local under `.dsh/work-checkpoints/`.

The row ships enabled with `resumeAfterRestart: false`, `resumeAfterUserStop: non-goal`,
`maxSessionResumes: 20`, `roundExtension: 1000`, `maxRoundExtensions: 2`, `hardMaxGoalRounds: 5000`,
`blockReview.enabled: true`, `blockReview.reviewQuestions: true`, and `checkpoint.enabled: true`. The
checkpoint defaults to `minToolCalls: 4`, `requireWrite: true`, `maxBlocks: 3`, `enforceParallel:
true`, `stepInterval: 40`, and `maxMessageChars: 1200`. Restart resume is opt-in: set
`resumeAfterRestart: true` on the row in the profile's `cordis.patch.yml`. Set
`blockReview.reviewQuestions: false` to review only blocks and leave questions unexamined, set
`checkpoint.enabled: false` to keep continuity and the review while disabling only the checkpoint, or
set `enabled: false`/disable the row to restore stock DSH goal behavior with no disarm, resume,
extension, block, suppression, notice, user-decision review, or checkpoint.

The checkpoint was added by the `replace-rare-triggers-with-work-checkpoints` change, which removed
the earlier goal-round speed review; a leftover `speedReview` object in a profile is accepted, warns
once, and runs nothing. The row `dsh-setup-goal-continuity` and the accepted requirements in the
`goal-continuity` and `work-checkpoints` specs describe the behavior. The shipped observability map
attributes the checkpoint request through the `goal-continuity` source kind and the tool call through
a `tool: work_checkpoint` match.

## Observability view

[`packages/plugin-observability`](../packages/plugin-observability) adds an **Observability** tab
beside Chat and Trajectory. It answers two kinds of question from the session event logs DSH already
writes: whether a rule fired and a plugin still works, and whether the **work itself** improved quality,
token cost, speed, or autonomy. It adds no telemetry pipeline, no second log, and no file of its own.
The Host reads through `ctx.sessionQuery`, aggregates in memory, and serves
`GET /plugins/dsh-setup-observability/report?range=<range>&session=<id>` to the Client. A bounded
in-memory cache keyed by session id plus event count and newest event time makes a repeated request
cheap, including the baseline read; a 10-second report cache per range answers a repeated view switch
without recomputing, and the Client keeps the last report for 30 seconds to paint before the fresh one
arrives. The baseline and hypothesis windows are read in parallel, and sessions are opened eight at a
time. A plain view request skips the hypothesis windows (they may span the whole week); the Hypotheses
tab asks for them with `&hypotheses=1` and states that it is reading the comparison windows while the
rest of the view is already usable. Nothing survives a Host restart.

**Ranges.** `session` is the open session and its descendant sessions, drawn as a time-based timeline;
`day`, `week`, and `month` are 24 hourly, 7 daily, and 30 daily buckets. Wider ranges cover every
session in the open session's workspace whose events fall in the window, subagent children included,
and a seed's copied prefix is skipped at `inheritedEventCount`, so an event counts once. When a child
overlaps a window without its parent, the parent chain is read too, so the human message that started
the episode is available.

**Task episodes are the unit.** An episode starts at a `user/message` whose source kind is `user` and
keeps machine messages and tool activity inside it. It ends before the next human message, at session
end, or after the configured idle gap (default 30 minutes); activity after the gap stays outside every
episode until the next human message. Events before the first human message are preamble. A session may
hold several episodes (`sessionId#index`, index by start time) and a session without a human message
contributes none. A child session never becomes a top-level episode: it is joined to the parent episode
its time overlaps most, its tokens and tools are counted there once, and a child whose parent chain
leaves the corpus or whose time overlaps no episode is reported as unlinked rather than dropped.

**Window accounting.** Episodes are reconstructed from complete session records before filtering. An
episode joins the cohort of the window that contains its start, exactly once; its tokens, steps, and
active intervals are attributed by event time, so a spanning episode is split at the boundary and
adjacent windows reconcile. Cohort outcomes are observed at the window end, and a baseline never sees a
completion after its cutoff. Per-episode cost is measured through the cutoff by default and labelled
(`through cutoff`; the session range has no cutoff and reads `full episode`). The Tasks detail also
shows the full-episode cost, labelled.

**Token metrics.** Every assistant message's recorded usage contributes input, output, cache read,
cache write, and total tokens. Context load is input plus cache read; context per step is the mean of
context load across the window's assistant messages; the cache hit ratio is cache read over input plus
cache read and is absent when both are zero. A message without usage contributes zero and lowers the
stated coverage instead of being estimated: the view reports step coverage and message coverage
separately and never calls them complete when either is partial. Cache reads dominate token totals, so
the view shows context per step and the cache mix beside the totals and prefers p50/p90 over a mean.

**Quality, speed, and autonomy.** The outcome map is `completed` for a completed final turn end,
`failed` for a turn failure or a tool failure no completed turn recovered (an unrecovered failure
outranks the closer), `cut` for `aborted`/`max-tokens`/`interrupted`, `blocked` for `blocked`, `other`
for an unmapped terminal kind, and `open` when no final turn end was recorded — including a later turn
that started without an end. A completed checkpoint with a non-empty verified list marks the episode
verified; `continue` is not a close, and the lists' text never reaches the report. Active time is the
union of step and tool intervals clipped to the episode, so a tool inside a step counts once, idle gaps
are excluded, and commands are not intervals; wall-clock span is never used. Autonomy reports steps per
human message, machine injections per human message, episodes per session, goals, completed goals,
rounds, and human messages per completed goal, following each goal by its opaque id from create to
complete; a human-message-per-episode count is not reported because the episode definition makes it
constant.

**Subagent work.** A child session's tokens, tools, and active intervals belong to the parent episode
and are observed at the window cutoff: a child that starts after the cutoff is not counted, and a child
whose failure lies after the cutoff still reads open. The report carries delegate calls, episodes with a
child, parallel width, parent wait between a delegate call and its result, child tokens, child
outcomes, and the unlinked count.

**Process timeline.** A worker is a joined child session of an episode: its activation is its first own
record, its end is its last, and its span is clipped to the window. One time axis draws the number of
workers active over time, a decomposition marker where an episode's first worker activates while no
worker is already running (carrying the episode id and that episode's worker count), and a reflection
marker for every `work_checkpoint` call whose outcome word parsed (its time, episode id, outcome word,
and the steps since the previous reflection or the episode start). A malformed checkpoint call is not a
reflection: it never becomes a marker, does not reset the cadence, and does not count toward coverage,
though it remains in the raw checkpoint count. The step-rate strip below the axis counts recorded
`step/start` events per bucket: the range's own buckets for day, week, and month, and 24 equal parts of
the session timeline for the session range. Everything carried is a time, count, id, or outcome word;
message text, tool arguments, goal objectives, and checkpoint list text never enter the report. The
summary reports workers (distinct joined child sessions), episodes with a worker, worker activations,
maximum concurrency, time from episode start to the first worker (p50/p90), steps between reflections
(p50/p90), reflections per episode, and reflection coverage. An empty window reports zero workers and
states that no decomposition was observed; that is absence of evidence, not compliance.

**Intervention comparison.** The plugin accepts one optional `interventionAt` ISO date. When set, the
timeline splits the window's episodes by start at that instant, reports both summaries with their
episode counts, prints the date it used, and labels the comparison an association, not proof; below
`minEpisodes` on either side it reads insufficient data instead of an improvement. Without the date it
compares against the report's baseline — the previous equal window, or the previous completed session
for the session range — and names that baseline, or carries no comparison when there is none. The date
is configuration data, not a logged configuration history, and the panel states that it is the reader's
declared marker. The process view does not read prompts or skill text, decide whether the model chose to
decompose, or store an experiment registry.

**Scorecards.** Every signal row may declare a business `goal` and an `eligible` predicate list (signal
rows only). The scorecard shows eligible episodes, the share of them where the row fired (activation),
the error rate, and an outcome comparison between the treated cohort (fired and eligible) and the
control (eligible and not fired), matched by tool-call size bin and week; a size bin that cannot be
matched within one week is compared across weeks and the report says the week was relaxed. A fired
episode outside the eligibility predicate is shown separately and never enters activation. Below the
configured minimum episodes per side the comparison reads insufficient data, and every comparison is
labelled association, not proof, with its sample size.

**Comparisons and hypotheses.** Day, week, and month compare against the previous equal window; the
session range compares against the previous completed session in the same workspace, or reports no
baseline. Hypotheses are inert configuration: a metric id from a fixed catalog
(`verified-completion-rate`, `tokens-per-episode`, `context-tokens-per-step`,
`active-minutes-per-episode`, `steps-per-human-message`, `human-messages-per-completed-goal`,
`delegate-rate`, `checkpoint-coverage`, `failure-rate`), a direction, a non-negative threshold, a
window, an optional minimum sample count (default 20), and an optional guardrail metric. A hypothesis is
`collecting` below its minimum, `supported` when the movement reaches the threshold and the guardrail
does not worsen, `refuted` when the metric moves opposite beyond the threshold, and `inconclusive`
otherwise; unknown metric ids and fields are rejected by name, descriptions are rendered as data, and
no result claims causation.

**Attention findings.** The view derives findings from the metadata rather than waiting to be read.
The first rule is the serial long run: an episode with at least 40 steps or 20 active minutes whose
joined children never overlapped (parallel width at most one) becomes one finding naming the episode,
its steps, active minutes, and width, with a next action to name two to four independent streams and
their files or record why the work must stay serial. A long run with overlapping children is not
flagged and an empty window produces no finding. Findings are heuristics over counts and times, never
proof, and carry no message text. Further process rules (blocking waits, human corrections, untested
edits) are deliberately out of scope until this one is exercised.

**Views.** `Overview` shows the data-sufficiency verdict, the attention findings, four outcome tiles
(quality, cost, speed, autonomy) with their sample size and p50/p90, the token mix, the activity
timeline or range series, plugin scorecards, a compact silent group with triggers, the data-quality
strip, and failure access. `Plugins` keeps the row board and the failure list; `Tasks` lists episodes
newest first (capped at 200 while the counts stay uncapped) with sortable, outcome- and
plugin-filterable columns and a detail view carrying the episode timeline, full-episode cost, tokens per
step, subagents, goals, and checkpoints; `Hypotheses` shows one card per configured hypothesis with its
metric, baseline, current value, threshold, sample size, window, guardrail, and status. Charts render at
the container's measured width with no stretched aspect ratio, bars are bounded, the session range is a
time timeline rather than one bucket per turn, and the layout is two columns above 900 px and one column
below. Status is always written in words beside colour, and the charts use the published theme tokens
without adding a dependency.

**Failures are a list, not a number.** Every failed or cut record in the window is listed newest first,
independent of the configured rows: its time, session (title, or a short id when unavailable), turn,
step, tool, and the error identity the log records (`name`/`code`). Severity comes from the log's own
reasons: `turn failure` (`turn/end` with `error`), `turn cut` (`max-tokens` or `interrupted`), and
`tool failure` (`tool/result` with an error). A tool failure is `recovered` when its turn ended
`completed`; recovery is resolved by turn over the session's full record set, so a closer outside the
window still counts. The rendered list is bounded to the newest 200 entries while the counts cover the
whole window, and raw failure reasons, message text, and tool arguments never appear. An entry from the
open session focuses the Trajectory inspector on the recorded call; an entry from another session opens
that session; "Fix in a new session" opens a blank with a bounded draft naming the listed failures and
instructions to read their events and fix the root causes. The draft is never submitted automatically
and never replaces existing draft text.

**Status words.** `active` means traces in the period, `error` means at least one failed trace,
`not loaded` means a tool the row names is absent from the live tool registry, and `silent` means
configured but no traces — labelled explicitly as the absence of traces, not proof of a fault. A silent
row is compact and states what it waits for (its `trigger`, when configured) and its eligible-episode
count beside its zero. A guidance row has no activity status: it is `guidance only`, or its readiness
word when it declares a contribution. Every state is written in words as well as colour, and the tool
distribution draws each tool's failing share over the calls made inside the window, joined by call
identity, so the share never exceeds the call count.

**Nothing is persisted.** Aggregates are computed on demand. Any caching is in memory, keyed by session
identity and modification time, and no report or baseline writes a file. A Host restart recomputes the
same numbers from the sessions.

**Absence is explicit, never health.** A configured signal with no matches is shown as a row with no
traces, stating its trigger and its eligible-episode count beside its zero, or that eligibility is not
declared; absence alone never places a row in needs attention, and a window with no eligible episodes is
never reported as healthy. The verdict is the union of a turn failure, an unrecovered tool failure, a
configured tool that is not loaded, and a declared prompt contribution that is not mounted; thin data
reads insufficient data, not healthy. Rows are data: an `id`, a `label`, a `kind`, an any-of `match`
over event type, tool, injected-message source kind, turn-abort reason prefix, command name, and one
argument field/value, plus the optional `trigger`, `goal`, and signal-only `eligible` list. A guidance
row declares `mounted` section and/or skill names and must not declare eligibility. Readiness checks
those names against the live registries and reports `mounted`, `not mounted`, or `readiness unknown`;
only a confirmed absence needs attention. Unknown fields are rejected by name and configuration is never
executed.

**What it cannot see.** The view names these blind spots rather than implying full coverage: a plugin
that fails while loading and leaves no registered tool, prompt section, or skill; UI rendering effects;
and whether the model complied with a prompted rule. Delivery of a declared contribution is checked;
compliance with its text is not. It also states that whether a human accepted a completed result is not
recorded, that the configuration and version active in a past session are not recorded, and that every
plugin comparison is an association, not causal proof.

The shipped signal map lives in `packages/setup/defaults.yml` and maps each shipped plugin's tools,
message kinds, aborts, and commands to its own row; its test fails when a tool is renamed, a plugin is
removed, a row loses its goal, eligibility appears on a guidance row, or a declared section or skill is
no longer registered. The shipped configuration also carries two hypotheses (goal continuity on steps
per human message and delegation on active minutes per episode) over the fixed metric catalog.

The following remain out of scope (P2): diff churn and rework measured from git, price tables and
currency, per-session configuration or version snapshots, review verdicts, and CSV export.

To add a custom signal, override the row in the profile's `cordis.patch.yml`. A configuration patch
replaces the whole `config` object, so restate every row the profile needs **and** the plugin's other
fields (`idleGapMinutes`, `minEpisodes`, `hypotheses`, and the optional `interventionAt`) from the
shipped map in `packages/setup/defaults.yml`:

```yaml
- id: dsh-setup-observability
  config:
    rows:
      - id: my-tool
        label: My tool
        kind: signal
        trigger: a my_tool call runs
        goal: my tool shortens the task it serves
        match:
          - tool: my_tool
      - id: my-notes-writes
        label: My notes writes
        kind: signal
        trigger: a write targets notes.md
        goal: notes are updated with small writes
        match:
          - tool: write
            argument:
              field: path
              value: notes.md
        eligible:
          - tool: edit
          - tool: write
      - id: my-skill
        label: My plugin
        kind: guidance
        trigger: the my-plugin skill is loaded
        goal: my plugin's guidance is delivered
        mounted:
          skill: my-plugin
    idleGapMinutes: 30
    minEpisodes: 10
    hypotheses: []
```

## Adding a package

1. Copy the closest existing package shape (`packages/plugin-rust` for a Host-only bundle,
   `packages/plugin-admin-indicator` for a Host+Client bundle) and rename the package. For an MCP
   adapter without a Host module, keep only `package.json`, `cordis.fragment.yml`, `locale/en.json`,
   and `icon.svg` and skip the TypeScript project, build, and package-test steps; `pnpm gen` and the
   repository validation still apply.
2. Update `package.json` (`name`, `description`, `icon`, fragment, Client manifest) and
   `locale/en.json`.
3. Add the package to the root `tsconfig.json` references.
4. Run `pnpm gen` and commit the generated patches.
5. Run `pnpm check`; it type-checks, lints, builds, and tests the package.
6. Add a test under `test/` for each behavior the package promises.

## Development loop

Install the workspace package into a dedicated profile as a link, so the Harness loads the
checked-out files instead of a copy:

```sh
dsh --profile dev --from-default-profile web
dsh plugin --profile dev add link:<absolute path to packages/plugin-<name>>
pnpm build --watch
```

Observed behavior on the supported Harness version (0.2.1-rc.3, Web boot of a throwaway `dev`
profile with the plugin installed as a `link:`):

- **The Client half reloads without a page reload or Host restart.** Editing
  `src/client/index.tsx` makes `pnpm build --watch` rewrite `lib/client.js`; the client-HMR transport
  then reports the new bundle revision on `/plugins/events` (a `rebuilt` frame naming the package and
  its new revision). An open Web page swaps the rebuilt bundle and remounts the plugin with fresh
  state; the page is not reloaded.
- **The Host half applies on the next profile recomposition, not when its file is written.** Editing
  `src/host/index.ts` makes the TypeScript watch rewrite `lib/index.js`, but the running Host keeps
  the loaded module. Changing the profile's `cordis.patch.yml` recomposes the profile, replaces the
  linked package's module, and runs `apply` again; restarting the Harness also applies the new code.
- **The Desktop app uses neither of these paths for the Client half.** The `rebuilt` frame is
  delivered over the Web transport; a Desktop window picks up rebuilt Client bundles only after it is
  reopened or the app is restarted.

So the Client half is the half with true hot replacement; treat Host changes as requiring a profile
recomposition (or a restart) rather than assuming both halves reload.
