---

## Task lanes (dsh-setup guidance)

This section is added by `@dsh-setup/plugin-openspec`; it is not part of the pinned upstream
OpenSpec skill.

- A lane is a top-level `##` task group whose tasks own disjoint paths and whose result no other
  group needs, except the serial integration tail.
- When writing or revising `tasks.md`, cut lanes first. Name each lane's owned paths in its heading;
  or state in one line why the change is a single lane: one work constraint, meaning a shared hot
  file, generated output, or a serial gate. A task-review or archive process is not a work
  constraint and is never a single-lane reason. Typical: 2-4 lanes, 2-6 substantive tasks each.
  More lanes cost more handoff and merge than they save.
- Keep shared files, generated output, and the full repository gate in the serial tail.
- A lane does not edit the change's spec artifacts or another lane's tasks.
- When applying, before the first implementation task, read the level-2 headings once and assign
  each independent lane to a worker or record its serial decision (a heading containing `serial`, or
  a `workflows` `note` action naming a task in the lane with the reason); no new tool or state.
- Within one lane the sequential loop still runs. For two or more independent lanes, start parallel
  writers in separate git worktrees with their task ids and owned paths, merge each after its checks
  and any configured task review, then run the serial lane.
- When any task of a lane is checked, start that lane's review at once with `workflows(action:
  "start", definitionId: "task-review", change: "<change>", section: "<section key>")` (or `task:
  "<taskId>"` when the task is outside a section). Start every due lane in the same pass; no lane
  waits for another's verdict.
- While a review runs on a frozen snapshot, keep implementing another independent lane that does
  not depend on its verdict. When the run reports that it fell back to the live worktree, a write
  can discard its verdict: restore snapshot support and re-run, or defer writes until the run
  settles. Never wait with a blocking sleep.
- Treat the waiting close as the pause for a verdict: it ends the turn while every due review is
  live, the next turn resumes the loop on the same lane unit, and no write in the reviewed scope
  happens meanwhile. The waiting close approves nothing and submits no message: it ends the turn for
  the verdict and wakes nothing, and a user stop is never resumed by gate input; collect the record
  before ticking coverage or archive.
