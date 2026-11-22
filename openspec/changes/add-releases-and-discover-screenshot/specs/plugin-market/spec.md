# Spec Delta

## ADDED Requirements

### Requirement: GitHub Release publication

A release tag `v<version>` that passes the release gate SHALL publish a GitHub Release for that tag
whose notes GitHub generates from repository history. A tag whose validation or Pages deployment
fails MUST publish no Release, and a workflow rerun for a tag whose Release already exists MUST leave
that Release and its notes unchanged.

#### Scenario: Successful release

- **WHEN** validation and the Pages deployment succeed for tag `v<version>`
- **THEN** a GitHub Release for `v<version>` exists with generated notes.

#### Scenario: Failed validation

- **WHEN** validation fails for a tagged commit
- **THEN** no GitHub Release is created for that tag.

#### Scenario: Failed Pages deployment

- **WHEN** validation passes but the Pages deployment fails
- **THEN** no GitHub Release is created for that tag and the previously published index remains in place.

#### Scenario: Rerun with an existing Release

- **WHEN** the release workflow runs again for a tag whose GitHub Release already exists
- **THEN** the run leaves that Release and its notes unchanged and does not fail on its existence.

### Requirement: Discover route documentation

The installation guide SHALL show the Discover route for installing the setup market: enable the
Custom plugin markets bundle, open Discover, add the documented index URL, and select the setup
entry. It MUST include a screenshot of Discover with the dsh-setup market index added, with
descriptive alt text, and the tracked image and text MUST contain no machine path, credential, or
private session content.

#### Scenario: Reader follows the guide

- **WHEN** a reader opens the installation guide's manual install section
- **THEN** the steps name the toggle, the tab, and the index URL, and a screenshot shows Discover with the dsh-setup market added.

#### Scenario: Screenshot is accessible

- **WHEN** the screenshot is read as text or rendered without images
- **THEN** its alt text describes Discover with the dsh-setup index added, and the numbered steps still carry the full route.

#### Scenario: No machine data in the tracked image

- **WHEN** the tracked repository is inspected
- **THEN** the screenshot shows no machine path, user name, credential, session title, or private content.
