## ADDED Requirements

### Requirement: Pinned third-party bundle installation

The one-command installer SHALL install every bundle declared in `dsh.json` under `installBundles.git`
from its pnpm spec and SHALL select it in `dsh.profile.bundles` before the setup bundle, so the setup
defaults retain precedence. Each declaration MUST be a git spec whose reference is a 40-hex commit,
and the standalone installer MUST carry the same specs; repository validation MUST reject a mismatch
between them and a spec that is not exactly `<source>:<path>#<40-hex commit>`. The selection name MUST
be the package name the profile recorded for that exact spec, which MAY differ from the repository
name and MAY be scoped, so a declaration cannot select a package that does not exist. A failed fetch
MUST warn and leave the rest of the installation complete, and a rerun MUST retry it. The bundle MUST
NOT be vendored into the repository, duplicated as a setup row, or published to the setup's market
index.

#### Scenario: Fresh installation

- **WHEN** the installer runs against a profile that does not have the declared bundle
- **THEN** it installs the package from the pinned spec, selects the package name the profile recorded
  ahead of the setup bundle, and the composed profile contains every row that package's patch declares

#### Scenario: Package name differs from the repository name

- **WHEN** the installed package's name is not the spec's repository name, or is scoped
- **THEN** the installer selects the recorded package name and the verification passes

#### Scenario: Failed fetch

- **WHEN** the pinned spec cannot be fetched
- **THEN** the installer warns, installs the shipped bundles and the setup bundle as usual, and the
  verification does not report the absent bundle as a problem

#### Scenario: Stale pin

- **WHEN** the profile has the bundle installed at a different spec than the declared one
- **THEN** the installer installs the declared spec again instead of skipping the bundle

#### Scenario: Divergent declaration

- **WHEN** `dsh.json` and `install.ps1` disagree about a spec, or a spec is not exactly
  `<source>:<path>#<40-hex commit>`
- **THEN** repository validation fails and names the offending spec
