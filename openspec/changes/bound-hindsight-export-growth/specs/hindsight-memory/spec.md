# Spec Delta

## MODIFIED Requirements

### Requirement: Native transfer archive as JSON

The exporter SHALL obtain each bank through the Hindsight bank transfer API and store the archive's JSON entries verbatim under one folder per bank, with a manifest and checksums. It MUST NOT store embeddings, MUST exclude operational history and attachments unless enabled, and MUST keep the local export outside the DSH home and `pg0` paths.

#### Scenario: Bank folder

- **WHEN** a bank is exported
- **THEN** its transfer archive entries and a manifest with counts and checksums are written under one sanitized bank folder

#### Scenario: No embeddings

- **WHEN** the archive is written
- **THEN** it contains no embedding vectors and records the Hindsight schema version

#### Scenario: Default scope

- **WHEN** the export runs with default settings
- **THEN** operational history and attachments are omitted

#### Scenario: Opt-in history and attachments

- **WHEN** history is enabled
- **THEN** the export keeps the audit log, the LLM request log, the per-model refresh history, and the operation log
- **AND WHEN** attachments are enabled
- **THEN** the export keeps the attachment rows and blob bytes

### Requirement: Git commit and automatic push

The exporter SHALL commit to a dedicated private Git repository, pack loose objects during an export cycle, and push automatically to its configured remote without force. Remote URL and credentials MUST come from machine-local configuration and never from tracked files. Authentication, network, or oversize-blob failures MUST leave local commits intact and retry later without user prompts.

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

#### Scenario: Oversized blob in the push

- **WHEN** the objects a push would send include a blob over 100 MiB
- **THEN** the exporter skips the push, reports the file and the limit, and keeps the local commit

#### Scenario: Packed during a cycle

- **WHEN** an export cycle finishes with a loose-object backlog over the threshold
- **THEN** the exporter packs those objects, whether or not the snapshot changed
- **AND WHEN** packing fails
- **THEN** the cycle keeps its outcome and the next cycle packs again
