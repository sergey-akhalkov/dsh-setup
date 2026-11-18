# Live acceptance evidence (task 4.3)

Observed on 2026-11-18, Windows, with the owner's existing `~/.codex` login and the
installed bundled `@openai/codex` `0.170.0` platform binary. No absolute machine
path, credential, or token is recorded here.

The shipped provider and status tool (`packages/plugin-codex-subagent/lib/index.js`)
were driven against the real binary with real subprocesses. Run from the repository
root:

```sh
pnpm exec vitest run --config scripts/manual/vitest.config.ts \
  packages/plugin-codex-subagent/test/live-acceptance.manual.ts -t "<test name>"
```

The harness is manual: the main Vitest config does not include it, so `pnpm test` and
CI never require a Codex login.

## Status tool (real binary)

`codexSubagentStatus` resolved the installed bundled binary and reported:

```json
{
  "found": true,
  "version": "0.170.0",
  "source": "bundled",
  "bundledVersion": "0.170.0",
  "codexHome": "~/.codex",
  "loginCommand": "<resolved codex> login",
  "path": "<profile>/node_modules/.pnpm/@openai+codex@0.170.0-win32-x64/.../codex.exe"
}
```

## Authenticated provider run

One delegation completed on the owner's login with the target
`model: gpt-6.2-astra`, `reasoningEffort: xhigh`:

```json
{
  "stopReason": "completed",
  "output": [{ "type": "text", "text": "PROVIDER-0.170.0" }]
}
```

The returned token proves the app-server handshake, `thread/start`, `turn/start`, the
final answer notification, and `turn/completed` all worked on `0.170.0`; the model id
was accepted on the ChatGPT login.

## Signed-out provider run (isolated Codex home)

The same provider ran with `codexPath` pointing at a `.cmd` wrapper that sets
`CODEX_HOME` to an empty temporary directory, so the owner's real login was never
touched:

```text
stopReason: error
diagnostic:
Product subagent failure (product: Codex; codex: 0.170.0; stage: turn; category: transport; HTTP status: 401)
Codex is not authenticated; run `<resolved codex> login` once (it writes ~/.codex) and retry
```

## Scope note

The harness's thread-resume test (two further app-server runs on one review key) was
not run for this change: the bump does not touch the thread store, and the unit tests
cover the key parsing and reuse contract. Everything else in the harness is covered
above.
