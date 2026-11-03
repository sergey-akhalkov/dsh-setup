# Proposal

## Why

The durable export grew to 3.3 GB on disk and around 1.4 GB a day while the memory it protects was about 235 MB. Two defects compound: the per-model refresh history (`mental_model_history.json`, 187 MB and still growing) is re-committed in full on every five-minute cycle as a loose Git object that is never packed, and once that file passed GitHub's 100 MB blob limit on 2026-10-31 every push became impossible — 398 commits piled up locally while each cycle retried a multi-gigabyte push. The same exporter also leaves its transfer archive on the server, which is being fixed separately.

## What Changes

- The default export scope stops carrying operational history that is not memory content: `mental_model_history.json` (per-model refresh history) and `data/async_operations.json` (the server's operation log). Both are carried only when `includeHistory` is enabled.
- At the end of every export cycle the exporter packs loose objects that exceed a threshold, so they do not accumulate between manual cleanups and a failed pack is retried by the next cycle whether or not the content changed.
- A push whose objects include a blob over 100 MB is skipped and reported instead of retried forever; the local commit is kept and a later cycle retries once the history fits the remote.
- Documentation explains the bounded default scope, the packing step, the oversize-push rule, and how to reclaim an already oversized export repository.
- **BREAKING** for restore: a default snapshot no longer carries per-model refresh history or the operation log, so `includeHistory` is now required to restore them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hindsight-memory`: the default export scope excludes generative and operational history, a commit packs loose objects, and an impossible push is reported instead of retried.

## Impact

- `packages/plugin-hindsight/src/host/export-archive.ts`: the default archive scope.
- `packages/plugin-hindsight/src/host/export-git.ts`: post-commit packing and the oversize-push guard.
- `packages/plugin-hindsight/test/export-archive.test.ts`, `export-push.test.ts`, `export-git.test.ts`: scope, packing, and push-guard coverage.
- `docs/hindsight.md`: bounded scope, packing, oversize-push rule, reclamation.
- Regenerated output: `packages/plugin-hindsight/lib/**` (`pnpm build`) and the vendored `packages/setup/node_modules/@dsh-setup/plugin-hindsight/**` (`pnpm gen`).
