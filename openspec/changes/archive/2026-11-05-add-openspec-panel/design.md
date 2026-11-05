# Design

## Context

See `proposal.md` for motivation and `specs/openspec-panel/spec.md` for the behavior contract. What
shapes the approach:

**The package already has both halves.** `@dsh-setup/plugin-openspec` registers the six skills through
`ctx.skills.registerProvider`, ships a client half at `src/client/index.ts` that registers
`/openspec-apply` on `ctx.commandUi` with the native `popupSelect`, and serves a read-only route at
`/api/plugins/dsh-setup-openspec/changes` through `connection.fetch`. That route already resolves the
workspace from the session id, refuses a workspace with no local `openspec/` root, and bounds the CLI
call by killing the whole spawned process tree. Everything the panel needs to read is behind that
pattern.

**Build and typecheck already accept a component client half.** `scripts/build.ts` prefers
`src/client/index.tsx` over `.ts`, bundles it with esbuild (`format: cjs`, `jsx: automatic`) and
externalizes `react`, `react-dom`, `react/jsx-runtime` plus whatever `dsh.client.external` names. The
package `tsconfig.json` compiles only `src/host`. `plugin-admin-indicator` and `plugin-observability`
have exactly this shape today, so the client half stays esbuild-only and no build configuration
changes.

**The right column is a plugin-extensible surface.** `rightbar` → `rightbar.session` declares keyed
slots `sidebar.right.pane.tab` and `sidebar.right.pane.tab.title`, dispatched by *the `id` of the type
in force for `tab.kind`*. A type registers through `ctx.sidebarRightTabs.register({id, kind, patterns,
canOpen, title, guide})`, is opened through `ctx.sidebarRight.openResource(address, {params})`, and the
tab record is keyed by the address, so the same address focuses instead of duplicating. `title(address)`
computes a per-tab title, and `guide` entries in the same registration render as Start-page cards.
Shipped occupants: guide, document, terminal, files, browser, subagent, deliverables, plan,
schedule/task. `dsh-client-ui-plan` is the closest precedent — a resource-backed type with its own body
and title slots, opened from a chat card.

**The house component library covers every surface the panel needs.** `MarkdownText` renders the same
GFM/KaTeX document as the conversation; `SegmentedControl` supports a per-segment `disabled` flag and
`title`; `Tag`, `StateDot`, `Pill`, `Button`, `Menu`, `Tooltip` and the icon set ship with it.

## Goals / Non-Goals

**Goals:**

- One tab type that a user reaches in one activation from the Start page and that behaves like a shipped
  tab under docking, splitting, floating, fullscreen, close, and refresh.
- Drill-down that stays addressable: a change, a capability, and a starting artifact are all reachable
  by address, so tabs restore and a repeated open focuses instead of duplicating.
- Live updates through the host's own file observation: a saved artifact reaches the open view after a
  short debounce, and each view states when its files were last modified.
- The whole read path uses the documented CLI for lists and counts, and the same workspace-local guard
  for everything else.
- Graceful degradation on a host without the right sidebar.

**Non-Goals:**

- The archive. `openspec list` does not report archived changes and `openspec show` rejects their names
  (`unknown_item`), so an archive browser would need its own filesystem walk and date-prefixed name
  parsing — a separate change, not a hidden extra here.
- Any write: archive, sync, validate, task ticking, artifact editing.
- Per-task actions, change-to-change diffing, a polling loop, a heartbeat, or a plugin-owned filesystem
  watcher; live updates reuse the host's shipped file observation.
- Changing the six skills, their descriptions, or the picker's behavior.

## Decisions

### D1 — The panel ships in `@dsh-setup/plugin-openspec`

Alternatives: a new `plugin-openspec-panel` package. Rejected: it would add a bundle row, a market
entry, a package version, an installer selection, and a second copy of the workspace-local root guard
and CLI runner, to gain nothing — capability boundaries in this repository already live *inside* a
package (`openspec-apply-picker` is a capability of this same package, `observability` a capability of
`plugin-observability`).

Cost accepted: the package description widens from "six skills" to "skills plus a panel", and its
client bundle grows. Both are one-line manifest facts, not architectural costs.

### D2 — Address-keyed tabs, opened as resources

The root view is a **page address**, because that is the address the Start card actually produces: the
shipped guide body activates an entry with `tab.actions.openTab(entry.kind, …)`, which the host
addresses as `sidebar://<kind>`. Deeper views are **resource addresses**, because they must be
deep-linkable and restorable. One registration covers both: `patterns: ['sidebar://openspec',
'dsh-resource://openspec/**']` with a `canOpen` that accepts exactly these shapes and nothing else.

| Address | Shows |
| --- | --- |
| `sidebar://openspec` | root view, Changes segment — what the Start card, the panel list, and the command open |
| `dsh-resource://openspec/specs` | root view, Specs segment |
| `dsh-resource://openspec/change/<name>` | one change, artifact tabs |
| `dsh-resource://openspec/spec/<id>` | one capability spec |

The tab record is keyed by `contentId: address`, unmodified, so exactly one address per view is the
rule: `dsh-resource://openspec/change/add-auth` is the only identity the change `add-auth` ever has.
Artifact selection therefore never enters the address — it is the tab's own state, optionally seeded
the first time through the `params` passed to `openResource`. A `?artifact=` suffix would mint a
second address for the same change and defeat the deduplication the spec requires.

Alternatives considered:

- **Everything as a page type opened by kind.** Simple, but a page address carries no item, so two open
  changes could not coexist and a change could not be linked to or restored.
- **Everything as a resource address, root included.** Consistent, but the Start card cannot produce it:
  the host's own card activation is `openTab(kind)`. Rejecting `sidebar://openspec` would leave the
  primary entry point pointing at an address the type refuses.
- **In-place navigation in one tab.** One chip, but a second change then needs a back button and two
  changes cannot stand side by side — losing exactly the comparison a spec review does.

Refresh is **not** automatic: the host blocks `page.refresh` unless the tab supplies its own refresh
command, so the panel binds one to its read operation (see D10).

### D3 — Activation through `ctx.inject`, never the exported `inject` array

The plugin's exported `inject = ['commandUi', 'sessions', 'conversation']` gates the *whole* client
half. Adding `sidebarRight`/`sidebarRightTabs` there would make a host without the right sidebar drop
the picker and, by the picker spec, register nothing at all.

`ctx.inject(deps, callback)` (cordis `Registry.inject`) runs the callback only once the named services
exist, inside a child context whose effects dispose with them. The panel registration lives there.

Alternative rejected: probing with `ctx.get('sidebarRightTabs')` inside `apply`. The sidebar plugin is
not a declared dependency of this package, so load order is not guaranteed and the probe would lose a
race on a host that happens to load it later.

### D4 — CLI for lists and counts, guarded file reads for artifact bodies

Lists come from the documented CLI in both cases: `list --json` for changes, `list --specs --json` for
capabilities. Re-implementing them as directory scans would fork the CLI's resolution rules (`--store`,
ancestor roots, `defaultStore`) — the reason the picker spec already forbids it.

Artifact bodies come from files, because no CLI command returns them: `show` describes specs and a
change's requirement deltas, not the text of `proposal.md`, `design.md`, or `tasks.md`. The read is
fenced three ways: the change name must appear in the result of `listWorkspaceChanges` for that
workspace; the path is then built by joining under `<workspace>/openspec/changes/`, never from request
text; and the resolved path is compared against that boundary. A capability id gets the same treatment
against `<workspace>/openspec/specs/`. Requests carry a session id and an item name, never a path.

Two new routes, both exact paths in the style of the existing one — no path parameters, the workspace
always derived from the session:

| Route | Returns |
| --- | --- |
| `GET /api/plugins/dsh-setup-openspec/change?session=<id>&name=<change>` | every artifact body, the presence set, the progress counts, and each artifact's last-modified time |
| `GET /api/plugins/dsh-setup-openspec/specs?session=<id>` | the capability inventory |
| `GET /api/plugins/dsh-setup-openspec/specs?session=<id>&id=<capability>` | that capability's spec body and last-modified time |

The second path carries two shapes deliberately: the inventory and one entry of it are one read model,
and a separate route would duplicate its guard.

### D5 — One response per change, not one per artifact tab

The change-detail route returns every artifact body, the artifact-presence set, the progress counts, and
each artifact's last-modified time in a single response. These are local reads of a few tens of
kilobytes, so four round trips (and four loading states) would cost more than they save; one response
makes artifact switching instant and gives the artifact tabs something to be disabled *about* — presence
is known before the first click. The last-modified fact arrives with the content it describes instead of
as a second request that could race it.

### D6 — The root view has two segments

`Changes | Specs` via one `SegmentedControl`. With zero open changes — the state this repository is in
today — a changes-only panel is an empty state and nothing else. The capability inventory is the durable
side of the same workspace and reuses the same renderer, so the second segment costs a route and a list
row, not a second surface. A separate specs tab (a second chip) was rejected: same data, more chrome.

### D7 — Reuse the component library, own only layout

| Surface | Component |
| --- | --- |
| Artifact tabs | `SegmentedControl` — per-segment `disabled` + `title` is exactly how a missing artifact is explained |
| Artifact body | `MarkdownText` — a rendered `design.md` and a rendered assistant message are the same document |
| Change status | `StateDot` + text |
| Artifact presence | `Tag tone="quiet"` |
| Delta-spec switcher | `Pill` |
| Header actions | `Button` + `Menu` |
| Disabled reasons | `Tooltip` |

Only layout uses new CSS (flex, gap, overflow), on `--dsw-*` tokens. No colour, type size, radius, or
shadow of the panel's own. Alternative rejected: hand-written markup and CSS as `plugin-observability`
does for its dashboard — that precedent exists, but each surface here maps one-to-one onto a shipped
primitive and the owner asked for the native look.

### D8 — Read-only, with one composer handoff

The panel's only effect outside itself is
`conversation.input.for(sessions.scope(sessionId)).setDraft('/openspec-apply-change <name>')` — the same
call the picker makes, no submit, focus left in the composer. The empty state uses it for
`/openspec-propose `.

Rejected: ticking checkboxes in `tasks.md` (it would corrupt lane and review state and needs its own
confirmation model), and running `openspec validate` or `openspec archive` from the panel (long-running,
write-adjacent, and gated by review approval, with nowhere to show the outcome in a sidebar).

### D9 — The picker's no-own-UI clause gets scoped, not worked around

`openspec-apply-picker` requires that the plugin "MUST NOT ship its own React components, styles,
icons, or popup". A tab body is a React component, so that sentence as written forbids this change.
Rather than silently contradict an accepted requirement, the delta narrows the clause to the picker's
own presentation and adds a scenario asserting the picker is unchanged. The panel's own spec carries the
composition rule it needs (component library as a host-provided external).

### D10 — Bind the refresh the shell owns and live updates to the shipped file watch

`page.refresh` is refused for a tab that does not supply it: the occurrence carries
`commands.refresh`, and the tab body publishes it through the shipped `actions.bindCommands` surface.
The panel binds a callback that re-reads its current request and disposes it with the body, and also
re-reads when the tab becomes visible after being hidden.

Live updates use the file observation the host already owns, not a second watcher. Every slot body
receives the standard `useResource` hook; the shipped `file` resource provider
(`@deepseek-ai/dsh-client-workspace-files`) wraps the Host's `workspaceFiles.changes` feed, which starts
`fs.watch`/Chokidar before its `ready` frame and streams `{absolutePath, version}` or an absence
notice, with one shared stream per Session and path. A change view renders one no-output subscription
per artifact it shows — `proposal.md`, `design.md`, `tasks.md`, and each delta
`specs/<capability>/spec.md` — at `dsh-resource://file/session/<sessionId>/<path>`; a capability view
watches its `specs/<id>/spec.md`. Observation readiness and the route response are independent, so the
first `live` version cannot be trusted as the content's version: the first reports from a view's
subscriptions schedule one bounded, debounced reconciliation re-read, which closes any save that landed
between the content response and observation readiness. After that, a changed version, an appearance,
or an absence schedules one 300 ms-debounced re-read of that view's host route, which refreshes bodies,
progress, and the last-modified fact together. Subscriptions and a pending timer dispose with the body,
and no timer runs while nothing changes. When the provider is absent (`status: none`, e.g. an older
host), the views keep working through the native refresh and the hidden-to-visible re-read.

Alternatives rejected: a polling timer (a new moving part in every session, and the owner asked for
push-style updates), and a plugin-owned filesystem watcher (it would duplicate the host's `fs.watch`,
queued changes, path normalization, cancellation, and per-path stream sharing).

## Risks / Trade-offs

- **Right-sidebar services absent on DSH 0.2.1-rc.3** → D3 gates activation; no panel, picker and six
  skills unaffected. The `file` resource provider is unverified on that version too; where it is absent
  the panel still renders and stays on native refresh. Verify on both supported versions during the
  integration task, not by assumption.
- **`dsh-client-ui-primitives` becomes a load-time external** → if a host did not provide it, the client
  module would fail to load and take the picker with it. Mitigated by the fact that
  `plugin-admin-indicator` already ships this exact dependency shape on both supported versions, and by
  pinning the dev dependency so the types cannot drift. Residual risk: a host that strips the module
  table is untested.
- **Narrow column** → rendered tables and code fences can exceed the pane. Mitigated by design at the
  narrowest supported width, scrolling inside the offending block, never horizontally on the panel
  (spec scenario "Narrow panel").
- **Stale tabs for a deleted change** → the address outlives the change. Mitigated by the detail route
  answering with the unreported-item error and the body rendering the cause with retry; closing the tab
  is one click.
- **The package's `files` array is an explicit allowlist** → a new emitted host module that is not
  listed ships a package whose entry imports a missing file, so the plugin fails to load at all. This is
  the sharpest failure mode here and it is silent in every local check. Mitigated by listing every new
  emitted module in the same task that creates it, plus a generated-tree check that the vendored package
  carries it (task 3.1).
- **Live updates depend on the shipped file observation** → on a host without the `file` resource
  provider the view stays manual; on every host the debounce bounds re-reads to one per edit burst, and
  subscriptions exist only while a view is mounted. Each debounced re-read of a change runs one
  `openspec list`, so a very slow CLI delays the content update rather than duplicating calls.
- **A long artifact body in a narrow pane** is the worst case for `MarkdownText`'s document typography →
  the default `body` variant is kept (consistency with the conversation) and the task list carries a
  check against the narrowest width rather than a second variant.

## Migration Plan

Additive; no configuration, option, or stored-state migration. The bundle row and `dsh.client` package
name are unchanged; `pnpm gen` regenerates `packages/setup` with the widened package. Rollback: disable
the plugin's row (which also removes the six skills) or ship a patch dropping the panel registration.
The only state the panel creates is the per-session tab layout DSH already owns, and closing the tab is
harmless.

## Open Questions

- Whether the panel also deserves a client command entry (`/openspec`) in addition to the Start card and
  the sidebar panel list — purely an entry-point count, answerable during implementation without
  touching the specs or the task lanes.
