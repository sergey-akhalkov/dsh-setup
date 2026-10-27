# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
