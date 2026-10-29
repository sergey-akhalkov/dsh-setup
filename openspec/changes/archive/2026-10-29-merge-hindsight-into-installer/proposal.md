# Proposal

## Why

Installing a Windows machine takes two commands today: `install.ps1` sets up the DSH profile, and the separate `setup-hindsight.ps1` provisions the local Hindsight daemon. The owner wants one documented command that installs everything, and a rerun that only updates the plugins without redoing a healthy Hindsight install. The two standalone files also duplicate their output helpers and pins, so they drift.

The owner chose a best-effort second phase: the profile install remains the contract, and Hindsight provisioning must not turn a routine plugin update into a failed install.

## What Changes

- Fold the `setup-hindsight.ps1` functions into `install.ps1` as a second phase that runs only after the profile phase is installed and verified. The documented `irm .../install.ps1 | iex` becomes the single command for both.
- Add a readiness gate before the phase. It skips the phase when the default Hindsight profile matches the pinned provider, model, endpoint, database, and API version; a key is resolvable without a prompt; `hindsight-embed` is at the pinned tool version; the coding-agent configuration and TLS bundle exist; and `/health` reports a healthy connected database. A skip writes nothing, prompts nothing, verifies no key, and runs no retain/recall check.
- Otherwise run the existing idempotent provisioning unchanged: install or update the pinned tool, write the profile and ACLs, export the TLS trust bundle, start the daemon, register the logon task, write the coding-agent configuration when absent, and verify a retain/recall round-trip.
- Ask for the DeepSeek key and the export directory/remote only in this second phase, after the profile install/update and its verification, never in the preflight, the plan, or the profile phase. A configured machine updates plugins with no prompts at all.
- Best-effort prerequisites: when `uv`, an available key, or an interactive prompt is missing, warn and skip the phase, leave the plugins installed, exit successfully, and print the next action. A failure after provisioning has started exits non-zero and states that the profile was installed.
- Add `-NoHindsight` (profile phase only), `-HindsightOnly` (Hindsight phase only, used by `restore-hindsight.ps1`), and `-RepairHindsight` (force the phase past the readiness gate). Keep the existing Hindsight option names; `-SkipVerify` applies to the Hindsight phase only.
- Turn `setup-hindsight.ps1` into a thin forwarder to `install.ps1 -HindsightOnly`: the local sibling installer when present, otherwise the published `install.ps1`. The old documented URL and `restore-hindsight.ps1` keep working without duplicated logic.
- Update the installer exercise and dogfood to pass `-NoHindsight`, keep the printed plan free of prompts and `uv` calls, and cover the readiness gate with `-SelfTest` cases, including that a missing logon task or export configuration does not trigger provisioning.
- Update the installation, Hindsight, and contributing guides and the README with the new behavior and options.
- Amend the specifications: the one-command installer now includes the optional local runtime phase, and the one-click bootstrap becomes the Hindsight-only entry point of that installer.

**BREAKING**: none. The setup bundle, plugin behavior, profile contract, and existing options are unchanged. The documented one-liner now also provisions the optional local Hindsight runtime when its prerequisites are available; otherwise it warns, skips the phase, and succeeds.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `portable-setup`: the one-command installation also runs the optional local Hindsight phase, skips it when already configured, isolates its failures, and adds the `-NoHindsight`, `-HindsightOnly`, and `-RepairHindsight` options.
- `hindsight-memory`: the documented one-click bootstrap moves into the installer's Hindsight phase; a thin `setup-hindsight.ps1` entry point remains for the Hindsight-only path and `restore-hindsight.ps1`.

## Impact

- `install.ps1`: the Hindsight helper functions and main flow move in; the plan and summary report the phase; new options; `-SelfTest` gate cases; still no bare `exit` and still safe under `Invoke-Expression`.
- `setup-hindsight.ps1`: reduced to a forwarder that keeps the existing Hindsight parameters.
- `restore-hindsight.ps1`: unchanged while the forwarder is present.
- `scripts/validate-installer.ts` and `scripts/dogfood.ts`: pass `-NoHindsight`, so CI and dogfood never touch a machine-level Hindsight home.
- Documentation: `README.md`, `docs/install.md`, `docs/hindsight.md`, `docs/contributing.md`.
- No `dsh.json`, plugin package, dependency, generated file, or supported-DSH change.
- Owner acceptance on this machine: a rerun skips Hindsight and only updates plugins, and `-RepairHindsight` runs the full phase. Fresh-PC acceptance stays manual because the runtime lives under `%USERPROFILE%`, not the throwaway DSH home.

This supersedes the archived `add-hindsight-memory` decision D12, which rejected folding the server provisioning into `install.ps1`. The coupling is accepted now because the owner wants one command, and it is bounded by the readiness gate, the phase isolation, and the best-effort prerequisite policy.
