# Design

## Context

- `install.ps1` (623 lines) installs the setup bundle into a DSH profile. It is fetched from `main` and run through `irm | iex`, where no parameters can be passed, a bare `exit` would terminate the caller's shell, and `Set-StrictMode -Version Latest` is active.
- `setup-hindsight.ps1` (1,191 lines) is fully standalone. It duplicates the `Write-*` output helpers, recomputes `$DshHome` from the environment (which would overwrite the installer's parameter), and uses top-level `return` for `-SelfTest` and `-DryRun`. Its state lives under `%USERPROFILE%\.hindsight` and `%USERPROFILE%\.dsh\hindsight-export.json`; it never touches a DSH profile.
- `restore-hindsight.ps1` invokes its sibling `setup-hindsight.ps1 -SkipVerify` to raise an unhealthy daemon. `scripts/test/restore-hindsight.test.ts` writes a throwing fake sibling and expects the restore fallback.
- The archived `add-hindsight-memory` design D12 rejected folding the provisioning into `install.ps1`: it couples the profile installer to `uv`, a key prompt, and a network download, and makes an optional server failure look like a setup failure. This design supersedes that decision with a readiness gate, phase isolation, and a best-effort prerequisite policy.
- On the owner's machine the runtime is healthy, the key lives in `~/.hindsight/embed` (there is no `deepseek.key`), the tool is installed in the `uv` tool venv, and the `Hindsight embed daemon` logon task is not registered. A gate that required the key file or the logon task would wrongly re-provision this machine.

## Goals / Non-Goals

**Goals:**

- One documented command installs the profile and, when its prerequisites allow it, the local Hindsight runtime.
- A rerun on a configured, healthy machine updates plugins with no Hindsight prompt, write, or verification.
- The profile phase remains the run's contract: missing Hindsight prerequisites cannot fail it.
- The Hindsight-only path used by `restore-hindsight.ps1` and the old documented URL keeps working without duplicated provisioning code.

**Non-Goals:**

- Installing `uv` or any other system tool automatically.
- Changing Hindsight pins, defaults, the export prompt on a full phase run, the plugin row, or the setup bundle.
- A state marker file, environment-variable switches, per-component incremental skipping, or a Hindsight test override for `%USERPROFILE%`.
- Making `setup-hindsight.ps1` a copy of the merged code.

## Decisions

### D1. One file, two phases

`install.ps1` keeps its current profile phase and gains the Hindsight phase, in this order:

```
preflight -> plan (read-only) -> profile phase -> profile verification
          -> Hindsight phase -> summary -> finally: restart app once
```

The app is closed only for the profile phase today; in the merged script it stays closed through the Hindsight phase and is restarted once in `finally`. That gives the app's first start a configured memory runtime, keeps all prompts in one place, and reuses the existing restart path. Alternatives considered:

- Fetch `setup-hindsight.ps1` at run time: two downloads, nested `iex`, and version skew between the two files.
- Keep a copied Hindsight body in `install.ps1`: the drift this change removes.
- Make `setup-hindsight.ps1` canonical and have `install.ps1` delegate: the same two-file coupling with worse local-checkout behavior.

### D2. Prompts after the profile phase, never before

The preflight, the printed plan, and `-DryRun` are read-only and never prompt: they must not ask for the DeepSeek key or the export directory/remote. The first possible prompt is inside the Hindsight phase, after the profile phase installed the setup bundle and its verification passed. This is the owner's explicit ordering requirement; it also keeps a configured machine's plugin update prompt-free.

The phase keeps the existing internal order: resolve the key (prompt when interactive and no source exists), verify it, configure the export, then install/start/verify the runtime.

### D3. Readiness gate

Before the phase (and again when it starts) the installer evaluates a read-only gate. It skips the phase only when all of these hold:

- `~/.hindsight/embed` exists and its `HINDSIGHT_API_LLM_PROVIDER` is `deepseek`, `HINDSIGHT_API_LLM_MODEL` equals the desired model, `HINDSIGHT_API_HOST` is `127.0.0.1`, `HINDSIGHT_API_PORT` equals the desired port, `HINDSIGHT_EMBED_API_DATABASE_URL` is non-empty, and `HINDSIGHT_EMBED_API_VERSION` equals `$ApiVersion`.
- A key resolves without prompting from the parameter, `DEEPSEEK_API_KEY`, `~/.hindsight/deepseek.key`, or the profile.
- `hindsight-embed` is installed at `$ToolVersion` (the current `Get-EmbedCommand` with install disabled).
- `~/.hindsight/coding-agent.json` and `~/.hindsight/windows-certs.pem` exist.
- `/health` reports `status: healthy` and `database: connected`.

The logon task and `~/.dsh/hindsight-export.json` are deliberately not part of the gate: `-NoLogonTask` and a local-only export are user choices, the plugin autostart is the reboot fallback, and requiring them would re-provision a machine like the owner's. A missing task or export file is reported as optional, not as a reason to run.

A skip writes nothing, prompts nothing, verifies no key, and runs no retain/recall round-trip. The gate is recomputed when the phase starts so a change during the profile phase cannot produce a stale skip. Alternatives considered:

- A machine-local marker file: the facts already exist on disk; a marker can lie and needs its own validation.
- Requiring every component the provisioning writes: it would re-provision after a deliberate `-NoLogonTask` or when the export file was never configured.
- Per-component incremental skipping inside the phase: more code and more branches for the same outcome; the existing phase body is already idempotent.

### D4. Best-effort prerequisites versus phase failure

The phase has two outcomes besides success and "already configured":

- **Skip with a warning and exit 0** when it cannot attempt: `uv` is not on `PATH`, no key source exists and the session is not interactive (or the secure prompt is left empty), or `-NoHindsight` was passed. The warning names the cause and the next command; the plugins remain installed.
- **Exit non-zero** when it attempts and fails: a rejected or unreachable key verification, an invalid or non-empty export directory, a refused export push check, a failed tool install, a failed profile/cert/daemon/task operation, or a failed retain/recall. The message starts with the fact that the profile phase succeeded, and `finally` still restarts the app. There is no rollback of the profile or of partial Hindsight state (the standalone script had none either).

The boundary is the decision to attempt, not the first write: once the phase starts checking a key or installing the tool, a failure is a real error the user must see. `-NoHindsight` and the readiness skip are the only silent-by-design outcomes.

### D5. Options and modes

- `-NoHindsight`: profile phase only; the summary says the Hindsight phase was intentionally skipped.
- `-HindsightOnly`: Hindsight phase only. It does not resolve the setup release, read a DSH profile, call the DSH CLI, back up profile files, or stop/restart the app. `restore-hindsight.ps1` and the forwarder use it.
- `-RepairHindsight`: runs the phase even when the readiness gate passes (revoked key, deliberately removed logon task, manual repair).
- The existing Hindsight options keep their names: `-DeepSeekApiKey`, `-ExportDir`, `-ExportRemote`, `-ApiPort`, `-Model`, `-NoLogonTask`, `-SkipVerify`. Stability lets the forwarder splat them unchanged. `-SkipVerify` applies only to the Hindsight phase; the profile verification cannot be skipped.
- `-DryRun` plans both phases and changes nothing; `-SelfTest` runs the Hindsight component self-test and returns without touching the profile.
- Contradictory combinations fail before any effect: `-HindsightOnly -NoHindsight` and `-NoHindsight -RepairHindsight`.
- The documented one-liner cannot pass options, so the readiness gate, not a switch, is what makes repeated runs cheap.

### D6. Thin forwarder for `setup-hindsight.ps1`

Keep the file name and parameters, and make the body:

1. Prefer `$PSScriptRoot\install.ps1` when it exists (checkout, restore, tests).
2. Otherwise download the published `main/install.ps1` and invoke it as a scriptblock.
3. Always call it with `-HindsightOnly` plus the bound Hindsight parameters.

No provisioning logic, no `exit`, no output helpers. This preserves the old documented URL, keeps `restore-hindsight.ps1` and its test unchanged, and leaves one implementation. The download path has the same trust as the documented one-liner; the local sibling is preferred for a checkout. Alternatives:

- Delete the file: breaks the old URL and `restore-hindsight.ps1`'s sibling lookup (the test fixture also writes that file name).
- Keep a full copy: drift, the problem this change solves.

### D7. Merge mechanics

- Remove the Hindsight copies of `Write-Step`, `Write-Ok`, `Write-Skip`, and `Write-Warn`; keep the installer's definitions so output stays consistent.
- Remove the Hindsight `$DshHome = ...` assignment; the installer's resolved parameter is authoritative and already exported to `DSH_HOME`.
- Move the Hindsight main flow into `Invoke-HindsightSetup` so its `return` statements and locals (including the resolved key) stay in the function scope. The top-level script keeps the installer's `try`/`finally`, so the app restarts once.
- Keep `Set-StrictMode -Version Latest`; the Hindsight code now runs under it. The self-test and a dry run are the parity checks.
- The phase computes a status (`configured`, `installed`, `skipped`) for the plan and the summary. "Cannot attempt" returns `skipped`; "attempted and failed" throws.
- The profile backup remains profile-only. Hindsight state has no backup today; the phase is idempotent and preserves data, and the export config merge preserves unrelated keys.
- No `exit` is introduced; failures are thrown, which keeps the `irm | iex` caller alive.

### D8. Verification strategy

- `install.ps1 -SelfTest` grows table-driven gate cases: ready; logon task absent (skip); export config absent (skip); key missing (not ready); profile provider/model/port/API-version mismatch (not ready); tool version mismatch (not ready); coding-agent or TLS bundle missing (not ready); health not healthy (not ready); `-RepairHindsight` forces the phase. The gate decision is a pure function over gathered facts, so it needs no daemon or key.
- `scripts/validate-installer.ts` passes `-NoHindsight` on the market-resolution runs and the main/second install runs, and the downloaded dry-run still asserts that the plan prints a `hindsight:` line without a prompt or `uv` requirement. A new cheap step runs `install.ps1 -HindsightOnly -DryRun -DshHome <temp>` with no profile and asserts exit 0 and a Hindsight plan, proving the mode is independent of the DSH profile and CLI.
- `scripts/dogfood.ts` passes `-NoHindsight`; dogfood must never touch the live `%USERPROFILE%\.hindsight`.
- `scripts/test/restore-hindsight.test.ts` stays unchanged because the sibling file name and `-SkipVerify` forwarding stay.
- Owner acceptance: a real rerun on this machine reports Hindsight as already configured and updates only the profile; `-RepairHindsight` on request. The fresh-PC acceptance remains manual because the runtime is under `%USERPROFILE%`, not the throwaway `DSH_HOME`; the archived clean-PC task is still unchecked and is not claimed as covered.
- CI never provisions Hindsight: it has no key and must not start a daemon.

### D9. Documentation and the superseded decision

Update `README.md`, `docs/install.md` (prerequisites, options, flow, the Hindsight section, "what is not included"), `docs/hindsight.md` (documented one-liner, options, the forwarder, the pin location, restore wording), and `docs/contributing.md` (the self-test command and the export paragraph). The new `design.md` records that this change supersedes the archived D12; the archive itself is not edited.

## Risks / Trade-offs

- **Longer app downtime on a first install or repair** → the plan names the phase and the app restarts once at the end; a configured rerun skips the phase and adds no time.
- **A plugin update can now prompt for a key or an export location** → only when the phase runs (not configured, unhealthy, or forced) and only after the profile is installed and verified; a ready machine prompts nothing.
- **A plugin update can exit non-zero after the plugins installed** → the message states that the profile phase succeeded, names the cause, and the app still restarts; the user asked for "real errors" to be visible.
- **Gate false negative** (profile or tool changed while the runtime is fine) → the phase runs and is idempotent; the cost is prompts and time, not damage.
- **Gate false positive** (a revoked key still stored in the profile) → the skip path never verifies the key; `-RepairHindsight` is the documented escape hatch and the risk is stated in the docs.
- **`uv tool list` fails in a restricted shell or with a broken cache** → the gate reports not ready and the phase fails at tool resolution; the message names `uv`, and the profile remains installed. The owner's normal external PowerShell is the supported environment.
- **`Set-StrictMode -Version Latest` exposes latent Hindsight assumptions** → the self-test and a dry run are run before the default phase is enabled.
- **The installer becomes a ~1,400-line file** → the merge is a move first (behind `-HindsightOnly`) and a behavior change second, so review sees a mechanical diff before the new branches.
- **The Hindsight pins now live in `install.ps1` and go live on `main` before a release** → the docs name the file; the release check still validates the installer, and a pin bump needs the same owner acceptance as before.
- **The forwarder downloads the installer when no local sibling exists** → the old URL and a restore fallback need the network; a checkout and the shipped pair use the sibling, and a failed download leaves the restore fallback in place.

## Migration Plan

1. Move the Hindsight code into `install.ps1` and expose `-HindsightOnly` without wiring the default phase; convert `setup-hindsight.ps1` to the forwarder; verify parity with the existing self-test and a dry run.
2. Add the readiness gate and its self-test cases.
3. Wire the default phase after profile verification, with the prompt ordering, the prerequisite/failure policy, the summary, and the new options.
4. Update validation, dogfood, and documentation.
5. Run the repository checks and the owner rerun (skip) and forced repair acceptance; publish.

Rollback: rerun the previous release's `install.ps1` (it never touched Hindsight), use the forwarder's Hindsight-only mode, or disable the Hindsight row and stop the daemon. There is no data migration; the runtime state is read, not moved.

## Open Questions

None. The export prompt on a full phase run keeps its current behavior; suppressing it on a rerun is a possible follow-up, not part of this change.
