# Spec Delta

## Purpose

Exposes the workspace's unfinished OpenSpec changes inside the composer through DSH's native picker shell,
so a user can fill the apply-change command line without remembering change names.

## ADDED Requirements

### Requirement: Native picker registration

The plugin SHALL register the client command `/openspec-apply` through the DSH client command API and
SHALL present its choices with the client's built-in `popupSelect` shell. The plugin MUST supply only
option data and the selection handler; it MUST NOT ship its own React components, styles, icons, or
popup. When the client command service is unavailable the client half MUST register nothing and raise
no error.

#### Scenario: Command listed and picker opens

- **WHEN** the Web client loads the plugin and the client command service exists
- **THEN** `/openspec-apply` is listed in the slash menu and invoking it opens the built-in picker shell

#### Scenario: Inert without the client service

- **WHEN** the client command service is absent
- **THEN** the client half registers no command and no error reaches the composer

#### Scenario: Shell owns the presentation

- **WHEN** the picker renders
- **THEN** the rows, search field, keyboard navigation, empty state, error strip, and styling come from the picker shell

### Requirement: Unfinished change list

Opening the picker SHALL list every unfinished change that `openspec list --json` reports for the
requesting session's workspace, one row per change, labeled with the change name and its completed and
total task counts. The plugin MUST resolve the workspace from the session.

#### Scenario: One row per unfinished change

- **WHEN** the workspace's OpenSpec root reports two unfinished changes
- **THEN** the picker shows one row for each change

#### Scenario: Progress label

- **WHEN** a change reports 3 completed tasks out of 14
- **THEN** its row shows the change name with `3/14` progress

#### Scenario: Root with no unfinished changes

- **WHEN** the workspace has an OpenSpec root and `openspec list --json` reports no changes
- **THEN** the picker shows the shell's empty state instead of rows

#### Scenario: Sessions stay scoped

- **WHEN** two sessions live in different workspaces
- **THEN** each picker lists only its own workspace's changes

### Requirement: Workspace-local root only

The picker SHALL list changes only when the session workspace contains its own `openspec/` root, and the
plugin MUST confirm that the CLI resolved that exact workspace as its root. A workspace without a local
root, or one whose resolution returns an ancestor root, a declared store, or a default store, MUST report
the no-root error instead of another root's changes.

#### Scenario: Local root accepted

- **WHEN** the workspace contains `openspec/` and the CLI reports that workspace as its root
- **THEN** the picker lists the workspace's changes

#### Scenario: Ancestor root rejected

- **WHEN** the workspace has no `openspec/` root but sits below a directory that does
- **THEN** the picker reports the no-root error and shows no rows

#### Scenario: External root rejected

- **WHEN** the workspace's configuration declares a store or the CLI falls back to a default store
- **THEN** the picker reports the no-root error instead of that store's changes

#### Scenario: Resolved root must match

- **WHEN** the CLI reports a root path that resolves outside the session workspace
- **THEN** the plugin treats the result as the no-root error


### Requirement: Pick fills the command line

Picking a change SHALL write the literal `/openspec-apply-change <name>` into the composer draft without
submitting it, and the composer SHALL keep focus and the draft for the user to send. The picker MUST
NOT execute, modify, or archive the change, and MUST NOT intercept a hand-typed
`/openspec-apply-change` line.

#### Scenario: Pick fills the draft

- **WHEN** the user picks the change `add-auth`
- **THEN** the composer draft becomes `/openspec-apply-change add-auth` and no message is sent

#### Scenario: No automatic send

- **WHEN** the pick settles
- **THEN** the composer is focused with the draft intact and the change is untouched

#### Scenario: Hand-typed invocation unchanged

- **WHEN** the user types and submits `/openspec-apply-change add-auth`
- **THEN** the line is sent as a user message and the host injects the apply-change skill exactly as before

### Requirement: Workspace-scoped list endpoint

The plugin SHALL serve the list over a read-only browser route that rejects a foreign origin or an
unauthenticated request, resolves the workspace from the session id, and runs the documented CLI there.
The request MUST carry only the session id; the route MUST NOT accept a filesystem path or build a
shell command from request text, and it MUST bound the CLI call with a timeout.

#### Scenario: Foreign origin rejected

- **WHEN** a request arrives from an origin other than the Web host's own origin
- **THEN** the route rejects it without running the CLI

#### Scenario: Unknown session rejected

- **WHEN** the request names a session the host does not know
- **THEN** the route rejects it with a client error and runs no command

#### Scenario: No arbitrary path

- **WHEN** a request carries text other than the session id
- **THEN** the route ignores it and reads only that session's workspace

#### Scenario: Bounded call

- **WHEN** the CLI does not finish within the configured timeout
- **THEN** the route terminates the whole spawned process tree and reports a timeout instead of waiting

### Requirement: Readable failures

When the CLI is absent, the workspace has no OpenSpec root, the CLI times out, or its output cannot be
parsed, the picker SHALL show a readable error with retry, and the composer, the six skills, and other
sessions SHALL remain unaffected.

#### Scenario: CLI absent

- **WHEN** `openspec` is not on `PATH`
- **THEN** the picker shows the prerequisite error and the six skills stay cataloged and loadable

#### Scenario: Missing root

- **WHEN** the workspace has no local `openspec/` root, or its resolution would leave the workspace
- **THEN** the picker reports that no workspace-local OpenSpec root exists

#### Scenario: Retry after failure

- **WHEN** the error strip's retry runs after the cause is fixed
- **THEN** the picker loads the change list without reopening the command

### Requirement: Graceful degradation

The client half SHALL activate only when its client command service exists, and the list route SHALL
register only when the Web host services exist. A CLI, TUI, or ACP host that lacks the Web host services
MUST keep all six skills cataloged and loadable and MUST NOT fail because the picker cannot register.

#### Scenario: Non-Web host mounts

- **WHEN** the plugin loads in a host without the Web server service
- **THEN** the six skills are cataloged and the plugin raises no error

#### Scenario: Web client without the command service

- **WHEN** the Web client lacks the client command service
- **THEN** no picker command is registered and the six skills remain available

### Requirement: Bundle integration

The picker SHALL ship inside the existing `@dsh-setup/plugin-openspec` package and its one bundle row,
with no new bundle row, package, market entry, install script, or dependency. The generated setup tree
MUST carry the client entry, and picker browsing MUST add no prompt text or model tokens.

#### Scenario: One row and no new dependency

- **WHEN** the repository is validated
- **THEN** the package still mounts through its single row and declares no new runtime dependency

#### Scenario: Generated setup carries the client entry

- **WHEN** the setup bundle is regenerated
- **THEN** the vendored package includes the client entry and `pnpm gen:check` passes

#### Scenario: No model surface

- **WHEN** the user opens, searches, or closes the picker without picking a change
- **THEN** no message, prompt text, or model token is produced
