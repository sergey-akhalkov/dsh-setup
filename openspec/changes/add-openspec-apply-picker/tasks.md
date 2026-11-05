# Tasks

## 1. Host list endpoint — `packages/plugin-openspec/src/host/**`, `packages/plugin-openspec/test/change-list.test.ts`

- [x] 1.1 Add `src/host/change-list.ts`: a fixed-argv `openspec list --json` runner with the session workspace as cwd, a workspace-local root guard (the workspace's own `openspec/` must exist and the CLI's `root.path` must resolve to the workspace), a 10-second timeout that terminates the whole spawned process tree (`taskkill /T` on Windows, the detached process group on POSIX), JSON parsing, and readable errors for a missing executable, non-zero exit, `"root": null`, root mismatch, timeout, and malformed output; verify the unit tests cover an ancestor root, a declared or default store, a hanging descendant, and every error mapping with `node:child_process` mocked.
- [x] 1.2 Register `GET /plugins/dsh-setup-openspec/changes` in `src/host/index.ts` only when `webServer`, `connection`, `agents`, and `workingDirectory` are present (probe with `ctx.get`, keep the six skills on hosts without them); resolve the workspace from the session id, enforce the workspace-local root guard before running the CLI, apply the origin/cookie authorization pattern, accept no other request text, and verify tests cover a foreign origin, an unknown session, a non-Web host, per-session workspace scoping, and the no-root rejection.
- [x] 1.3 Update the module note in `src/host/index.ts`: the plugin never installs, downloads, or fetches the CLI, and the picker route runs the documented CLI on demand; verify the existing `skill-provider` tests still pass.

## 2. Client picker — `packages/plugin-openspec/src/client/**`, `packages/plugin-openspec/package.json`, `packages/plugin-openspec/test/apply-picker.test.ts`, `docs/plugins.md`

- [x] 2.1 Add `src/client/index.ts` registering `/openspec-apply` through the client command service with a `popupSelect` spec and local structural service types (a `shortcut:` comment names the reference DSH version); verify the fake-context test asserts the registration and that a context without the service registers nothing and raises nothing.
- [x] 2.2 Implement `options()`: request the host route with the session id, map each change to `label`/`detail` (`<completed>/<total>`), and reject with the readable error for an absent CLI, a missing root, a timeout, and malformed output; verify the mapping, empty-list, and error tests.
- [x] 2.3 Implement `onSelect`: resolve `ctx.sessions.scope(sessionId)` and write `/openspec-apply-change <name>` through `conversation.input.for(actx).setDraft(...)`, never submitting; verify the draft test and that no submit path is called.
- [x] 2.4 Declare the client entry in `package.json` (exports `./client`, `files`, `dsh.client` on platform `web` with `@deepseek-ai/dsh-client-ui-commands` in its client dependencies) and document the command in `docs/plugins.md`; verify `pnpm build` emits `lib/client.js`, `pnpm typecheck` passes, and the documented behavior matches the picker tests.

## 3. Integration — generated tree and full gate

- [x] 3.1 Run `pnpm gen` and `pnpm build` and commit the regenerated patch, `lib/**`, and vendored setup tree; verify `pnpm gen:check` passes and the vendored `plugin-openspec` carries `lib/client.js`.
- [x] 3.2 Run `pnpm validate` (typecheck, lint, build, test, `gen:check`, `validate:repo`, `validate:composition`, `validate:installer`); verify it exits zero.
- [ ] 3.3 Run `pnpm build && git diff --exit-code` and `pnpm dogfood`; verify there is no build drift and the installer check passes against a copy of the live desktop profile.

## Workflow follow-up

- Owner smoke: install the built setup from an external PowerShell with the desktop app closed, open `/openspec-apply` in a workspace with an `openspec/` root, pick a change, and confirm the composer draft; agents must not install into the live desktop profile.
- Archive after `pnpm reviews:check --change add-openspec-apply-picker` reports every checked task approved.
