# CLI and installer reference

Use this when the interface is a command, a flag, an installer, or a prompt. The body's first-time
test and five costs still apply; this file is the detail.

## Four surfaces

1. Shape — how the command is named, how it splits into subcommands, and which inputs are flags,
   positional arguments, or defaults.
2. Dialogue — help, error and suggestion text, prompts, confirmations, and the next command printed
   after success.
3. Streams — what goes to stdout and stderr, what an exit code means, how a terminal changes the
   output, and which machine-readable modes exist.
4. Guardrails — destructive actions, dry runs, idempotence, configuration precedence, and
   deprecation.

A broad review covers all four; a narrow one still checks the knock-on effects.

## Command shape

- Use a parsing library; it gives help, validation, completion, and spelling suggestions.
- Verbs for subcommands: `init`, `list`, `show`, `create`, `delete`, `sync`, `login`. One verb per
  action, the same verb across objects.
- Prefer standard flag names: `--help`, `--version`, `--verbose`, `--quiet`, `--output`, `--format`,
  `--json`, `--force`, `--dry-run`, `--config`.
- Long form for every flag; short forms only for the common ones.
- Flags for optional, ambiguous, or growing values; positional arguments for the required primary
  nouns where order is obvious (`cp <source> <destination>`).
- No catch-all subcommand or silent abbreviation of subcommand names.
- Keep released names additive; a new flag is cheaper than a changed one.

## Help and discovery

- `-h` and `--help` on every command and subcommand; `help <subcommand>` for a multitool.
- No-argument behavior: concise help with purpose, usage, common flags, one or two examples, and a
  pointer to `--help`; not a bare error.
- Examples first, and examples that mirror real tasks.
- After success, print the next useful command.

## I/O contract

- Primary output and machine-readable output go to stdout; errors, warnings, progress, logs, and
  prompts go to stderr.
- Success exits 0; failure exits non-zero. Map distinct codes only when a caller can act on them.
- Detect a TTY: human formatting on a terminal, no decoration when piped; respect `NO_COLOR`.
- Offer `--json` for structured data and `--plain` for line-oriented output; keep their schemas
  stable.
- If input is missing and stdin is not interactive, fail with the exact flag or value to pass.

## Errors

A useful error has four jobs: name the failure, explain the cause, offer the next move, and give the
exact command or flag to run.

```text
Error: could not find app "billing-api" in project "prod".

Run `tool apps list --project prod` to see available apps.
```

A stack trace alone is not an error message. Never repair state-changing input behind the user's
back: offer the safe correction, and require an explicit flag when the change would mutate state.

## Interactivity and safety

- Prompt only when stdin is interactive; a script gets an error that names the flag.
- Every prompt has a non-interactive equivalent flag, config key, or environment variable.
- No prompt before the main work; ask only in the phase that needs the value.
- Dry run for broad or remote changes; show what will change before applying it.
- Match friction to blast radius: a small local edit may ask once; a wide or remote change gets a
  plan and a dry run; an irreversible one requires naming the target or an explicit
  `--confirm <name>`.
- Make it idempotent and crash-only: rerunning completes or skips; no cleanup required after a
  failure.
- Back up before writing user-owned state; keep the old entry points working.

## Installer specifics

- The documented common case is one command with no flags.
- The advanced path is one line too; a four-line download-and-run ceremony is a design bug.
- `-DryRun` prints the plan, changes nothing, and never prompts.
- A ready component is skipped with no prompt and no write.
- Best-effort phases warn, skip, and exit 0; a phase that started and failed exits non-zero and
  says what state the machine is in.
- No bare `exit` under `| iex`; no killing the caller's shell.
- Keep the old URL and option names working through a forwarder.

## Review checklist

- [ ] The common case is one command with no flags.
- [ ] `-h`/`--help`, no-argument help, and examples exist.
- [ ] stdout/stderr and exit codes follow the contract.
- [ ] Prompts are TTY-only and have flag equivalents.
- [ ] Destructive actions have proportional friction and a dry run.
- [ ] Rerunning is safe; the old entry points still work.
- [ ] Errors name the cause and the next command.
