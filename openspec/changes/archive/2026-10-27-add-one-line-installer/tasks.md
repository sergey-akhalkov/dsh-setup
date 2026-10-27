# Tasks

## 1. Installer behavior

- [x] 1.1 Remove the `exit` statements from `install.ps1`: the success path ends normally and the failure path prints its message then throws. Verify a pipeline-form run in a throwaway Harness home reports the failure and leaves the calling session alive (the new `validate:installer` probe prints its sentinel), and `pwsh -File install.ps1 -DryRun` still exits 0.
- [x] 1.2 Restrict checkout auto-detection to `$PSScriptRoot`. Verify a pipeline-form run from inside a repository checkout plans the released git spec (`setup:   git+https://...`) instead of the checkout directory.
- [x] 1.3 Record the setup version resolved from the market index and let the existing post-install check compare it with the installed version. Verify with a deterministic market-resolution check that supplies a known resolved version: a version different from the installed one must fail naming both versions, a matching one must exit 0, and `pnpm validate:installer` still passes.
- [x] 1.4 Add the `validate:installer` session-safety probe: a generated wrapper runs `try { iex (Get-Content -Raw install.ps1) } catch { ... }`, prints a caught marker and a sentinel after the call, and exits non-zero itself; the step requires the non-zero exit, the `FAILED:` text, and both markers. Verify the step fails against the pre-fix script and passes after 1.1.
- [x] 1.5 Reject a bare `exit` statement in `install.ps1` from `validate:repo`. Verify `pnpm validate:repo` passes on the fixed script and fails when an `exit 1` line is added.

## 2. Documentation

- [x] 2.1 Document the one-line command as the primary install and update path in `README.md` and `docs/install.md`, keep the downloaded-file form as the options path, and make the Update section say rerun the command. Verify `pnpm lint` passes and the documented command matches the form the step from 1.4 exercises.
- [x] 2.2 Add the installer gotcha to `AGENTS.md`: the script also runs under `Invoke-Expression`, so it must not call `exit`. Verify `pnpm lint` passes.

## 3. Integration checks

- [x] 3.1 Run `pnpm lint`, `pnpm validate:repo`, and `pnpm validate:installer` (Windows); run `pnpm dogfood` when the live profile copy is available. Verify every command passes and the working tree contains no generated-file drift.

## Workflow follow-up

- Sync the `portable-setup` delta into `openspec/specs/portable-setup/spec.md` and archive `add-one-line-installer` after the review requirements are satisfied.
- Owner step, outside the change: run the documented one-liner from an external PowerShell window after a passing `pnpm dogfood`; it closes and restarts DeepSeek Harness.
