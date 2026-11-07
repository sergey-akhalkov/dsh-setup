# Spec Delta

## ADDED Requirements

### Requirement: Review finding classification

Every review finding SHALL carry a class from the fixed vocabulary `spec-ambiguity`, `missing-test`, `path-boundary`, `state-persistence`, `stale-input`, `api-contract`, `plan-shape`, `docs-drift`, `security`, and `other`. The bundled review instructions SHALL request it, and the verdict parser SHALL store a valid class, normalize an absent or unknown class to `other`, and MUST NOT reject a verdict for a malformed class.

#### Scenario: Class is stored

- **WHEN** a review returns a finding with class `path-boundary`
- **THEN** the local review record carries that class with the finding

#### Scenario: Absent class is normalized

- **WHEN** a finding has no class field
- **THEN** the record stores `other` and the verdict is still accepted

#### Scenario: Unknown class is normalized

- **WHEN** a finding names a class outside the vocabulary
- **THEN** the record stores `other` and the verdict is still accepted

#### Scenario: PASS is unaffected

- **WHEN** a review returns PASS with no findings
- **THEN** the portable approval record is unchanged and still satisfies the gate
