# Design

## Context

See `proposal.md` - Why. The exporter (`packages/plugin-hindsight/src/host`) submits an async whole-bank transfer, polls it to `completed`, downloads `result_metadata.download_url`, unpacks the ZIP into the export repository, then commits and pushes. The server stores that ZIP under `banks/<bank>/exports/<uuid>/transfer.zip` and keeps it until something deletes it.

The pinned server (Hindsight 1.1.0) closes the loop for us: a terminal operation row is the archive's only handle, and deleting the row deletes the blob - the whole-file row and every `transfer.zip#chunk=N` row. The running daemon exposes `DELETE /v1/default/banks/{bank_id}/operations/{operation_id}/delete`, and `GET .../operations?type=export_bank&status=completed` lists candidates. No file-delete endpoint exists, and `files/retain` is file-to-memory conversion, not retention.

Constraints that shape the approach: cleanup must never fail an export cycle; the exporter runs every five minutes against local, remote, S3, and Cloud servers alike (so no direct database or filesystem access); the operation list is newest-first and paginated; another Host process or a manual control-plane export may use the same server.

## Goals / Non-Goals

**Goals:**

- Every cycle deletes its own archives right after download, so the server does not accumulate the archives the exporter produces, and the outcome of the commit or the push cannot change that.
- The archives already accumulated on affected machines, and any archive orphaned by a crash between download and delete, are removed without manual SQL.
- Cleanup is observable in the one-line export report and testable without a live server.

**Non-Goals:**

- Reducing the export interval or the server-side cost of building an archive every cycle.
- Changing the export snapshot format, the restore path, or any configuration option.
- Adding a server endpoint, an upstream patch, or a database dependency.

## Decisions

### Delete the terminal export operation, not the blob

The exporter calls the existing operation-delete endpoint right after the bytes are in hand. The endpoint deletes the operation row and then asks the storage backend to delete the archive's manifest and chunk rows, which makes the route work for local, remote, S3, and Cloud servers with no new dependency and no knowledge of the database. Blob reclamation is best-effort inside the server: the row is deleted first and a storage failure after that is logged and swallowed, so the client sees success and has nothing left to retry.

Alternatives considered: a new `DELETE /files/{key}` endpoint (upstream work with no extra benefit), direct `file_storage` rows deletion over `psql` or a PostgreSQL client (couples the plugin to the embedded `pg0` instance, its credentials, and its schema; breaks for S3/remote/Cloud; acquires a dependency; conflicts with the rule to never touch `~/.pg0`), and server-side retention via `HINDSIGHT_API_OPERATION_RETENTION_DAYS` (bounds growth to days instead of stopping it, and still needs an archive delete; kept only as an optional operator note in the docs).

### Delete immediately after download, before unpack and publish

The archive's only purpose is the download. Deleting before `unpackArchive`, `writeSnapshot`, commit, and push makes the push outcome irrelevant by construction: a failed commit or push cannot leave an archive behind, and a malformed archive still gets cleaned up. The bytes are already in memory, so snapshotting does not need the server copy. If the process dies between download and delete, the stale sweep recovers.

Alternative considered: delete after a successful push (the literal reading of the request). It leaves the archive on any commit or push failure, which is exactly the case where cycles repeat, and it makes archive lifetime depend on a network outcome that has nothing to do with it.

### Best-effort cleanup with one report line

A failed delete request is caught, reported as `hindsight export: ...` with the bank and the reason, and the cycle result is unchanged. The operation row remains, so the sweep retries it later. A 404 means the operation is already gone and counts as success; a 409 means it is not terminal yet; a 404/405 on the route means the server predates or lacks the endpoint, which is reported and skipped. The cleanup never throws out of the cycle. An acknowledged delete whose server-side storage step failed is not retryable from the client (the blob has no handle left), so it is covered by the documented residual check instead.

Alternative considered: failing the cycle on a cleanup error. Rejected - memory durability must not depend on server housekeeping, and the next cycle retries anyway.

### Sweep stale completed export operations once per cycle

At cycle start, under the existing writer lock, the exporter lists one page (`limit=100`, `type=export_bank`, `status=completed`) per bank and deletes entries whose completion (`updated_at`, falling back to `created_at`) is older than one hour. Deletion shifts pagination, so the sweep only advances past entries it kept; one page per bank per cycle keeps a large backlog from turning one cycle into thousands of requests. The backlog shrinks by up to 500 operations per cycle across five banks and stops growing immediately.

The one-hour grace exists for other users of the server: a second Host process whose download is in flight, or a manual export from the control plane that has not been fetched yet. Operations deleted by the exporter never reach the sweep, so in steady state the sweep sees only recent entries and does nothing.

Alternatives considered: no sweep (leaves the existing 2.5k archives and crash leaks in place), delete every terminal export operation with no age filter (races another process's download and breaks manual exports), and a separate cleanup script (another lifecycle to install, schedule, and document for work the cycle already does).

### Constants, not configuration

The one-hour grace, the 100-row page, and the report format are code constants. No new `export.*` option: the behavior is required for correctness, not a preference, and an option would add a code path and a documented failure mode for no user benefit. A future need can promote a constant then.

### Tests drive the fake server, not the live daemon

`test/fake-hindsight.ts` gains the two routes (`DELETE .../operations/{id}/delete`, `GET .../operations`) and records them in `requests`. Tests assert request order (download before delete, delete before commit), that a DELETE failure leaves the cycle outcome unchanged, that a push failure still deletes, that the sweep filters by type, status, and age, that a server answering 404 for the delete route is reported but not fatal, and that an acknowledged delete is treated as done even when the fake keeps the blob. Live verification uses a dedicated throwaway `pg0` instance, following the archived export change's acceptance setup, and never the owner's live database.

## Risks / Trade-offs

- **The blob cleanup lives behind an endpoint whose public description says only "delete a terminal operation".** If a future server stops deleting the archive with the row, archives start accumulating again. → The behavior is asserted in the published 1.1.0 source and covered by the fake-server test; the setup pins the server version; the docs state the expectation, and an upstream documentation note is worth filing separately.
- **Deleting operations removes export history from the server's operation list and adds one audit row per delete.** The list is five-minute export noise today (748 entries in one bank), and the audit rows are kilobytes per day against gigabytes per day. → Accepted; server-wide retention settings remain available to operators.
- **The server deletes the operation row before reclaiming the blob and swallows a storage failure, so an acknowledged delete can leave an archive with no handle; a crash between the blob write and the metadata update leaves the same kind of orphan.** The sweep cannot retry either one, and operation retention cannot recover it because the metadata that named the blob is already gone. → Accepted server-side limitation: the server logs `Failed to delete export archive <key>`, and the docs give the storage check plus the optional manual SQL that prunes `banks/%/exports/%` rows and a `VACUUM (FULL)`.
- **Deleted rows do not shrink the database file immediately; the disk space is reused, not returned.** → Document that autovacuum reclaims it over time and that one manual `VACUUM (FULL)` on `file_storage` returns it at once.
- **Cleanup depends on the server being reachable after the download.** → If the delete request fails, the operation row remains and the sweep retries it in a later cycle; the export itself is already safe in memory and on disk.

## Migration Plan

No data migration. On the first cycle after the update, each bank's export is cleaned immediately and the sweep starts draining the backlog; the export repository, its history, and the restore path are untouched. Rollback is reverting the release: cleanup stops and archives accumulate again, with no loss to exported data or memory.

## Open Questions

None.
