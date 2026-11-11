# Spec Delta

## MODIFIED Requirements

### Requirement: Shadow trigger catalog

The plugin SHALL declare triggers as data, each with an id, an event kind, a filter, and a mode (`shadow` or `active`). The observability shadow catalog SHALL support agent turn start, agent turn stop, tool result, subagent start, subagent end, and workspace file change. The engine's catalog SHALL contain those generic entries and SHALL merge the shadow entries contributed by installed plugins; a contributed entry SHALL name its plugin source. The workflow engine MAY additionally evaluate `turn.stopping`, `tool.pre-execute`, and `review.record`, and the optional intent trigger; the intent classifier is not a shadow event kind. A trigger with an unknown event kind, an empty id, or an invalid filter MUST fail the catalog or the contribution with a diagnostic naming the trigger, the source, and the field, and no partial catalog may be served. A duplicate trigger id MUST be refused naming both sources.

#### Scenario: Catalog loads

- **WHEN** the plugin loads with the shipped trigger definitions
- **THEN** the trigger catalog on the `Workflow design` page lists each generic and contributed trigger with its event kind, filter summary, source, and last evaluation time

#### Scenario: Invalid trigger is refused

- **WHEN** a trigger has an unknown event kind, an empty id, or an invalid filter
- **THEN** the catalog or the contribution is refused with a diagnostic naming the trigger, the source, and the field, and no partial catalog is served

#### Scenario: Active trigger creates a run

- **WHEN** an active trigger in an owned definition matches its event
- **THEN** the engine creates one run and the evaluation beside that event names the run

#### Scenario: Contributed trigger is listed

- **WHEN** a contributing plugin registers its shadow triggers while the registry service is available
- **THEN** the design page catalog lists those entries with the plugin source and the generic entries are unchanged

#### Scenario: Duplicate trigger is refused

- **WHEN** two sources register the same trigger id
- **THEN** the later contribution is refused naming both sources and no duplicate entry is served
