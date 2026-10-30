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

The same row makes two bounded, read-only review calls with the shared `goal-reviewer` preset:

- a **block review** gates a proposed `blocked` update through a `tools/pre-execute` decision;
- a **speed review** measures one completed goal round and, when it crosses a cost threshold, starts
  one background child that returns either `no-action` or one `speedup` action with a `speedup-id`.
  The action is recorded under `.dsh/goal-continuity/retro/`, announced in the next goal round's
  brief, and enforced by a follow-through gate that accepts a tagged worker start or a matching
  `task_progress` decline. The review, its brief, and the gate fail open and never block the goal.

The row ships enabled with `resumeAfterRestart: false`, `resumeAfterUserStop: non-goal`,
`maxSessionResumes: 20`, `roundExtension: 1000`, `maxRoundExtensions: 2`, `hardMaxGoalRounds: 5000`,
`blockReview.enabled: true`, and `speedReview.enabled: true`. The speed review defaults to
`minToolCalls: 12`, `minMinutes: 5`, `slowCallMs: 120000`, `everyRound: false`, `maxPerGoal: 20`,
`timeoutMs: 120000`, and `brief: true`. Restart resume is opt-in: set `resumeAfterRestart: true` on
the row in the profile's `cordis.patch.yml`. Set `speedReview.enabled: false` to keep continuity and
the block review while disabling only the speed loop, or set `enabled: false`/disable the row to
restore stock DSH goal behavior with no disarm, resume, extension, block, suppression, notice, or
either review.

The speed-review loop was added by the `add-goal-round-retro` change; the row
`dsh-setup-goal-continuity` and the accepted requirements in the `goal-continuity` spec describe its
behavior.

## Observability view

[`packages/plugin-observability`](../packages/plugin-observability) adds an **Observability** tab
beside Chat and Trajectory. It answers "did a rule actually fire, and is a plugin still working?"
from the session event logs DSH already writes; it adds no telemetry pipeline, no second log, and no
file of its own. The Host reads through `ctx.sessionQuery`, aggregates in memory, and serves
`GET /plugins/dsh-setup-observability/report?range=<range>&session=<id>` to the Client. A bounded
in-memory cache keyed by session id plus event count and newest event time makes a repeated request
cheap; nothing survives a Host restart.

**Ranges and buckets.** `session` is the open session's turns plus one explicit `Outside turn`
bucket (commands are appended with no turn around them); `day` is 24 local-hour buckets; `week` is 7
local-day buckets; `month` is 30 local-day buckets. Wider ranges cover every session in the open
session's workspace whose events fall in the window, subagent children included, and a seed's copied
prefix is skipped at `inheritedEventCount`, so an event counts once.

**Dashboard, not a log browser.** The view opens on a health verdict and four KPIs (turns, steps, tool
calls, errors), then one activity chart for the range with the error share in red, plugin health cards
grouped as Needs attention / Active / Silent (each with a status word, counts, last activity, a
sparkline, and its tool chips), the tool-call distribution, and a collapsed statement of blind spots.
A card expands to at most five recent traces — time, row, turn, tool, error flag — and message text
and tool arguments never appear. Built-in aggregates feed the KPIs, chart, and tools list while
configured rows become cards, so the same event is never counted twice in the dashboard totals.

**Rows are data.** A configured row has an `id`, a `label`, a `kind`, and a `match`: one predicate or
an any-of list of predicates over `eventType`, `tool`, `sourceKind` (an injected message's declared
kind), `abortPrefix` (a hook abort reason's prefix), `command` (a slash command's name), and at most
one `argument` field/value on a tool call. A `guidance` row has no match; it names a prompt-only
plugin honestly instead of letting it disappear. Unknown fields are rejected at startup, naming the
field. The configuration is never executed.

With no configuration the built-in sets still show turns, steps, tool calls, one row per observed
tool name, one row per observed injected-message source kind, one row per observed abort prefix, and
errors. The shipped signal map lives in `packages/setup/defaults.yml` and maps each shipped plugin's
tools, message kinds, aborts, and commands to its own row; its test fails when a tool is renamed or a
plugin is removed.

**Status words.** `active` means traces in the period, `error` means at least one failed trace,
`not loaded` means a tool the row names is absent from the live tool registry, and `silent` means
configured but no traces — labelled explicitly as the absence of traces, not proof of a fault. A
guidance row has no status: it is always `guidance only` and never enters the other four. Every state
is written in words as well as colour.

**What it cannot see.** The view names these blind spots rather than implying full coverage: a
prompt-only plugin's effect on a turn, a plugin that fails while loading (no session event), UI
rendering effects, and whether the model complied with a prompted rule.

To add a custom signal, override the row in the profile's `cordis.patch.yml`. A configuration patch
replaces the whole `config` object, so restate every row the profile needs (start from the shipped
map in `packages/setup/defaults.yml`):

```yaml
- id: dsh-setup-observability
  config:
    rows:
      - id: my-tool
        label: My tool
        kind: signal
        match:
          - tool: my_tool
      - id: my-notes-writes
        label: My notes writes
        kind: signal
        match:
          - tool: write
            argument:
              field: path
              value: notes.md
      - id: my-skill
        label: My plugin
        kind: guidance
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
