# Spec Delta

## ADDED Requirements

### Requirement: Gate-only retirement switch

The checkpoint provider SHALL support `automation: false`, which keeps the `work_checkpoint` tool, its local record, and the lane schema, while disabling the close gate, the parallel gate, the remedy gate, the bottleneck-age gate, and the periodic request. When automation is false, the `retro` workflow definition SHALL be the enforcing path and MUST be `own`; a `defer` definition beside the disabled automation MUST be refused because no enabled legacy source remains.

#### Scenario: Tool remains available

- **WHEN** `automation` is false
- **THEN** `work_checkpoint` still accepts a call, writes its record, and returns the decision summary

#### Scenario: Gates are silent

- **WHEN** `automation` is false and a turn stops without a checkpoint
- **THEN** the checkpoint provider does not steer or refuse the close

#### Scenario: Workflow owns the close

- **WHEN** `automation` is false and the `retro` definition is `own`
- **THEN** the workflow requests the checkpoint and refuses the close until a fresh record exists

#### Scenario: Defer is refused without automation

- **WHEN** `automation` is false and the `retro` definition is `defer`
- **THEN** the definition is refused and neither owner is silently left without an enforcing checkpoint

#### Scenario: Rollback

- **WHEN** `automation` is true again
- **THEN** the checkpoint provider's gates steer again and the `retro` definition MUST return to `defer`
