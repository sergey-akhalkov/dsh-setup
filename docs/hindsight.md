# Hindsight memory

Hindsight gives every session local, per-repository long-term memory: it seeds a repo's git
history, recalls past decisions when you start work, retains completed sessions, and maintains
knowledge pages. The setup uses the official native Hindsight DSH plugin; the memory server is a
local `hindsight-embed` daemon. No Hindsight Cloud account or Docker is used.

## What the setup ships

- `@dsh-setup/plugin-hindsight` mounts the official `@vectorize-io/hindsight-coding-agents@0.8.2`
  DSH entry point, so the upstream plugin owns recall, injection, retention, the `hindsight_*`
  tools, and the companion skill.
- The row `dsh-setup-hindsight` defaults to `serverMode: self-hosted` at
  `http://127.0.0.1:8888`. A machine-local `%USERPROFILE%\.hindsight\coding-agent.json` still wins.
- The root `setup-hindsight.ps1` script provisions the local daemon on a PC. It is separate from
  `install.ps1`: the setup installer installs the DSH bundle row, and the one-click script installs
  the local runtime.

## One-click local setup {#one-click}

Prerequisites on the PC:

- Windows with PowerShell 5.1 or newer.
- [`uv`](https://docs.astral.sh/uv/) on `PATH`. If it is missing:
  `winget install --id astral-sh.uv -e`.
- Network access to PyPI and `api.deepseek.com`.
- A DeepSeek API key.

Put the key in one of these places, or let the script prompt for it with a secure prompt:

```powershell
$env:DEEPSEEK_API_KEY = '<your key>'
```

or save it once in an untracked machine-local file:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.hindsight" | Out-Null
notepad "$env:USERPROFILE\.hindsight\deepseek.key"
```

Then run the one-click bootstrap:

```powershell
irm https://raw.githubusercontent.com/sergey-akhalkov/dsh-setup/main/setup-hindsight.ps1 | iex
```

The script:

1. installs the pinned `hindsight-embed==1.1.0` tool if it is missing or at another version;
2. discovers an existing default-profile database, or uses `pg0://hindsight-embed-default` on a
   fresh machine;
3. writes the default profile to `%USERPROFILE%\.hindsight\embed` with the DeepSeek provider,
   `deepseek-chat` model, loopback endpoint, and idle exit disabled;
4. exports the Windows root/CA certificates to `%USERPROFILE%\.hindsight\windows-certs.pem` and
   passes that bundle to the daemon, so a corporate TLS chain works without disabling
   certificate verification;
5. starts the daemon, registers the `Hindsight embed daemon` logon task, and writes
   `%USERPROFILE%\.hindsight\coding-agent.json` only when it is absent;
6. verifies a real retain/recall round-trip through the local REST API.

The default profile carries these settings (the key is the only secret):

| Key                                   | Value                                                 |
| ------------------------------------- | ----------------------------------------------------- |
| `HINDSIGHT_API_LLM_PROVIDER`          | `deepseek`                                            |
| `HINDSIGHT_API_LLM_MODEL`             | `deepseek-chat` (or `-Model`)                         |
| `HINDSIGHT_API_LLM_API_KEY`           | the machine-local key (never printed)                 |
| `HINDSIGHT_API_HOST`                  | `127.0.0.1`                                           |
| `HINDSIGHT_API_PORT`                  | `8888` (or `-ApiPort`)                                |
| `HINDSIGHT_EMBED_API_VERSION`         | `1.1.0` (daemon API fallback)                         |
| `HINDSIGHT_EMBED_DAEMON_IDLE_TIMEOUT` | `0` (no idle exit)                                    |
| `HINDSIGHT_EMBED_API_DATABASE_URL`    | existing database, or `pg0://hindsight-embed-default` |

Every daemon invocation selects the explicit profile with
`$env:HINDSIGHT_EMBED_PROFILE = 'default'`; an environment-selected named profile otherwise
redirects the command. The upstream README's five-minute idle-exit sentence is stale for 1.1.0:
the daemon default is no idle exit, and the script sets `HINDSIGHT_EMBED_DAEMON_IDLE_TIMEOUT=0`
explicitly.

The script is idempotent: rerunning it keeps existing data, the profile, and the logon task, and
restarts the daemon only when the profile changed. A downloaded copy can be inspected and run with
options:

```powershell
$installer = Join-Path $env:TEMP 'setup-hindsight.ps1'
Invoke-WebRequest https://raw.githubusercontent.com/sergey-akhalkov/dsh-setup/main/setup-hindsight.ps1 -OutFile $installer
& $installer -DryRun
```

| Option                | Effect                                                      |
| --------------------- | ----------------------------------------------------------- |
| `-DryRun`             | Report the plan and change nothing.                         |
| `-ApiPort <port>`     | Local API port; default `8888`.                             |
| `-NoLogonTask`        | Do not create or update the logon task.                     |
| `-SkipVerify`         | Skip the retain/recall verification.                        |
| `-DeepSeekApiKey <k>` | Scripted key input; prefer the environment or the key file. |

The key is never printed, is not placed in the repository, and is written only to the
ACL-restricted machine-local profile. The daemon receives it as a process environment variable,
so `%USERPROFILE%\.hindsight\embed` is machine-local state, not a portable file.

## Data and operation

| What             | Where                                                  |
| ---------------- | ------------------------------------------------------ |
| Daemon profile   | `%USERPROFILE%\.hindsight\embed`                       |
| Daemon logs      | `%USERPROFILE%\.hindsight\daemon.log`                  |
| Daemon lock      | `%USERPROFILE%\.hindsight\daemon.lock`                 |
| Embedded data    | `%USERPROFILE%\.pg0\instances\hindsight-embed-default` |
| DSH connection   | `%USERPROFILE%\.hindsight\coding-agent.json`           |
| TLS trust bundle | `%USERPROFILE%\.hindsight\windows-certs.pem`           |

Useful checks (select the default profile first):

```powershell
$env:HINDSIGHT_EMBED_PROFILE = 'default'
Invoke-RestMethod http://127.0.0.1:8888/health
hindsight-embed daemon status
hindsight-embed daemon logs -n 50
```

The daemon binds `127.0.0.1:8888` only. If another process owns that port, the script refuses to
kill it and reports the conflict. The CLI's own liveness check accepts any HTTP 200, so before
reusing an occupied port the script additionally requires the Hindsight health payload
(`status: healthy`, `database: connected`) and the expected daemon identity (process command line
or default-profile lock). It refuses a foreign listener and never terminates it. Stop that process
or choose another port with `-ApiPort`, then update the row or `coding-agent.json` to match.

### Persistence across a restart

The bootstrap's round-trip is immediate. To prove the database survives a daemon restart, use the
local REST API (the Windows `hindsight` CLI is unavailable; `hindsight-embed memory`/`bank` forward
to a CLI that is not installed). The daemon exposes its endpoints in `/openapi.json`; the relevant
ones are `/v1/default/banks/<bank>/memories` and `/v1/default/banks/<bank>/memories/recall`.

```powershell
$env:HINDSIGHT_EMBED_PROFILE = 'default'
$base = 'http://127.0.0.1:8888'
$bank = 'dsh-hindsight-persistence-check'
$marker = 'persistence-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$body = @{ items = @(@{ content = "The $marker marker proves persistence."; document_id = 'persistence-check' }) } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post -Uri "$base/v1/default/banks/$bank/memories" -ContentType 'application/json' -Body $body | Out-Null
$query = @{ query = "What is the $marker marker?"; max_tokens = 2000 } | ConvertTo-Json
$before = (Invoke-RestMethod -Method Post -Uri "$base/v1/default/banks/$bank/memories/recall" -ContentType 'application/json' -Body $query).results.text -join "`n"
if ($before -notmatch [regex]::Escape($marker)) { throw 'recall before restart failed' }
hindsight-embed daemon stop
if ($LASTEXITCODE -ne 0) { throw 'daemon stop failed' }
$stopDeadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $stopDeadline -and (Get-NetTCPConnection -LocalPort 8888 -State Listen -ErrorAction SilentlyContinue)) { Start-Sleep -Seconds 1 }
if (Get-NetTCPConnection -LocalPort 8888 -State Listen -ErrorAction SilentlyContinue) { throw 'daemon did not stop' }
$env:SSL_CERT_FILE = Join-Path $env:USERPROFILE '.hindsight\windows-certs.pem'
$env:REQUESTS_CA_BUNDLE = $env:SSL_CERT_FILE
hindsight-embed daemon start
if ($LASTEXITCODE -ne 0) { throw 'daemon start failed' }
$healthy = $false
$deadline = (Get-Date).AddMinutes(3)
while (-not $healthy -and (Get-Date) -lt $deadline) {
  try { if ((Invoke-RestMethod "$base/health" -TimeoutSec 5).status -eq 'healthy') { $healthy = $true } } catch {}
  if (-not $healthy) { Start-Sleep -Seconds 3 }
}
if (-not $healthy) { throw 'daemon did not become healthy' }
$after = (Invoke-RestMethod -Method Post -Uri "$base/v1/default/banks/$bank/memories/recall" -ContentType 'application/json' -Body $query).results.text -join "`n"
if ($after -notmatch [regex]::Escape($marker)) { throw 'recall after restart failed' }
```

A failure here means the database path changed or data was lost; check
`HINDSIGHT_EMBED_API_DATABASE_URL` and the daemon logs before continuing.

## Use from DeepSeek Harness

Install the setup bundle as usual and restart Harness. The plugin row is active by default; new
sessions in a git repository seed, recall, and retain automatically. The upstream plugin also
installs its `hindsight-coding-agent` companion skill in the shared skills root.

The first session in a repository can be slow while the daemon downloads its API/models and
seeds the repository. Memory calls fail open if the daemon is down: the Harness keeps working and
the plugin logs the failure; the default-on autostart below tries to bring it back, and
`& "$env:USERPROFILE\.hindsight\start-hindsight.ps1"` or the one-click script remain the manual
paths.

## Autostart

The Hindsight row defaults to `autostart: true`. When Harness loads the plugin and the effective
connection is self-hosted at the managed default-profile endpoint `http://127.0.0.1:8888`, the
wrapper checks `/health`. If the daemon is unhealthy, it spawns the installed
`hindsight-embed daemon start` detached with the default profile and the machine-local TLS bundle.
It does not wait, block startup, install the tool, or fail the session. The logon task from
`setup-hindsight.ps1` is the primary reboot path; autostart is the self-healing fallback when the
daemon crashed, was stopped, or missed its start.

Turn it off in the profile patch (a row configuration replaces the whole object, so restate all
three keys):

```yaml
- id: dsh-setup-hindsight
  config:
    serverMode: self-hosted
    apiUrl: http://127.0.0.1:8888
    autostart: false
```

A top-level `"autostart": false` in `%USERPROFILE%\.hindsight\coding-agent.json` also disables it.
The check applies the `harnesses.dsh` override, then the explicit environment and row values; an
explicit `HINDSIGHT_DISABLED=true|1|yes|on` also stops it. Autostart never applies to Cloud, a
remote `apiUrl`, `serverMode: daemon`, a different loopback port, a disabled Hindsight config, or a
machine without the `hindsight-embed` tool. A `paths.<prefix>` or `banks.<bankId>` entry with a
connection or disabled override (including under `harnesses.dsh`) makes the Host-wide connection
unknowable, so autostart is skipped; use the logon task or a custom row in that case. A custom
`-ApiPort` from the one-click script also skips plugin autostart; its logon task remains the start
path.

The `hindsight_diagnose` tool reports the resolved endpoint, config path, and whether a token is
configured. `hindsight_sync_status` reports whether the repository's memory is still being
seeded.

## Configuration precedence

1. A machine-local `%USERPROFILE%\.hindsight\coding-agent.json` (the file wins over the row).
2. Explicit `HINDSIGHT_*` environment variables.
3. The setup row defaults (`self-hosted`, `127.0.0.1:8888`).

The row configuration is a complete object; a profile override must restate both `serverMode` and
`apiUrl`:

```yaml
- id: dsh-setup-hindsight
  config:
    serverMode: self-hosted
    apiUrl: http://127.0.0.1:9999
```

Do not put a token or key in the profile patch or repository files.

## Opt-out and rollback

Disable the row in the profile's own `cordis.patch.yml`:

```yaml
- id: dsh-setup-hindsight
  disabled: true
```

Fully restart Harness. The tools, injection, and retention stop; the upstream companion skill file
may remain under the shared agents skills root, so delete
`%USERPROFILE%\.agents\skills\hindsight-coding-agent` manually if you want it gone. Re-enabling
requires a full Harness restart because the upstream plugin caches workspace state and tool
registration per process. The local daemon and its data are independent of the DSH row; stop it
with `$env:HINDSIGHT_EMBED_PROFILE='default'; hindsight-embed daemon stop` if it is no longer
wanted.

The row can also be disabled through the machine-local config with `"disabled": true`, or left
mounted but inert while another server is used.

## Cost and privacy

The daemon is local and loopback-bound; memory data stays on this PC. Fact extraction and
knowledge-page synthesis call the DeepSeek API configured in the profile, so automatic retention
and page refreshes consume DeepSeek tokens. A repo's first seed may also run the codebase survey;
set `codebaseSurvey` or the other upstream cost knobs in `coding-agent.json` if you want a quieter
profile. No Hindsight Cloud endpoint is used by the shipped default.

## Updating

The local runtime is pinned in `setup-hindsight.ps1` by `$ToolVersion = '1.1.0'` and
`$ApiVersion = '1.1.0'`; the profile records `HINDSIGHT_EMBED_API_VERSION` and the database URL.
To update the runtime, change both constants together, rerun the one-click script, and repeat the
retain/restart/recall persistence check. Rerunning keeps the pin and does not switch an existing
database.

The DSH plugin package is pinned at `@vectorize-io/hindsight-coding-agents@0.8.2`. The canonical
pin validation treats `packages/plugin-hindsight/package.json` as the source of truth, requires the
root and generated setup declarations to match, and rejects ranges, `latest`, mutable tags, and
invalid SemVer. To update it, change the exact version in the plugin manifest and root
`package.json`, run `pnpm install`, `pnpm gen`, and `pnpm build`, then run `pnpm validate` and the
live retain/recall plus restart acceptance before publishing a new set release and tag. Do not
hand-edit the generated setup manifest or vendored tree. The documented one-click URL targets
`main`, so it becomes live only after the release commit is pushed.

## Do not combine wiring routes

The official `npx @vectorize-io/hindsight-coding-agents install dsh` route writes a home-level
`$DSH_HOME/cordis.patch.yml` row and stages its own runtime. The setup bundle ships its own row.
Use one route, not both, or Hindsight mounts twice. This setup uses the bundle row plus the local
`hindsight-embed` daemon.

## Upstream

- [Hindsight](https://github.com/vectorize-io/hindsight) (MIT for the coding-agent integration;
  the server is Apache-2.0).
- [Coding Agents integration](https://hindsight.vectorize.io/sdks/integrations/coding-agents).
- [Daemon CLI (`hindsight-embed`)](https://hindsight.vectorize.io/sdks/embed).
