# Tasks

Single lane: groups 1-3 change the same exporter files (`export-cycle.ts`, `export-client.ts`, and their tests) and group 5 regenerates the one vendored tree, so a second writer would only queue behind the first; one owner implements the change in dependency order.

## 1. Test harness and client API
Owned: `packages/plugin-hindsight/test/fake-hindsight.ts`, `packages/plugin-hindsight/src/host/export-client.ts`, `packages/plugin-hindsight/test/export-client.test.ts`

- [x] 1.1 Add `deleteOperation(bankId, operationId)` and `listCompletedExportOperations(bankId)` to `TransferClient`, plus the matching `DELETE .../operations/{id}/delete` and `GET .../operations?type=export_bank&status=completed&limit=100&offset=0` routes in `test/fake-hindsight.ts` that record the calls. Verify with `pnpm exec vitest run packages/plugin-hindsight/test/export-client.test.ts`: a 200 deletes, a 404 counts as already gone, a 409 surfaces as a retryable cleanup failure, and the list request carries the type/status/limit filters and parses `id` with `updated_at` falling back to `created_at`.

## 2. Cleanup after download
Owned: `packages/plugin-hindsight/src/host/export-cycle.ts`, `packages/plugin-hindsight/test/export-cleanup.test.ts`, `packages/plugin-hindsight/test/export-push.test.ts`

- [x] 2.1 In `runExportCycle`, delete each bank's completed export operation immediately after `exportBank` returns and before `unpackArchive` and `writeSnapshot`, in a `finally` so a malformed archive is still cleaned, with one report line on failure. Verify with a new `export-cleanup.test.ts` asserting request order (export submit, poll, download, delete, then the Git commit) for a multi-bank cycle.

- [x] 2.2 Prove the archive does not depend on the commit or push outcome: a cycle whose remote push fails still deletes every archive. Verify by extending the cleanup test with an unreachable remote and asserting one delete per bank plus the existing push-retry behavior.

- [x] 2.3 Prove cleanup failure isolation: a delete that answers 500 leaves the cycle outcome, commit, and push unchanged, reports the bank and reason, and leaves the operation in place for the sweep. Verify in the cleanup test; the retry is covered by the sweep test.

- [x] 2.4 Prove the acknowledged-residual case: the fake delete route answers 200 but keeps its stored archive, and the cycle treats the operation as deleted with no error, no extra retry, and no crash. Verify in the cleanup test; this is the client side of the documented server-side residual.

## 3. Stale export operation sweep
Owned: `packages/plugin-hindsight/src/host/export-cycle.ts`, `packages/plugin-hindsight/test/export-cleanup.test.ts`

- [x] 3.1 Sweep after `listBanks()` and under the snapshot lock, before exporting: for each bank, list one page of completed `export_bank` operations, delete those whose completion is older than one hour, and advance the offset only past kept entries. Verify with a test that seeds stale, recent, pending, failed, and non-export operations and asserts only the stale completed exports are deleted and the rest survive.

- [x] 3.2 Keep the sweep bounded and retrying: more than one page of stale operations deletes one page in the first cycle and the rest in the next; a list or delete failure is reported and does not fail the cycle; a server answering 404/405 for the list or delete route is reported as cleanup-unavailable and the export still runs. Verify with tests covering the multi-cycle drain, the failure path, and the unsupported server.

- [x] 3.3 Verify a failed download does not leak: complete an export but make the archive download answer 500, let the cycle fail open, then run a cycle whose clock is past the grace period and assert the stale operation is deleted.

## 4. Documentation
Owned: `docs/hindsight.md`

- [x] 4.1 Add a "Server-side archive" subsection to the durable-export part of `docs/hindsight.md`: the archive is transient, it is deleted right after download regardless of commit and push, stale completed exports older than an hour are swept, cleanup needs the pinned 1.1.0 server, and it includes the verification SQL, the operator residual check (the server's `Failed to delete export archive` log line plus a storage query), the optional manual SQL that prunes `banks/%/exports/%` rows and a `VACUUM (FULL)` for disk reclaim, without claiming operation retention removes such orphans. Verify with `pnpm lint:fix` and by running each documented command against the live daemon.

## 5. Integration verification
Owned: `packages/plugin-hindsight/lib/**`, `packages/setup/node_modules/@dsh-setup/plugin-hindsight/**`

- [ ] 5.1 Run `pnpm build`, `pnpm gen`, `pnpm check`, `pnpm gen:check`, and `pnpm validate:repo`; commit the regenerated `packages/plugin-hindsight/lib/**` and `packages/setup/node_modules/@dsh-setup/plugin-hindsight/**` and confirm `git diff --exit-code` after a rebuild shows no drift.

- [ ] 5.2 Live acceptance on a dedicated throwaway `pg0` instance (never the owner's live database, following the archived export change's recipe): run two export cycles for a test bank, then query `file_storage` and assert the bank's `exports/` rows return to zero after each cycle and the relation size stays flat across cycles; seed more stale operations than one page and confirm the backlog shrinks by one page per cycle. Record the SQL counts in the change's verification notes.

## Workflow follow-up

- Mark each task complete only after its verification passes, and run its task-scoped `task-review` before ticking it, per the repository's review-approval gate.
- Sync the `hindsight-memory` delta into `openspec/specs/` and archive the change once every checked task has a committed review PASS.
