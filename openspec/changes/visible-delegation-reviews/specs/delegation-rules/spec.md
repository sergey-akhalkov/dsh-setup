# Spec Delta

## ADDED Requirements

### Requirement: Cataloged external review runs

A review-contract activation on an external provider SHALL start with parent delivery and no explicit child name, so the subagent service catalogs it as an external child of the delegating Session under the `delegation:<rule>` label. The child MUST accept no follow-up input, and the parent MUST receive the settlement notice with the review answer when the run completes.

#### Scenario: External review entry

- **WHEN** a review targets an external provider and the provider publishes the run
- **THEN** the Session's subagent list shows an external entry labelled `delegation:<rule>` with the service-assigned child name, and the entry closes as a leaf when the run settles

#### Scenario: External review notice

- **WHEN** the external review completes
- **THEN** the parent receives the settlement notice with the review answer, while the verdict parser, the record, and every gate behave as before

#### Scenario: Re-run of the same review

- **WHEN** the same external review identity starts again after an earlier child closed
- **THEN** no name was reserved by the engine, so the service assigns a new default name and the previous catalog entry cannot collide

### Requirement: Provider-specific delivery and catalog behavior

Answer and patch activations on an external provider MUST remain caller-delivered, so they are neither cataloged nor announced as settlement notices. In-process providers keep the service's existing behavior: their local children are always cataloged, and continuable children accept follow-up, independent of the engine's delivery choice; the delivery flag only decides whether the settlement notice is delivered.

#### Scenario: External answer and patch uncataloged

- **WHEN** an answer or patch rule targets an external provider
- **THEN** its activation is caller-delivered, no catalog entry is created, and no settlement notice is delivered

#### Scenario: Local provider unchanged

- **WHEN** a review or answer target uses an in-process provider
- **THEN** the service catalogs the local child exactly as before (a continuable child accepts follow-up), and the engine's delivery choice only decides whether its settlement notice is delivered
