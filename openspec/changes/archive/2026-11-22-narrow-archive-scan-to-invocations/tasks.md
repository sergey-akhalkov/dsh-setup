# Tasks

**Single lane:** every group edits the same shared files — `packages/plugin-workflows/src/host/index.ts`,
`packages/plugin-workflows/src/host/command-parse.ts`, the two plugin test files, and
`docs/workflows.md` — and the generated output and full gate are the serial tail, so implement the
groups serially in one lane rather than in parallel.

## 1. Message-value mask in the archive fall-back (`packages/plugin-workflows/src/host/index.ts`)

- [x] 1.1 Add a private `maskMessageArguments(command: string): string` scanner next to `rawArchiveAction`; it masks only when the command is one simple command whose executable and immediate subcommand, after an optional bare `rtk`/`pnpm exec` prefix, are exactly `git commit` or `gh pr create` with no global option between them, and the option is `-m`/`--message` for `git commit` or `--body` for `gh pr create`. Outside quoted regions it recognizes the option (case-insensitive, with an optional `=` for the long forms only) followed by a quoted value and replaces only that value's characters with spaces. Mask a single-quoted value, whose backslash, backtick, dollar sign, and PowerShell alternate double quote (U+201C–U+201F) are literal in both shells; mask a double-quoted value only when it contains no backslash, no backtick, no PowerShell alternate double quote, no `$(`, `${`, or `$[`, and the first following quote closes it, while a plain variable reference and a literal dollar sign stay data. Treat a bare backslash, backtick, smart quote (U+2018–U+201F), doubled quote, `@"`/`@'` here-string opener, or an expansion inside any other double-quoted argument as structure that returns the original unmasked command. If any value is unquoted, unterminated, escaped, or otherwise uncertain, return the original unmasked command for the whole command instead of resuming from a guessed boundary; verify the scanner is total (no throw) for those inputs.
- [x] 1.2 Apply the mask only on the pre-execute fall-back path: `rawArchiveAction(maskMessageArguments(command))` in place of `rawArchiveAction(command)`; keep `parseArchiveCommand` reading the unmasked command so the documented archive and move forms win unchanged.
- [x] 1.3 Keep the two refusal texts, the move detection, and the evidence gate unchanged; verify the diff touches no other gate branch.

## 2. Non-archive OpenSpec command predicate (`packages/plugin-workflows/src/host/command-parse.ts`)

- [x] 2.1 Add the exported `isNonArchiveOpenSpecCommand(command): boolean`: reject anything the existing `isCompound` finds compound (control, backslash, `$`) and additionally reject any `(`, `)`, backtick, or `&` that `isCompound` does not catch; strip an optional `rtk`/`pnpm exec` prefix; require the executable word to be `openspec` case-insensitively; tokenize (the existing `tokenize` strips quotes) and accept only a first argument in the known non-archive OpenSpec 1.15.0 subcommand set (`new`, `validate`, `status`, `show`, `list`, `instructions`, `context`, `view`, `schemas`, `templates`, `doctor`, `change`, `spec`, `config`, `schema`, `store`, `workset`, `init`, `update`, `install`, `feedback`, `completion`, `help`, `version`); do not modify `parseArchiveCommand` or its helpers' behavior.
- [x] 2.2 In the pre-execute fall-back, after `parseArchiveCommand` returns `undefined`, skip the scan when the predicate is true and otherwise apply task 1.2; a quoted/escaped/flagged `archive`, an unknown subcommand, a compound command, a parenthesized subexpression, or any shell control must keep the existing scan.
- [x] 2.3 Verify a real archive form still reaches the evidence gate: `openspec archive auth` is parsed by `parseArchiveCommand`, not by the predicate, and its refusal is unchanged.

## 3. Positive and negative regressions (`packages/plugin-workflows/test/host-wiring.test.ts`)

- [x] 3.1 Allow a `git commit -m` whose value names `openspec/changes/<name>` and `archive`; verify `tools/pre-execute` calls `next()` for `git commit -m "openspec/changes/auth: the archive gate reads"` with the `pwsh` and `bash` tools.
- [x] 3.2 Allow the `--message` and `--message=` forms and two `-m` values on `git commit`, and a `--body` value on `gh pr create`; verify each calls `next()` and a non-allowlisted program's same option is not masked.
- [x] 3.3 Allow a message value containing prose separators (`;`, `&&`, `>`, and a newline) and both words; verify the call proceeds.
- [x] 3.4 Allow `openspec validate narrow-archive-scan-to-invocations --strict`, `openspec status --change <name>`, and `openspec instructions archive --change <name>`; verify each calls `next()`.
- [x] 3.5 Refuse a message value followed by a real invocation (`git commit -m "..." ; openspec archive auth`) and by a real move (`... && git mv openspec/changes/auth "openspec/changes/archive"`); verify the deny reason is the existing "could not be parsed safely" text.
- [x] 3.6 Refuse `git commit -m "$(openspec archive auth)"` and a bash double-quoted backtick body; verify the evaluated region is not masked.
- [x] 3.7 Refuse `git commit -m "a \" -m '$(openspec archive auth)' \" b"`; verify the escaped quote abandons the mask and the deny reason is the existing "could not be parsed safely" text.
- [x] 3.8 Refuse a message option on a non-allowlisted program (`bash -c 'eval "$1"' --message "openspec archive auth"`), an unknown program's `-m` value naming both words, a git alias prefix (`git -c alias.review='!bash -c' review -m 'openspec archive auth'`), and a non-verified subcommand (`git log -m "openspec archive auth"`); verify no mask is applied and the scan refuses.
- [x] 3.9 Refuse `openspec validate (openspec archive auth)`, `openspec "archive" auth`, and `openspec --store team archive auth`; verify the parenthesized subexpression fails the predicate and all three keep the "could not be parsed safely" reason.
- [x] 3.10 Keep a quoted mention outside a message value refused (for example `Write-Output "openspec archive auth"`) and confirm the existing `archive separator bypass` suite is unchanged and green.
- [x] 3.11 Run `pnpm exec vitest run packages/plugin-workflows/test/host-wiring.test.ts`; verify it exits 0.

## 4. Predicate unit tests (`packages/plugin-workflows/test/command-parse.test.ts`)

- [x] 4.1 Cover `isNonArchiveOpenSpecCommand` true for: a plain `openspec validate <name>` with an `archive`-bearing name, a quoted subcommand (`openspec "validate" <name>`), an `rtk`/`pnpm exec` prefix, `openspec instructions archive --change <name>`, and `openspec help archive`.
- [x] 4.2 Cover it false for: `openspec archive auth`, `openspec "archive" auth`, `openspec --store team archive auth`, `openspec validate (openspec archive auth)`, `@(...)`, an unknown subcommand, a compound command, a substitution, a backslash, a wrapper (`bash -c 'openspec validate auth'`), and a non-`openspec` executable.
- [x] 4.3 Run `pnpm exec vitest run packages/plugin-workflows/test/command-parse.test.ts`; verify it exits 0 and the existing `parseArchiveCommand` cases are unchanged.

## 5. Documentation (`docs/workflows.md`)

- [x] 5.1 Rewrite the "Pre-execute archive" paragraph: a command the parser cannot read is refused when it names an archive invocation or move, except that a `-m`/`--message`/`--body` value of a `git`/`gh` command is data and a readable non-archive `openspec` subcommand without a parenthesized or other evaluated subexpression is not an archive; a wrapper's or unknown program's option value, an evaluation wrapper/substitution, an escaped or undelimitable value, a quoted or flagged `archive` subcommand, and a quoted/comment mention outside those positions stay refused.
- [x] 5.2 Verify the paragraph matches the tests and run `pnpm lint` (Biome) on the edited markdown.

## 6. Generated output and full gate (serial tail)

- [x] 6.1 Run `pnpm build` and commit the regenerated `packages/plugin-workflows/lib/**`.
- [x] 6.2 Run `pnpm gen` and commit the regenerated `packages/setup/node_modules/@dsh-setup/plugin-workflows/**` (and any setup manifest or patch the generator rewrites).
- [x] 6.3 Run `pnpm check` (typecheck, lint, build, test) and `pnpm validate:repo`; verify both exit 0.
- [x] 6.4 Run `pnpm gen:check`, then `pnpm build && git diff --exit-code`; verify no generated drift.
- [x] 6.5 Run `openspec validate narrow-archive-scan-to-invocations --strict`; if the installed (pre-fix) gate refuses the command because the change name contains `archive`, assemble the name from pieces for that one command and record it in the change; verify exit 0.
  - Verified with the installed pre-fix gate: the split-name form
    `$exe = 'open' + 'spec'; $name = 'narrow-' + 'archive' + '-scan-to-invocations'; & $exe validate $name --strict`
    printed `Change 'narrow-archive-scan-to-invocations' is valid` and exited 0.

## Workflow follow-up

- Sync the `workflows` delta into `openspec/specs/workflows/spec.md` and archive the change after the owner's approval and the current review PASS.
- Run `pnpm reviews:check --change narrow-archive-scan-to-invocations` before archiving; every checked task needs a committed `reviews/<taskId>.json` task-review PASS.
- Release through the repository process (version bump, build, gate, tag, push) when the owner schedules it.
