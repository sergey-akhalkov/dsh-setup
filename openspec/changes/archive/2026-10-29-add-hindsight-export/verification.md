# Acceptance record

## 8.2 Owner acceptance — 2026-10-29

The acceptance ran against a throwaway configuration: a temporary Hindsight home for the
profile and logs, plus a dedicated `pg0` database instance (`hindsight-acceptance`, port
5433) separate from the live default instance (`hindsight-embed-default`, port 5432). The
live Harness profile and the live default database were not used and were not modified.

### Throwaway profile

The temporary profile `<scratch>/acceptance/home/.hindsight/embed` contained (the key is
redacted here and was read from the live machine-local profile without printing it):

```text
HINDSIGHT_EMBED_API_VERSION=1.1.0
HINDSIGHT_EMBED_API_DATABASE_URL=pg0://hindsight-acceptance
HINDSIGHT_API_LLM_PROVIDER=deepseek
HINDSIGHT_API_LLM_MODEL=deepseek-chat
HINDSIGHT_API_LLM_API_KEY=<key>
HINDSIGHT_API_HOST=127.0.0.1
HINDSIGHT_API_PORT=8899
HINDSIGHT_EMBED_DAEMON_IDLE_TIMEOUT=0
```

The profile was activated with the throwaway home and started with:

```powershell
$pg0Root = Join-Path $env:USERPROFILE '.pg0'   # real machine pg0 root, captured before the throwaway redirect
$env:USERPROFILE = '<scratch>/acceptance/home'
$env:HOME = '<scratch>/acceptance/home'
$env:HINDSIGHT_EMBED_PROFILE = 'default'
$env:SSL_CERT_FILE = '<scratch>/acceptance/home/.hindsight/windows-certs.pem'
$env:REQUESTS_CA_BUNDLE = $env:SSL_CERT_FILE
& '<hindsight-embed.exe>' daemon start
Invoke-RestMethod 'http://127.0.0.1:8899/health'
```

`pg0` resolves its data root through the Windows known-folder API, not `USERPROFILE`;
the dedicated instance was therefore created under the machine's standard pg0 root while
the Hindsight profile and logs stayed in the temporary home. The acceptance harness
captured the machine's `.pg0` directory as `$pg0Root` before redirecting `USERPROFILE`;
the resolved instance directory is `$pg0Root\instances\hindsight-acceptance`, and the wipe
and cleanup commands below use exactly that path. `hindsight-embed daemon status` reported
the throwaway daemon running before the steps below.

### Retain

```powershell
$retainBody = @{ items = @(@{
  content = 'The acceptance-110de31c marker proves the throwaway Hindsight restore.'
  document_id = 'acceptance-doc'
}) } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8899/v1/default/banks/acceptance-bank/memories' `
  -ContentType 'application/json' -Body $retainBody -TimeoutSec 180
```

The retain returned success.

### Export

Temporary local-only export configuration:

```json
{ "dir": "<scratch>/acceptance/export", "enabled": true, "autoPush": false }
```

Exporter script (`<scratch>/acceptance/export.mjs`):

```js
import { resolveExportConfig } from '../../packages/plugin-hindsight/lib/export-config.js'
import { runExportCycle } from '../../packages/plugin-hindsight/lib/export-cycle.js'
const config = resolveExportConfig({})
const result = await runExportCycle({
  config,
  apiUrl: 'http://127.0.0.1:8899',
  log: (line) => console.log(line),
})
console.log(JSON.stringify(result))
```

Command:

```powershell
$env:HINDSIGHT_EXPORT_CONFIG = '<scratch>/acceptance/export-config.json'
node '<scratch>/acceptance/export.mjs'
```

Result:

```text
{"outcome":"committed","banks":1,"changed":true,"committed":true,"pushed":false}
```

### Wipe

```powershell
& '<hindsight-embed.exe>' daemon stop
& '<pg0.exe>' stop --name hindsight-acceptance --timeout 60
Remove-Item (Join-Path $pg0Root 'instances\hindsight-acceptance') -Recurse -Force
& '<hindsight-embed.exe>' daemon start
(Invoke-RestMethod 'http://127.0.0.1:8899/v1/default/banks').banks
```

The fresh database listed no banks.

### Restore and recall

```powershell
pwsh -NoProfile -File restore-hindsight.ps1 -From <scratch>/acceptance/export `
  -Bank acceptance-bank -TargetBank acceptance-bank `
  -ApiUrl http://127.0.0.1:8899
```

Result: exit `0`; `restored bank 'acceptance-bank' -> 'acceptance-bank': 1 documents,
1 facts, 1 observations`.

```powershell
$recallBody = @{ query = 'What is the acceptance marker?'; max_tokens = 2000 } | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri 'http://127.0.0.1:8899/v1/default/banks/acceptance-bank/memories/recall' `
  -ContentType 'application/json' -Body $recallBody -TimeoutSec 120
```

Result:

```text
The acceptance-110de31c marker proves the throwaway Hindsight restore, serving as its verification marker.
```

### Cleanup

```powershell
& '<hindsight-embed.exe>' daemon stop
& '<pg0.exe>' stop --name hindsight-acceptance --timeout 60
Remove-Item (Join-Path $pg0Root 'instances\hindsight-acceptance') -Recurse -Force
Remove-Item '<scratch>/acceptance' -Recurse -Force
Invoke-RestMethod 'http://127.0.0.1:8888/health'
```

The live daemon reported `healthy/connected`; the live default database and the live
Harness profile were not modified.

### Live durable export (additional evidence)

The production configuration was also exercised: `setup-hindsight.ps1` completed with a
private remote and a healthy daemon, and the real exporter committed and pushed three
banks at export-repository commit `8178372`
(`{"outcome":"committed","banks":3,"changed":true,"committed":true,"pushed":true}`),
including the project bank `coding-agent::dsh-setup` and the setup check bank. Restoring
the exported setup-check bank into a fresh target bank in the live database succeeded
(exit `0`, 1 document/1 fact/1 observation); recall returned its
`dsh-hindsight-setup-adefffbd` marker; deleting that test bank and restoring it again
reproduced the same counts and marker.
