# Design

## Context

See `proposal.md` for motivation. Current state that shapes the approach:

- The DSH Web composer's `/` menu is fed by trigger sources. `@deepseek-ai/dsh-client-ui-commands`
  registers the `command` source over a per-session host command catalog and a client contribution
  registry, and renders `popupSelect` contributions through the shared menu surface (`/model`,
  `/permission`). `@deepseek-ai/dsh-client-ui-skill` already registers the `/` skill source: it lists
  `/openspec-apply-change` in the menu, inserts the literal token on a pick, and implements no
  adjudication hooks, so it cannot offer argument choices.
- Enter selects the highlighted menu row or, with the menu closed, submits the line to the session's
  adjudication hooks; Space only polls the sources' `matchSpace` claims, and popup contributions never
  claim, so Space cannot open a picker.
- `@dsh-setup/plugin-openspec` is host-only (`inject: ['skills']`), ships no client entry, and its
  module note says it never spawns the OpenSpec CLI. The repository supports DSH 0.2.1-rc.3 and -rc.5;
  the client UI packages version independently of the DSH pin and are not repository dependencies.

## Goals / Non-Goals

- Goals: one native picker command, a workspace-scoped list, a pick that only writes the skill line,
  and unchanged skill behavior on every host.
- Non-goals: a Space gesture, auto-submit, per-change commands, store support, picker caching, or any
  plugin-owned presentation.

## Decisions

**Client command contribution with `popupSelect`.** Register `/openspec-apply` through the client
`commandUi` service with `ui: { kind: 'popupSelect', options, onSelect }`. The shell owns search,
keyboard, empty state, error strip, and styles. Alternatives rejected: a slot-rendered overlay (own
UI), a new input-trigger source (sources can claim a token or insert text, not open a shell popup).

**Distinct command name.** `/openspec-apply` differs from the skill `/openspec-apply-change` on
purpose: the same name would render two rows in the `/` menu (skill source and command source), and
Enter on the open menu would pick whichever row the highlight lands on. With a distinct name the
picker is deterministic and the hand-typed skill line is untouched.

**Pick writes the draft, never submits.** `onSelect` resolves the session scope
(`ctx.sessions.scope(sessionId)`) and writes `/openspec-apply-change <name>` through the conversation
input facade (`conversation.input.for(actx).setDraft(...)`). The user presses Enter, the line becomes an
ordinary prompt, and the existing host skill-injection path runs. Auto-submit was rejected: it would
bypass review and can race the input machine's submission phase. The shell's post-select token
consumption is CAS-guarded, so it cannot clear the new draft.

**Host route as the list source.** `GET /plugins/dsh-setup-openspec/changes?session=<id>` resolves the
agent by session id (`ctx.agents.get`), reads that session's workspace
(`ctx.workingDirectory.get(agent.session)`), runs `openspec list --json` there, and returns the
changes with name, completed, and total task counts. Chosen over reading `openspec/changes/*/tasks.md`
directly because the CLI is the documented source of truth for status and layout; the cost is that
this plugin now spawns the documented prerequisite, so its module note changes from "never spawns" to
"never installs, downloads, or fetches".

**Optional registration instead of required injection.** The plugin keeps `inject: ['skills']` and
probes `webServer`, `connection`, `agents`, and `workingDirectory` with `ctx.get` at apply time; the
route registers only when all four exist. CLI/TUI/ACP hosts therefore keep the six skills. Alternative:
a second bundle row or package for the Web-only half, rejected as extra surface.

**Structural contracts, no new dependency.** The client command API and the Web host services are
typed locally (the repo already hardcodes DSH contracts where a runtime import is unwanted), because
the client UI packages version independently and are absent from the repository's pinned
devDependencies. A short `shortcut:` comment records the reference version and the upgrade point.

**Workspace-local root guard.** Before spawning, the route requires `<workspace>/openspec` to exist. After
parsing, it compares the CLI's reported `root.path` (realpath, case-insensitive on Windows) with the
workspace path and rejects a mismatch. OpenSpec 1.15 resolves ancestor roots, declared stores, and the
global default store, so this guard is what keeps the picker to the plugin's project-local root model;
without it a nested workspace would list its parent's or a store's changes.

**Untrusted session id and process control.** The route accepts only the session id and resolves it
through the host registry; an unknown id is rejected. No request text reaches the command line: the argv
is fixed (`list --json`), and on Windows it runs through `cmd.exe /d /s /c` because the npm-installed
`openspec` is a `.cmd` shim. A 10-second timeout terminates the whole spawned process tree
(`taskkill /pid <pid> /T /F` on Windows, the detached process group on POSIX) and then settles the
request with a timeout error, so the shim's Node grandchild cannot outlive the call. Output is parsed as
JSON; a non-zero exit, `"root": null`, a root mismatch, or malformed output becomes a readable `Error`.

**Native failure surface.** `options()` rejects with a message for an absent CLI, missing root,
timeout, or unparsable result; the shell renders its own error strip with retry. No custom toast,
modal, or empty-state component.

**Row mapping.** One option per change: label = change name, detail = `<completed>/<total>`; no groups
and no custom icons. The shell's default substring search ranks them locally.

## Risks / Trade-offs

- [rc.3 client lacks the command service] → the client entry's `inject` makes it inert; skills and the
  hand-typed line keep working; the tasks verify rc.3 behavior first.
- [The command appears in every session of an installed profile] → a non-OpenSpec workspace shows the
  readable error/empty state from the spec; accepted for v1 and documented.
- [CLI latency] → the shell shows its loading skeleton; no cache is added until the recurrence is real.
- [OpenSpec resolves an ancestor root or a store] → the workspace-local root guard rejects the result
  with the no-root error before any row is shown.
- [The Windows shim's Node grandchild outlives a simple child kill] → the timeout kills the process tree
  and settles the response after the kill.
- [Windows shim and PATH differences] → the runner adapts per platform and maps a missing executable to
  the documented prerequisite error.
- [Structural type drift against a future DSH] → the picker contract tests and the `shortcut:` comment
  name the reference version; a DSH bump re-verifies the client API.
- [The module note contradicts the new spawn] → the note and `docs/plugins.md` are updated in the same
  change; no spec requirement depended on the old wording.

## Migration Plan

No data migration and no install-time action. The feature ships with the next package version and the
regenerated setup tree. Rollback is disabling the plugin row, which returns the profile to the
skills-only behavior; the hand-typed `/openspec-apply-change` line never depended on the picker. The
new command disappears with the client half.

## Open Questions

- A short per-workspace result cache is deferred; it is invisible to the specs and can be added later.
- Store support is out of scope; the plugin's project-local root model is unchanged.
