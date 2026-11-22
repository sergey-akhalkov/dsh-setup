## ADDED Requirements

### Requirement: Pinned third-party bundle installation

The one-command installer SHALL install every bundle declared in `dsh.json` under `installBundles.git`
from its pnpm spec and SHALL select it in `dsh.profile.bundles` before the setup bundle, so the setup
defaults retain precedence. Each declaration MUST carry the bundle's package name and a spec whose
reference is a 40-hex commit; the standalone installer MUST carry the same name/spec pairs, and
repository validation MUST reject a mismatch between them, an unpinned reference, or a declared name
that is not the package the spec installs. A failed fetch MUST warn and leave the rest of the
installation complete, and a rerun MUST retry it. The bundle MUST NOT be vendored into the repository,
duplicated as a setup row, or published to the setup's market index.

#### Scenario: Fresh installation

- **WHEN** the installer runs against a profile that does not have the declared bundle
- **THEN** it installs the package from the pinned spec, selects it ahead of the setup bundle, and the
  composed profile contains the bundle's rows

#### Scenario: Failed fetch

- **WHEN** the pinned spec cannot be fetched
- **THEN** the installer warns, installs the shipped bundles and the setup bundle as usual, and the
  verification does not report the absent bundle as a problem

#### Scenario: Stale pin

- **WHEN** the profile has the bundle installed at a different spec than the declared one
- **THEN** the installer installs the declared spec again instead of skipping the bundle

#### Scenario: Divergent declaration

- **WHEN** `dsh.json` and `install.ps1` disagree about the name or the spec, or the spec's reference is
  not a commit
- **THEN** repository validation fails and names the offending bundle
