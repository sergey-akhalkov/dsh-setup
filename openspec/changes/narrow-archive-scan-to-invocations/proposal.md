# Proposal

## Why

Issue #9: an ordinary `git commit -m` is refused before it runs when the message mentions the
change path (`openspec/changes/<name>`) and, in a later sentence, the word `archive`. The strict
archive parser correctly declines the command, and the fall-back textual check then scans the
whole command — including the `-m` value — so prose in a commit message is treated as an archive
invocation. Rewording the message is the only workaround, which loses an accurate history, and
agents hit it repeatedly because a commit body naturally names the change path and the gate.

The same scan refuses a readable non-archive OpenSpec command when an argument contains `archive`:
`openspec validate narrow-archive-scan-to-invocations --strict` is denied today with the issue's
reason, and `openspec instructions archive --change <name>` has the same shape. The strict parser
is not the bug: `parseArchiveCommand` only recognizes the documented archive forms, so neither
command matches. The bug is the unfiltered fall-back scan in
`packages/plugin-workflows/src/host/index.ts:4871-4881` over the text produced by
`rawArchiveAction` (`index.ts:462-497`).

## What Changes

- The fall-back textual check masks the value of `-m`/`--message` on a `git commit` command and
  `--body` on a `gh pr create` command only, whose option values are prose data and are not scanned
  as shell structure. A command whose only archive mention is such a value runs.
- The fall-back also skips the scan when the command is one simple command whose executable is
  `openspec`, whose subcommand is a known non-archive action (for example `validate`, `status`,
  `show`, `list`, or `instructions`), and whose text contains no parenthesized or other evaluated
  subexpression, so a change name or an `archive` artifact id in an argument is data.
- Both exemptions stop at evaluated text: a real invocation or move after a message value, a
  substitution or escaped quote inside a value, a message option on a wrapper, an unknown program,
  a git alias prefix, or a non-verified subcommand, a parenthesized subexpression, a quoted or
  flagged `archive` subcommand, an unknown subcommand, or any shell control keeps the existing
  fail-closed scan.
- The strict parser, the three documented move forms, the evidence checks, and the refusal texts
  are unchanged; every existing archive bypass regression stays green.
- The textual rule is otherwise kept fail-closed; a quoted or commented mention outside a message
  value remains a deliberate false positive, documented as such.

No general shell parser, no broader quoted-argument exemption, and no change to the archive
evidence or approval model.

## Capabilities

### New Capabilities

None. The behavior belongs to the existing `workflows` capability.

### Modified Capabilities

- `workflows`: the pre-execute archive gate no longer reads `-m`/`--message`/`--body` values or a
  readable non-archive `openspec` subcommand's arguments as archive structure, while real and
  unreadable archive invocations and moves stay gated.

## Impact

- `packages/plugin-workflows/src/host/index.ts` — the message-value mask, its fall-back call, and
  the non-archive OpenSpec short-circuit.
- `packages/plugin-workflows/src/host/command-parse.ts` — the exported non-archive OpenSpec
  predicate (the strict parser itself is unchanged).
- `packages/plugin-workflows/test/host-wiring.test.ts` — positive commit-message and
  non-archive-OpenSpec cases, negative following-invocation/move and evaluated-region cases;
  existing bypass suite unchanged.
- `packages/plugin-workflows/test/command-parse.test.ts` — unit cases for the predicate.
- `docs/workflows.md` — the "Pre-execute archive" paragraph reflects both data exemptions.
- `packages/plugin-workflows/lib/**` and the vendored
  `packages/setup/node_modules/@dsh-setup/plugin-workflows/**` — rebuilt with `pnpm build` and
  `pnpm gen`, committed with the source.
- No dependency, configuration, record-schema, approval-schema, or client UI change. The live
  desktop profile keeps its behavior until a release is installed.
