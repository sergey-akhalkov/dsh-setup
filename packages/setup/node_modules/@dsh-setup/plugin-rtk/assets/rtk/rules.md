# RTK shell output

Bulky shell output is a large token sink. When a `pwsh` command's output may be large — git
status/diff/log, test suites, build or lint logs, or a repo-wide search — run the supported command
through the installed `rtk` CLI instead of the native form (for example `rtk git diff`,
`rtk cargo test`, or `rtk rg "pattern" src`). Load the `rtk` skill for the command list, the
unsupported-command fallback, and how to recover full output.

Keep using the `read`, `grep`, and `glob` tools for file inspection; do not route them through
`rtk`. If `rtk` is missing or a subcommand is unsupported, run the native command and keep its
errors. Never prefix PowerShell-only commands or double-prefix.

Say "stop rtk routing" to suspend this rule for the rest of the session; it does not suspend the
other always-on guidance.
