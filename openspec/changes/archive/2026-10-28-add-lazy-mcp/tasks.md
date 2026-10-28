# Tasks

## 1. Package skeleton

- [x] 1.1 Create the complete skeleton in one step so its checks can pass together: `packages/plugin-mcp-lazy/package.json` (name `@dsh-setup/plugin-mcp-lazy`, `engines.dsh` copied byte-for-byte from `dsh.json` -> `enginesDsh`, `dsh.bundle.patch`, `files`, no install scripts), `cordis.fragment.yml` with the row `dsh-setup-mcp-lazy` and an empty `servers` config, `tsconfig.json` plus the root `tsconfig.json` reference, `src/host/index.ts` exporting `name` and an inert `apply`, `locale/en.json`, and `icon.svg`. Verify `pnpm build` emits `lib/index.js` and `lib/index.d.ts`, `pnpm gen` writes `packages/plugin-mcp-lazy/cordis.patch.yml` and the vendored copy, and `pnpm gen:check` passes.
- [x] 1.2 Declare `@modelcontextprotocol/client@2.2.0` as a runtime dependency and `@deepseek-ai/cordis`/`@deepseek-ai/dsh-tools` as pinned peers plus devDependencies, run `pnpm install`, then `pnpm gen`. Verify the dependency appears hoisted in the generated `packages/setup/package.json`, and `pnpm typecheck`, `pnpm lint`, and `pnpm validate:repo` all exit zero.

## 2. Configuration and server selection

- [x] 2.1 Parse the row's `servers` list into typed stdio entries using the Harness MCP client field names (`serverName`, `transport`, `command`, `args`, `env`, `cwd`, `toolCallTimeoutMs`); verify a unit test accepts a full entry and an empty list.
- [x] 2.2 Reject a duplicate `serverName` when the plugin is applied, with an error naming the duplicate; verify a unit test asserts the thrown message and that no client was constructed.
- [x] 2.3 Reject an entry whose `transport` is not `stdio`, with an error naming the server and the transport, and start nothing; verify a unit test asserts the message and that the transport factory was never called.
- [x] 2.4 Resolve the `server` tool argument only against configured names, failing with an error that lists the configured names and starting nothing; verify a unit test asserts an unknown name rejects and the factory was never called.

## 3. Server lifecycle

- [x] 3.1 Start a server on first use behind an injectable client/transport factory so tests never spawn a process; verify a unit test calls `mcp_tools` twice for one server and observes exactly one factory call.
- [x] 3.2 Reuse the started client for later calls in the same plugin instance; verify a unit test asserts the second call uses the same client object and keeps server-side state.
- [x] 3.3 Terminate every started process on unload; verify a unit test disposes the plugin fiber and asserts one close per started server.
- [x] 3.4 Preserve the configured command, arguments, environment, and working directory untouched when starting, including a confirmation flag; verify a unit test asserts the factory received exactly the configured values.
- [x] 3.5 Close the transport when initialization fails after the process started; verify a unit test with a factory whose connect rejects asserts one close and a call result naming the cause.
- [x] 3.6 Make unload safe during an in-flight initialization: cancel or await it, terminate the process, and never expose the connection afterwards; verify a unit test that unloads while connect is pending asserts the process is closed and a later call cannot use the connection.

## 4. Proxy tools

- [x] 4.1 Register `mcp_tools` with an optional `query` filter that lists a server's tool names and schemas; verify a unit test with two servers asserts one listing contains only its own tools and that the filter narrows results.
- [x] 4.2 Register `mcp_call` that forwards `{ server, tool, args }` and returns the tool's text content; verify a unit test asserts the forwarded arguments and the returned text.
- [x] 4.3 Surface a server-reported error as a failed call, never a success; verify a unit test asserts the error result carries the server's message.
- [x] 4.4 Fail a call against an unreachable server with an error naming the server and cause while other servers stay usable; verify a unit test with one broken and one working entry.
- [x] 4.5 Assert the registered tool names are exactly the two proxy tools for one and for five configured servers, and unchanged after a call that starts a server; verify a unit test compares `ctx.tools.schemas()` names before and after `mcp_tools` and `mcp_call`.

## 5. Documentation and market card

- [x] 5.1 Write `docs/lazy-mcp.md` covering the configuration fields, the stdio-only scope, the first-call startup cost, the text-only result limitation, and the exclusivity rule against a static adapter row; verify the page is linked from `docs/plugins.md`.
- [x] 5.2 Add the plugin row to the root `README.md` plugin table with its role, tools, and configuration; verify `pnpm lint` passes after formatting.
- [x] 5.3 State the stdio-only scope and the two proxy tool names in the market card description; verify the locale text names both tools and offers no remote-transport configuration.

## 6. Integration checks

- [x] 6.1 Run the local gate for the new package: `pnpm build`, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:repo`; verify every command exits zero and `git diff` is clean after committing generated output.
- [x] 6.2 Prove composition only with `pnpm validate:composition`: the lazy row appears with an empty server list; verify in the dump-config output. Runtime tool absence is verified in 6.3, not here.
- [x] 6.3 In a throwaway profile with one configured server, capture the model-facing tool names and schemas from a recorded request before any proxy call, then again after `mcp_tools` and `mcp_call`. Verify that no `mcp__<serverName>__*` tool ever appears, that the only tools the bundle contributes are the two proxy tools, and that the schema set is identical before and after the calls.
- [x] 6.4 Repeat 6.3 in a `ptc` profile: both proxy tools appear in the generated SDK block and work, and the visible tool set does not change after the calls; verify from recorded requests of that session.

## 7. Ship the Nuphus migration

- [x] 7.1 Extend the setup defaults contract so an entry may target a setup-contributed row and carry `disabled`; update `parseDefaults`, `renderSetupPatch`, `validate-repo`, and their tests. Verify `pnpm test` and `pnpm validate:repo`.
- [x] 7.2 Configure `dsh-setup-mcp-lazy` with the Nuphus stdio entry and disable `dsh-setup-nuphus-mcp` in `packages/setup/defaults.yml`; regenerate; extend `validate:composition` to assert the default composition (lazy Nuphus, static disabled) and to compose two overlays: an explicit static enable (both paths visible, so the guard's precondition exists) and an emptied lazy list (the documented opt-out). Verify `pnpm gen:check`, `pnpm validate:repo`, and `pnpm validate:composition`.
- [x] 7.3 Update the Nuphus guidance skill, `locale/en.json`, `docs/lazy-mcp.md`, `docs/install.md`, `docs/setup-composition.md`, `AGENTS.md`, and the root `README.md` rows for the lazy default, both upgrade reconciliations, and the rollback. Verify `pnpm lint`, then `pnpm build`, `pnpm gen`, and `pnpm gen:check` so the vendored skill and locale ship the updated text.
- [x] 7.4 Add the lazy one-home guard: before starting a process, fail when the loader tree has an enabled static `@deepseek-ai/dsh-mcp-client` row for the same `serverName` (including a row that is initializing, failed, or retrying and has no tools), falling back to registered `mcp__<serverName>__*` tools; name the row or tool and start nothing. Verify with unit tests for the enabled, disabled, and retrying cases and the tools fallback; then `pnpm build`, `pnpm gen`, `pnpm gen:check`, and a behavior test through `packages/setup/node_modules/@dsh-setup/plugin-mcp-lazy/lib/index.js` proving the vendored copy carries the guard.
- [x] 7.5 Prove Nuphus through the proxy in a throwaway profile with the real `nuphus-mcp`: record `mcp_tools` and `mcp_call` (`desktop_screen_size`), verify no `mcp__nuphus-mcp__*` and an unchanged tool set. Then the owner restarts the Desktop app and verifies the live setup composition from a new session. Verify the recorded checker passes, the setup-vendored guard test passes, and the owner's check succeeds.
