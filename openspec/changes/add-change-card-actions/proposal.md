# Proposal

## Why

A completed change in the OpenSpec right-sidebar panel still offers `Apply change`, which only fills a
composer draft the user must then send to archive it through a chat command. The panel can read
everything it needs to decide that the archive step is next — the task counts — yet it sends the user
to the conversation for the one action that finishes the change. Archiving also depends on
host-authenticated evidence (a completed intake run or adoption receipt, and a current whole-spec
PASS), so the click cannot simply run `openspec archive`: without the same gate checks the button
would become an authorization bypass.

A second, independent defect is in the engine's pre-execute archive gate: `openspec archive` after a
shell separator (`cd x; openspec archive y`, `cd x && openspec archive y`) is not parsed, and the
current refusal pattern is anchored to the start of the command, so the compound form falls through
the gate unexamined.

## What Changes

- The change detail header shows `Archive` instead of `Apply change` when every task is done. The
  click is the user's confirmation: the panel POSTs to a Host route, the host authorizes the click
  through the workflows engine's new `workflowsArchiveGate` service, and the OpenSpec CLI archives
  the change. No dialog and no chat command are added; `Apply change` stays for a change that is not
  complete and still only fills the `/openspec-apply-change <name>` draft.
- The same state-dependent action appears on each change card in the `Changes` list: Apply fills the
  draft for an incomplete change, Archive archives a complete one. The card action stops
  propagation, and a successful archive re-reads the list and opens the archived change.
- The Host route validates the live session, the CLI-reported active change, and complete task
  counts; the engine service verifies the change artifacts and the current whole-spec PASS, writes
  the host-signed adoption receipt that the click authorizes, and repeats the archive gate decision
  (authenticated completed run or receipt, current whole-spec PASS, no open required run step,
  portable task-review coverage when the shipped rule owns that behavior). A refusal is shown inline
  and leaves the change active. A host without the engine skips only the engine checks; the OpenSpec
  plugin still requires complete tasks.
- The pre-execute archive gate refuses a compound shell command that contains an archive invocation
  or archive move it cannot parse safely, closing the separator bypass. A benign compound command
  that names no archive stays allowed.
- `docs/plugins.md` and `docs/workflows.md` document the state-based action, the click as
  authorization, the route, the host service, and the separator refusal.

Out of scope: any other panel write (sync, validate, tick, edit), a new confirmation dialog, a new
package, a dependency, a bundle row, or a change to the agent-facing archive behavior for a command
the gate already parses.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-panel`: the panel stays read-only, except that the `Archive` action on a completed change
  is an authorized write; the Actions are state-dependent on the change card and detail header.
- `workflows`: the pre-execute archive gate refuses an unparseable archive invocation after a shell
  separator; a new `workflowsArchiveGate` host service authorizes a user-clicked archive with a
  host-signed adoption receipt and the same gate checks as the agent path.

## Impact

- Engine: `packages/plugin-workflows/src/host/{index,adoption,gates}.ts` and a new
  `archive-authorization.ts` shared decision module; host tests for the service and the separator
  bypass.
- OpenSpec plugin: `src/host/{index,change-list}.ts` (the new POST route and one CLI runner entry),
  `src/client/{index.tsx,panel.ts}` (the action, the request helper, the dictionary keys), and client
  and host tests.
- Docs: `docs/plugins.md`, `docs/workflows.md`.
- No new dependency, package, bundle row, install script, model tool, prompt text, or DSH API.
