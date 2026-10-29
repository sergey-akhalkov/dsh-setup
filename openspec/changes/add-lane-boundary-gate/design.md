# Design

## Context

`@dsh-setup/plugin-delegation-rules` is a model-agnostic delegation engine: rules are data, the
Host evaluates six deterministic triggers at `agent/turn-stopping`, and only a matching record
satisfies a strict rule. The engine's model of progress is a single flat task list — the gate
selects `tasks.find((task) => !task.checked)` — and the apply skill loops "for each pending task".
`tasks.md` already carries the parallel structure: the propose-time task-lane addendum requires
top-level task groups whose headings name the paths they own.

The failure this change addresses is structural, not motivational. At propose time the model sees
the whole task list and cuts lanes; during apply nothing ever shows it the remaining work as lanes
again, so a lane boundary is invisible and serial work remains the cheapest satisfying move. The
one behavior that survived a 6.5-hour goal was the one a strict gate enforced, so the fix reuses
that mechanism rather than adding more prose.

## Goals and non-goals

Goals: make a lane boundary a decision point; keep fanning out cheaper than the serial default;
cost nothing when no lane boundary is reached; fail open on any artifact it cannot read.

Non-goals: a new fan-out contract or worker orchestration in the engine (a lane is already one
`subagent` call); automatic merge (workers report, the session merges); per-turn planning analysis;
any always-on prompt text; changing the review contracts.

## Decisions

### D1 — Same plugin, not a new one

The trigger is a code extension of the engine's closed vocabulary (`Trigger` union and the
`TRIGGERS` set), and the condition needs the session involvement file, the per-write tick
transitions, the worktree digest, and the only turn-stopping steer in the session. A second plugin
would have to duplicate or reach into all of that, and two independent gates could both hold the
turn with no single satisfying move. It ships in `@dsh-setup/plugin-delegation-rules`, so the setup
bundle needs no composition change.

### D2 — Fire at a lane boundary, not every turn

The trigger is evaluated at turn close, but it only reports when one of **this session's own
`tasks.md` writes checked off a task that completed its lane**, derived from that write's canonical
before/after pair. Mid-lane turns, unchanged turns, and turns without a write never fire, so a
change reaches at most a handful of boundaries. Taking the completion from the session's own write
pair (rather than from "a task this session ticked, and the lane is now complete") also means
another session's final tick can never gate this one, and a write that only deletes or relocates
the last unchecked task is not a completion. A per-turn rule was rejected: it fires on
every implementation turn, and a rule that must be answered constantly is answered ritually.

### D3 — The serial escape is the existing progress note

A lane-boundary turn can also close on a `task_progress` note whose task belongs to a remaining
lane and whose worktree digest still matches. That is the same record the `implementation-work` rule
already reads, so the change adds no tool, no record type, and no new storage. The note's reason
field is where the serial decision is recorded, which also makes the decay auditable after the fact.

### D4 — Lane shape and fail-open parsing

A lane is the tasks under the nearest preceding level-2 heading; a task before the first heading
belongs to an untitled lane. Owned paths are the backticked segments of the heading. Parsing fails
open by design: an unreadable `tasks.md`, a change with no headings, and a lane with no owned paths
all produce no trigger rather than a blocked turn. A completion also stops counting when the plan
changes against it — a lane reopened, a completion task removed, or a lane renamed — because the
evidence no longer describes the current plan. The per-change artifact hint that the engine already
reports for an unreadable plan is unaffected: it is soft, it names the change, and it neither
satisfies nor blocks this rule. A change that predates the lane convention keeps working exactly as
before.

### D5 — The serial tail is named, not positional

A lane whose heading contains `serial` (case-insensitive) is the integration tail and is never
counted as remaining parallel work, because generated output and the full repository gate cannot
run concurrently anyway. When no lane is named `serial`, every remaining lane counts; the escape
note covers a change whose tail is not labelled.

### D6 — The payload is one ready call per lane, isolated in a worktree

The steer prints, per remaining lane, the lane title, its owned paths, and a complete `subagent`
call whose prompt names the change, the lane heading, the worktree the worker must create for
itself, the owned paths, the prohibition on ticking `tasks.md`, and the report to return. A worker
that edits the parent checkout would race another lane on the working tree and would invalidate a
pending task review, so the prompt requires its own branch and worktree: the worker resolves the
repository root (`git rev-parse --show-toplevel`), creates a sibling worktree from it (`git worktree
add ../wt-<change>-<n> -b lane-<change>-<n>`), never a directory inside the checkout, and installs
there. The session merges each branch after its checks. A new worktree only contains commits, so the
steer also prints the checkpoint command (`git add -A :/; git add -f
":(top)openspec/changes/<change>"; git commit -m "lane checkpoint before fan-out"`) that makes the
current plan and worktree visible to every worker. The force-add is required because the engine
supports a change directory that matches a Git ignore rule, and both pathspecs are rooted (`:/` and
`:(top)`) because the session may run in a nested working directory. The paths are
repository-relative and no machine path is printed, because the child inherits the working
directory; the payload is rendered in the Host from the parsed `tasks.md`, so it needs no asset and
no extra package file.

### D7 — Worker evidence is per turn and deliberately broad

The engine records a successful `subagent`, `subagent_fork`, `spawn_teammate`, or `workflow` tool
result as "a parallel worker was started in this turn". The check is broad on purpose: it proves
parallel work happened, not that it covered the right lane. Narrowing it to a lane-bound call would
need argument parsing across four tools and would still be guessable evidence.

### D8 — No new always-on prompt surface

The rule is configuration, the record is the existing note, and the steer text exists only while
the rule fires. The `delegate` tool description and the system prompt are unchanged; the on-demand
skill body gains a documented paragraph inside its existing 24,000-byte budget.

## Flow

```text
this session's tasks.md write turns a lane
from unfinished to complete (canonical before/after)
        |
        v
another lane has unchecked tasks, not the serial tail? -- no --> nothing
        | yes
        v
worker started this turn, or a matching progress note
   in a remaining lane? -- yes --> satisfied
        | no
        v
strict steer: checkpoint commit + lane list + owned paths
             + one exact subagent call per lane
             + the task_progress call for a serial decision
```

## Risks and limits

- A worker started for unrelated work satisfies the rule. Accepted: the rule measures parallel
  work, and the alternative is a guess.
- Lanes that genuinely depend on each other are outside the model; the propose-time convention
  requires disjoint lanes, and the escape note covers a deviation.
- A `bug-fix` patch run is a parallel writer but is not counted as evidence; it is rare and the
  escape note covers it.
- A lane worker in its own worktree pays an install before it edits; that is the documented price of
  the isolation the parallel-writer convention requires, and it is paid in parallel.
- A strict rule lengthens the turn it fires in; the lane-boundary scoping is what keeps that rare.

## Testing

Unit tests for the lane parser (headings, owned paths, untitled prefix, no headings, CRLF, task
lookup by id). Configuration tests for the new trigger with the note contract and against rejected
shapes (a target, a review contract, an unknown trigger). Gate tests for: fan-out required at a
lane boundary; silence mid-lane; silence on a single-lane change; silence when the serial tail is
the only remaining lane; satisfaction by a worker start; satisfaction by the escape note; and
fail-open on an unreadable `tasks.md`.
