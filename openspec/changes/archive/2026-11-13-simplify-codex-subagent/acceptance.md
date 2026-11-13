# Live acceptance evidence (task 3.4)

Observed on 2026-11-13, Windows, with the owner's existing `~/.codex` login and the
installed bundled `@openai/codex` `0.169.0` platform binary. No absolute machine
path, credential, or token is recorded here.

The provider and its status tool were driven by the shipped code
(`packages/plugin-codex-subagent/lib/index.js`) with **real subprocesses** against the
real binary. Run it from the repository root:

```sh
pnpm exec vitest run --config scripts/manual/vitest.config.ts
```

The harness is manual: the main Vitest config does not include it, so `pnpm test` and
CI never require a Codex login. It mocks only the host seams
(`@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-tools`), exactly as the package unit
tests do; the provider, app-server wire protocol, binary, and status resolution are
real. The harness is typechecked with the rest of the workspace and its fake tool
registry ignores registrations, so it adds no gate failure.

## Status tool (real binary)

`codex_subagentStatus` resolved the installed bundled binary and reported:

```json
{
  "found": true,
  "version": "0.169.0",
  "source": "bundled",
  "bundledVersion": "0.169.0",
  "codexHome": "~/.codex",
  "loginCommand": "<resolved codex> login",
  "snippet": "- id: dsh-setup-codex-subagent\n  config:\n    codexPath: \"<resolved codex>\""
}
```

The resolved executable reported `codex-cli 0.169.0`.

## Authenticated provider run

The shipped `codex-subagent` provider ran one delegation against the real binary and
the owner's login:

```json
{
  "stopReason": "completed",
  "output": [{ "type": "text", "text": "PROVIDER-0.169.0" }]
}
```

The app-server sequence was `initialize` → `initialized` → `thread/start` (ephemeral,
`model: gpt-6-astra`, `config.model_reasoning_effort: xhigh`, `approvalPolicy: never`,
`sandbox: read-only`, no MCP override) → `turn/start` → `agentMessage` `final_answer`
→ `turn/completed`.

## Signed-out provider run (isolated Codex home)

The same provider was run with `codexPath` pointing at a `.cmd` wrapper that sets
`CODEX_HOME` to an empty temporary directory, so the owner's real login is never
touched. The provider reported:

```text
stopReason: error
diagnostic:
Product subagent failure (product: Codex; codex: 0.169.0; stage: turn; category: transport; HTTP status: 401)
Codex is not authenticated; run `<resolved codex> login` once (it writes ~/.codex) and retry
```

The wrapper selects the isolated home only for this check; the shipped provider still
uses `~/.codex` in normal runs (it unsets `CODEX_HOME`).

## Scope note

This evidence covers task 3.4. The visible `codex_subagent` UI row (task 3.5) still
requires the owner to install the regenerated setup into the desktop profile from an
external shell; it is recorded as a blocked owner step.
