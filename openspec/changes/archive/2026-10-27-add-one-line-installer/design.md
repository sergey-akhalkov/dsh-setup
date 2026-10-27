# Design

## Context

See `proposal.md` - Why. Two facts from the current code drive every decision below:

- `install.ps1` ends its success path with `exit 0` and its failure path with `exit 1`. Under
  `Invoke-Expression` an `exit` statement terminates the whole PowerShell process. Verified on
  PowerShell 5.1 and 7: a probe that `iex`-ed the script against a throwaway Harness home printed the
  failure line and then ended the process, never reaching the statement after the `iex` call.
- `$PSScriptRoot` is empty under `Invoke-Expression`; the current fallback is `Get-Location`, so the
  checkout-detection branch would treat the caller's directory as a source.

The rest of the installer is already correct for this use: it resolves the newest release, is
idempotent, backs up the profile, and restarts the application in `finally`.

## Goals / Non-Goals

Goals:

- The documented one-line command installs and updates the setup and returns to a live window.
- `pwsh -File` keeps its exit-code contract, so `validate:installer` and any automation keep working.
- A rerun that did not update the installed version fails instead of passing.

Non-goals:

- Options for the pipeline form. `iex` cannot bind parameters; env-var configuration is deliberately
  not added, so the downloaded-file form stays the options path.
- An explicit "updated X -> Y" banner. The final version line already reports the installed version.
- A shorter URL or a Pages-hosted copy of the installer. The Pages artifact is constrained to the
  market document and icons.
- Installing DeepSeek Harness itself. The command installs the setup into an existing installation.

## Decisions

### D1. Document the pipeline form as primary, keep the file form for options

The primary command becomes `irm <install.ps1-url> | iex`; the current
download-to-temporary-file snippet moves beside the option table.

Alternatives considered:

- Keep the temporary-file snippet as primary (today's docs). Rejected: it is the three lines the
  request is about, and it buys no safety - the file form is blocked by a `Restricted` execution
  policy while the pipeline form is not, because downloaded text is not a script file.
- Add a `-Download` switch to the installer. Rejected: unreachable from the pipeline form.

### D2. Signal failure with a terminating error instead of `exit`

The success path simply ends (a script that ends normally reports success); the failure path replaces
`exit 1` with a bare `throw` after printing the friendly message.

Why: `throw` keeps the interactive session alive, still makes `pwsh -File` exit non-zero (verified),
and runs the existing `finally` that restarts the application. Setting `$global:LASTEXITCODE` instead
was rejected because `pwsh -File` still exits 0 (verified).

Trade-off: the file form now prints the PowerShell error record after the `FAILED:` line. The friendly
line stays first; the extra record appears only on failure.

### D3. Checkout detection requires `$PSScriptRoot`

The local-checkout branch runs only when the script executes as a file beside a checkout. Under
`Invoke-Expression` the documented command always installs the resolved release.

Alternative considered: an explicit `-Local` flag. Rejected: the file form already has the
convenience, and the pipeline form must not guess.

### D4. Verify the resolved version, not just the installed one

When the market index resolves the release, its version is recorded and the existing post-install
check compares it with the installed package version. This is the only new verification: an update
that silently kept the old package now fails the run.

Alternative considered: keep the existing version line and let the user compare. Rejected: rerunning
is now the documented update path, so "success on a stale version" is exactly the failure this change
must exclude.

### D5. Prove both new paths deterministically, guard the statically checkable part

`validate:installer` gains two steps.

**Session safety.** A generated `pwsh -File` wrapper sets a throwaway `DSH_HOME` and runs
`try { iex (Get-Content -Raw install.ps1) } catch { ... }`. The catch prints a caught marker, then a
sentinel, and the wrapper itself ends with a non-zero exit; a run that never threw is marked and also
fails the step. The assertions are a non-zero exit, the `FAILED:` text, and both markers: swallowing
the error inside the wrapper would leave it exiting 0, so the wrapper's own non-zero exit and the
markers are what the step checks. The step fails against the pre-fix script, whose `exit` statement
ends the process before either marker is printed.

**Version verification.** The existing runs cannot cover it: the install run passes `-SetupSpec`,
which returns from resolution before the market index is read, and the downloaded-copy run passes
`-DryRun`, which exits before verification. The new step supplies both sides of the comparison: a
loopback HTTP server serves an index with a chosen version over a fake 40-hex commit, and a stub `dsh`
passed as `-DshCli` emulates the version query and the plugin install, writing a chosen installed
version. One run resolves a version that differs from the installed one and must fail naming both; a
second resolves the installed version and must succeed. The stub is confined to this step; the
existing run keeps exercising the real CLI end to end.

`validate:repo` rejects a bare `exit` statement in `install.ps1`, which covers the success path and
any later re-introduction.

Alternative considered for both steps: an end-to-end pipeline install against the published release.
Rejected: `iex` cannot pass the profile and spec options, it needs network and a published release on
every run, and the file form already exercises installation. Alternative considered for the version
step: a real install against a published commit behind a fake index. Rejected for the same cost
reason; the branch under test is the comparison, not the package manager.

### D6. No release is required to ship the fix

The documented command fetches `install.ps1` from `main`, while the setup bundle stays pinned to the
newest tag. The installer fix therefore reaches users on their next run without a version bump,
regenerated files, or a new market entry.

## Risks / Trade-offs

- [The pipeline form executes a mutable `main` without a hash pin] -> The resolved setup payload stays
  commit-pinned, and the docs version of the command is the same trust model comparable CLIs use; no
  new risk beyond the already-documented installer URL.
- [A future edit reintroduces `exit`] -> `validate:repo` rejects it and `validate:installer` fails the
  probe.
- [The pipeline form cannot pass options] -> It is documented for the default install and update; the
  downloaded-file form is documented for options.
- [The market index is currently unpublished (HTTP 404), so first runs print fallback warnings] ->
  Resolution falls back to release tags and works; publishing the index is an existing owner
  follow-up, not part of this change.
- [`throw` aborts the rest of the caller's command line] -> Under `Invoke-Expression` the pipeline is
  the whole command line; nothing follows it. Documented behavior is a failed run ending the run.
- [The stub CLI used by the version step drifts from the real plugin manager] -> It only emulates the
  two operations the verification branch reads, the assertions compare the two supplied versions, and
  the existing real-CLI install run stays in the suite.

## Migration Plan

Not applicable: no stored state, profile format, or published artifact changes. The fix ships with the
next push to `main`; reverting the commit restores the previous installer behavior.

## Open Questions

None blocking. An "updated X -> Y" line remains optional polish and can be added later without
changing this design.
