# Design

## Context

See `proposal.md` for motivation and `specs/hindsight-memory/spec.md` for the behavior contract. The current integration delegates memory lifecycle to the official Hindsight plugin; this change adds a Host-side exporter and a manual restore script. Hindsight 1.1.0 already exposes a bank transfer API: an asynchronous ZIP export whose entries are JSON (`documents/NNNNNN.json`, `observations.json`, `mental_models.json`, `knowledge_pages.json`, `data/*.json`, `history/*.json`, `attachments.json`, `manifest.json`), and an asynchronous import with `mode=restore` (absent target bank) or `mode=merge` (documents into an existing bank). Embeddings are never exported and are recomputed on import without LLM calls.

```
Hindsight 127.0.0.1:8888
  |  POST /v1/default/banks/{id}/transfer/export (async)
  |  poll operation -> download_url -> GET /v1/default/files/download/{key}
  v
archive.zip (entries are JSON)
  |  unpack verbatim
  v
<exportDir>/banks/<sanitized-bank>/...      + export.json + index.json
  |  git commit (only when normalized content changes)
  |  git push (no force, machine-local remote)
  v
private Git repository
  |
  |  restore-hindsight.ps1: rebuild archive.zip -> POST transfer/import
  v
fresh Hindsight database
```

## Goals / Non-Goals

**Goals:**

- A durable, versioned copy of every Hindsight bank that survives a wiped DSH home, a lost machine, or a reset database.
- Automatic operation by default, with no per-session user action.
- A manual, verifiable restore path that works with the daemon down.
- No credentials, remotes, or machine paths in tracked repository files.

**Non-Goals:**

- Replacing the Hindsight database or the official plugin lifecycle.
- Continuous change-data-capture events; Git history of full snapshots is the version history.
- Automatic restore on an empty database.
- Protection of `~/.dsh` sessions or credentials; that is separate work.
- Cross-machine concurrency beyond a single writer per machine.

## Decisions

### D1: Use the native bank transfer archive, not a custom export

The exporter calls the Hindsight transfer API and stores its archive entries verbatim. This is a public, schema-versioned contract with a matching importer, and it carries documents, facts, observations, bank config, mental models, knowledge pages, directives, and webhooks without embeddings. Alternatives: (a) a custom REST aggregation — must reproduce facts, links, observations, and config and will drift; (b) `pg_dump` — schema-coupled, unsafe with a running daemon, not portable across embedding backends; (c) the bank template export — config only, no memories. Rejected.

### D2: Verbatim JSON tree plus our metadata

Each archive entry becomes a file at the same relative path under the bank folder. Nothing is rewritten, so import consumes exactly what Hindsight produced. Our `export.json` records the original bank id, export time, operation id, counts, and SHA-256 per file; `index.json` lists banks and the last export. The bank folder name is a reversible sanitization of the bank id (colons are not valid in Windows paths); the original id is in `export.json` and the archive manifest. Alternative: pretty-printing and re-keying arrays — nicer diffs, but risks changing the payload and complicates the round trip. Not used.

### D3: Dedicated private repository outside the DSH home

The default target is a dedicated Git repository outside `~/.dsh` and `~/.pg0`, configured per machine. This survives the failure mode that motivated the change (the previous export would have lived inside the wiped tree), keeps active project worktrees untouched, and holds every bank — including repositories that are not currently open. A per-project folder was considered and rejected as the default: it invites auto-commits into a user's dirty worktree and raises accidental-publication risk.

### D4: Machine-local remote and credentials

The repository behavior (`enabled`, interval, auto-commit, auto-push, history, attachments) is row configuration. The target directory and the remote URL live in a machine-local file (`~/.dsh/hindsight-export.json` by default) because they are machine-specific and must never be tracked. Credentials come from the existing Git credential helper or SSH agent; the exporter runs with an environment that disables interactive prompts. Alternative: put the remote in the row — rejected by the repository rule against machine paths and private URLs in tracked files.

### D5: Interval plus idle and dispose triggers

A timer (default five minutes), an idle-session trigger, and a best-effort dispose attempt cover busy sessions, quiet periods, and shutdown. The export runs asynchronously and never blocks a turn. A single-writer lock with a stale-owner takeover prevents two Host processes from committing at once. Alternative: hook every retain operation — the upstream plugin does not expose a stable retain-completion event, and per-change exports would be expensive.

### D6: Commit only on change, push without force

The exporter computes a normalized content hash (stable key order, arrays ordered by stable ids where the archive permits) and skips writing or committing when the snapshot is unchanged. When content changes it writes all banks, commits once with a fixed identity, and pushes. Push failures keep the commit and retry next cycle; no force-push; a diverged remote is resolved with fetch and rebase only in the single-writer case, otherwise the cycle stops and reports. A first run bootstraps the repository with `git init` or `git clone` and an initial push.

### D7: Manual restore with the same archive contract

`restore-hindsight.ps1` verifies the manifest schema version and checksums, ensures the local daemon is healthy (running the documented provisioning script when needed), rebuilds the ZIP from the JSON tree, and submits `transfer/import` with `mode=restore` into the absent bank. It polls the operation and compares the returned counts with the manifest. `-DryRun` validates only. `-Mode merge` recovers documents into an existing bank with a conflict policy. When the local copy is gone, `-Repo <url>` clones the private remote first. When the daemon cannot start, the script falls back to `hindsight-admin import-bank` against the restored `pg0` instance. Alternative: automatic restore — rejected because a deliberately deleted bank would silently return; the plugin may warn but never restores without a command.

### D8: Plugin integration and dependency

The exporter lives in `packages/plugin-hindsight` and starts from `apply()` after the upstream plugin is applied. It is a timer plus `fetch` plus `git` child process, with no model-facing surface. A small pure-JavaScript ZIP library is needed to unpack and rebuild archives; it must be vendored by the generator and must not add install-time scripts. Alternative: spawning PowerShell `Expand-Archive`/`Compress-Archive` — Windows-only, another process surface, and harder to test. Not chosen.

## Risks / Trade-offs

- **Archive entry ordering may be unstable** → normalize key order and use a content hash before writing; the first task is a fixture-based ordering spike. If normalization is unsafe, commit only when the semantic hash changes and accept a larger diff.
- **Repository growth** → history and attachments are opt-in; snapshots exclude embeddings; commits only on change; Git compression handles text well. A large bank is still a large repository; the owner can move the directory or prune history.
- **Push failures and diverged remotes** → never force; keep local commits; stop on conflict and report. The single-writer design keeps the common case linear.
- **Privacy leak** → the remote must be private; history and attachments are off by default; the documentation warns that transcripts may contain secrets; tracked files never carry the remote or credentials.
- **Restore limitations** → `restore` requires an absent bank; `merge` carries documents only; imported facts are re-embedded (CPU time, no tokens); history and attachments are restored only if exported. The restore report names each of these.
- **Daemon down at export time** → the cycle fails open and retries; the plugin never starts an unmanaged server for this purpose.
- **Lock staleness after a crash** → TTL takeover with a recorded owner; the next cycle recovers.
- **Bank id collisions after sanitization** → reversible encoding plus the original id in the metadata; restore maps back from metadata, not the folder name.
- **`export.enabled` true on every machine** → first run creates or clones a local repository; if that fails, export reports and the Harness continues. No memory operation depends on it.

## Migration Plan

1. Add the `export` block to the plugin config and the generated setup row; default enabled with an empty remote.
2. Ship the exporter, restore script, tests, and documentation.
3. Run the repository checks; the release follows the normal set-release process.
4. Owner setup: create the private repository, write its URL into the machine-local file, run one export, verify the commit and push, then run a dry-run restore against a throwaway database.
5. Rollback: set `export.enabled` to false or remove the local repository; no database migration is involved.

## Open Questions

None that change the specs or approach. The owner chooses the final local directory and private remote URL when configuring the machine; both are machine-local inputs, not repository decisions.
