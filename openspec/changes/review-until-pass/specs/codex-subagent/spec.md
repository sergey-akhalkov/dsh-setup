# Spec Delta

## MODIFIED Requirements

### Requirement: Review thread reuse

The Codex provider SHALL reuse one app-server conversation per review key (the change name plus the
review unit: a task id for a task review, a section key for a lane review, or the phase for a
whole-scope review). The first review of a key MUST start a thread; the provider MUST persist its
thread id and later reviews of the same key MUST resume that thread instead of creating an ephemeral
one. A review for a different key MUST NOT resume another key's thread.

#### Scenario: Second review of the same task

- **WHEN** a task has been reviewed once and is reviewed again for the same key
- **THEN** the provider resumes the same Codex thread and the target continues the prior review context

#### Scenario: Second review of the same lane

- **WHEN** a lane section is reviewed again after a `FINDINGS` round for the same section key
- **THEN** the provider resumes the lane's prior thread instead of starting a new conversation

#### Scenario: Different task

- **WHEN** the review belongs to a different task, section, or change
- **THEN** the provider starts a new thread and does not reuse the other key's conversation
