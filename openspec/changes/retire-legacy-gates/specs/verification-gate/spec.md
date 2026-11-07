# Spec Delta

## REMOVED Requirements

### Requirement: Verification gate boundary

**Reason**: The row is retired; the behavior moves to the `verify` workflow definition, which observes the same tool results and turn-stopping event without adding a second gate.

**Migration**: Enable the `verify` definition with the same command list, disable the verification-gate row, and keep the row installed for one release as rollback.

### Requirement: Code-changing turn detection

**Reason**: The workflow `verify` definition uses the same write-observation rule as its trigger condition; the legacy plugin no longer owns the detection.

**Migration**: The `verify` definition starts on a successful `edit`/`write` outside the excluded paths and non-`.md` targets; disable the row after parity.

### Requirement: Command recognition

**Reason**: The workflow `check` evidence uses the same exact-command and single `rtk` normalization rule; the legacy gate is redundant.

**Migration**: Copy the profile's commands into the `verify` definition's validated settings. The settings are outside the parity-bound template hash and the settings matrix covers command variations, so a profile with different commands loads from the shipped report and disables the row after parity.

### Requirement: Successful check requirement

**Reason**: The workflow `check` evidence requires the same foreground zero-exit result after the last write; the legacy gate no longer needs to enforce it.

**Migration**: Run the `verify` definition in shadow against a code-changing turn, compare the allow/refuse decision with the legacy gate, then disable the row.

### Requirement: Refusal message and block cap

**Reason**: The workflow turn-close gate owns the bounded steer and the `maxBlocks` cap; a second cap in the legacy gate would double-refuse.

**Migration**: Set the `verify` definition's `maxBlocks` to the legacy value, including a legacy value above 128, run the parity suite, and disable the row.

### Requirement: Configuration

**Reason**: The commands and the block cap move into the `verify` definition's validated settings; the legacy row configuration is retired.

**Migration**: Move `commands` and `maxBlocks` into the definition settings, validate them against the shipped settings matrix, and disable the row. The matrix preserves the legacy positive-safe-integer cap range, including a case above 128; two profiles with different commands and caps MUST load from the same report, and only a change to the definition template requires a new report.

### Requirement: Delivery and opt-out

**Reason**: The `verify` definition is delivered by the workflows bundle; the verification-gate row is disabled and later removed.

**Migration**: Enable the `verify` definition, disable the row, and verify that turning the definition off removes every verify steer. While the row is enabled, an `own` `verify` definition MUST be refused; while the row is disabled, a `defer` `verify` definition MUST be refused because no enabled legacy source remains.

### Requirement: Security and trust boundaries

**Reason**: The workflow evidence verifier keeps the same no-execution, untrusted-data, bounded-message rules; the legacy gate's separate boundary is retired.

**Migration**: Run the security tests against the `verify` definition, confirm no command is executed from a definition, then disable the row.
