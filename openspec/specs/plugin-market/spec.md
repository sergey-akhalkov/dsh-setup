# plugin-market Specification

## Purpose

Defines the generated static catalog that makes the setup bundle and individual plugin bundles discoverable and installable through DSH's native plugin market, with immutable version pinning and host compatibility.

## Requirements


### Requirement: Format-1 index generation

The release process SHALL generate a JSON plugin market index conforming to format 1, containing one entry for the setup bundle and one entry for each published plugin bundle, with a localized market title and per-plugin display metadata.

#### Scenario: Release generation

- **WHEN** a release tag is created
- **THEN** the generator emits an index whose entries describe the setup bundle and every published plugin bundle.

#### Scenario: Invalid document rejection

- **WHEN** generated content violates a format-1 rule, such as a missing required field or an undeclared metadata reference
- **THEN** publication is blocked and the offending JSON path is reported.

### Requirement: Immutable version pinning

Every listed version MUST reference an immutable source: a 40-hex-digit git commit SHA plus the package directory path inside the repository. The listed version MUST equal the package manifest version, and the listed publish time MUST be the source commit time.

#### Scenario: Version entry

- **WHEN** the index lists version `X.Y.Z` of a package
- **THEN** the entry's commit resolves to the tagged source, the path resolves to that package directory, and the version matches the package manifest.

#### Scenario: Non-immutable source rejection

- **WHEN** a generated version lacks a commit SHA or package path
- **THEN** the generator fails instead of publishing a mutable reference.

### Requirement: Version accumulation

A release SHALL preserve every installable version of a package that the previously published index lists, in addition to the version being released. Regeneration MUST read the previous published document instead of dropping older versions, and MUST fail rather than publish when that document cannot be read or fails validation.

#### Scenario: Second release

- **WHEN** a newer release is published
- **THEN** the index lists the new version and the previous versions, each with its original commit, publish time, and engine range.

#### Scenario: Unreadable previous index

- **WHEN** the previously published document cannot be read or fails format validation
- **THEN** publication stops and the previously deployed index remains in place.

### Requirement: Compatibility annotation

Every listed version MUST copy the package manifest's `engines.dsh` range unchanged. A version whose range is missing, blank, or invalid MUST NOT be listed.

#### Scenario: Compatible version

- **WHEN** the running DSH version satisfies a listed version's `engines.dsh`
- **THEN** the market reports the version as installable.

#### Scenario: Incompatible version

- **WHEN** the running DSH version does not satisfy a listed version's `engines.dsh`
- **THEN** the market reports the version as incompatible and offers no install action for it.

### Requirement: Install-target mapping

Each listed version MUST map to the pnpm install specification that DSH uses for git sources: `git+<repository-url>#<commit>` followed by `&path:/<package-path>` when the package is not at the repository root.

#### Scenario: Discover install

- **WHEN** a user installs a listed version from Discover
- **THEN** the install uses the generated git specification and the installed package version equals the listed version.

### Requirement: Display metadata and icons

Each plugin entry SHALL provide a localized title and description with an English fallback, and an icon that is either a relative file published beside the index or an inline image within the format's size limit.

#### Scenario: Missing optional metadata

- **WHEN** a plugin declares no title in the index
- **THEN** the market displays the package name, and discovery still succeeds.

#### Scenario: Relative icon resolution

- **WHEN** an entry references `icons/<name>.svg`
- **THEN** the browser resolves it beside the index URL and the card renders the icon.

### Requirement: Static hosting constraints

The index and its icons SHALL be served from a public HTTPS origin at a stable URL, as a direct 200 response without redirects, and the URL SHALL be documented in the repository.

#### Scenario: Add index source

- **WHEN** a user adds the documented index URL in the Discover tab
- **THEN** DSH reads the index successfully and lists its plugins.

#### Scenario: Redirect or insecure source

- **WHEN** the documented URL redirects or uses plain HTTP
- **THEN** DSH refuses to read it and reports the configured source as failed.

### Requirement: Publication gate

Index publication MUST occur only after the validation and composition checks succeed for the release commit. A failed release MUST leave the previously published index in place.

#### Scenario: Failed validation

- **WHEN** validation fails for a release candidate
- **THEN** no new index is deployed and the previously published index remains readable.

#### Scenario: Successful release

- **WHEN** validation succeeds for a tagged commit
- **THEN** the generated index and icons are deployed as one atomic publication.

### Requirement: Update visibility

A newer release SHALL make previously installed setup or plugin bundles report an available update, while older listed versions remain installable for users pinning a specific release.

#### Scenario: Newer version available

- **WHEN** the index lists a newer version than the installed bundle
- **THEN** the market reports an update for that entry.

#### Scenario: Older version pinned

- **WHEN** a user installs an older listed version
- **THEN** the entry's page offers that version and installation proceeds with its pinned commit.
