# Proposal

## Why

The Observability view reports that something happened but not what it was or what to do about it. Its
failure count is a bare number: a session with 22 failed records shows `22` with no list, no session,
no time, and no way to open one, while the plugin cards own only 1 of them. `Something needs attention`
says `error` without naming the tool or the failure. `silent` says only that no trace appeared, so a
plugin that is quietly broken and a plugin whose trigger never happened look identical, and a prompt-only
plugin's delivery is never checked. The owner goes back to reading session logs by hand to answer the
questions the dashboard raised, which is the work this view exists to remove.

## What Changes

- List every failed record in the window, independent of plugin rows and of the trace-detail cap:
  severity (`turn failure`, `turn cut`, `tool failure`, plus `recovered` for a tool failure inside a
  turn that completed), time, session, turn, step, tool, and the error identity the log records
  (`name`/`code`). The rendered list is bounded; its counts are not.
- Make the failure count a control, and give entries actions: focus the Trajectory inspector on the
  recorded tool call in the current session, open the owning session otherwise, or start a new session
  whose draft describes the listed failures. The draft is never auto-submitted and never replaces an
  existing draft.
- Check declared prompt contributions for readiness: a prompt section against the assembled system
  prompt, a skill against the skill catalog. A declared contribution that is absent reports
  `not mounted` and needs attention; an undeclared one stays guidance-only.
- State what a silent row waits for: an optional `trigger` sentence from the configuration plus the
  window's activity denominators beside its zero. Silence alone no longer reads as a fault.
- Draw a tool's failing share proportionally instead of colouring the whole bar.
- **Data** (compatible): a configured row may carry `trigger`; a guidance row may carry `mounted`
  (`section` and/or `skill`). Rows without them stay valid and keep today's presentation. Unknown
  fields are still rejected.
- Ship the new descriptors in `packages/setup/defaults.yml` and regenerate the setup patch.

## Capabilities

### New Capabilities

None. The change sharpens one existing capability; it adds no package, service, or route.

### Modified Capabilities

- `observability`: the failure list and its severity classification, the failure actions (inspector
  focus, session open, prefilled fix session), guidance readiness, the silent-row trigger and activity
  context, the dashboard's failure controls and proportional tool bars, the scope of "trace detail",
  and the blind-spot statement now that delivery is checked.

## Impact

- `packages/plugin-observability`: record extraction (`records.ts`), the failure model and report
  (`report.ts`), readiness and status (`status.ts`), the row schema (`rows.ts`), optional `systemPrompt`
  and `skills` access (`index.ts`), the client view (`src/client/index.tsx`), and every affected test.
- `packages/setup/defaults.yml`, then the generated `cordis.patch.yml` and vendored tree; `pnpm gen`,
  `pnpm gen:check`, and `pnpm validate:repo` remain the gate.
- `docs/plugins.md` documents the new row fields, the failure taxonomy, and the actions.
- Existing DSH APIs only: `sessionQuery.readTitleSnapshots`, the `systemPrompt` and `skills` registries,
  the `conversation.view` `inspectCall`/`openView` props, and `uiWorkspace.startSession`/`openSession`.
  When an optional service is absent the view degrades to a copyable list rather than failing.
- Out of scope: declared frequency expectations for silent rows, forking a session per failure, judging
  rule compliance, focusing an event across a session boundary, and any new log, storage, or route.
