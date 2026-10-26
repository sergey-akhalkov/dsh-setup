# Design

## Context

The repository already packages third-party prompt content as a host-only bundle: `plugin-ponytail`
registers an on-demand skill and an always-on ruleset from vendored assets, `plugin-serena` and
`plugin-rtk` register on-demand skills from assets beside the built module, and all of them use
`ctx.skills.registerProvider` at bundled rank 600 (see
[plugin-ponytail/src/host/index.ts](../../../packages/plugin-ponytail/src/host/index.ts) and
[plugin-serena/src/host/index.ts](../../../packages/plugin-serena/src/host/index.ts)). Project-local
skills in `<project>/.dsh/skills` carry rank 100 and win over packaged skills, and the DSH skill
registry only lists a provider's body on demand.

OpenSpec 1.15.0 ships a `dsh` tool target: `openspec init --tools dsh` writes generated
`SKILL.md` files into `<root>/.dsh/skills`. Its core profile installs six skills (`openspec-explore`,
`openspec-propose`, `openspec-apply-change`, `openspec-update-change`, `openspec-sync-specs`,
`openspec-archive-change`); the optional six are only installed through a custom profile. The files
are generated from templates inside the pinned CLI package, so there is no byte-identical upstream
file to vendor at a commit.

DSH has no sanctioned way for a plugin to add a CLI to the model shell's `PATH`: `shellEnv` only
registers `DSH_*` variables, and the shell request carries no plugin-owned environment. The repository
policy is to document external runtimes rather than install them (see
[docs/plugins.md:109](../../../docs/plugins.md#L109) and
[docs/install.md:249](../../../docs/install.md#L249)); `rtk` and `rust` follow the same rule. The owner
also chose project-local spec roots: the bundle must not use OpenSpec stores or `defaultStore`.

## Goals / Non-Goals

**Goals:**

- Deliver the six OpenSpec core skills to every session of a profile through one installable bundle.
- Keep the delivered text provenance-pinned to one OpenSpec release and reproducible from that release.
- Make the `openspec` CLI prerequisite explicit at the point of use (skill body, locale, docs).
- Make per-project roots the only documented root model, and keep per-project init from duplicating
  the packaged skills.
- Reuse the repository's existing provider, vendoring, generation, and release machinery.

**Non-Goals:**

- Installing, vendoring, or locating the OpenSpec CLI.
- Creating `openspec/` automatically, in a workspace or anywhere else.
- OpenSpec stores, `defaultStore`, or any global spec root.
- An always-on prompt section, plugin configuration, or a Client half.
- The six optional OpenSpec skills and any per-project `openspec update` automation.

## Decisions

### D1: Host-only bundle with one skill provider at bundled rank

Register all six skills from a single `SkillProvider` mounted by a host-only bundle
(`packages/plugin-openspec`). The provider lists candidates from a committed lock and reads the body
from the shipped `SKILL.md` only when the skill is invoked. `inject` is `['skills']`; there is no
`systemPrompt` contribution and no config.

Alternatives: writing files into `<dshHome>/skills` at install (rejected: bundles must not write user
state, and the files would be unversioned); a per-project copy (the status quo this change removes);
an always-on section (rejected: OpenSpec is an explicit workflow, unlike Ponytail's behavioral rule).
Rank 600 keeps project-local and user-local copies winning, so a repository that already ran
`openspec init --tools dsh` keeps its definition.

### D2: Pin the six core skills, not the custom five or all twelve

Generate with `--profile core`, giving the six workflows above. This is the upstream default, includes
`update` (missing from the owner's current custom profile), and is stable across OpenSpec releases
without asking the user to reproduce their global OpenSpec config. The six optional skills are out of
scope; they can be added in a later release by changing the pinned generator set.

### D3: Provenance records the generator and the output bytes

Because the skills are generated, the lock records both the upstream input and the generated output:

```json
{
  "upstream": { "repository": "https://github.com/Fission-AI/OpenSpec", "version": "1.15.0",
                "tag": "v1.15.0", "commit": "<gitHead>", "tarballIntegrity": "sha512-..." },
  "generator": { "command": "openspec init --tools dsh --profile core",
                 "workflows": ["propose", "explore", "apply", "update", "sync", "archive"] },
  "skills": [ { "name": "openspec-explore", "description": "...",
                "path": "assets/openspec/openspec-explore/SKILL.md",
                "bytes": 11427, "sha256": "..." } ],
  "license": { "path": "assets/openspec/LICENSE", "bytes": 1079, "sha256": "..." }
}
```

`pnpm openspec:update --version X.Y.Z` resolves the version's registry metadata (`gitHead`,
`dist.integrity`), runs the pinned CLI through `npx -y @fission-ai/openspec@X.Y.Z init <tmp> --tools
dsh --profile core --no-animation --no-copilot-cloud` with update checks and telemetry disabled,
validates the exact six names, frontmatter, LF endings, and size ceilings, then atomically writes the
assets and lock. Re-running the same version must leave the tree unchanged; an offline test verifies
every size and hash. The plugin reads the lock at apply time and never fetches or generates content.

Alternatives: vendoring the upstream TypeScript templates and rendering them locally (rejected: it
duplicates the generator and will drift); committing generated files by hand (rejected: no reproducible
refresh, no provenance); `openspec`-as-a-dependency (rejected with D4).

### D4: The CLI is a documented prerequisite, never installed

The locale description, `docs/openspec.md`, `docs/install.md`, and the adapter note appended to every
loaded skill name the exact install command (`npm install -g @fission-ai/openspec@1.15.0`) and state
that the setup does not install runtime prerequisites. The plugin does not probe the CLI at startup:
a missing executable surfaces as a normal `command not found` on the first skill command, and the
adapter note tells the model what to ask the user to run. The Harness still boots and the catalog still
lists the skills when the CLI is absent.

Alternatives: an installer step (rejected: Windows-only, only covers installer installs, and violates
the stated policy); vendoring the CLI and its dependencies (rejected: about 11 MB, license surface,
and no sanctioned way to put it on the shell `PATH`); an `npx`-backed tool wrapper (rejected: requires
rewriting every upstream command and brings network access into the runtime).

### D5: Project-local roots only; point per-project init at `--tools none`

The packaged skills keep their upstream store-aware text, but the adapter note fixes the deployment
model: specs and changes live in the workspace's nearest `openspec/` root; when none exists, run
`openspec init --tools none` in the workspace root and never `--tools dsh`, because the skills are
already global. The plugin itself writes nothing and does not create the root; the skill's own
root-check asks the user before any write, and the note supplies the CLI command. Local roots are the
only documented model; stores and `defaultStore` are not mentioned in docs or prompts.

Alternatives: a global store with `defaultStore` (owner decision: rejected, specs from different
repositories would mix); auto-running `openspec init` from the plugin (rejected: writes workspace
state without a user action and bypasses the skill's confirmation contract).

### D6: Generated bundle surface stays standard

Add `package.json` (engines pinned to `dsh.json`), `cordis.fragment.yml` with the single row
`dsh-setup-openspec`, generated `cordis.patch.yml`, `locale/en.json`, `icon.svg`, `tsconfig.json`, and
the root `tsconfig.json` reference. No `defaults.yml` entry is needed because the row has no config.
The setup generator adds the dependency, patch row, and vendored copy; the market generator picks up
the locale and icon. `dsh.json` and `install.ps1` do not change.

### D7: Tests cover both delivery and provenance

The package test mounts `apply` against a fake `ctx.skills` and asserts the provider name, six
candidates, lock descriptions, body loading, frontmatter removal, and the adapter note. A scripts test
verifies the lock shape, the core workflow set, LF endings, license text, and every byte size and
SHA-256 offline; generation and market tests pick up the new package automatically.

### D8: Stale project-local copies are removed by guidance, once, not by the plugin

A workspace that ran `openspec init --tools dsh` keeps five or six `SKILL.md` files under
`.dsh/skills/openspec-*`. Rank 100 makes them win over the packaged definitions, so after adoption
the catalog would mix local copies with the packaged set and drift on every `openspec update`. The
adapter note and `docs/openspec.md` therefore tell the user to delete those directories
(`.dsh/skills/openspec-*`) after installing the bundle; this checkout performs that deletion once.
The bundle does not delete them itself: writing into the workspace would violate the provider
boundary and would run without the user's action. Users who keep a project-local root use
`openspec init --tools none`, which creates no skills.

Alternatives: letting the local copies win (rejected: mixed versions and the plugin's pin never
takes effect); having the plugin delete files at mount (rejected: workspace mutation, no user
consent, and it would also delete user-authored copies with the same names); auto-detecting stale
copies and warning in the prompt (rejected: adds always-on prompt cost for a one-time cleanup).

## Risks / Trade-offs

- [Generated text drifts with the CLI version] → the version is pinned in the bundle, the adapter note
  names it, and `pnpm openspec:update` plus the release notes are the only path to a new set.
- [A future OpenSpec release changes skill names, frontmatter, or the generation command] → the updater
  fails loudly on the exact-name and hash checks, so a broken set cannot be committed.
- [The pinned generator becomes interactive or needs network in the updater] → the updater passes the
  non-interactive flags, fails on timeout or prompt, and the maintainer can rerun the same generator
  manually; this is a release-time failure, not a runtime one.
- [The CLI is missing on a fresh machine] → the skill body and docs carry the install command; the
  plugin keeps the catalog and the Harness usable without the CLI.
- [A project already has `.dsh/skills` from `openspec init --tools dsh`] → the adapter note and docs
  name the stale directories, and this change removes the copies in this checkout; the registry rank
  keeps any copy the user chooses to keep visible until they delete it.
- [Deleting this checkout's copies drops the skills until the rebuilt setup is active] → the cleanup is
  the last step, after `pnpm gen` has put the row into the linked setup; a Harness restart recomposes
  the profile and loads the packaged provider.
- [Upstream icon or name usage] → ship an original icon and credit Fission-AI/OpenSpec and the MIT
  license in the locale and docs; ship the upstream `LICENSE` byte-for-byte.
- [The change is profile-scoped] → like Ponytail, the skills exist only in profiles where the bundle
  is installed; the setup installs the bundle into the selected profile.

## Migration Plan

New plugin only: install the bundle (setup install or the market card), restart the Harness so the
recomposed profile mounts the new row, then delete any project-local `.dsh/skills/openspec-*`
directories that `openspec init --tools dsh` created. This checkout performs that deletion once as the
last step, after `pnpm gen` has added the row to the linked setup. No spec data is migrated or deleted.
Rollback is disabling the `dsh-setup-openspec` row or uninstalling the bundle; the user can regenerate
local copies with `openspec init --tools dsh` if they want the old per-project arrangement back.

## Open Questions

None.
