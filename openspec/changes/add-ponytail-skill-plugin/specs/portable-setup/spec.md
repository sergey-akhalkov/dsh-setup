# Spec Delta

## MODIFIED Requirements

### Requirement: No secrets or machine data

The repository MUST NOT contain credentials, session data, machine-specific absolute paths, or copies of shared agent skills and instructions. Provenance-pinned third-party skill content shipped inside a plugin bundle is permitted: it arrives with the bundle, carries its upstream license, and is verified against a committed pin; user-owned skills and instructions under `~/.agents` and the workspace remain machine-local and are not shipped.

#### Scenario: Repository validation

- **WHEN** the validation workflow inspects repository content
- **THEN** it fails on credential files, session artifacts, or absolute machine paths in manifests and patches.

#### Scenario: Packaged third-party content

- **WHEN** the validation workflow inspects a vendored upstream skill and license that match their committed provenance record
- **THEN** it accepts them and does not treat them as user-owned machine data.
