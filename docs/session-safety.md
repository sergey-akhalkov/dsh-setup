# Session data safety

Everything DSH keeps under the Harness home is outside git and has no built-in backup. A recursive
delete of that home destroys every session on the machine, and the next launch silently starts from
an empty home: the GUI is not broken, the files are gone. Two incidents did exactly that
(2026-10-29 and 2026-11-25); in the second, no Volume Shadow Copy survived to restore from.

This page owns the protocol. `AGENTS.md` and `docs/contributing.md` carry the short rule and link
here, and the machine-global `$DSH_HOME/AGENTS.md` repeats the essentials for every session on a
machine that runs experiments against live data.

## What is irreplaceable

| Path                                                                | What a loss means                             |
| ------------------------------------------------------------------- | --------------------------------------------- |
| `$DSH_HOME/sessions/<workspace>/session-<id>/session.v4.jsonl.zstd` | The only copy of that conversation            |
| `$DSH_HOME/storages/session_projcache/`                             | Session list metadata, titles, projections    |
| `$DSH_HOME/storages/workspace.json`                                 | Workspace-to-session mapping the GUI lists    |
| `$DSH_HOME/profiles/<name>/`                                        | Bundles, rows, patches, credentials           |
| `$DSH_HOME/AGENTS.md`                                               | User-global agent instructions                |
| `~/.pg0`, `~/.hindsight`                                            | Hindsight database, key, certs, export config |

`$DSH_HOME` is `%DSH_HOME%` when set, else `~/.dsh`.

## Hard rules

1. **Never delete a Harness home.** Rename instead: `<path>.bak-<yyyyMMdd-HHmmss>`. Deleting is the
   only operation that cannot be undone; a rename keeps the data and still gives a clean state.
2. **Never run a recursive delete outside the workspace or a throwaway root.** That includes
   `Remove-Item -Recurse`, `rd /s`, `rm -rf`, `git clean -fdx`, and `robocopy /MIR`. The workspace root
   and the throwaway root are the only places a recursive delete may resolve to.
3. **A clean-state test uses a throwaway home.** Set `DSH_HOME` (or `install.ps1 -DshHome`) under
   `%TEMP%` or `<repo>\.tmp`, and assert it. `pnpm dogfood` and `pnpm validate:installer` already copy
   the real profile into a temporary home; new scripts do the same.
4. **Do not exercise the real home.** To test against the owner's profile, copy it first and run the
   check against the copy. The `desktop` profile is Electron-owned; a hosted-shell install or reload
   kills the session that runs it.
5. **Live data needs the owner's explicit confirmation in the same turn, plus a completed backup or
   Hindsight export first.** An owner's "go" for an unrelated task is not confirmation.
6. **Agents never run elevated destructive commands** (`Start-Process -Verb RunAs`, UAC-approved
   scripts). If a destructive operation needs elevation, stop and hand the exact command to the owner.
7. **The deleting command's own log dies with the home.** Prefer logging the command to a scratch path
   outside the home, and name the command that ran in the final reply.

## Before any delete

Check before you run it; the check is three lines and prevents the whole class of incidents.

```powershell
$target = [System.IO.Path]::GetFullPath($path)
$root = [System.IO.Path]::GetFullPath((Join-Path $env:TEMP 'dsh-scratch'))   # or <repo>\.tmp
if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
  throw "refusing to delete $target; it is not under $root"
}
Remove-Item -LiteralPath $target -Recurse -Force
```

- No wildcards, globs, or `$env:...` interpolation inside a delete path; `-LiteralPath` only.
- Print the resolved target and the current directory in the tool output before running it.
- Prefer a rename, and confirm the replacement works before the old copy is removed.
- A directory whose creation time is "now" while its siblings are months old is a reset, not a fix.

## Backup and restore

Back up before any experiment that can touch live data:

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $env:DSH_BACKUP_ROOT $stamp   # a different volume than %USERPROFILE%
robocopy "$env:USERPROFILE\.dsh\sessions" (Join-Path $backup 'sessions') /E /COPY:DAT /DCOPY:T /R:1 /W:1
robocopy "$env:USERPROFILE\.dsh\storages" (Join-Path $backup 'storages') /E /COPY:DAT /DCOPY:T /R:1 /W:1
robocopy "$env:USERPROFILE\.dsh\profiles" (Join-Path $backup 'profiles') /E /COPY:DAT /DCOPY:T /R:1 /W:1
```

- Keep `AGENTS.md`, `.credentials.yaml`, and `.dsh-setup-backups/` in the same backup when the
  profile matters.
- A backup is complete only when the session-directory count and the `session_projcache` file count
  match the source (a robocopy exit code below 8 is success; keep the log).
- Restore only while the app is closed: copy missing session directories and cache files back, never
  overwrite an id that already exists, then reopen the app. A merge is safe because ids do not
  collide.

## If a home is lost anyway

1. Stop writing to that volume (close DSH, no builds, no installs): recovery odds drop with every
   write.
2. Check "Previous Versions" for the home or profile directory and `vssadmin list shadows` from an
   elevated shell. Client-requested snapshots are often deleted after use (none survived on
   2026-11-25), so this is a narrow window.
3. Check copies under `<repo>\.tmp`, `dogfood` and `validate-installer` homes, the Hindsight database
   (memory, not transcripts), and any session exports.
4. The Electron GUI profile keeps a list of recently seen session ids; it restores nothing, but it
   tells you what existed.
5. Record the incident with its date and command in this page, and fix the route that caused it.

## Ownership

This page and the machine-global `AGENTS.md` are the two homes of this protocol: the page for the
repository and review, the home file for every session on a machine that runs live experiments. A
change that adds a recursive delete, a `DSH_HOME` reset, or a `-DshHome` default references this page
in its review.
