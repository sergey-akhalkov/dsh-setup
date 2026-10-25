# Proposal

## Why

The repository reproduces the owner's Harness composition, but it deliberately ships no agent skills: `~/.agents` is treated as machine-local user state. Ponytail (`DietrichGebert/ponytail`, MIT) is a widely used third-party "lazy senior dev" prompt that is distributed upstream as a single skill file, a compact always-on rules file (`AGENTS.md`), and adapters for other agents. The owner wants it on every machine that installs this setup and for other developers: the ruleset should apply by default to coding sessions, and the full skill should stay available on demand, with the ability to move to a newer upstream release. Copying files into `~/.agents` by hand gives neither one-click distribution nor an update path, and installing the whole upstream Claude Code plugin would drag in hooks, a status line, commands, and 20 agent adapters that DSH does not need.

DeepSeek Harness `0.2.1-rc.3` provides both required seams: a documented Host skill-registry API (`ctx.skills.registerProvider` / `register`) with shipped precedents (`dsh-skill-badge`, `dsh-skill-office`, the badge skill bundle), and the system-prompt registry (`ctx.systemPrompt.section` in `dsh-system-prompt`) for ordered always-on prompt contributions. The repo already generates per-plugin patches, vendors plugin files into the setup bundle, and publishes every bundle through the static market; the missing pieces are a policy and a pipeline for shipping a pinned third-party prompt, plus a default-on always-on mode with a documented opt-out.

## What Changes

- Add `packages/plugin-ponytail`, a Host-only plugin bundle (`@dsh-setup/plugin-ponytail`) that contributes two things from vendored, pinned upstream files:
  - a skill `ponytail` registered through `ctx.skills.registerProvider`, loaded only on demand;
  - an always-on system-prompt section registered through `ctx.systemPrompt.section`, enabled by default, carrying the compact upstream `AGENTS.md` ruleset with a short adapter footer.
  The plugin has no Client half and no runtime network access.
- Make the always-on mode switchable without losing the skill: the row applies a schema-less configuration where `alwaysOn: false` (set through a profile-patch row override) suppresses the system-prompt contribution while the on-demand skill remains registered. Disabling or uninstalling the row removes both contributions.
- Vendor upstream Ponytail from an immutable pin: `skills/ponytail/SKILL.md`, `AGENTS.md`, and `LICENSE` at tag `v5.3.2` / commit `16352ac2…`, byte-identical, plus a committed `ponytail.lock.json` recording repository, version, tag, commit, per-file size and SHA-256, and the normalized skill description.
- Add `scripts/update-ponytail.ts` (and pure helpers under `scripts/lib/`) that resolve a requested upstream tag to a commit, fetch the three files at that commit, validate them (skill frontmatter, rules-file heading, non-empty content, LF-only, size ceilings), and only then write the assets and lock (staged and renamed into place, so a failed fetch or validation leaves the previous pin untouched). Re-running with the same version is byte-identical.
- Validate provenance offline: a unit test checks the lock against the assets (size, SHA-256, license copyright line, skill name, rules heading) and a plugin test checks the skill catalog entry, the always-on section registration, the config opt-out, and the loaded skill body. `pnpm gen:check` keeps the vendored setup copy in step; Biome must ignore the vendored assets so their bytes stay stable.
- Include the plugin in the generated setup bundle like every other plugin, so a full setup install makes both the always-on ruleset and the on-demand skill available, and let individual installs work through the market or a commit-pinned git spec. Update flow = update the pin, regenerate, release a new set version; older versions stay installable.
- Amend the pending `portable-setup` requirement that forbids shipping copies of agent skills: machine-local skills and instructions stay user-owned and unshipped, while provenance-pinned third-party prompt content MAY ship inside a plugin bundle.
- Document the plugin, the default-on always-on behavior and its prompt cost, both opt-outs (configuration and row removal), attribution and license, precedence of local skills with the same name, and the release-time update procedure.
- **Out of scope for this change**: Ponytail hooks, the "band", `/ponytail` commands and the other five upstream skills; automatic runtime updates or in-place market upgrades; npm publication; shipping any machine-local `~/.agents` content; a Client UI for switching modes.

## Capabilities

### New Capabilities

- `packaged-skills`: Distribution of third-party prompt content through plugin bundles: immutable upstream pinning and provenance, verbatim vendoring with attribution, an on-demand skill registration, a default-on always-on system-prompt contribution with a documented opt-out, precedence for project/user overrides, no runtime network, and an explicit repository policy that separates packaged third-party content from user-owned machine-local skills.

### Modified Capabilities

- `portable-setup`: The "No secrets or machine data" requirement changes so that provenance-pinned third-party skill content is permitted in a plugin bundle, while machine-local skills, instructions, credentials, and session data remain excluded. Packaged prompt rows arrive through the generated setup patch, so the single-bundle installation requirement itself needs no delta; the new `packaged-skills` capability specifies their distribution.

## Impact

- New repository content: `packages/plugin-ponytail` sources, three vendored files and the lock, its generated patch and committed `lib/`, the update script and tests, documentation, and the amended OpenSpec deltas.
- Generated content changes: `packages/setup/package.json`, `packages/setup/cordis.patch.yml`, and the vendored tree under `packages/setup/node_modules` gain one plugin package; the market index of the next release gains one plugin entry automatically.
- Behavior: after installing the setup (or the individual plugin), every session's system prompt carries the pinned compact ruleset by default, which changes coding style with an expected prompt cost of roughly 0.7 thousand tokens per step, while the full skill body is loaded only when invoked. `alwaysOn: false` in the profile patch keeps the skill but drops the system-prompt contribution; disabling or uninstalling the row removes both. A project or user skill named `ponytail` overrides the packaged one.
- External dependency: the upstream Ponytail repository and its tagged releases are the source of the vendored bytes; the update step is manual and network-bound, while installation, CI validation, and runtime stay offline.
- License and trust: vendored prompt files stay unmodified under MIT with the upstream copyright notice; the pinned commit and hashes make every prompt change visible in a release diff, and the plugin executes no upstream code.
- Compatibility: the plugin uses the DSH skill and system-prompt APIs available in `0.2.1-rc.3`, the repository's existing `engines.dsh` range, and existing bundle, generation, market, and release machinery; no installer or `dsh.json` change is required.
