# RTK shell output

Before every `pwsh` call, check the first command word. These commands MUST go through `rtk`:
`git ...` -> `rtk git ...`; `pnpm exec vitest` or `vitest` -> `rtk vitest`; `pnpm exec tsc` or
`tsc` -> `rtk tsc`; `pnpm test|build|lint` -> `rtk pnpm ...`; `cargo test` or `pytest` -> `rtk ...`.
Tests and build logs are the biggest wins; do not skip routine commands.

Prefix each supported part of a compound command (`rtk git status; rtk git diff`). Never prefix
PowerShell-only commands (`Get-*`, `Select-*`), `openspec`, `node`, `codex`, or unsupported
commands; run native and keep errors (also when rtk is missing). Never double-prefix.
Use `read`, `grep`, and `glob` for file inspection, not rtk.

This applies to subagents too. rtk keeps errors and exit codes; do not avoid it for full output.
Say "stop rtk routing" to suspend this rule; other guidance stays.
