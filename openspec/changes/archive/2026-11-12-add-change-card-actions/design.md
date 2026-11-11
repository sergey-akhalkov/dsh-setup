# Design

## Context

`packages/plugin-openspec` renders a change's progress from the CLI-reported counts and writes at
most a composer draft (`/openspec-apply-change <name>`). The archive decision itself already lives in
`packages/plugin-workflows`: the `tools/pre-execute` listener parses `openspec archive <name>` and
archive moves, verifies the current whole-spec `PASS` record, checks portable task-review coverage
when the shipped `task-review` definition is `own`, loads the host-authenticated runs and receipts,
and calls `evaluateArchiveGate`. Adoption (`/workflows adopt`, the `workflows` tool action, and the
intake approval step) writes the host-signed `.dsh/workflows/receipts/<name>.json` after verifying the
four change artifacts and the current whole-spec PASS.

Two facts shape the design. First, the click on `Archive` is the user's confirmation, so the host may
write the adoption receipt for it: the route is reachable only through the carrier's admission fence
(origin/cookie), the session comes from the request and is resolved to a live workspace, and every
call is the direct result of a user activation in the panel. Second, the user's explicit click is the
final authorization for that archive: the host verifies the change artifacts and the current
whole-spec `PASS`, records the click as the host-signed receipt, and archives. Internal review state
(an open run step, a pending task approval, a stale marker) can delay the agent command path but must
not turn the user's click into a wall of process errors.

The panel's current `ChangeCard` is a `<button>`; a nested action button would be invalid HTML. The
card becomes a focusable `role="button"` element with the same activation behavior, so the action can
be a real button inside it.

## Goals / Non-Goals

**Goals:**

- A completed change offers `Archive` in the detail header and on its card; the click archives it
  after the host authorizes the click.
- `Apply change` remains the action for an incomplete change and still only fills the draft.
- One shared archive-gate decision for the agent path; the user's click is the final authorization
  and does not wait on internal review state.
- A refusal names the cause, leaves the change active, and is shown inline.
- The separator bypass of the pre-execute archive gate is closed.
- A host without the workflows engine still archives after the task-count check.

**Non-Goals:**

- Any other write from the panel (sync, validate, tick, edit, reopen).
- A confirmation dialog, a chat command, a new model tool, or a new service method for the agent.
- Moving or changing the existing adoption command/tool behavior.
- Parsing arbitrary shell; a command the parser cannot understand is refused, not interpreted.

## Decisions

### The click is the authorization, recorded as a host-signed adoption receipt

`workflowsArchiveGate.authorizeAndCheck(workspace, change)` runs in the workflows host:

1. ensure the host key; without it nothing can be signed, so the archive is refused;
2. verify the four change artifacts (`proposal.md`, `design.md`, `tasks.md`, at least one
   `specs/**/spec.md`) and the current whole-spec `PASS` record with `verifyAdoptionEvidence`;
3. write the host-signed adoption receipt for the click with `issueAdoptionReceipt`;
4. return `{ ok: true }`; the route then runs the archive.

Reusing adoption evidence and the adoption receipt keeps one host-authenticated artifact for "this
change was verified and the user asked to close it" instead of inventing a second receipt kind. It
also means the receipt survives run-history pruning exactly like the existing adoption path. The
receipt is not a review record and does not bypass the whole-spec `PASS` check; the agent command
path still applies the full archive gate.

### The agent path keeps the full gate; the click is the final authorization

`packages/plugin-workflows/src/host/archive-authorization.ts` exports
`decideArchiveAuthorization(workspace, change, { auth, definitions, clickedTaskReview? })` for the
pre-execute listener. It reads the current whole-spec `PASS` record, computes optional portable
task-review coverage when the installed `task-review` definition's `gateOwnership` is `own`, loads
`hasTamperedRuns`, authenticated runs and receipts, and returns `evaluateArchiveGate`'s decision.
When the host key is unavailable it passes no auth and the decision is unchanged from today (empty
runs and receipts, no tampering). The clicked path does not call this decision: an open run step, a
missing portable approval, or a deferred/malformed marker cannot block the user's explicit click.

### The Host route validates the request before any write

`POST /api/plugins/dsh-setup-openspec/archive` with `{ session, name }`:

- the session must be live (`agents.get`), else 400;
- the workspace comes from the session, never from the body;
- `name` must be a CLI-reported active change from `listWorkspaceChanges(workspace)` with
  `totalTasks > 0 && completedTasks === totalTasks`, else 409 with a bounded reason and no write;
- the engine service is captured with `ctx.get('workflowsArchiveGate')` at request time, so a host
  that provides it after load and a host without it both work; a denial is a 409 with the engine's
  reason;
- the archived names are read immediately before the CLI call as a baseline, then the OpenSpec CLI
  runs as `openspec archive <name> --yes` through the existing bounded CLI runner (60–120 s
  process-tree timeout) with no shell command built from the name. The runner refuses any name that
  is not a plain slug with `requireSafeCliName` before spawning, because `cmd.exe` expands `%VAR%`
  even inside quotes — this applies with or without the engine;
- after the CLI succeeds the archived list is read again: the response reports `{ ok: true, name }`
  only for the row that was not in the baseline and whose date-stripped name matches the change. If
  either read fails or no new row is identified, the response is `{ ok: true }` with no name — never
  the plain active name, which is not an archived address. The client opens the reported archived
  address only when one exists and clears its busy state after success or refusal; the list re-read
  shows the change in `Archive` otherwise.

The route writes no file. The CLI syncs the delta specs and moves the change, the same way the chat
command would.

Deviation from the handed-in design: it said the client opens `archivedChangeAddress(name)` with the
requested name. OpenSpec renames the change directory to `<date>-<name>` when archiving, so the
plain name is not a CLI-reported archived item and that tab would immediately fail. The route
reports the newly added CLI-reported row when it can identify it, and reports success without an
address when it cannot; the client then refreshes the list instead of opening a fabricated tab.

### A card action needs a valid interactive parent

The list card is currently a `<button>`; two nested buttons are invalid and the DOM repairs them in
ways that break the card click. The card root becomes `<div role="button" tabIndex={0}>` with the
same Enter/Space activation and the host focus ring, while the artifact tags keep their existing
keyboard pattern. The action button calls `stopPropagation` and is a real `<button>` with a disabled
busy state and a visible label. The busy state is cleared after success or refusal, so the next card's
action is not blocked, and the list re-reads after a successful archive so the row leaves `Changes`
and appears in `Archive`.

### The `/workflows` command advertises free-form arguments

The DSH composer treats a registered command without an input descriptor as complete, so Tab/Enter
would run `/workflows` before the user could type `adopt <name>`. The command definition gains
`input: { hint: 'run <definitionId> | resume <runId> | install <path> | adopt <name> | status' }`,
the documented `CommandInputDescriptor.hint` placeholder for capable clients. The handler and its
accepted argument forms are unchanged; the descriptor only keeps the composer line open.

### Refuse what the parser cannot read

`parseArchiveCommand` already refuses any command carrying a shell control character, so a compound
command never becomes an `ArchiveIntent`. The listener then applies one conservative textual rule
instead of interpreting shell syntax: it lowercases the command, joins backtick/backslash line
continuations, keeps block-comment and stream-merge text but removes quotes, backticks and
backslashes, and scans the whole command without splitting it. A command that names `openspec` and
`archive` is refused, as is a command with a move verb together with `openspec/changes/archive` or an
`archive`/`archive/...` path token. A mention inside quoted text, a comment, a separator, or a
command substitution is refused the same way; the rule never executes or interprets the text. A
command that names no archive still goes to `next()`.

Rationale: six review rounds showed that a purpose-written shell parser keeps finding new
PowerShell/Bash constructs (parameter values, comments, block comments, substitutions, redirects,
continuations, assignments). A textual rule is fixed-size and cannot be out-parsed; the alternative
reading of "names no archive" — exact shell semantics — is an interpreter, not a gate. The cost is
one deliberate false positive: a quoted or commented mention of an archive is refused rather than
allowed.

## Risks / Trade-offs

- The panel can now write: one CLI archive, one host receipt. The alternative (no button) leaves the
  workflow incomplete. The click path verifies the change artifacts and the current whole-spec
  `PASS`; the agent command path keeps the full archive gate.
- The click is the final authorization: an open run step, a missing portable task approval, or a
  deferred/malformed review marker no longer refuses the user's click. The alternative is the
  support loop this change replaces (stuck review state blocking the click with a wall of internal
  errors). The receipt binds the verified digest and is the audit record of the user's decision.
- The separator check is deliberately conservative: a quoted string that merely contains
  `openspec archive` after a separator is refused rather than interpreted. Shell-free invocation is
  the documented form.
- The task-count check is the OpenSpec plugin's only check without the engine; a profile without the
  engine therefore archives after completion without the whole-spec/PASS gate, matching the absence
  of that gate in such a profile.
