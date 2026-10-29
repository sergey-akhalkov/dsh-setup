# Tasks

> Owner decision (2026-10-29): the owner deferred the live one-liner (5.2), the live repair (5.3), and the clean-VM acceptance (5.4) to post-release testing. Release 0.14.0 proceeds without them at the owner's request; the deferred checks remain unchecked and are not claimed as passed.

## 1. Merge the Hindsight implementation into install.ps1

- [x] 1.1 Move the Hindsight helper functions, the main flow wrapped in `Invoke-HindsightSetup`, and the Hindsight self-test from `setup-hindsight.ps1` into `install.ps1`; drop the duplicate `Write-*` helpers and the `$DshHome` recomputation, add the Hindsight parameter subset plus `-HindsightOnly`, and make that mode return before the profile phase. Verify `pwsh -NoProfile -File install.ps1 -SelfTest` passes the moved fixtures, `pwsh -NoProfile -File install.ps1 -HindsightOnly -DryRun` prints the Hindsight plan and changes nothing, and `pnpm validate:repo` passes.
- [x] 1.2 Replace the body of `setup-hindsight.ps1` with the thin forwarder: the same Hindsight parameters, a local sibling `install.ps1` first, otherwise the published `main/install.ps1`, both invoked with `-HindsightOnly` and the bound parameters, with no `exit` and no provisioning helpers. Verify `pwsh -NoProfile -File setup-hindsight.ps1 -DryRun` prints the same plan as `install.ps1 -HindsightOnly -DryRun`, and `pnpm exec vitest run scripts/test/restore-hindsight.test.ts` passes unchanged.
- [x] 1.3 Update `docs/contributing.md` for the moved self-test command (`install.ps1 -SelfTest`) and the `setup-hindsight.ps1` forwarder in the memory-export paragraph. Verify `pnpm lint` passes and the documented command runs as written.

## 2. Readiness gate

- [x] 2.1 Add the readiness decision over gathered facts: the default profile values and API version, a key resolvable without prompting, the pinned tool, the coding-agent and TLS files, and `/health`; a missing logon task or export configuration must not make it unready. Verify `install.ps1 -SelfTest` covers ready, optional task/export absent, missing key, profile mismatch, tool mismatch, missing files, and unhealthy daemon.
- [x] 2.2 Add `-RepairHindsight` and reject `-HindsightOnly -NoHindsight` and `-NoHindsight -RepairHindsight` before any effect. Verify each invalid pair exits with a clear message and changes nothing, and `install.ps1 -SelfTest` still passes.
- [x] 2.3 Make the plan's Hindsight preview non-prompting and non-throwing: `install.ps1 -DryRun` and `install.ps1 -HindsightOnly -DryRun` print a `hindsight:` line, ask nothing, and change nothing when `uv` or a key is absent. Verify with a `PATH` without `uv` and with the normal `PATH`.

## 3. Default phase, failure policy, and user documentation

- [x] 3.1 Wire the Hindsight phase after the profile verification: reuse the readiness gate, run `Invoke-HindsightSetup`, print the phase status in the summary, keep every key/export prompt after the profile phase, and keep the single app restart in `finally`. Verify `install.ps1 -NoHindsight -DryRun` reports the phase disabled, `install.ps1 -HindsightOnly -DryRun` reports only Hindsight, and the default `-DryRun` reports both phases in order.
- [x] 3.2 Implement the prerequisite skip and the attempted-failure path: missing `uv`, no key source, or a non-interactive no-key session warns, skips the phase, and exits 0; a failure once the phase attempts (rejected key, invalid export location, foreign listener, daemon or retain/recall failure) exits non-zero, states that the profile phase succeeded in the default mode, and still restarts the app. Verify with a `PATH` without `uv` (warning, exit 0) and `install.ps1 -HindsightOnly -RepairHindsight -DeepSeekApiKey deliberately-invalid` (non-zero, no runtime change).
- [x] 3.3 Update `docs/install.md` and `README.md` for the merged command, the ordering, the options table, and the Hindsight section. Verify every documented option exists in `install.ps1`, the documented command runs as written, and `pnpm lint` passes.
- [x] 3.4 Update `docs/hindsight.md` for the documented one-liner, the forwarder, the options, the prompt/skip/failure behavior, the pin location in `install.ps1`, and the restore wording. Verify the documented commands match the script and `pnpm lint` passes.

## 4. Installer validation and dogfood

- [x] 4.1 Add `-NoHindsight` to the market-resolution and main/second install invocations in `scripts/validate-installer.ts`; keep the downloaded dry-run without it and assert the plan contains the Hindsight line; add a step that runs `install.ps1 -HindsightOnly -DryRun -DshHome <temporary home>` with no profile and asserts exit 0 and a Hindsight plan. Verify `pnpm validate:installer` passes.
- [x] 4.2 Add `-NoHindsight` to `scripts/dogfood.ts`. Verify `pnpm dogfood` passes and the live Hindsight state is untouched: no prompt, no daemon or task change, and the existing `/health` answer is unchanged.

## 5. Integration and owner acceptance

- [x] 5.1 Run `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, `pnpm validate:installer`, and `pnpm dogfood`; verify they pass and `git diff --exit-code` is clean after `pnpm build`.
- [ ] 5.2 From an external PowerShell with DeepSeek Harness closed, run the documented one-liner on this machine and verify the profile updates, Hindsight reports already configured, no key or export prompt appears, and `~/.hindsight` plus the scheduled task are unchanged. Record the result.
- [ ] 5.3 From an external PowerShell, run `install.ps1 -HindsightOnly -RepairHindsight` with the existing key and export configuration and verify the daemon is healthy, the retain/recall check passes, and existing data is preserved. Record the result.
- [ ] 5.4 Fresh-PC acceptance on a clean Windows VM with `uv` and a DeepSeek key, starting with no Hindsight tool, profile, TLS bundle, or logon task: run the documented one-liner and verify the profile phase completes, the Hindsight phase provisions the pinned runtime, the logon task exists, and retain/recall passes; rerun and verify the readiness skip. Record the result; do not use the live machine.

## Workflow follow-up

- Sync the `portable-setup` and `hindsight-memory` deltas into the main specs after apply.
- Run `pnpm reviews:check --change merge-hindsight-into-installer` and obtain the task-review PASS records before archiving.
- Archive the change and verify the archived spec paths.
