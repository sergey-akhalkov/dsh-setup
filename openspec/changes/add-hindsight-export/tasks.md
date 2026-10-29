# Tasks

## 1. Configuration and defaults

- [ ] 1.1 Extend the plugin config type with the `export` block (`enabled`, `dir`, `intervalMinutes`, `autoCommit`, `autoPush`, `includeHistory`, `includeAttachments`, `importOnEmpty`) and read the machine-local `~/.dsh/hindsight-export.json` for `dir` and `remote`; verify unit tests cover the default (enabled, target outside the DSH home), explicit disable, and machine-local precedence.
- [ ] 1.2 Add the default `export` block to `packages/plugin-hindsight/cordis.fragment.yml` and the setup defaults, run `pnpm gen`, and verify the generated plugin and setup patches contain `export.enabled: true` and `pnpm gen:check` passes.

## 2. Archive round trip

- [ ] 2.1 Add the pure-JavaScript ZIP dependency to the plugin (no install-time scripts) and implement unpack/repack helpers; verify a fixture archive round-trips with byte-identical entries and the failure path returns a typed error.
- [ ] 2.2 Implement reversible bank-id sanitization, the per-bank metadata (`export.json`), the repository index, and SHA-256 checksums; verify tests cover collisions, Windows-invalid characters, and metadata recovery of the original bank id.

## 3. Hindsight export client

- [ ] 3.1 Implement bank listing, async transfer export submission, operation polling, and archive download against the local REST API; verify tests against a fake HTTP server cover success, a bank-not-found response, an operation failure, and daemon-down isolation.
- [ ] 3.2 Implement the snapshot writer with a staging directory, verbatim archive entries, normalized content hash, and the single-writer lock; verify tests cover atomic replacement, an unchanged snapshot producing no commit input, and a stale lock taken over.

## 4. Git repository

- [ ] 4.1 Implement repository bootstrap (`git init` or `git clone`), the fixed commit identity, and commit-only-on-change; verify tests use a temporary repository and a bare remote and cover the first export, no-op cycles, and a clone when the directory is missing.
- [ ] 4.2 Implement automatic push without force, headless credentials (`GIT_TERMINAL_PROMPT=0`), and retry after an authentication or network failure; verify tests prove the local commit survives a failed push, no prompt is attempted, and a later cycle pushes.
- [ ] 4.3 Verify repository validation rejects a tracked export remote, credential, or machine path, and that the machine-local file is the only source for `dir` and `remote`.

## 5. Scheduler integration

- [ ] 5.1 Wire the interval, idle-session, and dispose triggers into `apply()` with fail-open behavior and no model-facing surface; verify plugin tests cover disabled export, a healthy cycle, a daemon-down cycle, and dispose without blocking.
- [ ] 5.2 Run the fake-server end-to-end test: export a bank, change its content, export again, assert one commit and one push; verify the disabled flag produces no Git or HTTP calls.

## 6. Restore script

- [ ] 6.1 Add `restore-hindsight.ps1` with `-From`, `-Repo`, `-Bank`, `-Mode restore|merge`, `-TargetBank`, `-DryRun`, `-IncludeHistory`, and `-SkipVerify`; verify a fixture tree rebuilds a valid archive and dry-run changes no bank.
- [ ] 6.2 Implement restore into an absent bank, merge into an existing bank, count verification against the manifest, and refusal to restore over an existing bank; verify tests cover each outcome and the mismatch exit code.
- [ ] 6.3 Implement the health check and provisioning handoff, the `hindsight-admin import-bank` offline fallback, and the remote clone path; verify a simulated missing local copy restores from a bare remote and a stopped daemon falls back to the admin import.

## 7. Documentation

- [ ] 7.1 Document the export layout, the default-on flag, the machine-local `dir`/`remote` file, the private-repository and privacy boundary, Git credential requirements, and the restore procedure in `docs/hindsight.md`; verify every documented command runs as written and the page contains no credential, remote URL, or machine path.
- [ ] 7.2 Add the export/restore operations to `docs/contributing.md` or the page that owns repository operations; verify the Markdown lint passes and `pnpm validate:repo` reports no new problem.

## 8. Integration verification

- [ ] 8.1 Run `pnpm gen`, `pnpm build`, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm validate:repo`; verify every command exits zero and the regenerated tree is committed.
- [ ] 8.2 Run the owner acceptance on a throwaway home and database (never the live profile): retain a marker, export, wipe the throwaway database, restore, and recall the marker; record the commands and the result in the change notes.

## Workflow follow-up

- The owner creates the private Git repository and records its URL only in the machine-local configuration before enabling auto-push on a live machine.
- Release through the normal set release (`pnpm release:prepare`, full gate, tag) after acceptance; the change is archived after the release and the owner acceptance are recorded.
