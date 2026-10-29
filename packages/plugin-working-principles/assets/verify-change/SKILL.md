---
name: verify-change
description: >
  Verify a change before calling it done: reproduce the failure first, reduce one
  dimension at a time, and judge a run by whether its original trigger fired.
  Use for bug fixes, regressions, flaky tests, or any claim that a fix works.
---

# Verifying a change

A change is done when its effect was observed, not when its diff looks right. This skill is the
procedure for getting that observation, and for knowing when you have not.

## Start from what you will actually run

Name the artifact you executed: the binary on `PATH`, an installed copy, a cached bundle, a container
image, a service already running. Any of those can differ from the source you just edited, and a
generated or committed build output commonly does.

- Keep the exact command, its working directory, its inputs, and its output. A result you cannot
  reproduce is an anecdote.
- Historical success is not verification of the current change. Neither is a passing suite that does
  not cover the path you touched.
- If the change is documentation, configuration comments, or formatting only, say which check
  applies — usually a link, lint, or build check — and skip the runtime story. State that choice.

## Reproduce before you fix

For a bug or a regression, produce a failure you can recognize first. Then the fix has a subject, and
you can tell a real pass from a coincidence.

- Prefer the narrowest real entry point that shows the failure: a single test, one CLI invocation, one
  request. A unit test around the suspect function is a fallback, not the default, when the bug lives
  in the wiring.
- Keep the reproduction inputs. If the case is intermittent, run it enough times to state a frequency
  with its denominator, and report both. "Usually passes" is not a measurement.
- When a full check is slow or inconclusive, a smaller check is acceptable only if it keeps the
  conditions that matter: the same startup path, timing, permissions, or integration boundary. A
  smaller check that loses them proves less than it appears to.

## Reduce, one dimension at a time

When a failure is large or a reproduction is expensive, shrink it methodically:

- Change one dimension per attempt: data size, concurrency, one dependency, one option.
- Verify the reduced case still fails **the same way**. A smaller case that fails differently is a
  different bug, and a fix aimed at it proves nothing about the original.
- Stop when further reduction stops teaching you something.

## Judge the pass honestly

- A run in which the original trigger no longer runs is not a pass. Check the trigger, not only the
  exit code.
- Exit code zero is not an assertion. A test that asserts nothing, a command that silently skipped its
  work, and a suite that reported zero tests all exit zero.
- Read the failure, not just the last line of output. Wrapped errors and truncated logs hide the
  first cause.
- Re-run after the fix in the same conditions as the reproduction, and keep both results.

## A repeated correction is a durable gap

A correction you had to apply twice in one session is evidence that the instruction layer, not the
model's memory, is missing the rule. Answering it by promising more care is the wrong fix.

- Name the durable fix and its home: an instruction-file edit (the workspace guide, a project doc, or
  this skill) or a hook/check that fails on the mistake. Say where the text would live or which check
  would catch it, then propose it.
- One correction, applied once, is ordinary repair; it does not need a durable change.

## Long-running and managed processes

- Read stdout and stderr concurrently. Reading one stream to completion while the other fills its
  buffer deadlocks the process you are testing.
- Wait for an observed condition — a port accepting, a line appearing, a file existing — rather than
  sleeping and hoping.
- Clean up only what you started. Other processes, containers, and files on the machine may belong to
  someone else's work.
- A process that exists is not a process that works, and a closed process is not a failure.

## Report the result

End with what a reader needs to decide: what changed, which checks actually ran with their outcomes,
what remains unverified, what you would do next, and where the detail lives. Keep the outcome and the
caveat in the same place — a green summary with the caveat three paragraphs later is a false report.

Record durable decisions in the place that already owns them (a project guide, a spec, a check),
not in a new log.
