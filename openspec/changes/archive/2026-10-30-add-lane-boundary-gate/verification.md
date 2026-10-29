# Verification

Acceptance evidence for `add-lane-boundary-gate`, recorded at commit `a58c1a2` (the implementation
commit; the `tasks.md` ticks and the `reviews/` approvals are uncommitted at review time).

## Repository gate

| Command                   | Exit | Output                                                                                     |
| ------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `pnpm build`              | 0    | `build: 15 workspace package(s), DSH 0.2.1-rc.3`                                            |
| `pnpm check`              | 0    | `Test Files 63 passed (63)`, `Tests 900 passed (900)`                                       |
| `pnpm gen:check`          | 0    | `gen:check: 270 generated files match (15 plugin(s))`                                       |
| `pnpm validate:repo`      | 0    | `584 file(s) scanned, 15 plugin package(s), AGENTS.md 14097 bytes (budget 16000), no problems` |
| `pnpm validate:composition` | 0  | `validate-composition: setup bundle composes on DSH 0.2.1-rc.3`                             |
| `git diff --exit-code`    | 0    | empty diff after the implementation commit                                                  |

## Generated output

- `packages/plugin-delegation-rules/cordis.patch.yml` carries the `lane-fanout` row with
  `when: lane-boundary`.
- `packages/setup/cordis.patch.yml` carries the same row.
- `packages/setup/node_modules/@dsh-setup/plugin-delegation-rules/**` vendors the updated fragment,
  asset, and `lib/**`, including the `lane-boundary` branch.

## Focused tests

- `pnpm exec vitest run packages/plugin-delegation-rules/test` — 6 files, all passing.
- `approval.test.ts` covers lane parsing (headings, owned paths, untitled prefix, no headings, CRLF,
  no-backtick heading, task-id lookup across lanes).
- `config.test.ts` covers the `lane-fanout` default row and the rejection of a `review` contract for
  `lane-boundary`.
- `gate.test.ts` covers fan-out required, worker started, failed worker start, worker from a previous
  turn, the serial escape note, mid-lane tick, single-lane and unlaned plans, serial-tail remainder,
  renamed completed lane, lane completed by another session, reopened lane, removed completion task,
  deleted last unchecked task, mixed owned/unowned remainder, unreadable `tasks.md`, and the payload
  (checkpoint command, worktree instruction, `Do not tick tasks.md`, no machine path).

## Known limits

- The rule is not active in the session that implemented it: the running profile still carries the
  installed defaults, which do not include `lane-fanout`. The rule reaches a machine after the next
  release and install.
- The `pnpm check` suite failed once on `packages/plugin-hindsight/test/export-push.test.ts` during
  an early run and passed on retry and in the final full run; it is unrelated to this change and
  looks load-sensitive.
