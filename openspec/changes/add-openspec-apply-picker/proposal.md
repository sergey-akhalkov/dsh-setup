# Proposal

## Why

Invoking `/openspec-apply-change` today requires remembering the change name. When the name is omitted,
the skill only lists the available changes after the message is sent, and the model may infer a change
from conversation context before the user has chosen one. The DSH Web client already ships a native
in-composer picker shell (`popupSelect`, used by `/model` and `/permission`), but no plugin exposes the
workspace's OpenSpec change list where the user chooses it. The owner asked for the list to appear
while composing, with native DSH components and styles and no plugin-owned UI.

## What Changes

- Add the plugin's first client half: a client command `/openspec-apply` registered through the DSH
  client command API, whose picker is the built-in `popupSelect` shell. The plugin supplies option
  data and a selection handler only; search, keyboard handling, empty state, error strip, and styling
  stay with DSH.
- The picker lists every unfinished change the workspace's `openspec list --json` reports, one row per
  change labeled with the change name and its completed/total task progress.
- Picking a row writes the literal `/openspec-apply-change <name>` into the composer draft, without
  submitting. The user sends it, and the existing skill-invocation path injects the apply-change skill
  exactly as a hand-typed line does.
- Add a read-only, workspace-scoped host route that resolves the workspace from the requesting session
  and runs the documented CLI there with a bounded timeout. It rejects foreign origins, exposes no
  arbitrary path, and reports an absent CLI, a missing root, a timeout, or a malformed result as a
  readable picker error with retry.
- Keep the package installable everywhere: the client half registers nothing when the client command
  service is absent, and the host route registers only when the Web host services exist, so CLI, TUI,
  and ACP hosts keep the six skills. No new bundle row, dependency, install script, or market entry.
- Update the plugin package (client entry, exports, files, tsconfig), tests, and the plugin
  documentation; regenerate the generated patch and setup tree.

No breaking change.

## Capabilities

### New Capabilities

- `openspec-apply-picker`: the native in-composer change picker for OpenSpec changes: command
  registration, the workspace-scoped unfinished-change list, pick-to-draft behavior, endpoint
  security and bounds, and degradation when the client service, the Web host, or the CLI is absent.

### Modified Capabilities

None.

## Impact

- `packages/plugin-openspec/package.json` (client entry, exports, files), `tsconfig.json`, a new
  `src/client/index.ts`, `src/host/index.ts` (optional route registration and the bounded CLI runner),
  new tests, and the plugin row in `docs/plugins.md`.
- Generated `packages/*/cordis.patch.yml` and `packages/setup/**` through `pnpm gen` / `pnpm build`.
- No new package, bundle row, installer array entry, market entry, dependency, or DSH version.
- Out of scope: opening the picker on Space (the trigger pipeline reserves Space for command claims),
  per-change skill names, auto-submit after a pick, store support in the picker, and non-Web hosts.
