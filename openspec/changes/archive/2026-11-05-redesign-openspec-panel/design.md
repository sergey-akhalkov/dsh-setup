# Design

## Context

See `proposal.md` for motivation. The panel already has the hard parts done: one tab type in the right
sidebar, three workspace-scoped read routes, one tab per change/capability, live observation through the
shipped `file` resource provider, and composer-draft handoff. What it lacks is a data layer that uses
what OpenSpec already knows, and a visual system that turns that data into something scannable.

Constraints that shape this work:

- The OpenSpec CLI 1.15 reports more than the panel uses: `list --all --json` returns active and
  archived rows with `lastModified` and task counts; `show <item> --json` returns purpose, structured
  requirements and scenarios; `list --specs --json` returns the capability inventory. Archived changes
  are not addressable through `show`, so their artifacts stay file reads.
- The panel must stay read-only, workspace-local, and free of polling. Its one write is a composer
  draft. The existing root guard (`<workspace>/openspec`, canonical realpath containment, CLI-reported
  names only) applies to every new read.
- The plugin ships no runtime dependency, and the DSH client primitives are a host-provided external
  module. There is no component test DOM: client tests render through the same hook/element mocks the
  panel already uses.
- The right sidebar's narrowest width is the layout budget. Every design below must work there without
  horizontal scrolling.

## Goals / Non-Goals

**Goals:**

- A reader can answer, without opening a file: what is open, what it is for, how far it is, what it
  will change, when it last moved and on which commit.
- An accepted capability explains its own purpose and shows which archived change produced it, when
  that change closed, whether its tasks were done, and the commit it landed on.
- Dense OpenSpec Markdown (requirements, scenarios, task lanes) renders as structured, scannable
  content with meaningful emphasis, not as one typographic wall.
- The panel looks deliberately composed: clear tiers, cards, semantic colour, icons and progress, all
  from host tokens and primitives — no new visual vocabulary.
- Returning from any detail view preserves the root segment the user was browsing.

**Non-Goals:**

- No editing, archiving, syncing, validating, task ticking, or checkbox interaction.
- No new package, bundle row, marketplace entry, runtime dependency, or persisted configuration.
- No polling, watcher, or background refresh beyond the existing shipped file observation.
- No full-text search service, fuzzy ranking, or indexed store: filters are in-memory over the loaded
  rows.
- No replacement of the shared Markdown renderer for proposal/design bodies.
- No validation-report UI in this change.

## Decisions

### D1 — Three root segments with a counted workspace header

The root becomes `Changes | Specs | Archive`, each label carrying its count. The header states the
workspace summary (`N changes · N specs · N archived`) and carries the two next-step actions:
`Explore` (outline, browse icon) and `Propose` (primary, plus icon). Both write composer drafts:
`/openspec-explore ` and `/openspec-propose `, never submitting. The empty Changes state repeats those
two actions as larger cards and adds the three most recent archived changes so the screen is never a
dead end.

Why `Archive` instead of putting archived rows in Changes: this repository usually has zero active
changes and thirty-four archived ones, and archived work is the real reading material — proposals,
designs, task lanes. A separate segment keeps Changes honest (open work only), gives archive browsing a
home, and reuses the same change view. Alternative considered: a "Recent" strip only. Rejected because
old changes would be unreachable unless a capability happened to reference them.

Why counts in labels: they are the cheapest orientation fact and prove the segments load independently.

### D2 — Remember the root segment per session

`RootBody` currently derives its segment from the tab address, so returning from a change/capability
resets to Changes. The browser back/tab return path is host-owned and not worth fighting. Instead the
client keeps the last viewed segment in `sessionStorage` under a namespaced key containing the session
id, and `RootBody` initializes from it: an explicit `SPECS_ADDRESS` still wins, otherwise a stored
segment wins, otherwise Changes. Switching a segment writes the key. A fresh session has no key and
opens on Changes.

Why `sessionStorage`: it survives tab navigation and reloads, is naturally scoped to the session and
browser, and does not create cross-session surprises. A module-level map was rejected because a reload
would forget it; `localStorage` was rejected because it leaks across sessions.

### D3 — Host is the data assembler; the client only renders

The client keeps one fetch per screen. The Host composes CLI truth, file bodies, archive scans, and git
facts into view-shaped JSON:

- `GET /changes` runs `openspec list --all --json` once and `openspec list --specs --json` once, then
  returns `{ changes, archived, counts }`. `changes` keeps the established active-row contract, extended
  additively with presence, summary, commit and a derived `phase`; `archived` is a separate additive
  list; `counts` carries active, archived and capability totals so the root header is complete before
  Specs is opened. The picker keeps reading `changes` only, so an already-loaded older client still sees
  just unfinished active rows.
- `GET /change?name=` takes an explicit `archived=1` and resolves the name against that family only
  (active by default, archived when set): no fallback, because the two directories may hold the same
  name. Active changes use `openspec show <name> --json --type change` for structured deltas; archived
  changes read the files under `openspec/changes/archive/<name>/` and parse their delta specs. Both add
  summary, commit, and archive facts.
- `GET /specs` returns the capability inventory with purpose, requirement count, last-modified time,
  last commit, and the newest archived change that touched each capability.
- `GET /specs?id=` adds structured requirements from `openspec show <id> --json --type spec` and the
  full history for that capability. The explicit type is mandatory: a change and a capability may share
  an identifier, and the CLI rejects the ambiguous read.

Why Host-side: request-named filesystem paths stay forbidden, the CLI and git run in the workspace, and
the client stays a view. Alternative considered: client-side `openspec` calls. Rejected — the browser
cannot spawn processes, and moving the trust boundary into the client would weaken the existing guard.

### D4 — Reuse the change tab and change route for archived changes

An archived change gets its own address family, `dsh-resource://openspec/archive-change/<name>`, while
the existing `dsh-resource://openspec/change/<name>` keeps addressing active changes. The change route
receives an explicit `archived=1` for the archive family and resolves the name against that list only;
it never falls back from one family to the other. The change view shows the archive treatment and hides
the apply action. This is required because OpenSpec permits a date-prefixed active change to share its
name with an archived change, so one address for both would focus the wrong tab and serve the wrong
files.

Why a separate address rather than a query parameter on the change address: a tab's identity is its
address, and the sidebar deduplicates by address; a discriminator inside the address is what makes two
identically named changes two tabs. Existing active addresses are unchanged, so no open link or saved
tab breaks. The tab chip shows the full archived name because the date prefix is the identity; the view
header splits it into the change name and a separate archive date.

### D5 — Provenance: archive scan for "which change produced this spec", git for "which commit"

A capability's history is computed by scanning `openspec/changes/archive/*/specs/<id>/spec.md`
(newest first by the directory's ISO date prefix). Each entry joins the archived row's task counts with
its commit. The spec list needs only the newest entry per capability and gets it from one scan that
builds a `capability -> newest entry` map. Git facts come from one bounded `git log` per request:

- list request: one `git log -n 300 --name-only` over `openspec/specs` and `openspec/changes`, parsed
  newest-to-oldest into a `path -> commit` map (first hit per path wins);
- detail request: one bounded `git log -n 300 --name-only` over the item's own path plus, for a
  capability, every archived producer directory and that producer's delta spec file, so the accepted
  spec and each history row get their own commit from the same call.

All git calls use `execFile` (no shell), fixed arguments, `windowsHide`, a 5-second bound, a 2 MB
output cap, and pathspecs after `--`. A failure (not a repository, git missing, timeout) resolves to
`null` and the route succeeds without commit facts. The client renders commit facts only when present.

Why one batched log instead of one call per row: thirty rows would mean thirty processes on Windows.
Why not read `.git` directly: brittle, and git's own path filtering already answers the question.

### D6 — Summaries come from the proposal's `Why`

For a change (active or archived), the summary is the first non-empty paragraph under `## Why` in
`proposal.md`, whitespace-collapsed and capped at 240 characters. Fallback order: first paragraph of
the document, then `null`. The client clamps the card to two lines and keeps the full text in a
tooltip. For an accepted capability, the summary is the CLI's `overview` (the Purpose text), with the
file's `## Purpose` section as a fallback when the CLI shape changes.

Why not derive summaries from the change name: names are terse (`goal-continuity`) and the user
explicitly asked for "what is it in two words" from the actual prose.

### D7 — Structured requirements with a small inline renderer

For accepted capabilities and active change deltas the CLI already returns:

```
{ name, text, scenarios: [{ name, rawText }] }
```

The panel renders one card per requirement. Requirement text is rendered by a small inline renderer
that understands backticked code, `**strong**`, `*emphasis*`, and http(s) Markdown links; everything
else stays text. A keyword pass marks `SHALL`, `MUST`, and `MUST NOT` (word-boundary, case-sensitive)
in the normative tone without altering the text. Scenario `rawText` is split into its `WHEN` / `THEN` /
`AND` / `BUT` bullets; each line becomes a labelled row with a small uppercase step tag and the rest
inline-rendered.

Archived deltas have no CLI output, so the same shape is derived from the delta Markdown: `## ADDED |
MODIFIED | REMOVED | RENAMED Requirements` gives the operation, `### Requirement:` starts a
requirement, `#### Scenario:` starts a scenario, and the bullet lines below it become the scenario's
`rawText`. `RENAMED` sections carry no requirements: their `- FROM: ### Requirement: <old>` and
`- TO: ### Requirement: <new>` bullets become a `{ from, to }` pair on the delta (bullet marker
optional, matching the CLI). The parser preserves the text verbatim; it does not rewrite or normalize
prose. A mixed file keeps every section it can parse and marks any section it cannot as unsupported
instead of discarding the whole delta; the raw Markdown fallback is used only when no section parses at
all.

Why not render requirements through `MarkdownText`: keyword emphasis and card/scenario structure are
not expressible through the shared renderer's props, and post-processing its HTML would be brittle.
The inline renderer is small, dependency-free, and the only place that interprets Markdown. Proposal
and design bodies keep `MarkdownText`.

### D8 — Task checklist from `tasks.md`, counts cross-checked with the CLI

`tasks.md` is parsed into groups by `##` headings and tasks by the pinned CLI's exact task-line grammar
from `dist/utils/task-progress.js`: any CommonMark list marker (`-`, `*`, `+`, or `1.`/`1)`), optional
leading whitespace, and one non-whitespace marker in the checkbox (`[ ]`, `[]`, `[~]`, `[ x ]`) — only
`x`/`X` counts as done, and a single-token label followed by `(` or `[` is a link, not a task. Every
matching line counts, including nested sub-tasks, so the sum equals the CLI's numerator and
denominator. Each group gets its own `done/total`; the header keeps the CLI's overall counts. Task text
goes through the inline renderer so backticked paths stay code. Done tasks use the step-done mark and
tertiary text; pending tasks use the empty step and primary text. There is no checkbox interaction.

The parsed files are the ones the CLI counts: for an active change, the task artifact paths reported by
`openspec status --change <name> --json`; for an archived change, `tasks.md` plus any `tasks/*.md` /
`tasks/**/*.md` files the change carries. If the parsed total ever differs from the CLI total (a schema
with a different tracking glob), the header keeps the CLI number and the checklist shows a one-line
note naming the unparsed remainder instead of silently disagreeing.

Why parse tasks when the CLI returns counts: counts alone do not tell a reader which tasks remain, and
that is the question the Tasks tab exists to answer. The file is the same one the CLI counts.

### D9 — The visual system: hosted primitives, semantic tokens, one card grammar

The panel introduces no new control and no literal colour. It composes shipped primitives with
`--dsw-*` tokens:

| Tier | Token / primitive | Use |
| --- | --- | --- |
| Detail title | `--dsw-font-m-18` (strong) | change name, capability id |
| Panel title | `--dsw-font-base-strong-16` | `OpenSpec` header |
| Card title | `--dsw-font-s-strong-14` | change/capability/requirement names |
| Body | `--dsw-font-xs-13` | purpose, requirement text, task text |
| Meta | `--dsw-font-xxs-12` | dates, counts, commit, artifact facts |
| Group label | `--dsw-font-xxxs-strong-11` + letter spacing | `In progress`, `Recently archived`, lane headers |
| Inline code | `--dsw-font-markdown-code` | backticked text |
| Card surface | `--dsw-alias-bg-layer-1`, `--dsw-alias-border-l2`, `--dsw-radius-md` | change/spec/requirement cards |
| Card hover | `--dsw-alias-interactive-bg-hover` | whole-row hover |
| Primary text | `--dsw-alias-label-primary` | titles |
| Secondary text | `--dsw-alias-label-secondary` | purpose |
| Tertiary text | `--dsw-alias-label-tertiary` | meta, captions |
| Progress | `--dsw-alias-state-business-primary` fill, `--dsw-alias-bg-module-platform` track | task progress |
| Success | `--dsw-alias-state-success-primary` (via `Tag tone="success"`) | complete, `THEN` |
| Info | `--dsw-alias-state-business-primary` (via `Tag tone="info"`) | ready/applying, `ADDED`, `WHEN` |
| Warning | `--dsw-alias-state-warn-primary` (via `Tag tone="warning"`) | planning, warnings |
| Danger | `--dsw-alias-state-error-primary` (via `Tag tone="danger"`) | errors, `REMOVED` |

Status vocabulary and tone (the same word always gets the same tone):

- `planning` — proposal exists, no tasks — warning;
- `ready to apply` — tasks written, none done — info;
- `applying` — some tasks done — info with a filled progress bar;
- `complete` — all tasks done, not archived — success;
- `archived` — archived — neutral/quiet with a check icon and the archive date.

Iconography uses shipped 14px product icons: browse (Explore), plus (Propose), search (filters), branch
(commit), check-circle (archived/complete), warning triangle (planning/errors), right-up (open accepted
spec). Icons are decorative (`aria-hidden`), labels are text.

Spacing constants are 4, 6, 8, 12, 16 px (no spacing token exists); page padding 12, card padding 12,
card gap 8, section gap 16. Borders are 1px hairlines. Radius uses `--dsw-radius-sm/md`.

### D10 — Screen composition

**Root header**

```
OpenSpec                                      dsh-setup · 2 changes · 19 specs · 34 archived
[Browse Explore]  [+ Propose]
[ Changes 2 | Specs 19 | Archive 34 ]
```

Title row wraps; the workspace summary moves under the title at narrow widths; the two actions stay
adjacent and wrap as a pair. The segmented control spans the panel width.

**Change card** (one per row, whole card is the button):

```
● ready to apply   add-openspec-panel                              4/12
  Add a right-sidebar panel that renders the workspace's changes…
  ▓▓▓▓▓░░░░░░░░  4/12 tasks
  proposal  design  2 specs  tasks      updated 2h ago   ⌘ 7e87448
```

Top line: state dot + status tag + name + right-aligned task fraction. Second line: purpose, clamped to
two lines. Third: progress bar. Footer: quiet artifact tags, relative update, commit. The archived
variant replaces the status with the archive date and dims the card one step; the complete variant uses
the success tone and a full progress bar. On hover the card takes the hover surface; focus keeps the
host ring.

**Changes grouping**: `In progress` and `Complete` group labels; archived rows never appear here.

**Specs list**

```
[ Search capabilities… ]
admin-indicator                                                        10 req
Shows whether the running DSH Desktop has Windows administrator rights…
Accepted via add-admin-indicator · 2026-10-27 · 5/5 · ⌘ 7e87448
```

Filter sits under the header; rows are the same card grammar. The provenance line is one meta row that
wraps after the change name; the commit subject is a tooltip, not a visible paragraph. No provenance
renders as `10 requirements` alone, never as an empty slot.

**Spec detail**

Header: capability id (detail title), purpose (full), meta tags (`10 requirements`, `21 scenarios`,
`Accepted 2026-10-27`, `via add-admin-indicator`, commit). Tabs: `Requirements (10) | History (3)`.
A filter appears above the cards when requirements exceed twelve.

Requirement card:

```
Windows administrator status
The system SHALL determine … as `administrator`, `standard`, or `unknown`.
┌ Scenario: Elevated Host ────────────────────────────────────────┐
│ WHEN  the Host process token has a High or System integrity…     │
│ THEN  the Web client receives `administrator`                    │
└──────────────────────────────────────────────────────────────────┘
```

One requirement per hairline card: title (card title tier), requirement text (body), then one inset
scenario block per scenario with a 2px business-tinted leading rule, a scenario name, and labelled
`WHEN`/`THEN` rows. Long text keeps a readable measure; nothing is truncated. History is a vertical
timeline of archive rows: date (meta, fixed column), change name (card title), `5/5`, commit; the row
opens the archived change tab.

**Change detail**

Header: name, status tag, purpose, progress bar with `4/12 tasks`, last updated, commit, `Apply change`
button (hidden for archived). Tabs: `Why | Design | Specs (N) | Tasks` via `SegmentedTabs`. Proposal and
design are `MarkdownText` inside a padded surface so headings and paragraphs keep the shared
typography. Delta specs show capability pills, the operation tag per requirement group, structured
cards, and an `Open accepted spec` action. Tasks show the overall bar, then per-lane groups with
`3/4`, step marks, and inline code paths.

**Empty / loading / error**

- Changes empty: workspace pulse line, two action cards with icons and one-line descriptions, then
  `Recently archived` with three rows and a `See all archive` action.
- Specs empty: "No accepted specs yet" + "Archive a completed change to add one" + an Archive action
  when the archive is non-empty.
- Archive empty: "Nothing archived yet" + "Complete a change and archive it to keep its history here."
- Loading: one quiet shimmer line (`TextShimmer`), not a layout jump.
- Error: warning icon + cause + `Retry` button, using the same card surface.

### D11 — Narrow width and accessibility

At the narrowest width the card's top line wraps (status and fraction may move to their own line), the
progress bar stays full width, metadata wraps, and the commit subject collapses to the short hash with
a tooltip. Truncation is limited to two-line purpose clamps; no fact is hidden behind hover on touch.
Status is always carried by text as well as colour. Tabs use the shared `SegmentedTabs` keyboard model;
filters have visible labels; rows are buttons with Enter/Space; focus rings stay host-owned; motion is
limited to 120 ms hover/selection transitions and disabled under `prefers-reduced-motion`.

### D12 — Live updates and read cost

Active change and capability views keep the existing `useResource` file observation and 300 ms
debounced re-read. Archived views are immutable by convention and do not need observation; they render
from the route and still support native refresh. The first root read returns the three segment totals and
both change lists from one `/changes` response; only the Specs rows load lazily on first use. No
validation pass, no polling, no cache layer. The only new process per read is git, and it is optional
and bounded.

The Host read routes still need `connection.fetch`, which the support floor does not provide; where it is
absent, no read route is registered (existing behavior). The panel shows its designed error state naming
the failing request and offers Retry; the `/openspec-apply` picker shows the same failing request in its
shell's error strip. Neither claims an empty workspace, and the six skills remain usable. The full visual
acceptance applies to a host that serves the routes; the older host's acceptance is that degradation,
verified separately in the integration task.

## Data shapes

```ts
type Phase = 'planning' | 'ready-to-apply' | 'applying' | 'complete' | 'archived'
type CliStatus = 'no-tasks' | 'complete' | 'in-progress'
type CommitFact = { short: string; at: string; subject: string }

type ChangeRow = {
  name: string
  status: CliStatus           // unchanged legacy field the picker reads
  phase: Phase                // derived status the redesigned cards render
  completedTasks: number
  totalTasks: number
  archived: boolean
  archivedAt: string | null   // ISO date from the archive directory prefix
  summary: string | null
  modified: string | null
  commit: CommitFact | null
  presence: { proposal: boolean; design: boolean; tasks: boolean; specs: number }
}

type ChangeListResponse = {
  changes: ChangeRow[]        // active only: the established contract
  archived: ChangeRow[]       // additive; older clients ignore it
  counts: { active: number; archived: number; capabilities: number }
}

type SpecRow = {
  id: string
  requirementCount: number
  purpose: string
  modified: string | null
  lastChange: {
    name: string; date: string; completedTasks: number; totalTasks: number
    commit: CommitFact | null
  } | null
  commit: CommitFact | null
}

type Requirement = { name: string; text: string; scenarios: { name: string; rawText: string }[] }
type Delta = {
  capability: string
  operation: 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED'
  requirements: Requirement[]
  rename?: { from: string; to: string }   // RENAMED sections carry this and no requirements
}

type ChangeDetail = {
  /* existing name, status, counts, presence, modified, artifacts, specs */
  phase: Phase
  archived: boolean
  archivedAt: string | null
  summary: string | null
  commit: CommitFact | null
  deltas: Delta[]           // empty for archived changes with unreadable deltas
}

type SpecDetail = {
  /* existing id, requirementCount, body, modified */
  purpose: string
  requirements: Requirement[]
  history: { name: string; date: string; completedTasks: number; totalTasks: number; commit: CommitFact | null }[]
  commit: CommitFact | null
}
```

Route responses stay additive: the `changes` array keeps the active rows, the legacy `status` values,
and every current field, so the picker and an already-loaded older client keep working during a partial
install. The client treats every new field as optional and falls back to the old rendering when it is
absent.

## Risks / Trade-offs

- **CLI JSON shape drift** → the Host validates each field it consumes and returns the existing readable
  "not understood" error when a shape changes; the CLI stays a machine prerequisite with its own
  diagnostics. Structured fields fall back to file/raw rendering where possible.
- **Archived delta markdown varies** (optional sections, wrapped bullets, rename pairs) → the parser is
  line-based and forgiving: unknown lines stay text, a requirement without scenarios still renders,
  `RENAMED` FROM/TO pairs are carried as their own delta, a mixed file keeps the sections it parsed, and
  only a file with no parsed section falls back to the raw Markdown body with an explanatory line.
- **Task grammar parity** → the checklist uses the pinned CLI's exact task-line pattern and counts every
  matching line; parity fixtures cover `*`, `+`, ordered markers, uppercase `X`, indentation, `[]`,
  `[~]`, and link bullets. Nested task files are resolved from the CLI's reported artifact paths for
  active changes; if an archived schema tracks a different glob, the header keeps the CLI total and the
  checklist names the unparsed remainder.
- **Older client against a new Host** → the active-row `changes` array and its legacy `status` values stay
  unchanged; archived rows travel only in the additive `archived` array, which the shipped picker never
  reads. A compatibility test asserts the picker still sees only unfinished active rows.
- **Git cost on large repositories** → one batched `git log` bounded to 300 commits, 5 seconds, and
  2 MB; older items simply have no commit fact. A per-row git loop was rejected.
- **Commit facts on Windows** → `execFile('git', …)` avoids the `.cmd` shim problem; a missing git is a
  normal `null`, not an error. `git log -- <path>` keeps request names from becoming options.
- **Reading 34 archived proposals on a list request** → one small file read per archived row, parallel
  and bounded; summaries are cached per request only. If this ever becomes slow, drop summaries from
  the Archive rows (not from details) rather than adding a cache.
- **Visual regression at narrow width** → the card grammar is built from wrapping flex rows with no
  fixed widths; the client tests assert facts and actions, and the existing narrow-width scenario stays
  a live smoke item.
- **Session storage unavailable** (private modes, blocked storage) → the remembered segment silently
  falls back to the address/default; no error.
- **Long archived tab chips** → the chip truncates; the view header carries the full name and date.

## Migration Plan

No data migration: the panel stores nothing in the workspace and the new `sessionStorage` key is
disposable. The change ships as a normal plugin release: build the client bundle and host modules,
regenerate `packages/setup`, run the repository gate, and install through the usual setup bundle.
Rollback is the previous package version; no workspace file is rewritten by this change.

## Open Questions

None that affect the specs, approach, or task breakdown. The visual rules above are the contract;
pixel-level polish is verified in the live panel on both supported DSH versions during the serial
integration task.
