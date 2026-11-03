# Verification notes

## 4.1 Documentation commands

The verification block in `docs/hindsight.md` was run verbatim against the live daemon and its
database: 6,929 archive rows / 16 GB for `banks/%/exports/%`, and a 17 GB `file_storage` relation.
The destructive prune pair was validated against the same schema with `EXPLAIN (COSTS OFF)` only;
it is executed on the throwaway instance below, because writing to the owner's live database needs
explicit owner confirmation.

## 5.2 Live acceptance on a throwaway instance — 2026-11-03

Dedicated `pg0` instance `hindsight-acceptance` (port 5433) and a throwaway Hindsight home under
`%TEMP%\dsh-hindsight-acceptance` with the daemon on port 8899. The owner's live instance
(`hindsight-embed-default`, port 5432) and daemon (port 8888) were not used or modified.

The `pg0` instance was created by the daemon and lives under the machine `pg0` root; it was dropped
with `pg0 drop --name hindsight-acceptance --force` afterwards. The bank `acceptance-bank` was
created by a retain attempt whose deliberately dummy LLM key was rejected (HTTP 401); that failure
is in fact extraction only and does not touch the transfer/archive path.

The built `packages/plugin-hindsight/lib` was driven through `runExportCycle` with `autoPush: false`
and an export directory inside the scratch tree.

| Step                                      | export archive rows | export operations | `file_storage` relation |
| ----------------------------------------- | ------------------- | ----------------- | ----------------------- |
| after cycle 1                             | 0                   | 0                 | 32 kB                   |
| after cycle 2                             | 0                   | 0                 | 32 kB                   |
| 150 stale completed `export_bank` rows    | 0                   | 150               | -                       |
| after cycle 3                             | 0                   | 100               | -                       |
| after cycle 4                             | 0                   | 0                 | 48 kB                   |

The seeded rows were inserted into `async_operations` with
`updated_at = now() - interval '2 hours'`. Cycle 3 deleted exactly one page (100) and cycle 4 the
remaining 50, matching the bounded sweep; the archive row count returned to zero after every cycle.

Both documented prune commands were then run on the same throwaway database, with three seeded
`banks/acceptance-bank/exports/.../transfer.zip` rows:

| Step                               | export archive rows | `file_storage` relation |
| ---------------------------------- | ------------------- | ----------------------- |
| three archive rows seeded          | 3                   | 88 kB                   |
| `DELETE ... LIKE 'banks/%/exports/%'` | 0                | 88 kB                   |
| `VACUUM (FULL) file_storage`       | 0                   | 16 kB                   |

The `DELETE` removed exactly the three seeded rows (`DELETE 3`) without shrinking the relation, and
`VACUUM (FULL)` returned the space; the live database was only read in this session.

Cleanup: throwaway daemon stopped, instance dropped, scratch tree removed; the live daemon answered
`/health`, and every acceptance SQL statement ran on port 5433. The live export-archive count moved
from 6,929 to 6,953 rows while this work ran, because the still-installed earlier exporter keeps
leaving archives behind: that is the leak this change fixes, not a write from this session.
