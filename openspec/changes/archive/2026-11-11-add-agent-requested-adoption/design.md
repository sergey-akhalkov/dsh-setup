# Design

## Context

Adoption is the only path that writes a host-authenticated receipt for a change that predates the intake workflow, and the archive gate needs that receipt. Today `adoptChange` refuses unless the caller passes `userStarted: true`, which only the `/workflows adopt` command does; the model-facing tool explicitly refuses an adoption. The check is redundant with the security property that matters: `adoptChange` already asks the user through the host question service, refuses a missing service, a timeout, or a non-yes answer, re-verifies the artifacts and the spec digest after the answer, and only then signs the receipt.

## Goals / Non-Goals

**Goals:**

- The model can request adoption and the owner only answers a host UI question.
- The receipt remains host-signed and written only after a direct user yes.
- The command path, receipt format, archive gate, and tool boundaries stay compatible.

**Non-Goals:**

- No automatic archive authorization, no new slash command, page, route, or dependency.
- No change to the install/approval boundaries or the archive gate's other checks.

## Decisions

### The interactive user answer is the authorization

Remove the `userStarted` flag from `adoptChange`. Keep every existing check: valid change name, the four artifacts, the current whole-spec `PASS`, the question service being present, a `yes` answer, re-verification after the answer with the same digest, and the host-signed receipt. The model can call the action, but it cannot supply the answer; the host question UI owns it. A model-created receipt without a user answer is therefore impossible, which is the property the flag was protecting. This also amends the `Security and trust` requirement's user-started sentence: initiation may be model-requested, but the receipt stays host-signed and user-authorized, and the write guard still covers the receipts directory.

### One shared path for the command and the tool

The command's `host.adopt` wiring and the tool's `adopt` action both call `adoptChange` with the agent-scoped question service. The tool adds only argument validation and a bounded result line; it does not duplicate verification or sign anything itself.

### Tool surface

`workflows` gains the action `adopt` and the field `change`; the action set, the parser, the tool schema, and the description are updated together. The action never accepts a raw script, a definition body, or an install, and it writes no receipt for any other action.

## Risks / Trade-offs

- **A model calls adoption repeatedly** → each call only asks the user; a no, timeout, or missing service writes nothing. Refusals name the cause.
- **The change moves while the question is open** → the post-answer re-verification refuses a changed artifact or digest; no receipt is written.
- **A tool without a user-question service** → the adoption is refused with the named reason; the command path has the same behavior.
- **Tool surface growth** → one action and one argument, documented in the tool schema and `docs/workflows.md`.

## Migration

None: existing receipts and the command path are unchanged. A change adopted through the tool before the archive is archived by the same `openspec archive <name>` path.
