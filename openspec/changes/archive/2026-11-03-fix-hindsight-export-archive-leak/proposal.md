# Proposal

## Why

Every export cycle leaves its transfer archive behind on the Hindsight server. Each `POST /transfer/export` stores `banks/<bank>/exports/<uuid>/transfer.zip` in `file_storage`, the exporter downloads the bytes and never deletes them, and the API exposes no file-delete endpoint. With the default five-minute interval the database grows without bound: issue #2 measured 3,058 retained archives and 16 GB in five days, and the affected host filled its system drive (observed again on the owner machine: a 17 GB `file_storage`, 2,551 live archives, and 748 completed `export_bank` operations in one bank).

The archive is a transfer artifact, not a durable copy: the committed export repository is the durable copy, and a failed push must not keep the archive. Hindsight 1.1.0 already treats the terminal operation row as the archive's only handle and deletes the blob (manifest and all chunk rows) when that row is deleted, so the leak is fixable from the exporter with the existing API and without a database, schema, or server change.

## What Changes

- The exporter deletes each completed export operation immediately after downloading its archive, before unpacking, snapshotting, committing, or pushing. The archive is gone whether or not the later steps succeed.
- Cleanup is best-effort: a failed delete is reported in one line, never fails the export cycle, and is retried by the next cycle. A server that does not offer the endpoint is reported once and skipped; export continues.
- Each cycle sweeps completed `export_bank` operations older than one hour, one bounded page per bank, and deletes them. This removes the existing backlog on affected machines and any archive orphaned by a crash between download and delete, while leaving recent operations (another exporter mid-download, a manual export from the control plane) untouched.
- The Hindsight documentation explains that the server-side archive is transient, how to verify that `file_storage` stops growing, and how to reclaim the disk space already consumed by deleted rows.
- Tests drive a fake server through download-then-delete ordering, push failure independence, cleanup failure isolation, sweep filtering, and a server without the cleanup endpoint.
- No new dependency, no Hindsight version bump, no direct database access, and no change to the export snapshot format or the restore path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hindsight-memory`: the exporter treats the server-side transfer archive as transient. A new requirement covers deleting the export operation after download, independent of commit and push, plus the bounded stale-operation sweep and its failure isolation.

## Impact

- `packages/plugin-hindsight/src/host/export-client.ts`: delete a terminal operation; list completed export operations.
- `packages/plugin-hindsight/src/host/export-cycle.ts`: delete after download, sweep before exports, report lines.
- `packages/plugin-hindsight/test/fake-hindsight.ts`: `DELETE .../operations/{id}/delete` and `GET .../operations` routes; a new cleanup test suite.
- `docs/hindsight.md`: server archive lifecycle and disk reclaim.
- Regenerated output: `packages/plugin-hindsight/lib/**` (`pnpm build`) and the vendored `packages/setup/node_modules/@dsh-setup/plugin-hindsight/**` (`pnpm gen`).
- Hindsight server: `DELETE /v1/default/banks/{bank_id}/operations/{operation_id}/delete`, already present in the pinned 1.1.0 (verified against the published `hindsight-api-slim==1.1.0` sdist and the running daemon).
