# Spec Delta

## ADDED Requirements

### Requirement: Reviewer identity binding

When `openspec/review-approval.json` declares `reviewerProvider`, every portable task-review PASS MUST name a matching `target.provider`; a declared `reviewerModel` MUST also match. The live archive gate, live task gate, `delegation_status`, and `pnpm reviews:check` SHALL apply the same binding. An absent declaration preserves provider-agnostic behavior; a mismatch is unapproved.

#### Scenario: Matching provider

- **WHEN** the marker declares `reviewerProvider` and a portable PASS names that provider
- **THEN** the record counts as approved

#### Scenario: Mismatched provider

- **WHEN** the marker declares `reviewerProvider` and a portable PASS names another provider
- **THEN** the record counts as unapproved and the detail names both providers

#### Scenario: Model pin

- **WHEN** the marker declares `reviewerModel` and the record target model differs
- **THEN** the record counts as unapproved

#### Scenario: Legacy marker

- **WHEN** the marker declares neither field
- **THEN** any valid record target counts as before

#### Scenario: Live task gate

- **WHEN** a checked task has a local task-review record from a provider other than the marker's reviewer and the marker declares one
- **THEN** the live task gate refuses the close

#### Scenario: Audit and live gate agree

- **WHEN** the archive gate and the approval audit inspect the same record
- **THEN** both apply the same provider/model binding and report the same approval result

### Requirement: Staged archive audit

The repository SHALL provide `pnpm reviews:check --staged` and a tracked `.githooks/pre-commit` hook selected by `pnpm hooks:install` once per clone. The command SHALL audit every staged change under `openspec/changes/archive/` and fail closed when a checked task lacks a matching PASS. A commit with no staged path under the archive passes; an unknown range or unreadable evidence fails closed and names `pnpm reviews:check --all`. The pre-push and CI audits remain authoritative.

#### Scenario: Staged unapproved archive

- **WHEN** a commit stages a change under `openspec/changes/archive/` and a checked task has no matching PASS
- **THEN** `reviews:check --staged` exits non-zero, names the task and record path, and the commit is refused

#### Scenario: Staged approved archive

- **WHEN** a commit stages an archived change whose checked tasks all have matching PASS records
- **THEN** the staged audit exits zero

#### Scenario: Non-archive commit

- **WHEN** a commit stages no path under `openspec/changes/archive/`
- **THEN** the staged audit exits zero without a full archive audit

#### Scenario: Unknown staged range

- **WHEN** the staged range cannot be determined or the evidence cannot be read
- **THEN** the audit fails closed and prints the full audit command

#### Scenario: Fresh clone hook

- **WHEN** a fresh clone on Windows runs `pnpm hooks:install` and then `git commit`
- **THEN** the pre-commit hook runs the staged audit from the tracked hooks