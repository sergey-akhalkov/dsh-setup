# Spec Delta

## MODIFIED Requirements

### Requirement: Bundle integration

The picker SHALL ship inside the existing `@dsh-studio/plugin-openspec` package and its one bundle row,
with no new bundle row, package, market entry, install script, or dependency. The generated setup tree
MUST carry the client entry, and picker browsing MUST add no prompt text or model tokens.

#### Scenario: One row and no new dependency

- **WHEN** the repository is validated
- **THEN** the package still mounts through its single row and declares no new runtime dependency

#### Scenario: Generated setup carries the client entry

- **WHEN** the setup bundle is regenerated
- **THEN** the vendored package includes the client entry and `pnpm gen:check` passes

#### Scenario: No model surface

- **WHEN** the user opens, searches, or closes the picker without picking a change
- **THEN** no message, prompt text, or model token is produced
