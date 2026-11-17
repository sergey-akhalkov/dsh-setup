# Proposal

## Why

Long DSH work sessions accumulate linked Git worktrees that nobody owns. The current workspace holds 35
linked worktrees beside the repository; 34 are already merged into `main` and clean, and one is merged
with four uncommitted files. DSH's own `worktrees` service reclaims only checkouts it created under
`.agents/worktrees/**`, and only when the creating Session is archived; workflow lane worktrees are
created with raw Git (`git worktree add ../wt-<change>-<n> -b lane-<change>-<n>`) and are invisible to
that service. Reclaiming space is therefore manual `git worktree list` / `git worktree remove`
bookkeeping, and it is easy to forget which checkout still has unmerged work.

## What Changes

- Add a new bundle, `@dsh-setup/plugin-worktrees`, with a Host half and a right-sidebar Client half. No
  DSH core change and no modification to the existing workflow or OpenSpec plugins.
- **Safe automatic cleanup.** A scheduled sweep (configurable local time, default 04:00) plus a
  startup catch-up plus a `Sweep now` action removes a worktree only when every commit of its branch is
  in the base branch and the checkout has no uncommitted or untracked files. Automatic removal never
  uses `--force`, and the branch and its commits remain.
- **Bounded automatic scope.** By default only lane worktrees (branch prefix `lane-`) are removed
  automatically; manual worktrees are listed and deletable but never removed automatically. Config
  values `managed` | `all` | `off` change that scope.
- **Escalation instead of deletion for unfinished work.** An unmerged or dirty worktree is reported,
  never removed automatically. After a configurable idle period (`staleDays`, default 7) it is shown as
  stalled; deleting it requires an explicit click and a confirmation that lists the commits not in the
  base branch and the uncommitted files.
- **Persistent daily report.** Each sweep writes `.dsh/worktrees/reports/<time>.json` with the removed,
  kept, and failed worktrees and the reason for each. The last 14 reports are kept and survive Host
  restarts.
- **Worktrees panel.** A new right-sidebar tab type, opened from a Start-page guide card, with two
  segments: `Worktrees` (every linked worktree with branch, creation time, last activity, status and
  reason; opening a row shows its unmerged commits and uncommitted files) and `Report` (the recent
  sweeps). A row offers `Delete`; unsafe rows require the confirmation above.
- **Protection.** The main checkout, worktrees used by a live session, Git-locked worktrees,
  DSH-owned `.agents/worktrees/**` checkouts, and workflow review snapshot directories are never
  removed.
- New plugin config row with `staleDays`, `sweepAt`, and `autoRemove` defaults; the setup bundle gains
  the package dependency, the fragment row, owner defaults, docs, and regenerated artifacts.

## Capabilities

### New Capabilities

- `worktree-cleanup`: the workspace worktree maintenance behavior — the Git-derived worktree inventory,
  the safe automatic removal policy and its configuration, the persistent sweep report, and the
  right-sidebar Worktrees panel with statuses, detail, and manual deletion.

### Modified Capabilities

- None. The setup bundle already requires every repository plugin package it mounts to be a declared
  dependency and requires generated composition; this change only adds one more plugin package to that
  existing contract, with no requirement text change.

## Impact

- New package `packages/plugin-worktrees`: Host modules for Git facts, the pure policy, sweep
  execution, the report store, the Fetch routes, and the schedule; Client modules for the tab type,
  the guide card, the list/detail/report bodies, and the wire decoders; a test suite over a temporary
  Git repository fixture.
- `packages/setup`: regenerated dependency list, fragment row, vendored tree, and default config via
  `pnpm gen`; `packages/setup/defaults.yml` gains the plugin's config defaults.
- `docs/plugins.md`, `README.md`, the plugin `locale/en.json`, `icon.svg`, and `docs/DETAIL.md` describe
  the new bundle; the release workflow regenerates the market index from the tag.
- New Host service usage: `connection.fetch`, `agents`, `workingDirectory`, `timer`, and the
  `subprocess`/Git executable. New Client service usage: `sidebarRightTabs`, `slots`, `locale`,
  `resources`, and the shipped `@deepseek-ai/dsh-client-ui-primitives` component library.
- Unverified: whether a DSH host without `connection.fetch`, `agents`, or `workingDirectory` can still
  mount the plugin inertly; the design keeps every route and panel registration behind `ctx.get`
  probes so a CLI or TUI host registers nothing.
