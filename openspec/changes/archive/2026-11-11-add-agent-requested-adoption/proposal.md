# Proposal

## Why

The archive gate accepts only an authenticated completed `change-intake` run or a host-authenticated adoption receipt, and only the user-started `/workflows adopt <name>` command can write the receipt. The model cannot finish an archive of a change that was planned or applied outside the intake workflow without the owner typing that command. The owner has already written four such receipts by hand (`.dsh/workflows/receipts/`: `add-workflow-overview`, `fix-workflow-run-lifecycle`, `redesign-workflows-ui`, `workflows-live-test`), and the archive of `redesign-workflow-design-surface` is blocked by the same requirement.

## What Changes

- Add an `adopt` action to the model-facing `workflows` tool with one `change` argument. It verifies the four change artifacts and the current whole-spec PASS, asks the user through the host user-questions UI, and writes the same host-signed receipt on a yes answer.
- The adoption function no longer requires a user-typed command: the direct user answer to the host question is the authorization. The artifact verification, the question, the post-answer re-verification, and the signed receipt are unchanged.
- The `/workflows adopt <name>` command keeps its behavior and shares the same path.
- The archive gate, the receipt format, the install/approval boundaries, and the existing tool actions are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflows`: the model interface gains a user-confirmed adoption action, and the adoption requirement allows the tool path while keeping the receipt host-signed and user-authorized.

## Impact

- Host: `packages/plugin-workflows/src/host/{adoption,commands,tools,index}.ts` and the adoption/tool tests.
- Docs: `docs/workflows.md` and `docs/plugins.md`.
- No dependency, route, page, client component, bundle row, or installer change; the host question UI is reused.
