# Tasks

## 1. Planning

- [x] 1.1 Add the proposal, design, delta spec, and tasks for the foreign-change and per-change digest split.

## 2. Gate implementation

- [x] 2.1 Scope the turn-start baseline and the turn-end snapshot to owned changes and add a regression test that a foreign change with no `tasks.md` cannot steer or set a digest error.
- [x] 2.2 Keep per-change artifact errors out of the worktree digest, emit a per-change hint naming the change and owner, and update the docs; add the owned missing-`tasks.md` regression test.

## 3. Verification

- [ ] 3.1 Build, generate, run the full gate, and commit the generated `lib/` and vendored plugin copy.
