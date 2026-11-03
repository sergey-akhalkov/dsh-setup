# Spec Delta

## ADDED Requirements

### Requirement: Transient export archive

The exporter SHALL delete a completed export operation immediately after its archive is downloaded, so the server-side `transfer.zip` and its chunk rows do not outlive their use. The deletion MUST happen before the snapshot is written and before any commit or push, and MUST NOT depend on their outcome. Blob reclamation is best-effort on the server: an acknowledged delete is not retried by the client.

#### Scenario: Archive deleted after download

- **WHEN** the archive bytes for a bank have been downloaded
- **THEN** the exporter deletes that export operation before writing the snapshot

#### Scenario: Commit or push failure

- **WHEN** the commit or the push fails after the export
- **THEN** the archive was already deleted, and a later cycle re-exports and retries the push

#### Scenario: Cleanup failure does not fail the cycle

- **WHEN** the operation-delete request fails
- **THEN** the cycle keeps its outcome, reports the failure, and the operation remains for the sweep

#### Scenario: Acknowledged delete with a retained blob

- **WHEN** the server acknowledges the delete but cannot reclaim the stored archive
- **THEN** the exporter treats the operation as deleted and the documented storage check finds the residual

#### Scenario: Server without cleanup

- **WHEN** the server does not offer the operation-delete endpoint
- **THEN** the exporter reports that archive cleanup is unavailable and keeps exporting

### Requirement: Stale export archive sweep

Each export cycle SHALL delete completed whole-bank export operations that finished more than one hour ago, one bounded page per bank, so archives accumulated before this behavior, or orphaned by a crash between download and deletion, do not persist. The sweep MUST NOT delete incomplete, failed, or non-export operations.

#### Scenario: Existing backlog

- **WHEN** the server holds completed export operations older than one hour
- **THEN** later cycles delete them and the count of stored export archives stops growing

#### Scenario: Recent operation

- **WHEN** a completed export operation finished less than one hour ago
- **THEN** the sweep leaves it for a later cycle

#### Scenario: Other operation types

- **WHEN** an operation is not a completed whole-bank export
- **THEN** the sweep does not delete it

#### Scenario: Failed download

- **WHEN** an export completed but its download failed
- **THEN** the sweep deletes its archive after the grace period

#### Scenario: Bounded work per cycle

- **WHEN** a bank has more stale operations than one page
- **THEN** the cycle deletes one page and later cycles continue the sweep

#### Scenario: Sweep failure does not fail the cycle

- **WHEN** listing or deleting in the sweep fails
- **THEN** the cycle continues, reports the failure, and a later cycle retries
