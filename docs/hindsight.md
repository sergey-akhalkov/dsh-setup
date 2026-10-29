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
- The same plugin exports every bank as JSON into a private Git repository (on by default), and the
  setup ships `restore-hindsight.ps1` for the way back; see
  [Durable memory export](#durable-memory-export) and
  [Restore from the export](#restore-from-the-export).
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

## Durable memory export

Every bank is exported as JSON into a private Git repository, on by default. The 2026-10-29
incident that emptied the Harness home and the local database is what this protects against: the
repository lives outside both, and its Git history keeps every committed snapshot.

The exporter is part of `@dsh-setup/plugin-hindsight` and deliberately small:

- it runs every `export.intervalMinutes` minutes (default 5), after a session goes idle, and once
  best-effort when the Host disposes the plugin;
- it asks the local Hindsight API for the native bank transfer archive, unpacks it, and stores the
  entries verbatim under one folder per bank;
- it never blocks or fails a session: a missing server, a failed export, or a failed push is logged
  as `hindsight export: ...` and the next cycle retries;
- it registers no tool, command, or prompt section.

### Where it writes

The default target is `%USERPROFILE%\hindsight-export`. A target inside the Harness home or the
`pg0` database directory is refused, because the wipe that motivated the export took both.

The target directory and the remote are machine-local and never live in this repository. Write
`%USERPROFILE%\.dsh\hindsight-export.json`:

```json
{
  "dir": "<absolute target directory>",
  "remote": "<private remote URL>"
}
```

`dir` and `remote` are the machine-specific keys; the export switches below may also be set there
and win over the row. A tracked fragment or setup default that carries `export.dir` or
`export.remote` is rejected by `pnpm validate:repo`, so the file (or a machine-local profile patch)
is the only place they can come from.

The layout is one folder per bank plus an index:

```text
<target>/
  .git/
  index.json
  banks/<sanitized-bank>-<hash>/
    export.json
    manifest.json
    documents/000000.json
    documents/000001.json
    observations.json
    mental_models.json
    knowledge_pages.json
    data/<table>.json
    history/<table>.json      # only with includeHistory
    attachments.json          # only with includeAttachments
    blobs/<ordinal>           # only with includeAttachments
```

- `index.json` lists every bank folder, its export time and operation, and the normalized content
  hash of the last snapshot.
- `export.json` is the exporter's metadata: the original bank id, export time and operation id,
  counts, archive schema version, the requested scope, and a SHA-256 for every stored entry. The
  folder name is a reversible sanitization plus an id hash because bank ids contain `:`; restore
  reads the original id from `export.json`, never from the folder name.
- Archive entries are stored byte for byte (`manifest.json` is the transfer manifest), so an import
  consumes exactly what Hindsight produced.
- Embeddings are never exported. Hindsight recomputes them on import, so a restore costs CPU time
  but no model tokens.
- History (audit log and LLM request log) and attachments are off by default. Attachments travel
  with the data section on the wire, so the exporter strips `attachments.json` and `blobs/**`
  unless `includeAttachments` is on.

### Git behavior

- A dedicated repository: the exporter runs `git init` (and adds the remote) when the target is
  empty, or clones the configured remote when the directory is missing.
- Commits use the fixed identity `Hindsight Export <hindsight-export@localhost>`; your own Git
  identity is never borrowed.
- A snapshot is committed only when its normalized content changes (key order and array order are
  normalized, `exported_at` is ignored), so an unchanged bank produces no commit and no push.
- With a remote configured and `autoPush` on, the commit is pushed without force. A failed push
  keeps the local commit and is retried on a later cycle, including cycles where the content did
  not change. A diverged remote is reconciled with fetch and rebase; a conflict stops the push and
  is reported.
- Git runs headless: `GIT_TERMINAL_PROMPT=0`, Git Credential Manager in non-interactive mode, and a
  failing askpass helper, so no credential dialog can block a cycle. Authentication comes from the
  existing Git credential helper or SSH agent.
- One writer at a time: a lock file inside the repository serializes cycles across Host processes,
  and an abandoned lock is taken over after fifteen minutes.

### Configuration

| Key                  | Default | Meaning                                                           |
| -------------------- | ------- | ----------------------------------------------------------------- |
| `enabled`            | `true`  | Export at all; `false` stops every write and Git command.         |
| `dir`                | -       | Target directory; machine-local file and profile patch only.      |
| `intervalMinutes`    | `5`     | Minutes between automatic cycles.                                 |
| `autoCommit`         | `true`  | Commit a changed snapshot.                                        |
| `autoPush`           | `true`  | Push after a commit when a remote is configured.                  |
| `includeHistory`     | `false` | Also carry the audit log and LLM request log.                     |
| `includeAttachments` | `false` | Also carry attachment rows and bytes.                             |
| `importOnEmpty`      | `false` | Log a restore hint when the server lists no banks; never imports. |

The row configuration is a complete object, so a profile override restates every key it keeps:

```yaml
- id: dsh-setup-hindsight
  config:
    serverMode: self-hosted
    apiUrl: http://127.0.0.1:8888
    autostart: true
    export:
      enabled: true
      intervalMinutes: 15
      autoCommit: true
      autoPush: false
      includeHistory: false
      includeAttachments: false
      importOnEmpty: false
```

To turn the export off without touching the row, add `"enabled": false` to
`%USERPROFILE%\.dsh\hindsight-export.json`. Nothing is written, no Git command runs, and memory
keeps working.

### Privacy boundary

Memory contains conversation text, code, and whatever else a session retained, and it can contain
secrets. The export is a copy of that data:

- keep the remote **private**; there is no automatic push without a configured remote;
- history and attachments stay off unless you enable them;
- the remote URL and Git credentials never enter this repository; they live in the machine-local
  file and your Git credential store;
- the target directory holds plain JSON: anyone who can read it, or the remote, can read the
  memory. Full-disk or repository access control is the protection.

### Credentials

The exporter never asks for a credential and never stores one. Before enabling auto-push, make sure
the Git credential helper or SSH agent already authorizes the private remote for your user, for
example by pushing a commit by hand once:

```powershell
git -C "$env:USERPROFILE\hindsight-export" push origin HEAD
```

If that works without a prompt, the exporter will push too. A push that fails for authentication or
network reasons is retried later; the local commits are kept.

## Restore from the export

`restore-hindsight.ps1` rebuilds each bank's transfer archive from the stored JSON, verifies the
manifest and every checksum, imports it through the local API, and compares the imported counts
with the manifest. It never touches the live Harness home; it only reads the export tree and talks
to the daemon you point it at.

Restore is deliberately manual. A deliberately deleted bank must not silently return, so nothing
imports automatically.

### Procedure

```powershell
# 1. Inspect. Rebuilds and validates every archive, changes no bank, sends no request.
pwsh -NoProfile -File restore-hindsight.ps1 -From "$env:USERPROFILE\hindsight-export" -DryRun

# 2. Restore every bank into a fresh database from the local copy.
pwsh -NoProfile -File restore-hindsight.ps1 -From "$env:USERPROFILE\hindsight-export"

# 3. Or restore from the private remote when the local copy is gone.
pwsh -NoProfile -File restore-hindsight.ps1 -Repo "<private remote URL>"

# 4. One bank, under a different id.
pwsh -NoProfile -File restore-hindsight.ps1 -From "$env:USERPROFILE\hindsight-export" `
  -Bank "coding-agent::repo" -TargetBank "coding-agent::repo-restored"

# 5. Recover the documents of one bank into an existing bank.
pwsh -NoProfile -File restore-hindsight.ps1 -From "$env:USERPROFILE\hindsight-export" `
  -Bank "coding-agent::repo" -Mode merge
```

`restore` (the default) needs an absent target bank: the script refuses to write over an existing
one and names the merge option instead. The import is recorded against a temporary
`hindsight-restore-*` operation bank, which is deleted afterwards. `merge` imports documents into an
existing bank and skips conflicting document ids; it carries no bank configuration, mental models,
or knowledge pages.

| Option            | Meaning                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `-From`           | Exported tree directory.                                                    |
| `-Repo`           | Private remote cloned to a temporary directory when the local copy is gone. |
| `-Bank`           | One or more bank ids; default is every bank in the tree.                    |
| `-Mode`           | `restore` (absent bank) or `merge` (existing bank, documents only).         |
| `-TargetBank`     | Restore target id; defaults to the archive's source bank. One bank only.    |
| `-DryRun`         | Verify, rebuild, and report only; no request, no bank change.               |
| `-IncludeHistory` | Also restore history when the archive carries it.                           |
| `-SkipVerify`     | Skip the post-import count comparison.                                      |
| `-ApiUrl`         | Endpoint; defaults to `HINDSIGHT_API_URL` or `http://127.0.0.1:8888`.       |
| `-ArchiveOut`     | With `-DryRun`, write each rebuilt `.zip` there for inspection or hand-off. |

Exit codes: `0` success, `1` usage or validation error, `2` target bank already exists (use
merge), `3` imported counts differ from the manifest, `4` daemon down and no `hindsight-admin`,
`5` import failure or timeout.

### When the daemon cannot start

The script checks `/health` first. When the daemon is down it runs the documented
`setup-hindsight.ps1` only if `hindsight-embed` is already installed (it never installs silently).
If that fails or the tool is missing, it falls back to the offline importer:

```powershell
hindsight-admin import-bank --archive "<kept archive>" --target-bank "<bank id>"
```

Without `hindsight-admin` the script prints that command together with the path of a kept archive
and exits `4`. Point it at the `pg0` instance's configured database like the other `hindsight-admin`
commands.

### Limitations

- `restore` restores whole banks only; `merge` recovers documents only.
- Facts are re-embedded on import: CPU time, no LLM tokens, no new facts.
- History and attachments are restored only if they were exported and requested.
- The daemon must be reachable, or `hindsight-admin` must be installed for the offline path.
- A failed push delays the remote copy; the local repository still has the snapshot.
- A very large bank makes a large repository; move the target or prune its history if needed.

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

For the export, `%USERPROFILE%\.dsh\hindsight-export.json` outranks the row's `export` block, which
outranks the defaults.

The row configuration is a complete object; a profile override must restate every key it keeps, for
example both `serverMode` and `apiUrl` (and the `export` block when the row sets one):

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

The export has its own switch: `"enabled": false` in `%USERPROFILE%\.dsh\hindsight-export.json`
(or the row's `export.enabled`) stops all writes and Git commands without affecting memory. Moving
or deleting the target directory only removes the export copy; the database is untouched. There is
no database migration to roll back.

## Cost and privacy

The daemon is local and loopback-bound; memory data stays on this PC. Fact extraction and
knowledge-page synthesis call the DeepSeek API configured in the profile, so automatic retention
and page refreshes consume DeepSeek tokens. A repo's first seed may also run the codebase survey;
set `codebaseSurvey` or the other upstream cost knobs in `coding-agent.json` if you want a quieter
profile. No Hindsight Cloud endpoint is used by the shipped default.

The export copies whatever memory holds — conversation text included — into a Git repository. It
consumes disk and Git history rather than tokens, and it is only as private as that repository and
directory. Keep the remote private and see [Privacy boundary](#privacy-boundary).

## Updating

The local runtime is pinned in `setup-hindsight.ps1` by `$ToolVersion = '1.1.0'` and
`$ApiVersion = '1.1.0'`; the profile records `HINDSIGHT_EMBED_API_VERSION` and the database URL.
To update the runtime, change both constants together, rerun the one-click script, and repeat the
retain/restart/recall persistence check. Rerunning keeps the pin and does not switch an existing
database.

The exporter writes metadata schema version `1` (`export.json` and `index.json`), and
`restore-hindsight.ps1` refuses any other version instead of guessing. A future archive layout change
therefore needs a restore-side migration before old snapshots are dropped.

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
