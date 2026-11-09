# Design

## Context

The live profile runs `@dsh-setup/setup` 0.29.4 and owns the checkpoint and task-review
gates through the `workflows` definitions. The intake run that created this change walked
the drafts, the owned `create-change` call, and the spec step; the run records are the
evidence for that walk.

## Decisions

### 1. Documentation-only delta

The dispatch defect the live run found is fixed and released; restating it as a spec delta
would describe behavior the main spec never required. This change records only the behavior
the walk confirmed and the main spec fails to state.

### 2. Empty commands keep verification inert

The shipped row configures `verify.commands: []` on purpose, mirroring the retired
verification row that shipped no commands. The engine records `no-command` evidence and
allows the turn close; the requirement now states that instead of leaving it to a code
comment. A test at the engine boundary already covers the behavior; this change does not
move it.

## Risks

- A docs-only delta can drift from the code. The scenario names the observed evidence shape
  (`no-command`), so a behavior change has to change the text.
