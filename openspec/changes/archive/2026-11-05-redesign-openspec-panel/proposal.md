# Proposal

## Why

The shipped right-sidebar OpenSpec panel renders the workspace's changes and accepted specs, but it
answers too few questions to be a reading surface. A change row states a task fraction and four quiet
artifact tags, with no summary of what the change is for, no status a reader can act on, and no commit.
The capability list is a bare name and a requirement count, and an accepted spec page is one long
Markdown dump: it cannot say which archived change produced it, when that change closed, whether its
tasks were all done, or on which commit it landed. With no active changes in this repository the Changes
screen is a single sentence and one button, while thirty-four archived changes and their proposals,
designs and task lists are invisible. Going back from a spec always lands on Changes even when the user
was browsing Specs. The panel also ignores the structure the CLI already provides: `openspec show
--json` returns the purpose, requirements and scenarios as data, so the raw Markdown is rendered
flatter than it needs to be.

## What Changes

- **Root view**: a workspace header with `Explore` and `Propose` actions, and three counted segments —
  `Changes | Specs | Archive`. Both actions write a composer draft (`/openspec-explore ` or
  `/openspec-propose `) without submitting. The last viewed segment is remembered for the session, so
  returning from a spec restores it.
- **Changes**: each row becomes a card carrying the change's status (planning, ready to apply,
  applying, complete, archived) as a coloured tag, a task progress bar, the artifact facts, a one-line
  summary taken from the proposal's `Why`, relative last-updated time, and the last commit. The empty
  state keeps the two actions, states the workspace's archive/spec totals, and lists the most recent
  archived changes instead of a single sentence.
- **Specs**: each row states the capability's purpose in one line, its requirement count, and its
  provenance — the archived change that last touched it, the archive date, that change's task
  completion and its short commit hash. The list is searchable by name and purpose.
- **Spec detail**: requirements render as structured cards from `openspec show <spec> --json`, with
  `SHALL`/`MUST` and scenario `WHEN`/`THEN` steps visually marked and one card per requirement instead
  of a Markdown wall. A `History` tab lists every archived change whose delta spec touched this
  capability, newest first, with date, task completion and commit; choosing one opens that archived
  change in its own tab. A requirement filter appears for long specs.
- **Change detail** (active and archived): a header with the status tag, progress bar, last-updated
  time, commit and archived date where applicable; `Why | Design | Specs | Tasks` tabs. Delta specs
  render as structured requirement cards with an `ADDED`/`MODIFIED`/`REMOVED` badge and a link to the
  accepted capability spec. `Tasks` renders a grouped checklist with per-group progress instead of a
  Markdown file. Archived changes open from `Archive` and from a spec's `History`.
- **Archive**: a searchable, reverse-chronological list of archived changes with date, task completion
  and commit; opening one shows the same change view.
- **Git provenance**: read-only `git log` facts (short hash, ISO date, subject) for a change directory
  or a capability spec file, computed in the Host; when git or a repository is absent the facts are
  omitted and the panel keeps working.
- **Host reads**: the change-list route keeps its established active-row contract for the apply picker,
  adds archived rows as a separate additive list, and carries all three root totals so the header is
  complete before any segment body loads; the change route reports archived changes, structured deltas,
  and provenance; the specs route reports purpose, structured requirements, history and commits. The
  CLI stays the source for names, counts, status and structured requirements; files remain the source
  for artifact bodies.
- **Read-only is preserved**: the panel still owns no write except the composer drafts; it never
  archives, syncs, ticks a task, or edits a file.

The existing behaviour that stays: one tab per change, one tab per capability, live file observation
for active views, native refresh, session-scoped reads and the workspace-local root guard.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-panel`: the root view gains an Archive segment, remembered segmentation and visible
  Explore/Propose actions; change rows and change detail gain status, summary, progress, commit and
  archived facts; the capability list and detail gain purpose, provenance, structured requirement
  rendering and history; archived changes become openable read-only.

## Impact

- `packages/plugin-openspec/src/host/change-list.ts` and `change-detail.ts`: new read shapes, an
  archived-change path, summary extraction, archive history mapping, structured `openspec show`
  parsing and a bounded, optional git-log reader.
- `packages/plugin-openspec/src/host/index.ts`: the three existing read routes return the wider shapes;
  no route is removed.
- `packages/plugin-openspec/src/client/panel.ts` and `index.tsx`: new address kind for archived changes,
  remembered root segment, the three-segment root, cards, structured requirement/task renderers,
  spec history and panel styling limited to `--dsw-*` tokens and shipped primitives.
- `packages/plugin-openspec/locale/en.json`, tests and `docs/plugins.md` follow the new copy and
  behaviour; `packages/setup` is regenerated.
- New machine interaction: read-only `git log` in the workspace. It is optional and degrades to no
  commit facts; no new runtime package, bundle row, market entry, install script, or write is added.
