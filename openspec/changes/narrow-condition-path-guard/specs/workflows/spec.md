# Spec Delta

## MODIFIED Requirements

### Requirement: Review condition

A trigger MAY declare a `condition`: a bounded JSONLogic predicate over the event, the change's
checked and unchecked tasks and lanes, the current whole-spec and task records with their digests,
the current spec and worktree digests, and the session's involvement. The engine SHALL evaluate it at
every turn close and MUST refuse a predicate that is not JSONLogic or names an unknown context field.
A false condition SHALL produce no run and no steer.

#### Scenario: Condition gates the run

- **WHEN** the trigger fires and its condition is false
- **THEN** no run starts and no steer is emitted

#### Scenario: Condition sees the records and digests

- **WHEN** a condition references `records.spec.pass` and `digests.spec`
- **THEN** it evaluates against the current whole-spec record and the current change artifact digest

#### Scenario: Involvement sources are bounded

- **WHEN** a condition reads `session.involved`
- **THEN** it is true for the session's own write/edit, change creation, persisted involvement, or a supported shell write (Set-Content, Add-Content, Out-File, New-Item, Copy-Item, Move-Item, Rename-Item, Remove-Item, cp, mv, rm, touch, tee, redirection, or pipeline; copy/move use their destination and rename its source path); a shell form outside that set does not establish involvement in Release A

#### Scenario: Invalid condition fails load

- **WHEN** a definition's `condition` is not JSONLogic or names an unknown context field
- **THEN** the definition is refused at load with the definition and field

#### Scenario: Prose does not gate condition evaluation

- **WHEN** a change's `tasks.md` contains a URL, a custom-scheme address, an inline-code slash, or an absolute path in task or lane-title prose
- **THEN** the context builds with that text unchanged, the condition evaluates normally, and no definition is suppressed

#### Scenario: Path inputs keep the guard

- **WHEN** `event.path`, `event.command`, or a lane's owned paths carry an absolute drive or POSIX path, a UNC path, or a traversal
- **THEN** the context build fails instead of passing that value into a predicate

#### Scenario: URLs are not filesystem paths

- **WHEN** a guarded value contains a non-`file:` URL, including query parameters such as `https://example.invalid/?a=1&next=/archive`, in a literal path field or as a quoted shell argument
- **THEN** it is not rejected as a filesystem path, while a `file:` URL, an ordinary absolute path, and an unquoted URL followed by a shell redirection into an absolute path (`https://example.invalid>/etc/private/token.txt`) still are

#### Scenario: A context build failure records an error

- **WHEN** the condition context cannot be built for an event
- **THEN** every condition-bearing definition records `error` with a bounded detail instead of `false`, the health record names the cause, and unconditional definitions still evaluate for that event
