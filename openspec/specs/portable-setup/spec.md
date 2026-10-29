# portable-setup Specification

## Purpose

Defines how a single installable bundle and one installer command reproduce a complete personal DeepSeek Harness setup on another machine or for another developer, without hand-editing profiles, without a routine of manual toggles, and without swallowing machine-local ownership.

## Requirements

### Requirement: Single-bundle installation

The repository SHALL publish one setup bundle that, when installed through the native DSH bundle mechanism, composes the full personal setup. Installing it MUST NOT require manual edits to the profile manifest or its patch file.

#### Scenario: Install from a configured market index

- **WHEN** a user installs the setup bundle from a market index in the Discover tab
- **THEN** DSH installs the bundle's dependency packages, selects the bundle, applies its patch, and the running profile contains the setup's rows.

#### Scenario: Install from a commit-pinned git specification

- **WHEN** a user installs the setup bundle by a commit-pinned git spec without any market index
- **THEN** DSH produces the same composed profile rows as the index installation.

#### Scenario: Install with the one-command installer

- **WHEN** a user runs the documented installer command on a new machine
- **THEN** the installer enables the documented shipped bundles, installs the setup bundle, and the composed profile contains the setup rows and owner defaults.

### Requirement: One-command installation

The repository SHALL ship a single installer command that reproduces the complete setup on a prepared machine: enable the documented shipped bundles through the profile's native bundle selection, install any registry bundles declared in `dsh.json` through the native plugin manager, install the setup bundle at a pinned release, verify the result, and restart DeepSeek Harness. The installation guide SHALL document that command as one PowerShell pipeline, and running it MUST NOT terminate the caller's session.

#### Scenario: Fresh machine

- **WHEN** a user runs the installer on a machine where DeepSeek Harness has been started once and quit
- **THEN** the profile selects every documented bundle and the setup bundle, the setup bundle is last in the selection, and the composed profile contains every plugin row and owner default.

#### Scenario: Running application

- **WHEN** the installer starts while DeepSeek Harness is running
- **THEN** it closes the application before writing the profile and starts it again after installation, unless the user passed the option that forbids stopping it.

#### Scenario: Missing profile

- **WHEN** the target profile does not exist
- **THEN** the installer stops with an instruction to start DeepSeek Harness once so that the profile is created.

#### Scenario: Documented one-line form

- **WHEN** a user runs the documented single-pipeline command in an ordinary PowerShell window with no options
- **THEN** the installer runs its default installation and returns to the same window, which stays open with the run's exit status

#### Scenario: Failed run keeps the session

- **WHEN** the documented single-pipeline command stops on a failed precondition
- **THEN** it reports the cause, leaves the caller's window usable, and reports a non-zero exit status to a non-interactive caller

#### Scenario: Checkout directory is not a source

- **WHEN** the documented single-pipeline command runs from a directory that happens to contain a repository checkout
- **THEN** it installs the resolved release rather than that checkout

### Requirement: Installer leaves user-owned state untouched

The installer MUST NOT modify the profile's own patch file or its non-bundle settings. It MUST keep a profile-manifest backup before changing anything and MUST be safe to rerun.

#### Scenario: Rerun

- **WHEN** the installer runs again on an already configured profile
- **THEN** the bundle selection and the profile patch are unchanged and no package is installed twice.

#### Scenario: Profile patch is user-owned

- **WHEN** the installer enables bundles and installs the setup
- **THEN** the profile's `cordis.patch.yml` is byte-identical to before the run.

### Requirement: Non-destructive owner-profile verification

The repository SHALL provide a dogfood command that verifies the installer against a copy of the current machine's Desktop profile. The command MUST NOT write that profile, stop or restart the running Harness, or disturb any Harness home outside the throwaway copy. The installer MUST refuse to close the Harness whose process tree hosts the calling shell. The command's owner-row preservation check SHALL treat `dsh-setup-nuphus-mcp` and `dsh-setup-serena` as explicitly retired adapter rows that may disappear from the composed copy, while every other owner-patched row MUST keep its effective config.

#### Scenario: Dogfood on the owner's machine

- **WHEN** a developer runs the documented dogfood command from a shell hosted by the running Harness
- **THEN** the installer runs against a throwaway copy of the profile, the composed copy shows the setup rows and defaults effective, every owner-patched row except the retired adapter rows keeps its effective config, the retired adapter rows may be absent, and the live profile's files are byte-identical afterwards

#### Scenario: Live install from a hosted shell

- **WHEN** the installer is asked to target the `desktop` profile from a shell hosted by the running Harness
- **THEN** it stops before changing anything and points to the external-PowerShell and dogfood alternatives

#### Scenario: Retired adapter row override

- **WHEN** the owner's profile patch still targets `dsh-setup-nuphus-mcp` or `dsh-setup-serena` and the installed composition omits that row
- **THEN** the dogfood preservation check reports the intended retirement, does not fail for the missing retired row, and still fails when any other owner-patched row disappears

### Requirement: Dependency-contained plugins

The setup bundle MUST declare as package dependencies every repository plugin package whose rows its patch mounts, so that one installation provides all plugin code. A configuration-only adapter row MAY mount a package that the Harness installation provides; that package MUST NOT be duplicated as a setup dependency.

#### Scenario: Fresh profile

- **WHEN** the setup bundle is installed into a profile that declares none of the plugin packages
- **THEN** every plugin module referenced by the setup patch resolves and mounts.

#### Scenario: Missing dependency detection

- **WHEN** a plugin row is present in the setup patch but its repository package is absent from the setup bundle's dependencies
- **THEN** release validation fails before publication.

#### Scenario: Self-contained git installation

- **WHEN** the setup bundle is installed from its commit-pinned git spec
- **THEN** every declared plugin package's code arrives with that single installation, without a registry lookup or an additional install step.

#### Scenario: Harness-provided adapter target

- **WHEN** the setup patch contains a configuration-only adapter row that names a package shipped with the Harness
- **THEN** the setup manifest does not declare that package as a dependency, and the row resolves from the Harness installation without a second copy.

### Requirement: Generated composition patch

The setup bundle's patch MUST be generated from per-plugin composition fragments. The committed patch MUST be reproducible from those fragments, and validation MUST fail when the committed patch differs from the generated result.

#### Scenario: Regeneration

- **WHEN** a plugin composition fragment changes
- **THEN** the generator updates the setup patch, and the validation workflow reports a non-reproducible patch until the committed file is regenerated.

### Requirement: Scoped patch entries

The setup patch SHALL insert only rows contributed by the setup and SHALL override shipped rows
only for explicit defaults. An explicit default MAY target a row the setup itself inserts, including
setting `disabled: true`; a configuration override MUST restate the complete configuration the target
row requires, while a disable override carries no configuration. The setup MUST NOT re-implement a
shipped bundle's rows or alter the profile's bundle selection list, and the profile's own patch MUST
remain the final authority over every setup override.

#### Scenario: Shipped bundle change

- **WHEN** the setup patch does not mention a shipped row
- **THEN** that row remains governed by the shipped bundle layer and its configuration is unchanged

#### Scenario: Setup row default

- **WHEN** an explicit default targets a row the setup inserts and sets its configuration or disables it
- **THEN** the generated setup patch applies the override to the row (a setup-row disable is part of its insert entry), and the composed profile shows it

#### Scenario: Profile override of a setup default

- **WHEN** the profile patch restates or re-enables a row the setup also configures
- **THEN** the profile value is effective and the setup default does not override it

#### Scenario: Bundle selection preserved

- **WHEN** the setup bundle is installed
- **THEN** the profile's `dsh.profile.bundles` list is unchanged except for the appended setup bundle

### Requirement: Portable defaults and local precedence

The setup patch SHALL carry owner defaults: default model and reasoning effort, theme, UI preferences, agent preset selection, and the shipped lazy MCP configuration (the `dsh-setup-mcp-lazy` row configured with `nuphus-mcp` and `serena`; no static `@deepseek-ai/dsh-mcp-client` row for either server). It MUST NOT modify the profile's own patch file, and the profile patch MUST continue to take precedence over the setup layer.

#### Scenario: Fresh profile defaults

- **WHEN** the setup is installed into a profile whose own patch is empty
- **THEN** the setup's model, theme, UI, and preset defaults are effective without further configuration

#### Scenario: Nuphus lazy default

- **WHEN** the setup is installed with no MCP override in the profile patch
- **THEN** the composed profile lists `nuphus-mcp` and `serena` in the lazy row and mounts no static adapter row for either server

#### Scenario: Local override

- **WHEN** the profile patch already sets a value that the setup also sets
- **THEN** the profile value is effective and the profile patch file is not modified by installation

#### Scenario: Restore the static Nuphus adapter

- **WHEN** the profile patch adds a static `@deepseek-ai/dsh-mcp-client` row for `nuphus-mcp` and removes the lazy Nuphus entry
- **THEN** the static adapter is effective and the lazy row starts no process; the setup does not ship that static row

### Requirement: Experimental bundle prerequisites documented

The installation guide SHALL list every shipped optional bundle the setup expects and name the Plugins toggle that enables it. The setup bundle's patch MUST NOT duplicate shipped experimental rows. The one-command installer SHALL select exactly the documented bundle names, using the same profile selection the toggles update, and MUST NOT rewrite those bundles' rows.

#### Scenario: New machine guidance

- **WHEN** a user sets up a new machine by following the installation guide
- **THEN** the documented installer command or the listed toggles, index source, and install step produce the expected capability set.

#### Scenario: Manual and installer paths agree

- **WHEN** a user compares the bundles selected by the installer with the toggles the guide lists
- **THEN** both name the same bundles in the same configuration.

#### Scenario: Setup alone stays pure

- **WHEN** the setup bundle is installed without the installer
- **THEN** it adds no shipped bundle to the profile selection and duplicates no shipped row.

### Requirement: Prebuilt distribution

Packages installed from git SHALL include their built runtime files generated from the tagged source. No published package may require an install-time build script for normal installation.

#### Scenario: Git installation without build approval

- **WHEN** a user installs the setup bundle or a plugin package from a commit-pinned git spec
- **THEN** no build step requires approval and no `allowBuilds` entry is necessary.

#### Scenario: Reproducible published runtime

- **WHEN** the release process rebuilds the published packages from the tagged source
- **THEN** the rebuilt runtime files match the committed files, and a difference blocks the release.

#### Scenario: Build-script rejection

- **WHEN** a published package manifest declares a `prepare` or install-time build script
- **THEN** release validation fails.

### Requirement: Compatibility declaration and release gate

Every published package SHALL declare an `engines.dsh` range covering the supported DSH versions. A release MUST be blocked unless the composed setup profile validates against each supported DSH version.

#### Scenario: Unsupported runtime

- **WHEN** a user installs a package on a DSH version outside its `engines.dsh` range
- **THEN** DSH refuses the installation and reports the unmet requirement.

#### Scenario: Composition validation

- **WHEN** a release candidate is validated
- **THEN** the DSH CLI composes a temporary profile with the setup bundle installed, and the check passes for every supported DSH version before publication, and the installer passes its throwaway-profile exercise on every supported DSH version.

#### Scenario: Installer preflight

- **WHEN** the installer runs on an unsupported DSH version
- **THEN** it reports the supported versions and changes nothing.

### Requirement: No secrets or machine data

The repository MUST NOT contain credentials, session data, machine-specific absolute paths, or copies of shared agent skills and instructions. Provenance-pinned third-party skill content shipped inside a plugin bundle is permitted: it arrives with the bundle, carries its upstream license, and is verified against a committed pin; user-owned skills and instructions under `~/.agents` and the workspace remain machine-local and are not shipped.

#### Scenario: Repository validation

- **WHEN** the validation workflow inspects repository content
- **THEN** it fails on credential files, session artifacts, or absolute machine paths in manifests and patches.

#### Scenario: Packaged third-party content

- **WHEN** the validation workflow inspects a vendored upstream skill and license that match their committed provenance record
- **THEN** it accepts them and does not treat them as user-owned machine data.

### Requirement: Update by rerunning the installer

Rerunning the documented install command SHALL update an existing installation to the newest released setup version. The installer MUST verify that the installed version is the version it resolved, and MUST fail the run when they differ.

#### Scenario: Newer release available

- **WHEN** a newer release is published and the user reruns the documented command
- **THEN** the newer setup version is installed, the existing bundle selection keeps its order with the setup bundle last, and the run reports the installed version

#### Scenario: Already current

- **WHEN** the resolved version is already installed
- **THEN** the run changes no bundle selection and reports the installed version matching the resolved one

#### Scenario: Version mismatch after installation

- **WHEN** the installed setup version differs from the version the run resolved
- **THEN** the run fails the verification and names both versions

#### Scenario: Unresolvable release

- **WHEN** neither the market index nor the release tags can be read
- **THEN** the run fails before changing the profile and names the override options for pinning a version or a package spec

### Requirement: Administrator desktop shortcut

The installer SHALL create or repair the fixed `DeepSeek Harness (Administrator)` shortcut on the current user's Desktop by default when the installed Desktop app can be resolved. The shortcut SHALL start the installed Desktop app through a Windows UAC elevation prompt.

#### Scenario: Default install

- **WHEN** a user runs the installer without shortcut-suppression options and the Desktop app is installed
- **THEN** the administrator shortcut is created on the Desktop and the run reports its name

### Requirement: Administrator shortcut skip and rerun safety

`-DryRun` and `-NoDesktopShortcut` SHALL skip the shortcut. A missing Desktop app SHALL be a warning rather than a failed installation. Shortcut creation MUST be idempotent and MUST NOT change the profile, its patch, or the app installation; the installer's existing setup-update behavior is unchanged.

#### Scenario: Intentional skip

- **WHEN** the installer runs with `-DryRun` or `-NoDesktopShortcut`
- **THEN** no shortcut is created and the run reports that the step was skipped

#### Scenario: Missing Desktop app

- **WHEN** the installer cannot resolve an installed Desktop app
- **THEN** it warns about the skipped shortcut, completes the profile installation, and does not fail

#### Scenario: Rerun

- **WHEN** the installer runs again with the same Desktop app
- **THEN** the shortcut is created or repaired without duplicating files, and the installer's normal setup update behavior is unchanged

#### Scenario: Repository validation

- **WHEN** the installer exercise or dogfood runs in the repository
- **THEN** it passes `-NoDesktopShortcut` and creates no shortcut on the runner or owner Desktop

### Requirement: Nuphus migration reconciliation

The setup MUST NOT read or rewrite the profile patch. The migration documentation SHALL state the required reconciliation for a profile that still targets the removed static Nuphus or Serena adapter row, or carries a static row of its own. A lazy call while a static adapter is active MUST fail with the lazy-mcp one-home error and start no process.

#### Scenario: Explicit static enable on upgrade

- **WHEN** an existing profile patch still sets `disabled: false` on the removed `dsh-setup-nuphus-mcp` row and the setup's lazy row configures `nuphus-mcp`
- **THEN** the composed profile carries only the lazy entry, the profile patch is not rewritten, and the documentation names the stale override to remove

#### Scenario: Prior opt-out on upgrade

- **WHEN** an existing profile patch disables the removed `dsh-setup-nuphus-mcp` row and the setup's lazy row configures `nuphus-mcp`
- **THEN** the composed profile still carries the lazy entry, and the documentation states that emptying the lazy `servers` list is required to keep Nuphus off

#### Scenario: Default profile has one path

- **WHEN** the profile patch carries no Nuphus or Serena override
- **THEN** only the lazy path is configured: the lazy row lists `nuphus-mcp` and `serena` and no static adapter row is mounted

### Requirement: Exact-pinned third-party runtime dependencies

A repository plugin package MAY declare an exact-pinned third-party runtime dependency. The setup manifest SHALL hoist it as a regular dependency, the profile installation SHALL fetch that exact version from the registry, and the repository MUST NOT vendor the package when it is self-contained. The dependency MUST be documented and MUST NOT duplicate a Harness-provided package.

#### Scenario: Fresh profile install

- **WHEN** the setup bundle is installed into a profile that does not yet contain the third-party package
- **THEN** the profile installation fetches the exact pinned version, the plugin row resolves, and no separate manual installation step is required

#### Scenario: No vendored copy

- **WHEN** the generated setup tree and manifest are inspected
- **THEN** the third-party package is absent from the vendored tree and present in the manifest at the exact pinned version

#### Scenario: Version drift

- **WHEN** repository validation finds a version range, a latest tag, or a version different from the recorded exact pin
- **THEN** validation fails

#### Scenario: Harness-provided package

- **WHEN** a configuration-only row mounts a package that the Harness installation provides
- **THEN** the setup does not declare that package as a dependency, exactly as the existing dependency-containment rule requires
