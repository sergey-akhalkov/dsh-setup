# openspec-skills Specification

## Purpose
Defines how the setup delivers the upstream OpenSpec core skills to every session of a profile from
one pinned bundle, with the OpenSpec CLI as a documented machine prerequisite and specs kept in each
workspace's own `openspec/` root.

## Requirements

### Requirement: Profile-global core skill set

The bundle SHALL register the six OpenSpec core skills (explore, propose, apply-change, update-change,
sync-specs, archive-change) in the profile's global skill layer as on-demand catalog entries. It MUST
NOT write skill files into the workspace, the Harness home, or a user skill root, and installing it
MUST expose the same six skills in every session of that profile.

#### Scenario: Installation through the native bundle mechanism

- **WHEN** a user installs the plugin through the market, a commit-pinned git specification, or the setup bundle
- **THEN** the running profile's skill catalog lists the six core skills

#### Scenario: No manual file placement

- **WHEN** a user installs only through the native bundle mechanism
- **THEN** the plugin writes no files into the workspace, the Harness home, or any user skill root

#### Scenario: Catalog entry only

- **WHEN** a session starts and a packaged skill is not invoked
- **THEN** the catalog advertises its description and the full skill body is absent from the assembled prompt

#### Scenario: Row removal

- **WHEN** the profile patch disables the plugin's row or the bundle is uninstalled
- **THEN** none of the six packaged skills is present in the catalog

### Requirement: Local skill precedence

A project or user skill with the same name SHALL take precedence over the packaged definition, so a
workspace that already generated OpenSpec skills keeps its local copy without uninstalling the bundle.

#### Scenario: Local copy wins

- **WHEN** `<project>/.dsh/skills/openspec-explore/SKILL.md` exists and the packaged skill has the same name
- **THEN** the catalog resolves the local definition and loading the skill returns the local body

#### Scenario: Other packaged names unaffected

- **WHEN** one name is overridden locally
- **THEN** the other five packaged skills remain cataloged and loadable

### Requirement: Immutable OpenSpec release pin

The packaged files MUST come from one OpenSpec release recorded in a committed provenance lock:
repository, version, tag, 40-hex-digit commit, npm tarball integrity, generator command, and generator
profile. The bundle MUST NOT fetch, generate, or update skill content at installation or at runtime.

#### Scenario: Pin record

- **WHEN** the repository is inspected
- **THEN** the lock names the upstream release, the generator command and profile, the six-workflow set, and a record for every packaged file

#### Scenario: Immutable identity

- **WHEN** the update step resolves a release
- **THEN** it records the registry metadata for that exact version and integrity, not a mutable branch reference

#### Scenario: No implicit fetch

- **WHEN** a session runs without the explicit update step
- **THEN** the provider reads only the committed assets and the lock and makes no request to the upstream repository

### Requirement: Reproducible generated assets

The lock SHALL record each vendored file's size and SHA-256, and refreshing the pinned version MUST
reproduce byte-identical assets and lock. Repository validation MUST verify those hashes offline and
fail on any mismatch.

#### Scenario: Offline verification

- **WHEN** repository validation runs without network access
- **THEN** every asset matches its recorded size and hash and the set contains exactly the six core skills plus the license

#### Scenario: Reproducible refresh

- **WHEN** the update step runs again for the already pinned version
- **THEN** it leaves the working tree unchanged

#### Scenario: Drift rejection

- **WHEN** a packaged file no longer matches its recorded size or hash
- **THEN** repository validation fails and names the mismatched file

### Requirement: Adapter note at the point of use

Every loaded packaged skill MUST append a DeepSeek Harness adapter note that names the pinned OpenSpec
version and license, states the `openspec` CLI prerequisite with the exact pinned global-install
command, and directs a workspace without `openspec/` to `openspec init --tools none`. The note MUST
NOT appear in the catalog description or in the idle prompt.

#### Scenario: Loaded body carries the note

- **WHEN** the model or a user loads any packaged skill
- **THEN** the content ends with the adapter note naming the version, license, install command, and `--tools none`

#### Scenario: Catalog stays clean

- **WHEN** the skill catalog is listed
- **THEN** the descriptions contain no adapter note text

### Requirement: External CLI is a prerequisite, never installed

The setup MUST NOT install, vendor, download, or add the `openspec` CLI to `PATH`, and the bundle MUST
remain loadable with the six skills cataloged when the CLI is absent. The locale description and the
installation documentation MUST name the CLI and its pinned install command as a machine prerequisite.

#### Scenario: CLI absent

- **WHEN** the Harness runs on a machine where `openspec` is not on `PATH`
- **THEN** the bundle mounts and the catalog lists the six skills

#### Scenario: No install-time action

- **WHEN** the bundle is installed
- **THEN** it executes no package script and performs no network request

#### Scenario: Prerequisite documented

- **WHEN** a user reads the market card or `docs/install.md`
- **THEN** the CLI and the pinned `npm install -g @fission-ai/openspec@<version>` command are stated

### Requirement: Project-local spec root model

The packaged presentation MUST direct users to the workspace-local `openspec/` root and, when none
exists, to create it with `openspec init --tools none`. It MUST NOT recommend stores, `defaultStore`,
`--store`, or `--tools dsh`, and the bundle MUST NOT create or modify an `openspec/` directory.

#### Scenario: Existing root

- **WHEN** a workspace already contains `openspec/` and a packaged skill runs
- **THEN** commands operate on that root and the presentation adds no store flag

#### Scenario: Fresh workspace

- **WHEN** no `openspec/` root exists and the user asks for OpenSpec work
- **THEN** the guidance is `openspec init --tools none` in the workspace root and the bundle creates no root itself

#### Scenario: No store guidance

- **WHEN** the packaged skill presentation or the plugin documentation is inspected
- **THEN** it does not recommend a store or `defaultStore`

### Requirement: Stale generated project copies

Adoption guidance MUST instruct users to delete project-local `openspec-*` skill directories under
`.dsh/skills` that `openspec init --tools dsh` created, so the packaged definitions are the only
copies. The bundle MUST NOT delete workspace files itself.

#### Scenario: Adoption guidance names the copies

- **WHEN** a workspace already contains `.dsh/skills/openspec-*` and a packaged skill is loaded or the installation documentation is read
- **THEN** the guidance names those directories and tells the user to delete them

#### Scenario: No automatic deletion

- **WHEN** the bundle mounts
- **THEN** it creates, modifies, and deletes no workspace files

#### Scenario: Packaged set after cleanup

- **WHEN** the local `openspec-*` copies are removed and the row is active
- **THEN** each of the six names resolves to the packaged definition

#### Scenario: New roots write no skills

- **WHEN** a user creates a project-local root after adopting the bundle
- **THEN** the documented command is `openspec init --tools none`, which writes no skills

### Requirement: Release-pinned update contract

Moving to a newer OpenSpec version SHALL be an explicit repository release: regenerate the six core
skills and license from the new pin, rewrite the lock, regenerate the setup bundle, and publish a new
set version. The running plugin MUST NOT replace or extend its vendored content.

#### Scenario: New upstream version

- **WHEN** a release pins a newer OpenSpec version
- **THEN** the market lists the new plugin version alongside previously published versions and all assets come from the new pin

#### Scenario: No self-update

- **WHEN** the plugin runs
- **THEN** it never fetches or writes replacement skill content
