## 1. Owner state

- [x] 1.1 Record the first-observing thread per active change under `.dsh/delegation` atomically, read it in the gate and status, and keep it across engine restarts; verify the two-thread unit test and the status output.
- [x] 1.2 Add the owning thread to the review record shape and its parsing/formatting; verify existing records without the field stay readable or are reported stale, and the record carries the owner for new runs.

## 2. Thread-scoped triggers

- [x] 2.1 Evaluate `spec-ready`, `spec-task-ready`, `implementation-work`, `implementation-complete`, and the integration review only in the change's owning thread; verify the two-thread gate tests produce a steer in the owner and none in the foreign thread.
- [x] 2.2 Refuse a review `delegate` for a foreign change before starting a target, with the owner and next action; verify the unit test, the docs, and the unchanged `task_progress`/answer/patch behavior.
- [x] 2.3 Report each change's owner and whether it is the current thread in `delegation_status`; verify the status test.

## 3. Verification and docs

- [x] 3.1 Update `docs/delegation-rules.md` with thread-scoped triggers, the owner, the refusal, and the owner-state reset escape hatch; verify no machine paths or secrets.
- [ ] 3.2 Live two-thread acceptance: create/continue the change in thread A, confirm the spec and task reviews run only there, thread B is not steered and its review delegate is refused, and the owner survives an app restart.
- [ ] 3.3 Build, gen, validate:repo, and the focused test suites stay green; archive the change and push.
