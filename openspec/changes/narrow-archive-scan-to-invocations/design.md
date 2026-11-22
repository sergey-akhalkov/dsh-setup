# Design

## Context

See [proposal.md](proposal.md) for the motivation. The behavior lives in
`@dsh-setup/plugin-workflows`, in the pre-execute archive gate of `src/host/index.ts` and the
strict parser helpers in `src/host/command-parse.ts`.

The gate first calls `parseArchiveCommand(command, workspace, workdir)` (`index.ts:4863-4867`).
When it returns `undefined`, the gate calls `rawArchiveAction(command)` and refuses any mention
(`index.ts:4868-4882`). `rawArchiveAction` (`index.ts:462-497`) lowercases and joins the whole
command and matches `/\bopenspec\b[\s\S]*\barchive\b/u` (`index.ts:494`) across it, including
quoted arguments and message prose; it also refuses a move verb combined with an
archive-shaped path token (`index.ts:484-493`).

`parseArchiveCommand` is right to return `undefined` for `git commit` and `openspec validate`: it
only recognizes `openspec archive <name>` and the `mv`/`git mv`/`Move-Item` forms
(`command-parse.ts:415-449`). The bug is that the fall-back scan has no notion of a data
argument, so a `-m` value and an `openspec validate <name>` argument that mention both words are
refused. The 2026-11-12 change-card-actions design chose that over-refusal deliberately as the
price of a fixed-size textual rule; issue #9 shows the price is not acceptable for ordinary
commit messages, and the change-name collision (`narrow-archive-scan-to-invocations`) shows it
also blocks ordinary OpenSpec commands.

## Goals / Non-Goals

**Goals:**

- Let an ordinary `git commit` whose `-m`/`--message`/`--body` value mentions `openspec` and
  `archive` run.
- Let a readable non-archive OpenSpec command whose argument contains `archive` run, including
  `openspec validate <change-with-archive-in-name>` and `openspec instructions archive`.
- Keep every real archive invocation, documented move, quoted/flagged archive subcommand, and
  unreadable compound archive invocation or move refused exactly as today.
- Keep the check textual and fail-closed, with no new dependency or shell interpreter.

**Non-Goals:**

- A general executable/argument classifier for shell commands.
- Exempting arbitrary quoted arguments (only message/body option values are data; only an exact
  known non-archive OpenSpec subcommand short-circuits).
- Changing the archive evidence rules, the host attestation model, the refusal text, the strict
  parser, or the client.
- Parsing shell-dialect escapes, doubled quotes, or here-strings.

## Decisions

**D1 — Mask message/body values only for a verified program and subcommand pair, on the fall-back
path.** The strict parser keeps the unmasked command and stays authoritative for the documented
forms; the mask is applied as `rawArchiveAction(maskMessageArguments(command))` only where the
parser already declined the command. This leaves the successful archive path and every evidence
check untouched.

The mask applies only when the command is one simple command whose executable, after an optional
`rtk` or `pnpm exec` prefix, begins exactly one verified pair: `git commit` with `-m`/`--message`,
or `gh pr create` with `--body`. The executable and its immediate subcommand token must match with
no global option between them. Every other command — another subcommand, a `-c`/`--config-env`
prefix, another program, a shell, `bash -c`, `pwsh -Command`, `iex`, `eval`, or any wrapper — is
not masked and keeps the original textual scan. Git can run a shell alias from an arbitrary
subcommand (`git -c alias.review='!bash -c' review -m ...`), and a shell can assign a positional
argument to `$0`/`$1`; the verified pairs cannot, because `commit` and `pr create` treat those
values as message text.

The mask is one pass. Outside quoted regions it recognizes `-m`, `--message`, or `--body`
(case-insensitive) followed by an optional `=` for the long forms and a quoted value, and replaces
the value's characters with spaces. A single-quoted value is masked: it is literal in both shells.
A double-quoted value is masked only when it contains no backslash, no `$(`, and no backtick and
its closing quote is the first following quote. An unquoted, unterminated, here-string, escaped, or
otherwise uncertain value masks nothing in the whole command: the function returns the original
unmasked command instead of resuming from a guessed quote boundary. An exception never escapes; an
unreadable input keeps today's result.

Safety argument:

- Masking is scoped to `git commit`/`-m`/`--message` and `gh pr create`/`--body`. A wrapper, an
  unknown program, another subcommand, or a git alias prefix is never masked, so
  `bash -c 'eval "$1"' --message "openspec archive auth"` and
  `git -c alias.review='!bash -c' review -m 'openspec archive auth'` keep their original text and
  are refused.
- A double-quoted value with a backslash, `$(`, or a backtick is not masked, and an uncertain quote
  boundary abandons the mask for the whole command, so an escaped quote can no longer be mistaken
  for the value end and the following substitution stays visible to the scan.
- A single-quoted value is literal in both shells, so masking it cannot hide executed text.
- The option is recognized only outside quotes, so a `-m` inside prose cannot start a mask that
  crosses into real code (for example `echo "a -m " ; openspec archive auth`).

**D2 — Skip the scan for a readable non-archive OpenSpec command, with every evaluation form
rejected.** Add `isNonArchiveOpenSpecCommand(command)` to `command-parse.ts`. It returns true only
when the command trims to one simple command, after an optional `rtk`/`pnpm exec` prefix the
executable word is `openspec` (case-insensitive), and the next token — after the existing
`tokenize` strips quotes — is one of the known non-archive OpenSpec 1.15.0 subcommands (the
top-level command surface without `archive`: `new`, `validate`, `status`, `show`, `list`,
`instructions`, `context`, `view`, `schemas`, `templates`, `doctor`, `change`, `spec`, `config`,
`schema`, `store`, `workset`, `init`, `update`, `install`, `feedback`, `completion`, `help`,
`version`). The predicate rejects anything the existing `isCompound` finds compound and, beyond it,
any `(`, `)`, backtick, or `&`, because `isCompound` does not reject parentheses: PowerShell
evaluates `openspec validate (openspec archive auth)` as a parenthesized subexpression before the
call, so a predicate that accepted it would skip the scan for an executed archive. The gate checks
the predicate after `parseArchiveCommand` returns `undefined`; true skips the raw scan.

Why the guards are all needed:

- A simple command with no separator, redirection, substitution, escape, or parenthesized
  subexpression runs exactly one program, so an `openspec <non-archive-subcommand>` command cannot
  archive.
- A quoted or option-prefixed `archive`, an unknown subcommand, a compound command, a wrapper, a
  parenthesized subexpression, or any shell control fails the predicate and keeps the existing
  textual scan. That preserves every existing bypass test (`"openspec" archive auth`,
  `openspec --store team archive auth`, `openspec $(...)`,
  `openspec validate (openspec archive auth)`, `cd x; openspec archive y`, and the `bash`/`iex`
  wrappers).

**D3 — Keep the deliberate false positive everywhere else.** A quoted or commented mention
outside a message/body value (for example `Write-Output "openspec archive auth"`) stays refused,
as does an `openspec` command that is redirected, piped, wrapped, or not on the allowlist. This
change narrows the prior rule only where the reported harm is; the docs and the delta spec say so.

Alternatives rejected:

- **Classify the executable and its semantic arguments with a shell parser.** The 2026-11-12
  design rejected a purpose-written parser after six review rounds; evaluation wrappers are
  open-ended (`bash -c`, `sh -c`, `pwsh -Command`, `powershell -Command`, `iex`,
  `Invoke-Expression`, `eval`, `exec`, `&`, `Start-Process`, `xargs`, ...) and missing one opens
  an evasion.
- **Mask every quoted argument.** A quoted string can be executable text
  (`bash -c "openspec archive auth"`, `iex 'openspec archive auth'`,
  `& "openspec" archive auth`, `git commit -m "$(openspec archive auth)"`); safety would require
  enumerating every wrapper, the same arms race the prior design rejected.
- **Allowlist the `git commit` program.** Fixes one program; the issue also names `--message` and
  `--body`, and the option name is the actual data boundary.
- **Drop the fall-back for non-compound commands.** Would allow `open\spec archive auth`,
  `iex 'openspec archive auth'`, and other readable-but-unparsed invocations; the change keeps
  the fail-closed scan.
- **Match `archive` only as the word after `openspec` without the simple-command gate.** The
  current scan catches a quoted or escaped executable and a flagged subcommand because it scans
  the whole text; a next-word-only rule would allow `openspec --store team archive auth` if the
  CLI ever accepts options before the subcommand. D2 requires a simple command and an exact known
  subcommand, and fails closed otherwise.
- **Fix only message values and leave `openspec validate <name>` refused.** The change's own name
  and validation command hit the second false positive, so the plan could not be verified; the
  issue's expected behavior ("inspect commands that could archive or move a change") covers it.
- **Regex-only masking or a regex subcommand rule.** No quote awareness means an `-m` inside
  prose or an `openspec` in an argument can start a match that crosses real code; the scanner and
  the predicate must know their position.
- **Dialect-aware escape, doubled-quote, and here-string parsing.** More code and a dialect guess
  (`terminal_send` has none). These shapes stay on the fail-closed path as a documented limit.

## Risks / Trade-offs

- [Residual false positives] An escaped, doubled-quote, substituted, backticked, unquoted, or
  here-string message value abandons the mask for the whole command, so the command is refused even
  when the value is prose. A redirected, piped, wrapped, unknown-program, or parenthesized OpenSpec
  command also stays refused. Both are the accepted fail-closed direction; a user report can widen
  a rule later.
- [Verified-pair mask] `-m`/`--message`/`--body` values are masked only for `git commit` and
  `gh pr create` after an optional `rtk`/`pnpm exec` prefix. A new subcommand or program whose
  option value is prose data needs the allowlist reviewed; until then its value stays refused
  (safe, visible false positive).
- [Subcommand allowlist] The R2 set is a snapshot of OpenSpec 1.15.0. A future non-archive command
  stays refused (safe), but a future archiving command under an already-allowed group would need
  the list re-checked; the existing bypass tests pin the known archive forms.
- [Test surface] The gate is host-level; the existing fake host in
  `test/host-wiring.test.ts` drives `tools/pre-execute` with `pwsh` and `bash` commands, and the
  predicate has unit coverage in `test/command-parse.test.ts`.

## Migration Plan

- Source change only; no data migration. Existing runs, records, approvals, and receipts stay
  valid.
- Rebuild generated output (`pnpm build`, `pnpm gen`) and commit it with the source.
- The live desktop profile keeps its behavior until a release is installed; no agent session
  installs into it. Release through the repository process (version bump, build, full gate, tag,
  push).
- Rollback is a version downgrade; no persisted state is rewritten.

## Test Plan

- `packages/plugin-workflows/test/host-wiring.test.ts`:
  - allow `git commit -m "openspec/changes/auth: the archive gate reads"` and
    `gh pr create --body "openspec changes: the archive gate reads"`;
  - allow `--message`, `--message=`, and `--body` values and two `-m` values;
  - allow a message value containing prose separators (`;`, `&&`, `>`, newline);
  - allow `openspec validate narrow-archive-scan-to-invocations --strict`,
    `openspec status --change <name>`, and `openspec instructions archive --change <name>`;
  - refuse `git commit -m "..." ; openspec archive auth` and a message followed by a real move;
  - refuse `git commit -m "$(openspec archive auth)"` and a bash double-quoted backtick body;
  - refuse `git commit -m "a \" -m '$(openspec archive auth)' \" b"`: the escaped quote
    abandons the mask and the substitution is still scanned;
  - refuse a message option on a non-allowlisted program, for example
    `bash -c 'eval "$1"' --message "openspec archive auth"`, and an unknown program's `-m` value
    naming both words;
  - refuse `git -c alias.review='!bash -c' review -m 'openspec archive auth'` and an option on a
    non-verified subcommand such as `git log -m "openspec archive auth"`; no mask is produced;
  - refuse `openspec validate (openspec archive auth)`, `openspec "archive" auth`, and
    `openspec --store team archive auth`;
  - keep the existing separator, move, quoted/comment, and benign-compound suites unchanged.
- `packages/plugin-workflows/test/command-parse.test.ts`: unit cases for
  `isNonArchiveOpenSpecCommand`, including a quoted subcommand, an option before the subcommand,
  an unknown subcommand, an `rtk`/`pnpm exec` prefix, a compound command, a substitution,
  parentheses, `@(...)`, and a wrapper such as `bash -c 'openspec validate auth'`;
  `parseArchiveCommand` stays green unchanged.
- `docs/workflows.md` matches the tested behavior; `pnpm lint` covers the edited markdown.
- Gate: `pnpm build` with no generated diff, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`,
  `pnpm test`, `pnpm validate:repo`, and `openspec validate <change> --strict`.
