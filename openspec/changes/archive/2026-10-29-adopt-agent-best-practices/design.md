# Design

## Context

See `proposal.md` — Why. Current state that shapes the approach:

- The harness exposes exactly the hooks this needs: `agent/pre-step`, `tools/result`, and
  `agent/turn-stopping` (already used by `plugin-delegation-rules` and `plugin-goal-continuity`),
  plus `payload.agent.steer(...)` for the refusal notice. No new platform capability is required.
- Observed tool contract: `edit`/`write` results carry a canonical `path`; a shell result carries the
  canonical foreground value `{ kind, exitCode, signal, timedOut, aborted, timeoutMs, stdout, stderr,
  sandbox? }`, and the `[exit code: N]` marker is rendered text emitted only when `exitCode` is not
  zero — so the marker's absence is not by itself evidence of success.
- `plugin-delegation-rules` already observes `tools/result` to record write evidence and steers at
  `agent/turn-stopping`. Its gate is deliberately scoped to OpenSpec changes attributed to the
  session; it does not cover a plain code turn.
- `session-guidance` already owns prompt budgets (working-principles 1,500 estimated tokens, one
  estimated token = UTF-8 bytes / 4) and `scripts/validate-repo.ts` already fails on an oversized
  contribution. The same shape applies to the workspace instruction file.

## Goals / Non-Goals

**Goals:**

- A code-changing turn cannot close on an unverified change, and the refusal names the exact command.
- The workspace instruction file becomes the fast path it is advertised to be, with a measured budget.
- The smaller guidance adoptions land where they are read on demand, not in always-on prose.

**Non-Goals:**

- No new trigger vocabulary, records, or digests: the verification gate is not a review gate and
  writes no record. Review remains `delegation-rules`.
- No interception, rewriting, or execution of shell commands. The gate only reads tool results.
- No path-scoped rule loading, no approval-mode classifier, no cost dashboard (see proposal).
- No re-vendor of the ponytail prompt and no change to any upstream-pinned asset.

## Decisions

### D1 — A separate Host-only bundle, not a rule inside `delegation-rules`

New package `packages/plugin-verification-gate`, one row `dsh-setup-verification-gate`, no Client
half. Rejected: adding the condition to the delegation engine, because that engine's contract is
change-scoped and digest-bound (records, session attribution, review runs) while verification applies
to any turn in any repository; folding it in would also grow a 139 KB host module and couple two
independent disable switches.

### D2 — Claude's posture: hard block, capped

The gate refuses the close and steers. After `maxBlocks` (default 8) consecutive blocks in the same
turn it allows the close and says so in the transcript. Rejected: a soft/steer-only mode, and rejected
making it a user-facing `mode` option — the row itself and an empty `commands` list are the opt-outs,
so no extra configuration exists to misconfigure. The cap is the livelock escape and is not a record:
no claim of verification satisfies the gate.

### D3 — Success is read from the canonical tool result, and anything unrecognized is not a pass

A run satisfies the gate only when `result.value` is a recognized foreground shell result with
`exitCode === 0`, `signal === null`, `timedOut` and `aborted` false, no sandbox denial, and no error.
Rejected: parsing the `[exit code: N]` marker from the rendered text, because that marker exists only
for a non-zero exit, so its absence cannot distinguish success from an unreadable result; rejected:
`isError` alone, because a failing suite can exit non-zero without the tool call being an error, which
would publish a false pass. A background handle, a missing field, or an unrecognized shape does not
satisfy the gate, the steer says the exit state could not be read, and the block cap still lets the
turn close.

### D4 — "Code write" = a successful `edit`/`write` outside planning scratch, not Markdown

A successful `edit` or `write` marks the turn dirty unless the target is under `.dsh/`, `.tmp/`,
`node_modules/`, or `openspec/`, or has the `.md` extension. Rejected: treating every write as code,
which would demand a check for plan and documentation turns; rejected: consulting git per write,
which is heavier and duplicates the delegation engine's snapshot work. Shell-mediated writes
(`pnpm gen`, `git checkout`) are invisible to this rule — a documented limit, because the gate is a
floor, not a proof.

### D5 — Exact command match, no internal normalization

A configured command matches only when the call's `command` argument, with leading and trailing
whitespace trimmed, equals the configured command exactly, or equals it after one leading `rtk `
token is removed together with the whitespace that follows it. Internal whitespace is never
collapsed: quoted arguments are part of the command, so `node -e "...'a b'..."` and
`node -e "...'a  b'..."` are different checks and only the configured text matches. Rejected: prefix
matching, because `pnpm check || true` and `pnpm check ; exit 0` begin with the configured command and
can report exit zero after the check itself failed, clearing the gate on a masked failure; rejected:
collapsing whitespace runs, because it can turn a failing check into a matching one; rejected:
regular expressions (more power, more ways to misconfigure). The `rtk` strip is required because this
setup's own routing rule rewrites `pnpm test` to `rtk pnpm test`, and a gate its own house rule
defeats is worse than none.

### D6 — Zero model-facing cost: no prompt section, no tools

The bundle registers no system-prompt section, no tool, and no skill. It speaks only through its own
steer messages, which name the plugin so two gates cannot be confused. Rejected: an always-on "run
the check" rule — that is the prose this change exists to replace.

### D7 — Configuration in the profile, inert by default

Row config: `commands: string[]` and `maxBlocks?: number`. An empty or absent `commands` keeps the
gate inert, so the shipped default changes nothing until an owner names their check. No `defaults.yml`
entry. Rejected: reading the command from the repository's instruction file, because a repository file
is advice and not enforceable configuration, and parsing it is guesswork. Invalid config throws at
apply with the row id, the offending value, and the accepted shape.

### D8 — In-memory per-agent state, reset on turn identity

`dirty` (a write happened since the last satisfied run), `blocksThisTurn`, and `allowedAnyway` per agent.
`blocksThisTurn` and `allowedAnyway` reset when the turn identifier changes — the `payload.turn`
identity observed at `agent/pre-step`, compared as the delegation gate compares it — not on every
step: a steer schedules another step inside the same turn, so a per-step reset would make the cap
unreachable. `dirty` survives until a satisfied run, so a capped turn still leaves the next one
honest. Rejected: persisting to `.dsh/`, because a restart demanding one check is harmless and a
durable gate would need its own corruption story.

### D9 — Two gates may steer one close

`delegation-rules` and this bundle both listen at `agent/turn-stopping` and each steers only for its
own unmet condition, so a turn can be told two things once. No priority mechanism is introduced:
each message names its owner and its own exact action. Subagent-origin sessions are excluded, as in
the delegation gate.

### D10 — Instruction budget enforced by `validate:repo`, measured in bytes

`AGENTS.md` is capped at 16,000 bytes (~4,000 estimated tokens at bytes / 4), half of Codex's 32 KiB
documentation cap, because a single-package-tree repository gets no per-directory layering and the
file is injected on every request. `scripts/lib/workspace.ts` exports the cap and the checker;
`scripts/validate-repo.ts` reports the measured size the way it reports an oversized plugin
contribution. Rejected: a line cap, which conflicts with the repository's existing bytes/4 convention.
The moved detail lands in a new `docs/contributing.md` (repository map, commands, plugin checklist,
CI gate, hard rules, troubleshooting) and `docs/openspec-status.md` (change history and open
follow-ups).

### D11 — The audit is a third skill, not a section in the existing body

`instruction-budget` is a new on-demand skill in `plugin-working-principles`; its catalog line is the
only cost. Rejected: extending the `working-principles` skill body, because that body is read for
design and review work, and an audit procedure buried there would not be discoverable from its
description.

### D12 — The plan checkpoint is one clause in the single contract section

A short "Plan before the edit" clause joins the always-on contract (about 200 bytes, keeping the
total under the 1,500 estimated-token budget); its rationale lives in the working-principles skill
body and `docs/principles.md`. No second always-on section, per the existing single-section rule. The
clause asks for a written plan and a nod before the first edit when the request touches more than one
file or its cause is unknown; it does not claim a way to enter plan mode, which is the user's control.

### D13 — Delivery through the setup bundle only

The bundle ships as a plugin package vendored inside `packages/setup` and mounted by the setup patch.
It MUST NOT be added to `dsh.json` → `installBundles.shipped` or to `$ShippedBundles` in
`install.ps1`: those lists select independent profile bundles *before* the setup is installed, while
this row is inserted by the setup patch itself, so a name there would either fail package resolution
or mount the same row twice. Rejected: listing it as a Harness-shipped bundle beside the
`@deepseek-ai/dsh-experimental-*` entries that actually live in that list.

## Risks / Trade-offs

- **A slow or broken check makes the gate noisy** → the cap bounds any single turn; the command list
  is short; an empty list is inert; the steer names the exact failing command instead of a generic
  refusal.
- **A repository runs its check with extra arguments the configured command does not name** → the
  gate stays closed and the steer shows the configured command, so the owner adds that exact form; a
  false pass is impossible by construction.
- **Shell-mediated writes are not seen** → documented limit; the review gates still cover OpenSpec
  work, and the verification gate is a floor.
- **Two steers on one close confuse the agent** → each message is prefixed with its owner and asks for
  one action.
- **The AGENTS.md restructure loses durable detail** → moved text lands in `docs/` with links, the
  budget check fails only on growth, and the tasks verify each moved section exists at its new home.
- **The shell result interface is an observation, not a platform promise** → the requirement is
  fail-closed (an unrecognized shape never satisfies the gate), a unit test pins the canonical fields
  and the unknown-shape behaviour, and a harness change degrades to "not verified", never to a false
  pass.

## Migration Plan

No data migration. Deployment is the normal release path: `pnpm gen`, `pnpm build`, `pnpm check`,
`pnpm validate`, then a set release; an owner on a linked checkout quits and relaunches the app, and
the gate first becomes active when they add `commands` to the profile row. Rollback is local and
independent per decision: disable the row (gate gone), `alwaysOn: false` (contract clause gone), or
revert the `AGENTS.md` split — the three do not depend on each other.

## Open Questions

- Whether `instruction-budget` should later also scaffold a missing instruction file (Codex's `/init`
  route). Deferrable: it adds a capability, not a requirement of this change.
