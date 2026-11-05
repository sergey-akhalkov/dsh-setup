# Design

## Context

See `proposal.md` and the `portable-setup` delta. What shapes the approach:

- `dsh.json` already records `enginesDsh` (`>=0.2.1-rc.3 <0.3.0`), and every published package copies
  it byte-for-byte into `engines.dsh`; DSH refuses an out-of-range package install.
- The installer is downloaded and run on its own (`irm … | iex`), so it cannot read the repository's
  `dsh.json` at run time; it must embed the range, and repository validation must keep the embedded
  copy equal to `enginesDsh`.
- The installer is documented in both Windows PowerShell 5.1 and PowerShell 7 forms. Windows
  PowerShell 5.1 has no `System.Management.Automation.SemanticVersion` and no SemVer comparison, so
  the range check cannot rely on it.
- The CI matrix is produced in each workflow's `versions` job from the JSON list; the release workflow
  must keep blocking publication until the same checks pass.

## Goals / Non-Goals

**Goals**

- One compatibility contract: the `enginesDsh` range.
- Any in-range DSH version installs without a repository edit, including prereleases newer than any
  version the repository has seen.
- A newly published in-range DSH is exercised before the next release without a version-list edit.

**Non-Goals**

- Automatically fixing upstream incompatibilities. A new in-range DSH may still break a plugin; the
  range check admits it and CI must catch the break.
- Changing `enginesDsh` itself or the pinned client devDependencies.
- Testing literally every published version; the floor and the newest matching version are the
  meaningful boundaries.

## Decisions

### D1 — `enginesDsh` is the only allowlist

`dsh.json` keeps `runtime` (the local tooling default) and `enginesDsh`; `supportedVersions` is
removed and `DshVersions` no longer declares it. The installer refuses only outside the range.
Alternative rejected: keeping `supportedVersions` as a "tested" list and deriving the gate from it —
it is the same manual list under another name, and the second copy is what went stale.

### D2 — The installer embeds the range and compares SemVer itself

`install.ps1` replaces `$SupportedDshVersions` with `$DshEngineRange = '>=0.2.1-rc.3 <0.3.0'`
(`validate:repo` requires byte equality with `dsh.json.enginesDsh`). A small PowerShell 5.1-compatible
comparator parses dotted numeric cores and SemVer prerelease identifiers (numeric identifiers compare
numerically and below alphanumeric ones; a release outranks its prereleases) and evaluates the
`>=`/`>`/`<=`/`<`/`=` clauses the range can contain. The refusal names the range and the fix.
Alternatives rejected: a per-version list (the problem), and `[System.Management.Automation.SemanticVersion]`
(absent on Windows PowerShell 5.1, which the documented pipeline form supports).

### D3 — CI resolves the matrix at run time

`scripts/ci-versions.ts` prints a JSON matrix: the range floor (`semver.minVersion`), `runtime`, and
the newest published `@deepseek-ai/dsh` version satisfying the range (`npm view … versions --json`
filtered with `semver.satisfies`), deduped and version-sorted. If the registry cannot be read, it
falls back to floor + runtime and prints a warning; the job keeps the log line. Both workflows call
it from their `versions` job instead of `node -p` over `supportedVersions`. Trade-off: a CI run now
depends on the npm registry; the fallback keeps releases validating when it is briefly unreachable,
and the fallback is visible rather than silent.

### D4 — Validation replaces the removed list checks

`validate:repo` checks that `install.ps1`'s `$DshEngineRange` equals `dsh.json.enginesDsh` (the old
exact-array comparison is deleted), and `validate:installer` gains a stub-CLI version gate: an
in-range prerelease that was never listed (`0.2.2-rc.1`) proceeds, below the floor (`0.2.1-rc.2`) and
at the ceiling (`0.3.0`) are refused with the range in the message, and the existing in-range
round-trip still passes.

## Risks / Trade-offs

- **New in-range DSH breaks behavior** → the newest-version CI matrix entry exercises it before a
  release; the installer still admits it, which is the requested behavior rather than a list edit.
- **Registry unavailable during CI** → floor + runtime still run; the script prints the fallback, so
  the reduced coverage is visible in the job log.
- **Hand-written SemVer comparator** → covered by `validate:installer` version-gate steps straddling
  the floor, an in-range prerelease, and the ceiling; prerelease ordering is the failure mode to test.
- **External consumers of `supportedVersions`** → grepped the repository; only repo-owned readers
  used it, and this change updates all of them.
