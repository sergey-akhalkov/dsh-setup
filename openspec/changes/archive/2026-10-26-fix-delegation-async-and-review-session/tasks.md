## 1. Async review runs

- [x] 1.1 Make review `delegate` start the target and return a run id/record path without blocking; keep answer/patch synchronous; verify a background run writes its record and the turn continues.
- [x] 1.2 Track running/completed/failed/discarded runs and report them in `delegation_status`; verify the status, duplicate-pending (rule+change+task identity), two-different-rules-same-task, and superseded-completion paths.
- [x] 1.3 Accept an explicit `task` for task-scoped reviews, validate it against the checked tasks, and prevent parallel task reviews from collapsing onto the next task; verify the unit tests.
- [x] 1.4 Bind each background verdict to immutable reviewed inputs (snapshot or equivalent mutation tracking; not a digest re-check); verify a delayed run with an edited-read-restored file publishes no PASS.

## 2. Codex review thread reuse

- [x] 2.1 Persist a Codex thread id per review key and resume it for later reviews of the same change/task; keep different keys isolated and serialize one run per key; verify the unit tests and the spawn wiring.
- [x] 2.2 Keep the resume confined to the run's cwd/sandbox/Serena restrictions and clean the persisted state with the delegation state; verify the config/profile stays untouched.

## 3. Verification and docs

- [x] 3.1 Update `docs/delegation-rules.md` and `docs/codex-subagent.md` with the async tool contract, run ids/status, explicit task selection, stable inputs, and thread reuse; verify no machine paths or secrets.
- [x] 3.2 Build, gen, validate:repo, and the focused suites stay green.
- [ ] 3.3 Live: three finished tasks reviewed as three concurrent async runs; a repeated review of one task continues the same Codex thread; check the results and thread continuity.
- [ ] 3.4 Archive the change and push.
