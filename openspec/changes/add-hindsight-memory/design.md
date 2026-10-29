# Design

## Context

See `proposal.md` — Why. The relevant current state:

- `@vectorize-io/hindsight-coding-agents@0.8.2` is a native DSH plugin, not an MCP server. Its `/dsh` entry binds `agent/session-start` (cold seed), `agent/pre-step` (recall and injection), and `agent/turn-stopping` (session write-back), registers the `hindsight_*` tools, and installs its companion skill on the first session. It reads one config file, `~/.hindsight/coding-agent.json`, with environment variables as a fallback and the file winning on conflict. Its default server mode is `cloud`; `self-hosted` requires `apiUrl`; `daemon` starts `hindsight-embed` through `uvx` on `127.0.0.1:9077`.
- The setup bundle is generated from per-plugin fragments. A fragment row may name its owning package or the single approved adapter package, `@deepseek-ai/dsh-mcp-client`; generation rejects any other foreign name (`scripts/lib/fragments.ts`, `scripts/lib/generate.ts`).
- The generator vendors a plugin's runtime dependencies under `packages/setup/node_modules` unless the package is on the `registryInstalled` exception list. The setup manifest then hoists those dependencies so the profile installation fetches them; the Codex CLI and MCP client SDK already use this path. A linked checkout resolves a hoisted dependency from the repository's own root install because the vendored plugin copy lives under the checkout.
- The owner's machines run Hindsight locally at `127.0.0.1:8888`. The official `hindsight-embed` CLI manages a default-profile daemon on that port, with embedded `pg0` data under `~/.pg0/instances/hindsight-embed-default`, configuration in `~/.hindsight/embed`, logs in `~/.hindsight/daemon.log`, and no idle exit in 1.1.0 (`DEFAULT_DAEMON_IDLE_TIMEOUT = 0`). A DeepSeek API key is used for extraction; it belongs to the daemon profile, not to the Harness.

## Goals / Non-Goals

**Goals:**

- One setup installation delivers native Hindsight memory with a local-only default endpoint.
- Provision the local `hindsight-embed` daemon and machine-local connection configuration on each owner machine, idempotently, so the owner does not install it by hand.
- Reuse the official plugin's lifecycle, tools, and skill; add no parallel memory logic.
- Keep credentials, machine paths, and server data out of the repository.
- Keep the existing row-target, composition, dependency, and release contracts intact.
- Give a profile a documented, reversible opt-out and an agent-runnable live verification.

**Non-Goals:**

- Automating local-runtime installation from `install.ps1` or the setup bundle; the agent provisions it as an explicit machine-local step during apply.
- Choosing an LLM provider other than DeepSeek for the shipped local server.
- Cloud mode, cross-PC sync, shared banks, or a memory UI.
- MCP-based memory through `dsh-setup-mcp-lazy` or a static MCP adapter.
- Memory Defense, observation tuning, or knowledge-page customization beyond upstream defaults.
- A Hindsight-specific always-on prompt rule.

## Decisions

### D1. Reuse the official native DSH entry point

Mount `@vectorize-io/hindsight-coding-agents/dsh` and call its `apply`. The upstream plugin owns recall, injection, retention, tool registration, bank resolution, and the companion skill. This is the only option that gives automatic memory without a new memory implementation or a second tool surface.

Alternatives considered:

- The Hindsight MCP endpoint (`/mcp/{bank}/`) mounted through the lazy row: it exposes retain/recall/reflect tools but no automatic seeding, per-prompt injection, or session write-back, and it adds bank/path configuration. Rejected.
- A custom memory plugin: duplicates a mature upstream and splits behavior. Rejected.

### D2. Ship a thin wrapper package, not a foreign row

Add `packages/plugin-hindsight` (`@dsh-setup/plugin-hindsight`). Its fragment row is `dsh-setup-hindsight`; its Host module exports `name`, `inject = ['agents']`, and an `apply` that applies connection defaults and then calls the upstream `apply`. The row therefore mounts its owning package, as the composition contract requires.

Alternatives considered:

- Add the upstream `/dsh` specifier to the approved row-target set: smaller in files, but broadens a deliberately narrow security policy and relies on the loader resolving a registry dependency named directly by a row. Rejected.
- Install the official package as a registry bundle from `install.ps1`: no setup or market integration, and the installer's registry path pins the DSH version rather than the bundle version. Rejected by the owner's choice of the setup-bundle route.
- Run the upstream `install dsh` command: it writes a home-level `$DSH_HOME/cordis.patch.yml` row with a `file://` runtime, applies to every profile, and auto-updates outside the release. It stays a documented alternative, not the shipped route.

### D3. Pin the upstream package exactly and fetch it from the registry

`packages/plugin-hindsight/package.json` declares `"@vectorize-io/hindsight-coding-agents": "0.8.2"` in `dependencies`. The generator's `registryInstalled` check gains this package, so generation hoists it into the setup manifest and does not copy its 16.7 MB tree into the tracked vendored directory. The root manifest also declares it as a dev dependency so the linked checkout resolves it at runtime. The profile installation fetches the pinned package from npm.

The plugin manifest is the canonical pin. Repository validation rejects a non-exact value (a range or `latest`) and checks that the root and generated setup declarations match it; negative tests cover a range, `latest`, and a mismatched version. A developer therefore cannot change only one of the three declarations.

Alternatives considered:

- Vendor the package: keeps a registry-free install but adds 16.7 MB to every generated commit and release for a self-contained package. Rejected; the existing Codex and MCP runtime dependencies already establish the registry path.
- Add a second vendoring mechanism or a package-specific lock file: not needed; the exact manifest pin is the lock.

### D4. Default the connection to the local server through the row configuration

The fragment row carries `config: { serverMode: self-hosted, apiUrl: http://127.0.0.1:8888 }`. The wrapper sets `HINDSIGHT_SERVER_MODE` and `HINDSIGHT_API_URL` only when they are unset, before calling the upstream `apply` (the upstream registers tools and resolves its workspace configuration during `apply`). Upstream's own precedence then applies: the config file wins per field, environment variables are the fallback, and the row values fill only what neither sets.

This makes a fresh install work against the owner's conventional local server without a per-machine file; the provisioning step may add an explicit config file when absent, but the row default remains the fallback. The row configuration is machine-independent and visible in `--dump-config`.

Alternatives considered:

- Require `~/.hindsight/coding-agent.json` before the plugin does anything: prevents the silent Cloud default but adds a mandatory manual step on every PC. Rejected.
- Have the installer write the config file: writes machine-local state outside the profile, is skipped by the market/manual install path, and would embed a server choice in installer code. Rejected for this change.
- Set the defaults inside the upstream package: it is a pinned third-party dependency; the wrapper is the owned seam.

### D5. Keep the extraction credential on the Hindsight server

The DeepSeek API key is configured in the `hindsight-embed` default profile (`~/.hindsight/embed`: `HINDSIGHT_API_LLM_PROVIDER=deepseek`, `HINDSIGHT_API_LLM_MODEL`, `HINDSIGHT_API_LLM_API_KEY`) and never appears in the setup patch, the config file shipped by the repository, or documentation examples. The wrapper sets only `serverMode` and `apiUrl`. A token required by the Hindsight API itself, if any, belongs in `~/.hindsight/coding-agent.json`.

Alternative considered: pass the key through the row configuration or environment defaults. Rejected: tracked secrets and a second configuration source.

### D6. Add no Hindsight-specific prompt guidance

The upstream plugin injects its own tool guide and knowledge preamble, registers self-describing tools, and installs a companion skill on the first session. A setup-owned always-on rule would duplicate that text, spend prompt budget on every step, and drift from upstream.

### D7. Provision the server as an explicit machine-local step

The setup bundle and installer do not install the local runtime. This change includes an agent-run provisioning step using the official `hindsight-embed` CLI: install the exact tool version, pin `HINDSIGHT_EMBED_API_VERSION=1.1.0` for the daemon's uvx API fallback, write or merge the default-profile configuration in `~/.hindsight/embed` with the DeepSeek provider/model/key from an untracked machine-local source, set an explicit `HINDSIGHT_EMBED_API_DATABASE_URL=pg0://hindsight-embed-default` (unless the machine already has an override), bind the API to `127.0.0.1:8888`, disable the idle exit, start the daemon through `hindsight-embed daemon start`, verify `/health`, and write `~/.hindsight/coding-agent.json` only when it is absent. Every invocation sets `HINDSIGHT_EMBED_PROFILE=default` so an active named profile cannot redirect provisioning. An idempotent logon scheduled task runs the same default-profile start after a reboot.

A missing or failed daemon never aborts Harness startup: the upstream plugin fails open, logs diagnostics, and keeps the session usable. The provisioning step is not a script inside any published package; it runs on the owner machine during apply and live acceptance.

### D8. Use the official embed daemon as the local runtime

`hindsight-embed` is the official local runtime and already manages what a hand-rolled service would have to duplicate: the default profile on `127.0.0.1:8888`, profile configuration, port health checks, reuse of a healthy daemon, refusal to kill a foreign listener, and the embedded `pg0` database. The default profile's implicit database name is not stable enough to document (`get_database_url("")` produces `pg0://hindsight-embed-`), so before writing the database setting provisioning discovers any existing default-profile database: an explicit `HINDSIGHT_EMBED_API_DATABASE_URL` in the profile, or the implicit `pg0://hindsight-embed-` instance when it exists and is populated. It preserves that URL explicitly and records the actual path; it never redirects existing data. Only a fresh installation gets the explicit `pg0://hindsight-embed-default` path.

The CLI's liveness check accepts any HTTP 200 from `/health`, before its process-identity checks. Provisioning therefore adds a preflight: when 8888 is already listening, it requires the Hindsight health payload (`status: healthy`, `database: connected`) and the intended daemon identity (process or profile lock) before reusing the port, and refuses an unrelated listener without terminating it.

In 1.1.0 the daemon idle timeout defaults to `0` (no auto-exit), despite the README's stale five-minute sentence; the provisioning sets it explicitly and verifies the daemon stays up.

A logon scheduled task starts the daemon after a reboot; it sets `HINDSIGHT_EMBED_PROFILE=default`, and `daemon start` is idempotent and reuses a healthy daemon. The tool and API versions are pinned together (`hindsight-embed==1.1.0` and `HINDSIGHT_EMBED_API_VERSION=1.1.0`) so the daemon does not silently drift.

The persistence check uses the local HTTP API, not `hindsight-embed memory`/`bank`: on Windows, those commands forward to a separate `hindsight` CLI whose installer is not available, while the daemon's REST API is. The check discovers the endpoints from `/openapi.json`, retains a unique memory, polls the operation, recalls it, restarts the daemon, and recalls it again.

Alternatives considered:

- Docker (the previous draft): the owner explicitly declined it; `hindsight-embed` is the supported bare local path and needs no container runtime.
- A foreground `hindsight-api` plus a scheduled task: the same underlying API, but it hand-rolls profile configuration, daemon start, health checks, and log/lock handling that `hindsight-embed` already provides.
- The plugin's `daemon` mode on `127.0.0.1:9077`: it would start the daemon automatically, but the owner chose the `8888` default profile, and that mode expects the extraction key in the Harness process rather than in the daemon profile.

The DeepSeek key is written only into the untracked, ACL-restricted `~/.hindsight/embed` profile (or an equivalent user environment source) and is never echoed or committed. The daemon process necessarily receives it as an environment variable, and the docs state that exposure boundary.

### D9. Verify the composition mechanically and the memory live

Repository checks cover the wrapper exports, the connection-default application, the generator's registry exception, the generated setup patch/manifest, and the composed profile. They cannot prove memory works, because that needs a running Hindsight daemon and an LLM.

The live acceptance is agent-run on the owner machine: confirm `/health`, start a new session in a git repository, let the plugin seed/retain, open a fresh session, ask for the stored fact or read a knowledge page, and confirm the `hindsight_diagnose`/`hindsight_sync_status` output. Disable the row and confirm the tools and injection disappear; re-enable after a full restart and confirm they return. Stop the daemon and confirm the next Host load autostarts it. The owner only supplies the extraction credential.

### D10. Add the registry runtime dependency allowance to `portable-setup`

The setup already relies on registry-fetched runtime dependencies, but the accepted spec only states the plugin-package dependency rule. Add one requirement stating that an exact-pinned third-party runtime dependency may be hoisted into the setup manifest, is fetched during profile installation, is not vendored, and must be documented. This makes the Hindsight dependency an explicit contract instead of an undocumented exception.

### D11. Use an exact version bump for upstream updates

Updating Hindsight is a set release: bump the exact dependency in the wrapper, run `pnpm install`, `pnpm gen`, `pnpm build`, the full check, and the live acceptance; then release the set. There is no self-update path and no vendored provenance record to refresh. The upstream package does not declare `engines.dsh`, so the wrapper's `engines.dsh` covers compatibility and the DSH-version bump checklist must re-run the live check.

### D12. Ship a standalone one-click bootstrap script

Add a root `setup-hindsight.ps1` that reproduces the local provisioning on another Windows PC with one command. It is standalone (no repo imports), so it works through `irm <raw-url> | iex`; it accepts the DeepSeek key from a parameter, `DEEPSEEK_API_KEY`, `~/.hindsight/deepseek.key`, or a secure prompt. It installs `hindsight-embed==1.1.0` if needed, discovers or creates the default-profile database, writes the profile and ACLs, exports the Windows CA bundle into `SSL_CERT_FILE`/`REQUESTS_CA_BUNDLE` for the daemon, starts it, registers the logon task, writes `coding-agent.json` when absent, and runs a REST retain/recall verification. `-DryRun` reports without changing anything; rerunning preserves existing data and the task and restarts the daemon only when the profile changed.

Alternatives considered:

- Fold the server provisioning into `install.ps1`: couples the DSH profile installer to an external Python runtime, a key prompt, Docker/uv prerequisites, and a network download, and makes an optional server failure look like a setup failure. The separate script keeps the installer's tested contract.
- Document the manual steps only: the owner would repeat the same multi-step setup on every PC, which is the request being solved.

The script requires Windows PowerShell 5.1+, `uv` on PATH, and network access; a missing `uv` fails with the install command instead of silently installing a system tool. The key is never printed, never passed on the command line by the documented one-liner, and is written only to the ACL-restricted machine-local profile.

A fresh-install acceptance runs on a clean Windows PC or VM with Windows PowerShell 5.1 and `uv`, starting with no Hindsight tool, profile, CA bundle, or scheduled task; it uses the downloaded pipeline and verifies the pinned installation, ACLs, logon start, REST retain/recall, and rerun preservation. The current machine's idempotent run is a separate check, not a substitute for the clean-state run.

### D13. Default-on local daemon autostart

The Hindsight row carries `autostart: true` by default. The wrapper resolves the effective connection with upstream precedence: the machine config file's top level, then `harnesses.dsh`, then explicit environment, then the row values. It only attempts a start when it is self-hosted at the managed default-profile endpoint `http://127.0.0.1:8888`, not disabled, and `autostart` is not false. A `paths` or `banks` entry that carries a connection or `disabled` override makes the Host-wide effective connection unknowable, so autostart is skipped rather than guessing. A different loopback port is skipped because the wrapper only starts the default profile on 8888; the logon task remains the path for a custom port.

It probes `/health` with a short timeout; if unhealthy, it spawns the installed `hindsight-embed daemon start` detached with `HINDSIGHT_EMBED_PROFILE=default` and the machine-local CA bundle in `SSL_CERT_FILE`/`REQUESTS_CA_BUNDLE`, then returns. It never waits, throws, installs the tool, or blocks Harness startup; a missing tool is a silent no-op. This is a fallback to the one-click script's logon task, not a replacement.

Alternatives considered:

- Rely only on the logon task: it covers a reboot but not a daemon that crashed, was stopped, or failed its own start. The plugin-level attempt heals that without a manual command.
- Use the upstream `daemon` server mode: it starts a different profile/port and expects the extraction key in the Harness process rather than in the machine-local daemon profile, which would split the owner's existing memory. Rejected.
- Install the tool from the plugin: published packages must not run install-time scripts, and a Host module must not silently install system software. The one-click script remains the install path.

## Risks / Trade-offs

- **A missing config file makes upstream use Cloud by default** → the shipped row supplies the local defaults; the wrapper only fills unset values; documentation names `hindsight_diagnose` for verification. The file still wins, so an explicit Cloud choice remains possible.
- **The first daemon start downloads the API package and models** → provisioning starts it early, raises the startup budget when needed, and verifies `/health`; later starts are fast. The plugin still fails open if the daemon is not ready.
- **`hindsight-embed` and the API package drift apart** → the provisioning pins both together and records the versions; an update is a deliberate release step followed by the persistence and live acceptance.
- **The extraction key is stored in `~/.hindsight/embed`** → the file is machine-local, ACL-restricted, never printed or committed; the docs state that the daemon process environment contains it.
- **The provider TLS chain is intercepted by a local CA** → the one-click script exports the Windows root/CA store to a machine-local PEM and passes it to the daemon through `SSL_CERT_FILE`/`REQUESTS_CA_BUNDLE`; it never disables certificate verification, and the retain/recall verification proves the chain.
- **The one-click script drifts from the manual provisioning** → the script is the shipped reference path for other PCs, the same script is rerun idempotently on this machine, and the live retain/recall check fails loudly instead of reporting success.
- **`uv` is missing on another PC** → the script stops before changing the runtime and names the supported `uv` install command; it does not install a system tool silently.
- **A key in a command line leaks into shell history** → the documented one-liner uses `DEEPSEEK_API_KEY`, the machine-local key file, or a secure prompt; the key parameter exists only for scripted use and is never echoed.
- **The default profile's implicit pg0 name is ambiguous** → provisioning discovers an existing explicit override or populated implicit `hindsight-embed-` instance before writing the database setting, preserves it, and records the actual path. Only a fresh installation gets the explicit `pg0://hindsight-embed-default` path. The persistence acceptance retains a unique memory, restarts the daemon, and recalls it, including a populated implicit database.
- **An active named profile redirects the command** → every provisioning, logon, and acceptance invocation sets `HINDSIGHT_EMBED_PROFILE=default`; the owner's active-profile selection is preserved.
- **A foreign service returns HTTP 200 on `/health`** → `hindsight-embed`'s liveness check alone would accept it; provisioning adds the Hindsight health payload and daemon-identity preflight, refuses reuse, and does not kill the unrelated process.
- **The Windows `hindsight` CLI is unavailable** → the persistence acceptance uses the daemon's local HTTP API and `/openapi.json`, not `hindsight-embed memory`/`bank`, whose forwarding CLI is not installed on native Windows.
- **The daemon exits on an idle timeout** → the provisioning sets the idle timeout to `0` and verifies the daemon stays up; the 1.1.0 default is `0` even though the README still describes a five-minute exit.
- **Autostart races a logon task or a second Host load** → `hindsight-embed daemon start` is idempotent and reuses a healthy daemon; the wrapper fires it detached and ignores its outcome, so duplicate attempts are harmless.
- **Autostart's tool is missing or off PATH** → the wrapper resolves the user-level `hindsight-embed` path, falls back to the command, and treats a spawn error as a silent no-op; the one-click script remains the documented install path.
- **Autostart starts a local daemon while the effective config is Cloud or remote** → `shouldAutostart` reads the machine-local top level, applies the `harnesses.dsh` override, then explicit environment and row values; it requires self-hosted at the managed `127.0.0.1:8888` endpoint and honors `disabled` and `autostart: false`. A `paths`/`banks` connection or disabled override makes the Host-wide connection unknowable, so autostart is skipped; a different loopback port is skipped. The tests cover those decisions, and the docs state the conservative skip.
- **A stopped daemon looks like an installed but inert plugin** → upstream fails open with diagnostics; startup never aborts; the docs state that the daemon is a provisioned prerequisite and show the health check.
- **Automatic ingestion costs tokens and stores session/git data locally** → the server is self-hosted and loopback-bound; docs name the cost knobs (`retainSessions`, `autoInject`, `gitIngest`, `codebaseSurvey`, page refresh) and the opt-out. Cloud is never the shipped default.
- **The profile installation needs npm access for the pinned package** → the exact pin makes the fetch deterministic; this is the same contract as the Codex CLI and MCP client SDK. An air-gapped profile can install the package by its own mirror before the setup.
- **The registry dependency must resolve from the vendored wrapper in a released profile** → it uses the same resolution path as the existing registry runtime dependencies; `validate:composition` plus the owner live run verify it. Fallback if resolution fails: vendor the package and accept the size cost.
- **Upstream release changes can break the wrapper's re-export** → the exact pin holds until the set release; the wrapper test asserts `name`, `inject`, and `apply`; the update procedure re-runs the live check.
- **Combining the shipped row with the official `install dsh` home patch mounts two rows** → documentation names the two routes and says to use one; the owner has not used the home-patch route on these machines.
- **The companion skill writes to `~/.agents/skills/hindsight-coding-agent` on the first session** → this is upstream behavior, documented; the row disable does not remove the shared skill file, so the documentation names manual deletion as the cleanup step. Re-enabling requires a full Harness restart because upstream caches workspace state and tool registration per process; the opt-out requirement and acceptance reflect that.
- **Upstream's tool registration samples the launch directory** → its execute path rebinds each call to the calling agent's workspace, and a non-repository launch directory falls back to a directory-derived bank rather than disabling tools; no setup workaround is needed.
- **Memory Defense is off by default** → it remains a server-side, per-bank decision; the docs name it as a follow-up for sensitive repositories.

## Migration Plan

1. Provision the local Hindsight daemon and machine-local config: install the pinned `hindsight-embed` tool, pin the API version, discover any existing default-profile database (explicit override or populated implicit instance) and preserve it, otherwise set the fresh `pg0://hindsight-embed-default` path; write or merge the default profile with the DeepSeek provider/model/key from an untracked source, select `HINDSIGHT_EMBED_PROFILE=default`, bind it to `127.0.0.1:8888` with the idle exit disabled, start it, verify `/health` and listener identity, register the logon start, and write `~/.hindsight/coding-agent.json` when absent.
2. Add the wrapper package, its dependency, the default-on autostart, and the generator exception; run `pnpm install`, `pnpm gen`, and `pnpm build`.
3. Commit the sources and the regenerated setup patch, manifest, and vendored wrapper copy.
4. Run the repository checks (`pnpm check`, `gen:check`, `typecheck`, `lint`, `test`, `validate:repo`, `validate:composition`, `validate:installer`, `dogfood`).
5. Build the release candidate and run the agent live acceptance against it in an isolated profile, before tagging. A failure blocks the release.
6. Release the set version; install the released setup into a throwaway profile fresh and over the previous release; confirm the new row, the manifest dependency, and the composed config.
7. Install the released setup on the owner machine with the local Hindsight daemon running, fully restart Harness, and confirm the new session uses memory. Stop the daemon, load the Host again, and confirm autostart brings it back; then disable `autostart` and confirm a stopped daemon stays stopped.
8. Rollback: disable the `dsh-setup-hindsight` row in the profile patch, or reinstall the previous set version. The local Hindsight data under `~/.pg0/instances/hindsight-embed-default` is unaffected; `hindsight-embed daemon stop` stops the runtime.
9. On another Windows PC, install the DSH setup as usual and run the documented `setup-hindsight.ps1` one-liner with the DeepSeek key available; the script performs the same provisioning and verification idempotently.

## Open Questions

None. The owner chose the setup-bundle route, the `hindsight-embed` default profile on `127.0.0.1:8888`, and a DeepSeek API key on the daemon side; the remaining work is implementation and verification.
