# Tasks

Single lane: groups 1-2 change two exporter modules and their tests, and group 3 regenerates the one vendored tree and the built output, so a second writer would only queue behind the first; one owner implements the change in dependency order.

## 1. Bounded snapshot scope
Owned: `packages/plugin-hindsight/src/host/export-archive.ts`, `packages/plugin-hindsight/test/export-archive.test.ts`

- [x] 1.1 Drop `mental_model_history.json` and `data/async_operations.json` from the stored snapshot unless `includeHistory` is set, and derive `includes_history` from the sections actually carried. Verify with `pnpm build && pnpm exec vitest run packages/plugin-hindsight/test/export-archive.test.ts`: the default scope omits both entries, `includeHistory` keeps them, and the manifest flag is true only when an operational section is present.

## 2. Packing and the oversize-push guard
Owned: `packages/plugin-hindsight/src/host/export-git.ts`, `packages/plugin-hindsight/src/host/export-cycle.ts`, `packages/plugin-hindsight/test/export-git.test.ts`, `packages/plugin-hindsight/test/export-end-to-end.test.ts`, `packages/plugin-hindsight/test/export-push.test.ts`

- [x] 2.1 Call `packLooseObjects` at the end of every export cycle, changed or not: count the loose objects and run `git repack -d -q` when they exceed 500, ignoring any failure. Verify with `export-git.test.ts` (the helper packs a seeded backlog) and `export-end-to-end.test.ts`: write 520 blobs with `git hash-object -w --stdin-paths`, assemble them with `git mktree`, commit with `git commit-tree` and pin the commit with `git update-ref refs/heads/fixture` so the backlog is reachable, then run an unchanged cycle and assert `git count-objects -v` reports no loose objects and the export `HEAD` did not move.

- [x] 2.2 Refuse to push a range that carries a blob over 100 MiB: resolve the range a push would send, read every object size, and return a reason naming the file instead of pushing. Verify with push tests that use a small `maxBlobBytes`: an oversize snapshot is not pushed, the named file appears in the reason, the local commit stays, and a snapshot under the limit still pushes.

## 3. Documentation and the full gate
Owned: `docs/hindsight.md`, `packages/plugin-hindsight/lib/**`, `packages/setup/node_modules/@dsh-setup/plugin-hindsight/**`

- [x] 3.1 Document the bounded default scope in the export layout and configuration table, the packing step and the oversize-push rule under Git behavior, and a reclamation recipe for an already oversized export repository. Verify with `pnpm lint:fix` and `pnpm gen:check`.

- [x] 3.2 Run `pnpm build`, `pnpm gen`, `pnpm check`, `pnpm gen:check`, and `pnpm validate:repo`; commit the regenerated `packages/plugin-hindsight/lib/**` and `packages/setup/node_modules/@dsh-setup/plugin-hindsight/**`, and confirm a second `pnpm build` leaves `git diff --exit-code` clean.
