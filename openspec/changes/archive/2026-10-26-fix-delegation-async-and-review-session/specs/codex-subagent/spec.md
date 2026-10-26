## ADDED Requirements

### Requirement: Review thread reuse

The Codex provider SHALL reuse one app-server conversation per review key (change name plus task id for a task review, or the change plus phase for a whole-scope review). The first review of a key MUST start a thread; the provider MUST persist its thread id and later reviews of the same key MUST resume that thread instead of creating an ephemeral one. A review for a different key MUST NOT resume another key's thread.

#### Scenario: Second review of the same task

- **WHEN** a task has been reviewed once and is reviewed again for the same key
- **THEN** the provider resumes the same Codex thread and the target continues the prior review context

#### Scenario: Different task

- **WHEN** the review belongs to a different task or change
- **THEN** the provider starts a new thread and does not reuse the other key's conversation

### Requirement: Review conversation confinement

A reused review thread MUST remain confined to the run's working directory, sandbox, Serena home, and disabled-tool policy. The persisted thread id MUST stay local scratch and MUST be removed with the delegation state; the user's Codex config MUST NOT be used or rewritten for the reuse. A provider restart MUST resume from the persisted thread id or report the missing thread and start a new one.

#### Scenario: Persisted state

- **WHEN** the provider restarts between two reviews of one key
- **THEN** it resumes from the persisted thread id (or reports the missing thread and starts a new one) without touching the user's Codex config

#### Scenario: Confinement

- **WHEN** a reused thread runs a review
- **THEN** the run's cwd, sandbox, Serena restrictions, and disabled tools still apply
