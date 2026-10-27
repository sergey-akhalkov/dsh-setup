# Proposal

## Why

The repository already promises a one-command installer, and `install.ps1` itself advertises the
short form `irm <url> | iex`. That form does not work: the script calls `exit 0` on success and
`exit 1` on failure, and under `Invoke-Expression` an `exit` statement terminates the whole
PowerShell process, closing the user's window on both outcomes. The documented path therefore
downloads the script to a temporary file first, and updating is described as installing a newer
entry or passing a version instead of rerunning the same command. Comparable agent CLIs install and
update with one pipeline and no options; this change makes the documented installer behave the same
way.

## What Changes

- Make `install.ps1` safe under `Invoke-Expression`: no `exit` statements. A successful run ends
  normally; a failed run raises a terminating error, so `pwsh -File` still reports a non-zero exit
  code while the caller's session stays alive. The existing `finally` block still restarts the
  application.
- Restrict checkout auto-detection to script-file execution: when `$PSScriptRoot` is empty (the
  one-line form), the installer resolves the released setup instead of whatever directory the caller
  happens to be in.
- Record the setup version resolved from the market index, so the existing post-install verification
  fails when the installed version is not the resolved one. Rerunning the command then proves the
  update landed instead of only reporting the installed version.
- Document `irm <install.ps1-url> | iex` in `README.md` and `docs/install.md` as the primary install
  **and** update command. Keep the download-to-file form as the options path, because pipeline
  execution cannot pass `-DryRun`, `-Profile`, `-SetupVersion`, or `-SetupSpec`.
- Document update as rerunning the same command; remove the advice to pass `-SetupVersion` for an
  update.
- Exercise the one-line form in `validate:installer` (a `try { iex ... } catch {}` probe in a
  throwaway Harness home must leave the session alive and report failure), and reject a bare `exit`
  in `install.ps1` from `validate:repo`.

Unchanged: `dsh.json`, the shipped and registry bundle lists, setup bundle contents, market index
format, release artifacts, and supported DSH versions. No generated file changes and no release is
required to ship the installer fix, because the documented command fetches `install.ps1` from
`main`.

## Capabilities

### New Capabilities

None: no new capability is introduced.

### Modified Capabilities

- `portable-setup`: the one-command installation requirement gains the single-pipeline delivery
  contract (executing the documented command must not terminate the caller's session) and an
  update-by-rerun contract with post-install version verification.

## Impact

- `install.ps1`: exit handling, checkout detection, and the resolved-version verification.
- `docs/install.md`: the one-command and update sections.
- `README.md`: the install line.
- `scripts/validate-installer.ts`: a one-line-form probe.
- `scripts/validate-repo.ts`: the no-`exit` rule for the installer.
- `AGENTS.md`: one gotcha line so a future edit does not reintroduce `exit`.
- No package, dependency, composition, generated file, or version change.
