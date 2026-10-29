import { TransferClient, type TransferClientOptions } from './export-client.js'
import { isForbiddenExportDir, type ResolvedExportConfig } from './export-config.js'
import { ExportError, messageOf } from './export-errors.js'
import {
  bootstrapRepository,
  commitSnapshot,
  hasUnpushedCommits,
  pushSnapshot,
} from './export-git.js'
import { acquireSnapshotLock, type BankSnapshotInput, writeSnapshot } from './export-snapshot.js'
import { unpackArchive } from './export-zip.js'

/** What one cycle did; every failure is reported, never thrown out of the cycle. */
export interface ExportCycleResult {
  outcome: 'disabled' | 'forbidden' | 'locked' | 'unchanged' | 'committed' | 'local' | 'failed'
  banks: number
  changed: boolean
  committed: boolean
  pushed: boolean
  /** Why a non-committed outcome happened, for the one-line report. */
  reason?: string
}

export interface ExportCycleOptions {
  config: ResolvedExportConfig
  /** Resolved Hindsight endpoint. */
  apiUrl: string
  /** Report sink; the default is console.error, matching the other Host plugins. */
  log?: (message: string) => void
  now?: () => Date
  client?: Partial<TransferClientOptions>
  git?: { timeoutMs?: number; env?: NodeJS.ProcessEnv }
}

const IDLE: ExportCycleResult = {
  outcome: 'unchanged',
  banks: 0,
  changed: false,
  committed: false,
  pushed: false,
}

function report(options: ExportCycleOptions, message: string): void {
  ;(options.log ?? ((line: string) => console.error(line)))(`hindsight export: ${message}`)
}

/**
 * One full export cycle: list banks, export each through the transfer API,
 * write the snapshot, commit it when the content changed, and push when a
 * remote is configured. Only the configured directory is touched, and every
 * failure is reported and retried by the next cycle.
 */
export async function runExportCycle(options: ExportCycleOptions): Promise<ExportCycleResult> {
  const { config } = options
  if (!config.enabled) return { ...IDLE, outcome: 'disabled' }
  if (isForbiddenExportDir(config.dir)) {
    report(options, `refusing export directory ${config.dir}: it is inside the Harness home or pg0`)
    return { ...IDLE, outcome: 'forbidden', reason: 'forbidden directory' }
  }

  let lock: ReturnType<typeof acquireSnapshotLock> | undefined
  try {
    const gitOptions = { timeoutMs: options.git?.timeoutMs, env: options.git?.env }
    await bootstrapRepository({ dir: config.dir, remote: config.remote, ...gitOptions })

    lock = acquireSnapshotLock(config.dir)
    const client = new TransferClient({
      apiUrl: options.apiUrl,
      ...options.client,
    })
    const bankIds = await client.listBanks()
    if (bankIds.length === 0) {
      if (config.importOnEmpty) {
        report(
          options,
          `the Hindsight server lists no banks; restore one with restore-hindsight.ps1 -Repo <private remote>`,
        )
      }
      return { ...IDLE, outcome: 'unchanged' }
    }

    // Export every bank before touching the tree: a failed export must not
    // publish a snapshot that silently drops that bank.
    const now = options.now ?? (() => new Date())
    const banks: BankSnapshotInput[] = []
    for (const bankId of bankIds) {
      const transferred = await client.exportBank(bankId, {
        includeHistory: config.includeHistory,
      })
      banks.push({
        bankId,
        operationId: transferred.operationId,
        exportedAt: now().toISOString(),
        entries: unpackArchive(transferred.zip),
      })
    }
    return await snapshotAndPublish(options, banks, now)
  } catch (error) {
    const reason = messageOf(error)
    if (error instanceof ExportError && error.code === 'lock') {
      report(options, reason)
      return { ...IDLE, outcome: 'locked', reason }
    }
    report(options, `cycle failed: ${reason}`)
    return { ...IDLE, outcome: 'failed', reason }
  } finally {
    lock?.release()
  }
}

async function snapshotAndPublish(
  options: ExportCycleOptions,
  banks: BankSnapshotInput[],
  now: () => Date,
): Promise<ExportCycleResult> {
  const { config } = options
  const snapshot = writeSnapshot(config.dir, banks, {
    includeHistory: config.includeHistory,
    includeAttachments: config.includeAttachments,
    now,
  })

  let committed = false
  if (snapshot.changed && config.autoCommit) {
    const commit = await commitSnapshot(config.dir, {
      message: `snapshot: ${banks.length} bank(s) at ${now().toISOString()}`,
      timeoutMs: options.git?.timeoutMs,
      env: options.git?.env,
    })
    committed = commit.committed
  }

  // A failed push leaves local commits behind; retry them even when this cycle
  // exported identical content, otherwise the snapshot never reaches the remote.
  let pushed = false
  let reason: string | undefined
  if (config.autoPush && config.remote !== undefined && (await hasUnpushedCommits(config.dir))) {
    const push = await pushSnapshot(config.dir, {
      timeoutMs: options.git?.timeoutMs,
      env: options.git?.env,
    })
    pushed = push.pushed
    reason = push.pushed ? undefined : push.reason
    if (!push.pushed) {
      report(options, `snapshot not pushed (kept for the next cycle): ${reason ?? 'unknown error'}`)
    }
  }

  const outcome = snapshot.changed ? 'committed' : 'unchanged'
  const local = snapshot.changed && !committed && config.autoCommit
  return {
    outcome: local ? 'local' : outcome,
    banks: banks.length,
    changed: snapshot.changed,
    committed,
    pushed,
    reason: reason ?? (local ? 'commit failed' : undefined),
  }
}
