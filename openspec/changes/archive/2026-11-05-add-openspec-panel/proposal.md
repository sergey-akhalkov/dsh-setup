# Proposal

## Why

OpenSpec artifacts are plain Markdown in the workspace, and DeepSeek Harness already renders Markdown
natively in its right column, but reading a change today means walking a file tree or asking the agent
to print files. The reading loop — which changes are open, what a change is for, what it designs, what
it changes in the accepted specs, which tasks are done — is navigation the harness can own.

The right column already hosts plugin-provided tab types (Files, Terminal, Browser, Plan), and the
build already compiles a client half for `@dsh-setup/plugin-openspec`. No new surface, package, or
mechanism is needed to close that loop.

## What Changes

- Add an **OpenSpec panel**: one plugin-contributed tab type in DSH's right sidebar, opened from a
  Start-page guide card, from the sidebar panel list, and from a client command.
- **Root view** shows `openspec list` as the default: one row per change with its status, its task
  progress, and which artifacts it already carries. A second segment lists the workspace's capability
  specs (`openspec list --specs`), so the panel still has content when no change is open.
- **A change opens as its own tab**, titled by the change name, with artifact tabs: Why
  (`proposal.md`), Design (`design.md`), Specs (each delta spec, one per capability), Tasks
  (`tasks.md`). Artifacts render through the shared markdown renderer, so typography, links, tables
  and code fences match the conversation.
- **Live updates.** An open change or capability view follows its Markdown through DSH's shipped
  workspace-file observation: saving `tasks.md` or any artifact re-reads that view after a short
  debounce and updates the rendered Markdown and task progress, and each view states when its files
  were last modified. No polling loop, heartbeat, or plugin-owned watcher.
- **Read-only.** The only outward action writes a command draft into the composer (`Apply change` →
  `/openspec-apply-change <name>`, no auto-submit). The panel never archives, syncs, ticks a checkbox,
  or otherwise mutates the workspace.
- **Two read-only host routes** beside the existing change-list route: one for a change's artifacts,
  progress and last-modified times, one for the capability inventory and a single capability's spec
  and last-modified time. All three resolve the workspace from the session and keep the existing
  workspace-local root guard.
- Ships **inside the existing `@dsh-setup/plugin-openspec` package**: no new package, bundle row,
  market entry, install script, or runtime dependency. The shipped DSH client component library is a
  host-provided `external` client module, and its types are a build-time dev dependency.

## Capabilities

### New Capabilities

- `openspec-panel`: the right-sidebar surface that lists a workspace's OpenSpec changes and capability
  specs, opens one change per tab, and renders its artifacts read-only with natively styled tabs,
  states and navigation.

### Modified Capabilities

- `openspec-apply-picker`: the "Native picker registration" requirement currently forbids the plugin
  from shipping its own React components, styles, or icons. That clause is scoped to the picker's own
  presentation, because the same package now ships a second client surface whose body is a component
  built from the shipped component library.

## Impact

- `packages/plugin-openspec`: `src/client/index.ts` becomes `src/client/index.tsx` and gains the panel
  and its live file subscriptions; `src/host/change-detail.ts` is new and reports artifact bodies,
  presence and last-modified times; `src/host/index.ts` registers the two new routes; `test/` gains
  coverage and `test/apply-picker.test.ts` needs its import path and one fake-service stub updated.
- `package.json`: the description states the panel, `@deepseek-ai/dsh-client-ui-primitives` is added as
  a dev dependency at the pinned DSH version, and `dsh.client.external` names it. `dsh.client.inject`
  does not change.
- `locale/en.json` and `docs/plugins.md` describe the widened plugin; `packages/setup` is regenerated
  with `pnpm gen`.
- DSH client surfaces consumed: `sidebarRightTabs`, `sidebarRight`, `resources`, `slots`, `locale`, and
  `@deepseek-ai/dsh-client-ui-primitives`.
- Unverified: the right-sidebar services and the `file` resource provider on DSH 0.2.1-rc.3. The panel
  must activate only when the right-sidebar services exist, so a host without them keeps the picker and
  the six skills working; a host without file observation keeps the panel on its native refresh and
  hidden-to-visible re-read.
