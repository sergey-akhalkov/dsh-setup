# issue-tracking Specification

## Purpose
Defines how a change records the GitHub issues it fixes and how a successful release closes each still-open fixed issue exactly once, naming the tag, the GitHub Release URL, and the archived change.

## Requirements

### Requirement: The change names the issues it fixes

A change that fixes GitHub issues SHALL list each one in `proposal.md` on its own line as
`Fixes #<n>`. A change that only informs an issue SHALL use `Refs #<n>`. A `Refs` line MUST NOT
close an issue.

#### Scenario: A fixing change names its issues

- **WHEN** a change's `proposal.md` carries `Fixes #9`
- **THEN** the release closeout treats issue 9 as fixed by that change

#### Scenario: A reference never closes

- **WHEN** a change's `proposal.md` carries only `Refs #11`
- **THEN** the release closeout leaves issue 11 open

### Requirement: A release closes the issues it fixed

When a release publishes, the release workflow SHALL close every still-open issue named by `Fixes`
in an archived change within the release window, and MUST post exactly one comment naming the tag,
the GitHub Release URL for that tag, and the archived change path at that tag. The closeout MUST run
only after both the market publication and the `release` job that creates the GitHub Release for the
tag succeeded, and MUST NOT run when that Release was not created.

#### Scenario: A shipped fix closes its issue

- **WHEN** a tag is published, its GitHub Release exists, and an archived change in that release
  names `Fixes #9` while issue 9 is open
- **THEN** issue 9 receives one comment with the tag, the Release URL, and the archived change path,
  and is closed with reason `completed`

#### Scenario: A publication failure closes nothing

- **WHEN** the validation or the Pages deployment fails
- **THEN** no GitHub Release is created and no issue is commented on or closed

#### Scenario: A failed Release closes nothing

- **WHEN** the market published but the `release` job failed to create the GitHub Release
- **THEN** no issue is commented on or closed

#### Scenario: A change that names no issue closes nothing

- **WHEN** every archived change in the window names no `Fixes` issue
- **THEN** the closeout posts nothing and exits successfully

#### Scenario: A release tag selects its own window

- **WHEN** the closeout runs for tag `v1.0.0` from a checkout that also contains archives and
  edited proposals from later releases
- **THEN** the plan names only the issues fixed by the changes archived between `v0.9.0` and
  `v1.0.0`, read at that tag

### Requirement: The closeout is idempotent and respects a decision

Running the closeout twice for one release MUST NOT post a second comment and MUST NOT attempt to
close an already closed issue. An issue labelled `wontfix` or `invalid` MUST be skipped.

#### Scenario: A rerun is a no-op

- **WHEN** the closeout runs again for the same tag
- **THEN** every already closed issue is skipped and no comment is posted twice

#### Scenario: An owner decision stands

- **WHEN** a planned issue carries the `wontfix` or `invalid` label
- **THEN** it is skipped with that reason and stays open

### Requirement: The closeout is previewable offline

An active change SHALL be previewable before it is archived, and only an apply run SHALL contact
GitHub.

#### Scenario: Preview before the archive

- **WHEN** `node scripts/close-issues.ts --change <name>` runs for an active change
- **THEN** the plan lists the issues its `proposal.md` fixes and no GitHub call is made

#### Scenario: The plan works without gh

- **WHEN** the plan mode runs where `gh` is missing
- **THEN** it still prints the plan and exits successfully
