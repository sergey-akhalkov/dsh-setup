# Spec Delta

## ADDED Requirements

### Requirement: Parallel writer isolation

The delegation skill body and the plugin documentation SHALL state that two writers which may touch the same files are isolated in separate worktrees or serialized, and that each writer is told which files it owns. The guidance MUST NOT change any trigger, record, digest, or gate, and MUST NOT require a worktree when a single writer runs.

#### Scenario: Conflicting writers

- **WHEN** two agents will edit the same repository at the same time
- **THEN** the skill body directs the agent to give each an isolated worktree or to serialize the writes and name the owned files

#### Scenario: Single writer

- **WHEN** one agent performs the work sequentially
- **THEN** the guidance does not require a worktree

#### Scenario: Engine unchanged

- **WHEN** the guidance is added
- **THEN** the triggers, records, digests, and turn-stopping gate behave exactly as before

#### Scenario: Patch contract already isolated

- **WHEN** a patch contract runs a write-capable target
- **THEN** the existing isolated-worktree behaviour applies and the new guidance does not duplicate it

#### Scenario: Documentation

- **WHEN** a user reads the delegation documentation
- **THEN** it names when to isolate a writer and when serializing in one checkout is acceptable
