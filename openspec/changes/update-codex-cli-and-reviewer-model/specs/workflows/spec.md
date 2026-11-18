# Spec Delta

## ADDED Requirements

### Requirement: Bundled review autonomy

The bundled review instructions SHALL tell the reviewer to decide and deliver the verdict itself:
it MUST NOT ask the user, propose a plan, or wait for confirmation, and it MUST finish with the
single JSON verdict block. Incomplete input SHALL be reported only as a P0/P1 finding under the
rubric; otherwise the reviewer returns `PASS`.

#### Scenario: Ambiguity still returns a verdict

- **WHEN** a review runs with a bundled instruction and a detail of the reviewed input is unclear
- **THEN** the reviewer makes the smallest reasonable assumption from the repository and the named
  artifacts and returns the single JSON verdict instead of asking or stopping
