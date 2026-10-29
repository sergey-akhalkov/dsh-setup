# Design

## Context

- The OpenSpec plugin already composes a loaded skill body at runtime: `stripFrontmatter(upstream)`
  followed by a plugin-owned `adapterNote` ([src/host/index.ts](../../../packages/plugin-openspec/src/host/index.ts)).
  A second plugin-owned suffix therefore needs no new mechanism and no fork of the upstream skill.
- The upstream bytes are pinned by `openspec.lock.json`, and
  [scripts/test/openspec.test.ts](../../../scripts/test/openspec.test.ts) requires
  `assets/openspec` to contain exactly the six skills and the license.
- The pinned updater's `writeAssets` deletes `assets/openspec` before writing
  ([scripts/update-openspec.ts](../../../scripts/update-openspec.ts)), so anything placed there is
  lost on every refresh.
- The accepted `openspec-skills` spec requires the loaded body to end with the adapter note and says
  the running plugin must not replace or extend its vendored content. The adapter note is already a
  runtime addition, so a second one is consistent once the contract names it (the delta does).
- The lane practice currently exists only as project-local `rules.tasks` and
  `operations.apply.guidance` in this repository's `openspec/config.yaml`; it does not travel to
  other workspaces or PCs.
- The plugin's skill layer is profile-global, so one installed package reaches every workspace. A
  workspace-local `.dsh/skills/openspec-*` copy still shadows the packaged skill, as before.

## Goals / Non-Goals

**Goals:**

- Ship the lane practice with the OpenSpec plugin, not with a project config.
- Append it to the three task-lifecycle skills only, before the adapter note.
- Keep the vendored bytes, lock, catalog descriptions, and idle prompt unchanged.
- Keep the cost on-demand: the text loads only with the skill.
- Fail loudly if an upstream refresh renames or drops one of the targeted skills.
- Keep the asset outside the directory the pinned updater deletes.

**Non-Goals:**

- Enforcing lane decomposition as a gate; this remains prompt-level guidance.
- Covering non-OpenSpec work or projects without the plugin.
- Changing all six skills, the OpenSpec CLI, or the task parser.
- Writing or migrating any project's `openspec/config.yaml` at install or runtime.
- Editing the vendored upstream files or their provenance lock.

## Decisions

### D1. Append a plugin-owned addendum to the loaded body

Add `assets/guidance/task-lanes.md` and append it in the provider between the vendored body and the
adapter note. The adapter note stays last, so the existing "content ends with the adapter note"
requirement continues to hold.

Alternatives rejected:

- **Patch the vendored `SKILL.md` files or the updater**: the assets would no longer be byte-identical
  to the pin, and the offline provenance test and the lock's meaning break.
- **Ship a seventh skill**: portable, but it must be loaded explicitly; the propose and apply skills
  would not pick it up automatically.
- **Register an always-on system-prompt section**: portable, but pays tokens on every step, including
  sessions that never touch OpenSpec.
- **Have the installer write `rules` into each project's config**: writes into the workspace (the
  plugin spec forbids it), misses existing projects, and creates a second source of truth.

### D2. Keep the guidance asset outside `assets/openspec`

The path is `packages/plugin-openspec/assets/guidance/task-lanes.md`. The pinned updater deletes
`assets/openspec`; the provenance test requires exactly six skills and the license there. An asset
outside that directory survives the refresh and keeps both checks green. The package `files` list
names the asset, and `pnpm gen` vendors it with the rest of the plugin.

### D3. Target propose, update-change, and apply-change only

`openspec-propose` writes `tasks.md`, `openspec-update-change` revises it, and
`openspec-apply-change` executes it. `openspec-explore` can write artifacts on request but is not the
normal task-authoring path and is the largest body; `sync-specs` and `archive-change` do not touch
tasks. The mapping is a small `Set` in the provider, validated against the lock.

### D4. Read and validate the guidance at registration, append at load

`apply` reads the asset once and validates that every targeted name exists in the lock; a missing
asset or a renamed target fails composition loudly instead of silently dropping the nudge. The
provider appends the cached text in `get`. A small pure `assertGuidanceTargets(skills)` helper makes
the missing-target branch testable with a fabricated lock.

### D5. Content shape

The addendum defines a lane (top-level `##` group, disjoint owned paths, no cross-lane dependency
except the serial tail), requires a lane cut with named paths or a one-line single-lane reason,
recommends 2-4 substantive lanes, keeps generated files and the full gate in the serial tail, and
says the sequential apply loop still runs inside one lane while independent lanes become parallel
writers in separate worktrees. It also forbids a lane to edit the change's spec artifacts or another
lane's tasks. The asset is capped at 4 KB to keep the on-demand cost bounded.

### D6. Remove the temporary project-local rule

Delete `rules.tasks` and `operations.apply.guidance` from `openspec/config.yaml` after the addendum
ships, so the practice has one authoritative home. The CLI instruction output loses those two
entries; the loaded skill body carries the same guidance for every workspace.

### D7. Documentation and spec delta

Update `docs/openspec.md` to state which skills carry the addendum, where the asset lives, why the
pinned refresh preserves it, and that no project config is needed. The delta spec adds the
task-lane requirement and clarifies that the release-pinned update contract freezes the vendored
upstream content while allowing plugin-owned runtime notes. The catalog descriptions stay as the
lock records them.

## Risks / Trade-offs

- **The nudge is prompt-level and can be ignored** -> measure on the next multi-package change; if it
  is ignored, the next step is a P1 review criterion in the portable `review-spec` prompt, not more
  prose.
- **The addendum sits after a long upstream body** -> it opens with a distinct local-guidance heading
  and explicitly states that it refines the sequential loop; the adapter note must remain last.
- **A local `openspec-*` skill copy shadows the packaged body** -> existing documentation already
  tells users to remove stale copies; the addendum inherits that limitation.
- **An upstream rename drops a targeted skill** -> registration fails with the missing name and the
  provider test lists the three targets; a release must update the mapping.
- **The asset could be placed back inside `assets/openspec`** -> the provider test asserts the path is
  outside it, and the provenance test would fail on the extra file.
- **The current working tree is busy with `merge-hindsight-into-installer`** -> apply this change on a
  clean tree so `pnpm gen` and `pnpm build` do not mix unrelated output.

## Migration Plan

No data migration. After merge, run `pnpm gen` and `pnpm build`, then publish the set; an installed
plugin reads the addendum from its package on the next skill load. Rollback is disabling or removing
the plugin row or publishing a release without the addendum; there is no workspace state to clean.
