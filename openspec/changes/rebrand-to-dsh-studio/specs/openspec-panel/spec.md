# Spec Delta

## MODIFIED Requirements

### Requirement: Bundle integration

The panel SHALL ship inside the existing `@dsh-studio/plugin-openspec` package and its single bundle
row, with no new package, row, market entry, install script, or runtime dependency. The DSH client
component library MUST be consumed as a host-provided external module. Generated setup files MUST carry
the panel, and browsing MUST add no prompt text or model tokens.

#### Scenario: One row, no new runtime dependency

- **WHEN** the repository is validated
- **THEN** the package still mounts through its single row and declares no new runtime dependency

#### Scenario: Generated setup carries the panel

- **WHEN** the setup bundle is regenerated
- **THEN** the vendored package includes the panel and `pnpm gen:check` passes

#### Scenario: No model surface

- **WHEN** the user browses changes, capabilities, and artifacts
- **THEN** no message, prompt text, or model token is produced
