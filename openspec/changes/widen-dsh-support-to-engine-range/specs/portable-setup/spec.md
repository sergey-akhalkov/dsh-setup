# Spec Delta

## MODIFIED Requirements

### Requirement: Compatibility declaration and release gate

Every published package SHALL declare an `engines.dsh` range covering the supported DSH versions.
That range MUST be the installer's only version allowlist, and the repository MUST NOT maintain a
separate exact-version list. The installer SHALL accept every DSH version inside the range and MUST
reject every version outside it before changing anything, naming the range and the next action. A
release MUST be blocked unless the composed setup profile and the throwaway installer exercise pass
for the range's lower bound, the runtime, and the newest published DSH version satisfying the range.
When the registry cannot be queried during validation, the release MAY proceed against the range's
lower bound and the runtime, and the degraded matrix MUST be reported in the job log.

#### Scenario: Unsupported runtime

- **WHEN** a user installs a package on a DSH version outside its `engines.dsh` range
- **THEN** DSH refuses the installation and reports the unmet requirement

#### Scenario: Composition validation

- **WHEN** a release candidate is validated
- **THEN** the DSH CLI composes a temporary profile with the setup bundle installed and the check passes for the range floor, the runtime, and the newest published matching version when it can be resolved before publication, and the installer passes its throwaway-profile exercise on each of them

#### Scenario: Installer preflight

- **WHEN** the installer runs on a DSH version outside the range
- **THEN** it reports the range and changes nothing

#### Scenario: In-range prerelease accepted

- **WHEN** the installed DSH version satisfies `engines.dsh` but was never named in a version list
- **THEN** the installer reports the version and proceeds with the installation

#### Scenario: Below the floor rejected

- **WHEN** the installed DSH version sorts below the range's lower bound (for example `0.2.1-rc.2`)
- **THEN** the installer reports the range and changes nothing

#### Scenario: At or above the ceiling rejected

- **WHEN** the installed DSH version is the range's upper bound or newer (for example `0.3.0`)
- **THEN** the installer reports the range and changes nothing

#### Scenario: Release gate follows the range

- **WHEN** a newly published DSH version satisfies the range
- **THEN** the next release validation tests it without a version-list edit, and the release is blocked unless it passes

#### Scenario: Registry unavailable during validation

- **WHEN** the published-version lookup fails during release validation
- **THEN** validation runs against the range floor and the runtime, the job log names the skipped newest-version check, and publication is not blocked by the lookup alone
