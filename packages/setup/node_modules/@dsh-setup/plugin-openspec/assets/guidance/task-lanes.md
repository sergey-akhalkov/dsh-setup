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
  each independent lane to a worker or record its serial decision (a heading containing `serial` or
  the task's `task_progress` note); no new tool or state.
- Within one lane the sequential loop still runs. For two or more independent lanes, start parallel
  writers in separate git worktrees with their task ids and owned paths, merge each after its checks
  and any configured task review, then run the serial lane.
