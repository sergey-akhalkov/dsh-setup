# Design

## Context

Measured on the owner machine on 2026-11-03, with the export installed since 2026-10-29:

| What | Size | Cause |
| --- | --- | --- |
| `hindsight-export-pc` working tree | 235 MB | `mental_model_history.json` in the `coding-agent::dsh-setup` bank is 187 MB and grows about 1.3 MB an hour |
| `hindsight-export-pc/.git` | 3.16 GB | 9,065 loose objects (2.85 GB) against 93 MB of packs: every five-minute commit stored another full copy of the growing file |
| uncompressed local database | 19.4 GB | 17 GB of `file_storage` export archives; fixed in the archived `fix-hindsight-export-archive-leak` change, deployed after this measurement |
| remote | frozen since 2026-10-31 22:47 | the last pushed snapshot carried the file at 99.6 MB; the next commit carried it at 101.0 MB, over GitHub's 100 MB blob limit, so every later push was rejected and retried |

The Hindsight transfer archive always carries `mental_model_history.json` with the `data` scope: the server treats per-model refresh history as mental-model state, not as optional history. The exporter therefore has to drop it itself when the owner does not ask for history.

## Goals

- A snapshot contains only what a restore needs to rebuild the memory: documents, facts, observations, mental models, knowledge pages, directives, webhooks, and bank configuration.
- A repository stays small without manual `git gc`, and a commit that cannot reach the remote is reported once per cycle instead of being retried with a multi-gigabyte pack.

## Non-Goals

- Changing the transfer archive format, the restore procedure, or the pinned Hindsight version.
- A retention/pruning policy for old snapshots; the bounded snapshot makes the packed history small enough that it is unnecessary.
- Deleting the owner's existing repository history; that is an operational step, not code.

## Decisions

### 1. Reuse `includeHistory` for the bounded scope

`includeHistory` is documented as "also carry the audit log and the LLM request log" and defaults to off. Extending it to cover all non-memory operational state — `history/**`, `mental_model_history.json`, and `data/async_operations.json` — keeps one switch instead of adding `includeMentalModelHistory` and `includeOperationLog`. A restore that wants the audit trail turns on one flag and gets the whole trail.

Alternatives rejected: a new per-file flag pair (three switches for one intent), and dropping the files unconditionally (a restore could never recover the model history even deliberately).

### 2. Pack at the end of every cycle, above an explicit threshold

Every export cycle ends by calling `packLooseObjects`: it reads the loose object count and, above 500, runs `git repack -d -q`. It runs whether the snapshot changed or not, so a transient packing failure is retried on the next cycle instead of waiting for the next content change — with the bounded scope most cycles are unchanged, and that wait could be days. Failure is ignored: housekeeping must not turn a successful snapshot into a failed cycle.

`git gc --auto` is not used because it was measured as a no-op on this machine: with Git 2.56 for Windows and `gc.auto=1`, both `git gc --auto` and `git maintenance run --auto` left loose objects unpacked in a small repository, which is the same silent gap that let 9,065 loose objects accumulate in the owner's repository. An explicit count plus `git repack` is deterministic, and below the threshold it costs one `git count-objects` call per cycle.

Alternative rejected: a scheduled task or `git maintenance` registration outside the exporter, because it needs another machine-specific install step and does not travel with the plugin.

### 3. Inspect the objects a push would send

`pushSnapshot` resolves the range it would push (`origin/<branch>..HEAD`, or `HEAD` when the branch has never been pushed), lists the objects in it, and reads their sizes through `git cat-file --batch-check`. If any blob exceeds 100 MiB, the push is skipped with a reason naming the file, and the commit stays for a later cycle.

The check is on the range and not only on `HEAD`: a snapshot that later drops an oversized file would still fail while that blob sits in an unpushed commit, and the retry loop would return. Checking the range is the behavior that actually bounds the failure.

The threshold is a constant, `MAX_PUSHABLE_BLOB_BYTES = 100 MiB`, matching the hard limits of the remotes this setup documents (GitHub rejects pushes carrying such a blob). `PushOptions.maxBlobBytes` exists for tests and a future self-hosted remote with a larger limit; the export configuration does not expose it.

### 4. Report, never fail the cycle

Both new steps are best-effort in the same way the push already is: packing failure is ignored, an oversize push returns `{ pushed: false, reason }` and the existing cycle reporting prints it once per cycle. Memory export must never be blocked by repository housekeeping.

## Risks and Mitigations

- **Restore loses model refresh history by default.** Documented in the layout and configuration sections, and `includeHistory` restores it. The models themselves, their evidence, and the pages are unaffected.
- **A remote that accepts blobs over 100 MiB now stops receiving pushes.** The reason line names the file and the limit, and the constant is one line to raise; the platform defaults this setup documents reject such blobs anyway.
- **Packing costs time on a large repository.** It runs after the snapshot work of each cycle, is skipped below 500 loose objects, and a failure never fails the cycle.
- **`async_operations` is not memory content.** It is an execution log the server can regenerate; the change excludes it only when history is off, so a forensic restore can still request it.

## Verification

- Unit: default scope omits `mental_model_history.json` and `data/async_operations.json`; `includeHistory` keeps them; the manifest records the requested scope.
- Git: a snapshot with a blob over the test limit is not pushed and reports the file; a snapshot under the limit pushes; an unchanged cycle packs a reachable loose-object backlog once the threshold is crossed.
- Integration: `pnpm build`, `pnpm gen`, `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, and a live cycle that shrinks the owner's export repository.
