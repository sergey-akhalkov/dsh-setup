# Design

## Context

See `proposal.md` — Why. Facts that shape the approach, verified against DSH `0.2.1-rc.3` and upstream Ponytail `v5.3.2`:

- DSH exposes `ctx.skills.registerProvider(create)` and `ctx.skills.register(skill)`. Shipped packages prove the provider pattern: `@deepseek-ai/dsh-skill-badge` registers one bundled skill by reading a markdown asset through `new URL('../assets/…', import.meta.url)`; `@deepseek-ai/dsh-skill-office` registers seven skills from an asset root; `@deepseek-ai/dsh-experimental-badge-skill-bundle` is a bundle whose only patch row mounts the provider package. Registration from a Host row lands in the global skill layer, discovery is lazy, and `tool-skill` republishes the catalog at `agent/pre-step`, so a newly active provider appears without restarting the Harness.
- DSH also exposes `ctx.systemPrompt.section({ name, order, text, interpolate?, complete? })` from `@deepseek-ai/dsh-system-prompt`: sections are unique-named and concatenated in ascending order, external contributions may use any finite order, `interpolate: false` preserves text literally, and registered sections are assembled into every model step's system prompt. The registry's alternative contribution type, `ctx.systemPrompt.context(...)`, materializes text as a durable user-role snapshot in model history (the lane `dsh-agent-instructions` uses for `AGENTS.md` files). A system-prompt section is the stronger always-on lane: it is present on every step and is not subject to history compaction.
- Precedence for skills: project-dsh (100) and project-agents (200) ranks outrank custom (300), user-dsh (400), user-agents (500), and bundled (600); a preset-scoped layer also wins over the global layer for the same name. A project or user skill named `ponytail` therefore overrides the packaged one.
- The skill catalog caps descriptions at 500 characters (`catalogDescriptionMaxLength`, default 500); loaded bodies become ordinary tool results and the standard preset prunes results over 8192 characters. Upstream's skill description is about 330 characters and its skill body is 3,496 bytes; its rules file `AGENTS.md` is 2,721 bytes.
- The repository treats a package's `files` list as the publishable set; the setup generator vendors each declared file (exact paths and single-level globs only) into `packages/setup/node_modules`. Install-time scripts are forbidden, built runtime and generated files are committed, LF is enforced, and Biome checks Markdown — so vendored Markdown must be excluded from formatting to keep its bytes stable.
- Every package that declares `dsh.bundle` with a valid `engines.dsh`, `locale` metadata, and an `.svg` icon is listed in the market automatically; the setup patch inserts a row for every plugin package. No generator change is needed for a new plugin.
- Cordis `4.0.5` passes raw config to plugins that export no `Config` schema (`resolveConfig` returns the input unchanged). The plugin can therefore accept `{ alwaysOn?: boolean }` without a runtime dependency on `@deepseek-ai/schemastery`, which keeps the vendored setup self-contained.
- The pending `portable-setup` delta currently forbids copies of shared agent skills. This change ships pinned third-party prompt content, so that requirement must be amended.
- Upstream Ponytail `v5.3.2` is one skill prompt (`skills/ponytail/SKILL.md`, 3,496 B, SHA-256 `9badd22a…a509`), a compact rules file (`AGENTS.md`, 2,721 B, SHA-256 `b98b15e1…25f`), and adapters for other agents; its own portability document describes DSH integration as instruction-tier with `skills/` and `AGENTS.md`. The license is MIT (`Copyright (c) 2026 DietrichGebert`, 1,071 B, SHA-256 `fb1bc690…3ab`). The tag is lightweight; the npm `5.3.2` bytes match the tag, and its `dist.gitHead` equals tag commit `16352ac2…`.

## Goals / Non-Goals

**Goals:**

- Deliver the upstream prompt as an ordinary, independently installable plugin bundle that also rides the generated setup bundle and the market.
- Make Ponytail's ruleset apply by default to every session of a profile where the plugin row is active, while keeping the full skill available on demand.
- Keep the vendored bytes immutable and reviewable: pinned commit, committed hashes, no transformation on disk.
- Provide documented, minimal opt-outs: keep the skill but drop the always-on mode through configuration, or remove both by disabling/uninstalling the row.
- Make a version refresh a deterministic one-command repository operation followed by the existing release flow.
- Keep installation, CI validation, and runtime offline.
- State the packaged-content policy in specs so the repository boundary stays explicit.

**Non-Goals:**

- Ponytail hooks, the "band", `/ponytail` commands, the other five upstream skills, or any of its agent adapters.
- Automatic runtime updates, in-place market upgrades, or upstream polling from the plugin.
- npm publication, a new generator feature, or changes to `install.ps1` and `dsh.json`.
- Shipping or syncing machine-local user skills and instructions.
- A Client UI for toggling the always-on mode; configuration is a profile-patch row override.

## Decisions

### D1. A Host-only plugin with two registrations

The plugin is a Host bundle whose `apply(ctx, config)` performs two registrations: a skill provider through `ctx.skills.registerProvider` (candidate `ponytail`, body loaded on demand), and, unless `config.alwaysOn === false`, a system-prompt section through `ctx.systemPrompt.section` carrying the vendored rules file. `inject` lists `skills` and `systemPrompt`. There is no Client half and no row command or hook. Alternatives considered for the skill lane: copying the file into `~/.agents/skills` (no distribution or update path, and it mutates the user-owned layer), `ctx.skills.register` at apply time (simpler, but reads synchronously during composition and registers at runtime rank 250), and depending on `@dietrichgebert/ponytail` from npm (breaks the self-contained setup and ties the plugin to tarball layout). Alternatives for the always-on lane are covered in D2.

Skill provider details: name `dsh-setup-ponytail`; candidate `ponytail`; `source: 'bundled'`; `rank: 600` — the `BUNDLED_SKILL_RANK` value of DSH `0.2.1-rc.3`, hardcoded with a comment so the plugin imports no DSH package at runtime (only type-only imports from `@deepseek-ai/dsh-skill` as a devDependency); `resourceBase` points at the vendored assets directory; the description comes from the committed lock; `get()` reads the markdown and appends a two-line adapter note naming the pinned upstream version and explaining that levels are requested in words because DSH has no `/ponytail` command. The note is runtime-only; vendored bytes stay untouched.

### D2. Always-on as a system-prompt section, default on with a config opt-out

The rules file is registered as `ctx.systemPrompt.section({ name: 'dsh-setup:ponytail', order: PONYTAIL_SECTION_ORDER, text, interpolate: false })`. A system-prompt section was chosen over `ctx.systemPrompt.context(...)` (durable user-role snapshot) because the rules must hold on every model step and must survive history compaction; a context snapshot can be compacted away. `interpolate: false` keeps the text literal and avoids strict variable resolution failures. The section name is namespaced to stay unique, and the order is a fixed constant in the gap between the deployment persona prefix (order 0) and the first-party plan policy (order 500), because DSH allocates central positions only for its own sections; the choice is documented next to the constant.

The text is the vendored `AGENTS.md` bytes followed by a clearly separated adapter footer that names the pinned upstream version and license, states that the mode is on for the deployment, tells the agent that the user can say "stop ponytail" or "normal mode" to suspend the ruleset for the rest of the session, and explains that levels are requested in words. The footer is runtime-only; the vendored file is unchanged.

Default-on is implemented without a `Config` schema: Cordis passes raw config to schema-less plugins (`resolveConfig` in `@deepseek-ai/cordis@4.0.5` returns the input when no `Config` is exported), so the plugin accepts `apply(ctx, config = {})` with a locally typed `{ alwaysOn?: boolean }` and treats only the explicit `false` as off. This avoids a runtime dependency on `@deepseek-ai/schemastery` and keeps the vendored setup self-contained. Documented opt-outs: `alwaysOn: false` in the profile patch keeps the skill and drops the section; disabling or uninstalling the row removes both.

Alternatives: shipping always-on through `dsh-agent-instructions` by pointing it at the vendored file (its candidates are fixed user/project file names and its config cannot reference a package asset); mounting the plugin twice with role configs (two rows, granular disable, but doubles the composition surface for no benefit); no opt-out (unacceptable for a behavior-changing default distributed to other developers); a schemastery `Config` (adds a runtime dependency the self-contained setup does not allow).

### D3. Vendored bytes provenanced by a committed lock; update is an explicit script

`assets/ponytail/SKILL.md`, `assets/ponytail/AGENTS.md`, and `assets/ponytail/LICENSE` are committed verbatim. `ponytail.lock.json` records `repository`, `version`, `tag`, 40-hex `commit`, the normalized `skill` metadata (`name`, one-line `description`, `argumentHint`), and per-file `path`/`bytes`/`sha256`. `scripts/update-ponytail.ts` accepts `--version X.Y.Z` (plus `--commit` as an offline/rate-limit escape hatch): it resolves the tag to a commit through the upstream API, fetches raw files by commit, validates the skill frontmatter and name, the rules-file heading and non-empty content, LF-only content, and size ceilings, then atomically writes all three assets and the lock. The lock omits timestamps, so a repeat run is byte-identical; failures write nothing and leave the previous pin in place. Pure helpers live in `scripts/lib/` so Vitest covers parsing and lock building without network.

Alternatives: fetching by tag (lightweight tags are not immutable), consuming npm tarball bytes (extra layout dependency), a git submodule (adds a checkout requirement to every consumer and CI), and an automatic PR bot (deferred; it changes no behavior).

### D4. Assets and the `files` list; no generator change

`assets/ponytail/SKILL.md`, `assets/ponytail/AGENTS.md`, `assets/ponytail/LICENSE`, and `ponytail.lock.json` are listed as exact entries in the package `files` array. The existing generator expands exact paths, so `pnpm gen` vendors them into the setup bundle without touching `scripts/lib/generate.ts`; the committed vendored copy is drift-checked by `pnpm gen:check`, and the plugin's own patch and manifest are generated from its fragment as usual. Adding assets later (for example the other five skills) is a `files` plus lock plus provider-list change, not a generator feature.

Biome must ignore `packages/*/assets` and the lock so the vendored markdown and generated JSON keep their exact bytes; the update script and the provenance test enforce LF and hashes. The repository scan continues to inspect the vendored Markdown for machine paths and secrets — the current upstream text is clean; if a future upstream body trips the scan, a provenance-checked exception is the fallback instead of a blanket exclusion.

### D5. Repository wiring, tests, and release

The package follows the existing plugin checklist: manifest with `engines.dsh` equal to `dsh.json`, `dsh.bundle`, a fragment mounting `dsh-setup-ponytail`, a TypeScript project with a root reference, `locale/en.json`, an original `.svg` icon, a Host-bundle test, and the provenance test under `scripts/test`. One release moves the pin and the set version together (`pnpm release:prepare`); the setup generator picks up the new row, the market generator lists the new plugin entry and keeps older versions, and `install.ps1`/`dsh.json` stay untouched.

The package test covers both registrations: with a fake context it asserts the skill candidate fields and loaded body, asserts that the prompt section is registered by default with the vendored rules text and footer, and asserts that `{ alwaysOn: false }` skips the section while keeping the provider; it also stubs `fetch` to fail if called. Acceptance: `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, and `pnpm validate:composition` pass; after installing into a throwaway profile (and, as an owner step, the desktop profile) a new session's system prompt carries the packaged ruleset, the skill catalog lists `ponytail`, and the skill tool loads the body. Composition validation does not assemble a prompt, so the prompt check is a manual verification step.

### D6. Distribution and opt-out

The plugin is included automatically in the setup bundle because the generator inserts every plugin row, and it is independently installable through the market or a commit-pinned git spec. Both installation paths turn the always-on mode on by default. Opt-out is a profile-patch row override (`config: { alwaysOn: false }`) that keeps the on-demand skill, or disabling the row / uninstalling the individual plugin, which removes both contributions; installation itself never edits the profile patch. Skill-name collisions are resolved by DSH precedence — project and user skills override the packaged one — and that behavior is documented instead of defended by renaming the skill.

Attribution: the MIT text ships in `assets/ponytail/LICENSE`; the market description and documentation name Ponytail, the upstream author, and the source URL; both vendored prompt files are unmodified and the adapter note/footer is clearly separated runtime text.

### D7. Spec boundary and archive ordering

`packaged-skills` owns the new behavior, including the always-on default and the repository content boundary. `portable-setup` receives a MODIFIED delta for its "No secrets or machine data" requirement so the two changes do not contradict after sync. Because the parent change's deltas are not synced yet (`openspec/specs/` is empty), OpenSpec reports that this MODIFIED delta can only be applied once the parent spec exists. The workflow follow-up in `tasks.md` records the ordering: the parent change is synced first, then this change. No artifact of the parent change is edited here.

## Risks / Trade-offs

- **Behavior-changing default**: every session on a profile with the plugin gets Ponytail's style and roughly 0.7 thousand extra prompt tokens per step. Mitigation: documented default-on, `alwaysOn: false` opt-out that keeps the skill, row disable/uninstall for full removal, and release notes that call out the new default.
- **Always-on rules can conflict with a project's or user's own instructions** (`AGENTS.md`, team conventions). Mitigation: the section is fixed guidance, the adapter footer names its origin, users can suspend it in conversation or turn it off; project instruction content still ranks as conversation context.
- **Upstream renames or removes files, or changes frontmatter/heading** → the update script fails loudly and writes nothing; the previous pin remains. Frontmatter, heading, LF, and sizes are validated at update time.
- **Vendored bytes conflict with repository tooling** → Biome ignores the assets and lock, LF is validated during update, hashes are checked offline, and `gen:check` compares the vendored setup copy.
- **DSH skill and prompt APIs or rank constants change in a later DSH version** → `engines.dsh` stays `<0.3.0`, CI runs the supported matrix, the plugin uses only documented registration surfaces, and the rank/section-order constants are pinned with comments.
- **Upstream release cadence is fast** → updates are owner-triggered releases, never automatic; the lock records each pin so a release diff shows exactly what changed in the prompts.
- **Whole-set versioning couples the plugin to set releases** → each refresh ships as a new set version, while the market keeps older versions installable for pinning.
- **Prompt trust** → the vendored text is trusted third-party instructions; the commit pin and committed hashes make changes reviewable, and the documentation states the plugin executes no upstream code and performs no network access.
- **MODIFIED delta cannot be archived until the parent spec exists** → recorded as a workflow follow-up; it does not block apply or validation.

## Migration Plan

1. Add the plugin package, vendored assets, lock, update script, tests, and documentation; run `pnpm install`, `pnpm ponytail:update --version 5.3.2` for the first pin, `pnpm gen`, and `pnpm build`.
2. Run `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, and `pnpm validate:composition`.
3. Install the plugin into a throwaway profile and verify the composed row; then verify in a session that the system prompt carries the ruleset, the catalog lists the skill, and the body loads. Repeat with `alwaysOn: false` in the profile patch and confirm the skill still works without the system-prompt section.
4. Optionally install the plugin into the owner's desktop profile through Plugins/Discover as a dogfood step and record the observed prompt/behavior.
5. Release the next set version and verify the market lists the plugin and the setup install mounts its row.
6. Rollback: uninstall the plugin or disable its row; the ruleset and skill disappear and no other configuration changes. Reverting a release restores the previous market deployment, and the previous pin remains installable.

## Open Questions

- Phase 2 scope: whether to ship the other five upstream skills (`ponytail-review`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help`). Deferrable; no spec or approach change for this change.
- Whether to add a scheduled workflow that reports newer upstream releases. Deferrable; it would not change installation or runtime behavior.
- Whether the adapter footer should later become configurable (for example, to change the stop phrase). Deferrable; the current footer is deliberately short.
