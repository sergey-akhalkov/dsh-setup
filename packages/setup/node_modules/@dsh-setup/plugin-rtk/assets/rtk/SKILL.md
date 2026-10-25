---
name: rtk
description: >
  Use before running a shell command whose output may be bulky: git status/diff/log, test suites, build
  or lint logs, or a repo-wide search. Routes supported commands through the installed rtk CLI and keeps
  errors and exit codes.
---

# RTK token-saving shell workflow

rtk is a local CLI proxy. It runs the real command and prints a compact version of its output. Exit
codes and stderr remain meaningful; do not hide a failure to save tokens.

## Supported commands

Use the `rtk` form in the `pwsh` tool for commands whose output may be bulky:

| Need | Try |
| --- | --- |
| Git inspection | `rtk git status`, `rtk git diff`, `rtk git log -n 20` |
| Git changes | `rtk git add`, `rtk git commit`, `rtk git push` |
| JavaScript/TypeScript tests | `rtk pnpm test`, `rtk npm test`, `rtk vitest`, `rtk jest` |
| Other test runners | `rtk cargo test`, `rtk pytest -q`, `rtk go test`, `rtk dotnet test`, `rtk playwright` |
| Build and lint | `rtk tsc`, `rtk lint`, `rtk ruff check`, `rtk prettier`, `rtk mypy`, `rtk go build` |
| Search | `rtk grep ...`, `rtk rg ...`, `rtk find ...`, `rtk fd ...` |
| Infrastructure | `rtk docker ps`, `rtk kubectl get pods`, `rtk aws ...`, `rtk psql ...` |
| Files from the shell | `rtk read <file>`, `rtk ls`, `rtk tree` |

The installed CLI is the authority. Run `rtk --help` or `rtk <command> --help` before relying on a
subcommand this table does not name; if the command is not supported, run the native command.

## Rules

- One supported command per call. Do not mix it with PowerShell-only statements.
- Do not prefix commands that are not in rtk's list (for example `Get-ChildItem` or `Select-String`).
- Do not prefix the `read`, `grep`, or `glob` tools; they do not pass through the shell.
- Do not double-prefix. If the command already starts with `rtk`, leave it.
- Keep errors and non-zero exits visible. rtk preserves them; a compact result is not a reason to
  drop the failure.
- If the output is small, the native command is fine; do not add a process for a one-line result.
- Do not run a mutating command a second time only to see more output.

## Recovery and fallback

- If compact output is insufficient to diagnose a failure, use `rtk proxy <command>` for a raw,
  tracked run. Do not use `rtk run` on Windows: it goes through `sh -c`.
- If `rtk` is missing from PATH, skip this workflow and run the native command. Tell the user the
  prerequisite is missing instead of retrying.
- If a command is unsupported or a filter drops information you need, run the native form. Do not
  invent an rtk subcommand.

## Security

- Do not run `rtk trust` in a repository you do not trust. Project-local filters are code.
- Do not put secrets, credentials, private paths, or session data into examples or command lines.
- rtk telemetry is off by default. Do not enable it as part of this workflow.

## Verify

- `rtk --version` is the version authority. This text was checked on 2026-10-26 and intentionally
  does not assert a version as current.
- `rtk gain --history` shows recent command savings. Under a confined DSH sandbox rtk may be unable
  to write its statistics; the filtering still works, so use the DSH token meter for the
  authoritative measurement.
