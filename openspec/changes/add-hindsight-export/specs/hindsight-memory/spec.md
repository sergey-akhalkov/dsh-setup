# Spec Delta

## ADDED Requirements

### Requirement: Default-on durable export

The `dsh-setup-hindsight` row SHALL default `export.enabled` to true and expose the target directory, interval, auto-commit, auto-push, history, and attachment settings. Disabling export MUST stop all Git activity without affecting memory. The target directory MUST default outside the DSH home.

#### Scenario: Default configuration

- **WHEN** the setup is installed and no export configuration overrides the row
- **THEN** export is enabled and writes to a directory outside the DSH home

#### Scenario: Export disabled

- **WHEN** the row or machine-local configuration sets `export.enabled` to false
- **THEN** the plugin writes no export files and runs no Git command

#### Scenario: Target outside the DSH home

- **WHEN** the default target directory is resolved
- **THEN** it is not under the DSH home or the Hindsight `pg0` instance path

### Requirement: Native transfer archive as JSON

The exporter SHALL obtain each bank through the Hindsight bank transfer API and store the archive's JSON entries verbatim under one folder per bank, with a manifest and checksums. It MUST NOT store embeddings, MUST exclude history and attachments unless enabled, and MUST keep the local export outside the DSH home and `pg0` paths.

#### Scenario: Bank folder

- **WHEN** a bank is exported
- **THEN** its transfer archive entries and a manifest with counts and checksums are written under one sanitized bank folder

#### Scenario: No embeddings

- **WHEN** the archive is written
- **THEN** it contains no embedding vectors and records the Hindsight schema version

#### Scenario: Opt-in history and attachments

- **WHEN** history or attachments are not enabled
- **THEN** the export omits those archive sections

### Requirement: Export scheduling and failure isolation

The exporter SHALL run on the configured interval, after an idle session, and best-effort on dispose, using one writer at a time. It MUST be asynchronous, MUST fail open without blocking or crashing the Harness, MUST retry on the next cycle, and MUST commit only when exported content changes.

#### Scenario: Interval export

- **WHEN** the interval elapses and the local server is healthy
- **THEN** every bank is exported and changed content is committed

#### Scenario: Server unavailable

- **WHEN** the local Hindsight server is unreachable
- **THEN** the export attempt fails open, the Harness session continues, and the failure is observable

#### Scenario: Concurrent hosts

- **WHEN** two Host processes attempt an export at the same time
- **THEN** one writer holds the lock and the other skips the cycle

#### Scenario: Unchanged content

- **WHEN** an export produces the same content as the last committed snapshot
- **THEN** no new commit is created

### Requirement: Git commit and automatic push

The exporter SHALL commit to a dedicated private Git repository and push automatically to its configured remote without force. Remote URL and credentials MUST come from machine-local configuration and never from tracked files. Authentication or network failures MUST leave local commits intact and retry later without user prompts.

#### Scenario: Successful push

- **WHEN** a changed snapshot is committed and the private remote is reachable
- **THEN** the commit is pushed without force

#### Scenario: Push failure

- **WHEN** authentication or the network fails
- **THEN** the local commit remains, no interactive prompt appears, and a later cycle retries the push

#### Scenario: No remote

- **WHEN** no remote is configured
- **THEN** exports are committed locally and no push is attempted

#### Scenario: No tracked remote or credential

- **WHEN** repository validation inspects the setup and plugin files
- **THEN** it finds no export remote URL, credential, or machine path

### Requirement: Manual restore from exported JSON

The repository SHALL ship a manual restore script that rebuilds the transfer archive from the exported JSON tree and imports it, with dry-run and count verification. Restore MUST target an absent bank; merge MAY recover documents into an existing bank. The script MUST support cloning the private remote when the local export is gone and MUST offer the offline `hindsight-admin` fallback.

#### Scenario: Restore after data loss

- **WHEN** the database is empty and a snapshot exists
- **THEN** the script restores each bank and verifies the imported counts against the manifest

#### Scenario: Existing bank

- **WHEN** restore targets a bank that already exists
- **THEN** the script refuses the restore and names the merge option

#### Scenario: Dry run

- **WHEN** the script runs in dry-run mode
- **THEN** it reports the planned imports and changes no bank

#### Scenario: Remote-only copy

- **WHEN** the local export directory is gone but the private remote is configured
- **THEN** the script clones the remote and restores from it

#### Scenario: Verification mismatch

- **WHEN** imported counts differ from the manifest
- **THEN** the script reports the mismatch and exits non-zero

### Requirement: Export privacy and documentation

Export MUST default to a private remote, MUST keep history and attachments off unless enabled, and MUST document that memory may contain conversation text and secrets. Repository validation MUST find no remote URL, credential, or machine path in tracked files.

#### Scenario: Private remote

- **WHEN** the owner configures the remote
- **THEN** the documentation requires a private repository and no automatic push without a configured remote

#### Scenario: Default export scope

- **WHEN** export runs with default settings
- **THEN** history and attachments are omitted

#### Scenario: Documentation

- **WHEN** the owner reads the Hindsight page
- **THEN** it explains the export layout, the restore procedure, the Git credential requirement, and the privacy boundary
