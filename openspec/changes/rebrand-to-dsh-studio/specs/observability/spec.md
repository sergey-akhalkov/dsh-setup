# Spec Delta

## MODIFIED Requirements

### Requirement: Guidance readiness is checked against the live registries

Each declared prompt contribution SHALL be checked against the live registries: a prompt section against
the assembled system prompt's section names, a skill against the skill catalog's completed discovery. A
guidance row whose declared contribution is present reports `mounted`; an absent one reports `not mounted`
and needs attention. A guidance row with no declared contribution, or whose check cannot run or did not
complete, MUST NOT be reported as failing.

#### Scenario: Section mounted

- **WHEN** a guidance row declares the section `dsh-studio:ponytail` and the assembled prompt contains it
- **THEN** the row reports mounted

#### Scenario: Section absent

- **WHEN** the declared section is absent from the assembly
- **THEN** the row reports not mounted and the view names it as needing attention

#### Scenario: Skill mounted

- **WHEN** a guidance row declares a skill and the catalog lists it
- **THEN** the row reports mounted

#### Scenario: Check unavailable

- **WHEN** the prompt or skill registry is unavailable, or the assembly fails
- **THEN** the row reports readiness unknown and is not reported as failing

#### Scenario: Partial skill discovery

- **WHEN** the catalog reports an incomplete observation and the declared skill is not listed
- **THEN** the row reports readiness unknown rather than not mounted

#### Scenario: No declaration

- **WHEN** a guidance row declares no contribution
- **THEN** it stays guidance-only with no readiness word
