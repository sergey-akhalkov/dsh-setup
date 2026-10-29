# Proposal

## Why

On 2026-10-29 a destructive command emptied the DSH home and the local Hindsight `pg0` database. Every memory bank, knowledge page, and retained conversation was lost with no copy: the local server was the only store, and the database lived under the wiped paths. Hindsight 1.1.0 already produces a portable bank transfer archive, but nothing exported it durably. Memory must survive a wiped home, a lost machine, and an accidental database reset.

## What Changes

- Add an `export` configuration block to the `dsh-setup-hindsight` row: enabled by default (`export.enabled: true`), with a target directory outside the DSH home, an interval, auto-commit, auto-push, and opt-in history/attachments.
- Export every bank through the native Hindsight bank transfer API on an interval, after an idle session, and best-effort on dispose. The export is asynchronous, fail-open, and serialized by a single-writer lock.
- Store the transfer archive's JSON entries verbatim under one folder per bank, with a manifest and checksums, in a dedicated private Git repository. The exporter commits only when content changes.
- Push automatically to the configured private remote without force; authentication and remote failures keep the local commits and retry later. The remote URL and credentials stay in machine-local configuration, never in tracked files.
- Ship a manual `restore-hindsight.ps1` that rebuilds the transfer archive from the JSON tree and imports it into a fresh database, with dry-run, count verification, a remote-clone option, and the `hindsight-admin` offline fallback.
- Document the export layout, the privacy boundary, the restore procedure, and the required Git credentials.

Out of scope: the protection-layer work (guards and backups of `~/.dsh`), changes to the upstream Hindsight pin, and automatic import.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hindsight-memory`: add requirements for the default-on JSON export to a private Git repository and for the manual restore procedure.

## Impact

- `packages/plugin-hindsight`: configuration schema, export scheduler, Git commit/push, tests.
- `packages/setup`: generated row defaults and vendored plugin update.
- Root `restore-hindsight.ps1` and Hindsight documentation.
- `openspec/specs/hindsight-memory/spec.md`.
- A small pure-JavaScript ZIP dependency may be needed to unpack and rebuild transfer archives; it ships with the plugin and has no install scripts. No credential or machine path enters a tracked file.
