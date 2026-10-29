# Spec Delta

## ADDED Requirements

### Requirement: Exact-pinned third-party runtime dependencies

A repository plugin package MAY declare an exact-pinned third-party runtime dependency. The setup manifest SHALL hoist it as a regular dependency, the profile installation SHALL fetch that exact version from the registry, and the repository MUST NOT vendor the package when it is self-contained. The dependency MUST be documented and MUST NOT duplicate a Harness-provided package.

#### Scenario: Fresh profile install

- **WHEN** the setup bundle is installed into a profile that does not yet contain the third-party package
- **THEN** the profile installation fetches the exact pinned version, the plugin row resolves, and no separate manual installation step is required

#### Scenario: No vendored copy

- **WHEN** the generated setup tree and manifest are inspected
- **THEN** the third-party package is absent from the vendored tree and present in the manifest at the exact pinned version

#### Scenario: Version drift

- **WHEN** repository validation finds a version range, a latest tag, or a version different from the recorded exact pin
- **THEN** validation fails

#### Scenario: Harness-provided package

- **WHEN** a configuration-only row mounts a package that the Harness installation provides
- **THEN** the setup does not declare that package as a dependency, exactly as the existing dependency-containment rule requires
