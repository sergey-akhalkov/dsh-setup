# Task approvals

Each `<taskId>.json` is a portable task-review `PASS`, written by the workflows engine when a unit's
review passes. `taskId` is the first 16 hex characters of the SHA-256 of the task text in `tasks.md`
with its whitespace normalized, so rewording a task retires its record and the task is reviewed again.

`100bb769671256c0.json` belongs to an earlier wording of task 1.1 and is superseded by
`c79105fad16bf057.json`; it is kept only as history and is not counted by `pnpm reviews:check`.
