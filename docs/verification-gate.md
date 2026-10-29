# Verification gate

`@dsh-setup/plugin-verification-gate` (row `dsh-setup-verification-gate`) is a Host-only turn-close
gate. A turn that changed source files cannot close until one configured check command has succeeded
_after_ the last edit. It observes tool results and the stop boundary; it never runs, rewrites, or
cancels a tool call, calls a model, or writes a review record.

The gate ships **inert**. Its row has no `commands`, so every turn closes exactly as before this
bundle existed. The plugin reads no repository file for configuration: the command list lives in the
profile row, because a repository instruction file is advice, not enforceable configuration.

## Configuration

Set the row in the profile's `cordis.patch.yml` (or the market entry's configuration) and restart
DeepSeek Harness:

```yaml
- id: dsh-setup-verification-gate
  config:
    commands:
      - pnpm check
    maxBlocks: 8
```

| Field       | Default | Meaning                                                                      |
| ----------- | ------- | ---------------------------------------------------------------------------- |
| `commands`  | none    | Exact shell commands that satisfy the gate. Absent or `[]` keeps it inert.   |
| `maxBlocks` | `8`     | Consecutive refusals allowed in one turn before the close is allowed anyway. |

A patch replaces the whole `config` object, so restate every field the row needs. The shipped
setup's defaults contain no entry for this row and no command list; adding this bundle alone changes
nothing until an owner names their check.

The configuration is validated once, when the row loads. `commands` must be a list of non-empty
strings (edge whitespace is trimmed), `maxBlocks` must be a positive integer, and unknown fields are
rejected, so a typo cannot silently disable an intended gate. An invalid value fails `apply` with
the row id (`dsh-setup-verification-gate`), the offending value, and the accepted shape.

## Exact command matching

A configured command matches a shell call only when the call's `command` argument, with edge
whitespace trimmed, equals it exactly, or equals it after one leading `rtk ` token and the
whitespace after it are removed. The `rtk` form is accepted because this setup's own routing rule
rewrites checks through `rtk`; internal whitespace is otherwise preserved.

Consequences:

- `pnpm check` matches `pnpm check` and `rtk pnpm check`.
- `pnpm check --watch`, `pnpm check:watch`, `pnpm check || true`, and `pnpm check ; exit 0` do **not**
  match, so a failed check cannot be masked by an extra argument or a compound command.
- Quoted arguments must match character for character: one space and two spaces inside a quoted
  argument are different checks.
- Matching is case-sensitive (`PNPM check` does not match `pnpm check`).
- Extra whitespace between configured words is not collapsed. A check run differently from the
  configured text does not satisfy the gate; the steer names the exact configured command.

Prefer one exact check command, for example the repository's own gate, rather than a long run of
independent commands. Additional configured commands are alternatives: any one of them can satisfy
the gate.

## Which writes count

Only a successful `edit` or `write` tool result marks the turn. The target comes from the result's
canonical `path` field; a result without that field does not mark the turn.

A target is ignored when it is Markdown (`.md`, case-insensitive) or under one of these roots
anywhere in the path: `.dsh/`, `.tmp/`, `node_modules/`, `openspec/`. Documentation and planning
writes therefore do not demand a check. A failed `edit`/`write` does not mark the turn, and a write
performed by a shell command is invisible to this rule (see [Known limits](#known-limits)).

## What counts as success

The matched call must return a **recognized foreground shell result**. The installed shell tools
(`pwsh` on Windows, `bash` elsewhere) return this canonical value:

| Field       | Type                                            | Gate rule                                                          |
| ----------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| `kind`      | `"foreground"`                                  | must be exactly `foreground`                                       |
| `cwd`       | string                                          | canonical field; not read for success                              |
| `exitCode`  | number or `null`                                | must be `0`                                                        |
| `signal`    | string or `null`                                | must be exactly `null`                                             |
| `timedOut`  | boolean                                         | must be `false`                                                    |
| `aborted`   | boolean                                         | must be `false`                                                    |
| `timeoutMs` | number                                          | canonical field; not read for success                              |
| `stdout`    | `{ text, truncated, spillPath? }`               | canonical field; not read for success                              |
| `stderr`    | `{ text, truncated, spillPath? }`               | canonical field; not read for success                              |
| `sandbox?`  | `{ mode, denied, enforcement?, runnerFailed? }` | if present, `denied` must be `false` and `runnerFailed` not `true` |

The `edit`/`write` result carries `path`; that is the only write field the gate reads. It does not
read written contents.

The success rule is intentionally fail-closed:

- A background job handle (`kind: "background"`) or a promoted foreground call
  (`kind: "promoted"`) does not satisfy the gate.
- A missing or mistyped field—including a result with no `kind`, `exitCode`, `signal`, `timedOut`,
  or `aborted`—does not satisfy the gate, and the refusal says the exit state could not be read.
- An `isError` tool result, a non-zero exit, a signal, a timeout, an abort, a sandbox denial, or a
  sandbox runner failure does not satisfy the gate.
- A result with a shape the gate does not recognize never satisfies it; the block cap still lets the
  turn close unverified.
- A successful run received **before** the most recent code write is stale and does not satisfy the
  gate; the check must run again after the last edit.
- A text claim that the checks pass satisfies nothing; only a matching result does.

The gate observes `tools/result`; it does not parse the rendered `[exit code: N]` marker, because that
marker exists only for a non-zero exit and its absence cannot distinguish success from an unreadable
result.

## Refusal, block cap, and resets

On an unverified stop the gate steers one bounded message that names the configured command(s), the
most recent written file, and the next action. The message is at most 800 characters, strips control
characters from untrusted values, and never includes file contents.

`blocksThisTurn` counts consecutive refusals in one turn. The counters reset only when the turn
identity changes, so a steer that schedules another step in the same turn does not reset the cap.
After `maxBlocks` consecutive refusals, the next stop is allowed to close: the gate does not steer
again, and it queues a non-waking notice that the turn closes **UNVERIFIED**. With the default
`maxBlocks: 8`, the ninth stop attempt closes with that notice. The notice is not a pass, no record
claims verification, and the dirty flag survives until a matching successful run, so a later turn
still needs the check.

A successful matched run clears the dirty flag and the unreadable-exit marker. Refusal and notice
texts are attributed to the `verification-gate` source, so two gates steering one close cannot be
confused.

## Known limits

- **Shell-mediated writes are not seen.** `pnpm gen`, `git checkout`, a script that rewrites files,
  and similar shell effects do not mark the turn because only `edit` and `write` results are
  observed. The gate is a floor, not a proof.
- **Only the exact command form counts.** Extra arguments, compound commands, a different quoting or
  spacing, a different case, or another shell's command do not match; run the configured text.
- **Only `pwsh` and `bash` foreground results are recognized.** A different shell tool, a background
  job, a promoted call, or an unreadable result never satisfies the gate.
- **The shell result shape is an observation, not a platform promise.** If a future harness changes
  it, the gate degrades to "not verified" and says the exit state could not be read; it never
  becomes a false pass.
- **No prompt cost.** The bundle registers no system-prompt section, no tool, and no skill; it speaks
  only through its own steer and notice messages. It costs nothing on a step that does not stop.
- **Subagent sessions are excluded.** A subagent's writes and stops are not gated by its parent's
  session.
- **State is in memory.** A restart forgets the dirty flag, so an unverified turn that ended at the
  restart can close without a new check; nothing is persisted to `.dsh/`.
- **No shipped default.** The setup mounts the row with no commands. Enabling the gate is an explicit
  per-profile decision, and an empty command list is the documented inert state.

## Opt out

- Remove the `commands` key or set it to an empty list: the gate registers no listener and every turn
  closes as before.
- Disable the row in the profile patch:

  ```yaml
  - id: dsh-setup-verification-gate
    disabled: true
  ```

- Uninstall the bundle. Disabling or removing the row stops every steer; there is no in-session
  bypass and no tool that clears the gate.

The bundle is installable on its own and needs no other `@dsh-setup` bundle. Installing both the
setup and the individual plugin mounts the same row twice; choose one.
