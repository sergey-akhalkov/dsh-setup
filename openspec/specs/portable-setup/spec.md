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

The repository SHALL ship a single installer command that reproduces the complete setup on a prepared machine: enable the documented shipped bundles through the profile's native bundle selection, install any registry bundles declared in `dsh.json` through the native plugin manager, install the setup bundle at a pinned release, verify the result, and restart DeepSeek Harness.

#### Scenario: Fresh machine

- **WHEN** a user runs the installer on a machine where DeepSeek Harness has been started once and quit
- **THEN** the profile selects every documented bundle and the setup bundle, the setup bundle is last in the selection, and the composed profile contains every plugin row and owner default.

#### Scenario: Running application

- **WHEN** the installer starts while DeepSeek Harness is running
- **THEN** it closes the application before writing the profile and starts it again after installation, unless the user passed the option that forbids stopping it.

#### Scenario: Missing profile

- **WHEN** the target profile does not exist
- **THEN** the installer stops with an instruction to start DeepSeek Harness once so that the profile is created.

### Requirement: Installer leaves user-owned state untouched

The installer MUST NOT modify the profile's own patch file or its non-bundle settings. It MUST keep a profile-manifest backup before changing anything and MUST be safe to rerun.

#### Scenario: Rerun

- **WHEN** the installer runs again on an already configured profile
- **THEN** the bundle selection and the profile patch are unchanged and no package is installed twice.

#### Scenario: Profile patch is user-owned

- **WHEN** the installer enables bundles and installs the setup
- **THEN** the profile's `cordis.patch.yml` is byte-identical to before the run.

### Requirement: Non-destructive owner-profile verification

The repository SHALL provide a dogfood command that verifies the installer against a copy of the current machine's Desktop profile. The command MUST NOT write that profile, stop or restart the running Harness, or disturb any Harness home outside the throwaway copy. The installer MUST refuse to close the Harness whose process tree hosts the calling shell.

#### Scenario: Dogfood on the owner's machine

- **WHEN** a developer runs the documented dogfood command from a shell hosted by the running Harness
- **THEN** the installer runs against a throwaway copy of the profile, the composed copy shows the setup rows and defaults effective with every owner-patched row keeping its effective config, and the live profile's files are byte-identical afterwards.

#### Scenario: Live install from a hosted shell

- **WHEN** the installer is asked to target the `desktop` profile from a shell hosted by the running Harness
- **THEN** it stops before changing anything and points to the external-PowerShell and dogfood alternatives.

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

The setup patch SHALL insert only rows contributed by the setup and SHALL override shipped rows only for explicit defaults. Every override MUST restate the complete configuration the target row requires, and the setup MUST NOT re-implement a shipped bundle's rows or alter the profile's bundle selection list.

#### Scenario: Shipped bundle change

- **WHEN** the setup patch does not mention a shipped row
- **THEN** that row remains governed by the shipped bundle layer and its configuration is unchanged.

#### Scenario: Bundle selection preserved

- **WHEN** the setup bundle is installed
- **THEN** the profile's `dsh.profile.bundles` list is unchanged except for the appended setup bundle.

### Requirement: Portable defaults and local precedence

The setup patch SHALL carry owner defaults: default model and reasoning effort, theme, UI preferences, and agent preset selection. It MUST NOT modify the profile's own patch file, and the profile patch MUST continue to take precedence over the setup layer.

#### Scenario: Fresh profile defaults

- **WHEN** the setup is installed into a profile whose own patch is empty
- **THEN** the setup's model, theme, UI, and preset defaults are effective without further configuration.

#### Scenario: Local override

- **WHEN** the profile patch already sets a value that the setup also sets
- **THEN** the profile value is effective and the profile patch file is not modified by installation.

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
