# Design

## Context

See proposal.md - Why. The relevant current state:

- `packages/plugin-codex-subagent` vendors `@deepseek-ai/dsh-subagent-codex@0.2.1-rc.3`
  and its `lib/**` is hand-edited (the repository's documented generated-file
  exception); `pnpm build` does not rebuild it.
- The provider starts `codex app-server --stdio` with fixed `-c` overrides,
  including a per-run `SERENA_HOME` and a disabled-tool list; the status tool reports
  the fixed Serena command.
- DSH support is `>=0.2.2-rc.2 <0.3.0`; the official `@deepseek-ai/dsh-subagent-codex`
  0.2.2-rc.3 exists but has no fixed `read-only` sandbox and no `reasoningEffort`, and
  the delegation targets depend on both.
- `packages/setup/**` and `pnpm-lock.yaml` are generated/committed; `pnpm gen` owns
  the vendored setup tree.

## Goals / Non-Goals

**Goals:**

- The Codex child starts with no Serena MCP server, no per-run Serena home, and no
  Serena diagnostic, while every other provider behavior stays byte-for-byte
  equivalent.
- The pinned CLI is the latest stable `@openai/codex` (`0.169.0`) and a live
  authenticated turn completes on it.

**Non-Goals:**

- Rebasing the fork onto the official 0.2.2-rc.3 source or adopting the official
  bundle; that stays a recorded follow-up.
- Any change to the delegation engine, targets, rules, the lazy `serena` MCP entry,
  or the Serena guidance bundle.
- A local child DSH Session, token/time metrics for the Codex run, follow-up delivery,
  or `delegate`-run visibility; the visible entry is an external leaf and `delegate`
  stays caller-delivered.

## Decisions

### D1: Remove only the Serena integration

Alternatives: (a) adopt the official bundle - rejected because the official
`permissionMode: never` leaves the user's Codex sandbox in force and it cannot map
`reasoningEffort`; (b) rebase now - rejected because it rewrites the vendored adapter
and re-ports every local patch, which the owner explicitly deferred. The removal is
localized to the Serena helpers, the fixed `-c` list, the home lifecycle, the
status field, and the `serenaFailure` classification.

### D2: The child inherits the user's Codex configuration

After removal, `codexAppServerArgs(cwd)` carries no `mcp_servers.serena*` entry, no
`SERENA_HOME` child env, and no per-run temp directory. Any MCP server configured in
the user's `~/.codex/config.toml` now starts with its own approvals; the provider no
longer claims MCP run isolation, and the docs say so. The write boundary is unchanged
for operations the provider starts: the Codex sandbox (`read-only` or
`workspace-write`) is the only file-write boundary, and `CODEX_HOME` stays unset so the
existing login/config apply.

The old Serena-disabled list was Serena-specific; any other user-configured MCP server
could already act outside the sandbox. This change removes the provider's claim rather
than the exposure: the delta spec's write-instance scenario is scoped to Codex-sandboxed
operations, a new "Inherited MCP boundary" scenario states the limit, and the docs name
it. A test asserts the app-server argv contains no `mcp_servers.*` override, so the
provider demonstrably leaves inherited MCP configuration to the user.

### D3: Bump `@openai/codex` to 0.169.0

`0.169.0` is npm `latest` at 2026-11-13 and has platform packages for
win32-x64/arm64, linux-x64/arm64, and darwin-x64/arm64. The version surfaces move
together: `package.json` dependency, `pnpm-lock.yaml`, `NOTICE`, package README,
`docs/codex-subagent.md`, root `README.md`, `locale/en.json`, spec requirement, and
the tests that pin `0.164.0`. The status tool reads the installed package manifest, so
no version constant needs a manual edit beyond comments.

Protocol verification: unit tests cover the handshake, `thread/start` fields
(sandbox/model/effort), turn completion, cancellation, and the 401 path; one live
authenticated turn on the owner's `~/.codex` login is the acceptance. If 0.169.0 moved
a field, patch the adapter, record it in `NOTICE`, and re-run the acceptance. The
recorded fallback is pinning back to the last verified version with the reason.

### D4: Tests

Delete the Serena suites (configuration, runtime missing, enabled override, disabled
tools, activation hook, nested-cwd symbol read). Add one assertion that the app-server
argv contains no `mcp_servers.serena` override and no `SERENA_HOME`. Update status
expectations (no `serena` field) and the `0.164.0` pins to `0.169.0`. Keep discovery,
ComSpec, sandbox, effort, thread-reuse, cancellation, protocol-mismatch, and
provenance tests.

### D5: Generated tree stays generated

`pnpm gen` regenerates `packages/setup/**`; it is committed from the generator output,
never hand-edited. `pnpm install` owns `pnpm-lock.yaml`. Both run in the serial
integration lane after the source and metadata lanes land.

### D6: The visible tool is our own `codex_subagent`

The subagent service catalogs an external child only for a parent-delivered activation
(`startActivation` with `delivery: 'parent'`); `caller`-delivered runs — what the
delegation engine uses — are never cataloged.

Alternatives: (a) mount `@deepseek-ai/dsh-tool-subagent` from the plugin fragment -
rejected because the repository's fragment rule mounts only own package code except
the `@deepseek-ai/dsh-mcp-client` adapter, and adding a second exception changes the
generator policy; (b) install the official bundle alongside - rejected because it adds
a second Codex provider and its own CLI pin; (c) register a small tool in this package
(chosen).

Interface: `defineTool` named `codex_subagent` with `prompt` (required), `description`
(required, the task label shown in the list), `name` (optional child name), and `cwd`
(optional). `execute` requires `exec.agent`, then calls
`ctx.subagents.startActivation({ provider: 'codex-subagent', label: description, name,
prompt: [{ type: 'text', text: prompt }], parent, cwd?, signal, delivery: 'parent' })`
and returns `{ kind: 'activation', name }`. No depth cap is sent: the external provider
owns its recursion budget, matching the official tool's `maxDepth: provider-managed`.

Why the read-only provider: a visible run is for exploration and second opinions; write
work stays on `delegate`'s patch rule in an isolated worktree. Name choice: distinct
from the official `subagent_codex`, so both bundles can compose without a tool-name
collision.

Consequences: one extra tool schema on every request; the row is an external leaf (not
openable, no token/duration metrics, no follow-up messages); the settlement notice wakes
the parent with a new turn. `delegate` runs stay invisible because their caller delivery
keeps verdicts out of the conversation.

## Risks / Trade-offs

- **The reviewer's symbol-level reach shrinks** -> Codex inspects through its own
  shell/tools inside the sandbox; the owner accepted the trade.
- **A user-configured Codex MCP server now runs for delegations** -> it is the user's
  own configuration and is documented; no provider-side approval is injected.
- **0.169.0 protocol drift** -> unit tests plus a live run; the recorded fallback pin
  bounds the blast radius.
- **Generated-tree drift** -> `pnpm gen:check` and the committed vendored tree.
- **An extra always-on tool schema and possible spontaneous calls** -> the tool
  description scopes it to an explicit request for a visible Codex delegation.
- **The settlement notice starts a parent turn** -> deliberate: the visible run is
  asynchronous by design, and the docs say the result arrives as a notice.

## Migration Plan

One commit: provider/test changes, metadata/docs, then serial lockfile + generated
tree + full gate + live acceptance. No runtime state or profile migration; existing
review-thread state and delegation records are untouched. Rollback is a revert of the
commit, which restores 0.164.0 and the Serena overrides.

## Open Questions

None.
