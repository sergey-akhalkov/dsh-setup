import { TransferClient } from './export-client.js';
import { isForbiddenExportDir } from './export-config.js';
import { ExportError, messageOf } from './export-errors.js';
import { bootstrapRepository, commitSnapshot, hasUnpushedCommits, pushSnapshot, } from './export-git.js';
import { acquireSnapshotLock, writeSnapshot } from './export-snapshot.js';
import { unpackArchive } from './export-zip.js';
const IDLE = {
    outcome: 'unchanged',
    banks: 0,
    changed: false,
    committed: false,
    pushed: false,
};
function report(options, message) {
    ;
    (options.log ?? ((line) => console.error(line)))(`hindsight export: ${message}`);
}
/** Completed exports older than this may belong to another process still downloading. */
const CLEANUP_GRACE_MS = 60 * 60 * 1000;
/** One page of stale deletions per bank per cycle keeps a backlog from bursting. */
const CLEANUP_PAGE_SIZE = 100;
/** An unsupported server is reported once per cycle, not once per bank. */
function isCleanupUnavailable(error) {
    return error instanceof ExportError && error.code === 'cleanup-unavailable';
}
/**
 * Delete completed whole-bank export operations that finished more than the
 * grace period ago, at most one page of deletions per bank, so the archives left
 * by earlier versions or by a crash between download and delete do not
 * accumulate. Recent pages are walked past, not treated as the end. A failure is
 * reported and retried by the next cycle. Returns false when the server does not
 * offer the operation routes at all.
 */
async function sweepArchives(options, client, bankIds) {
    const now = (options.now ?? (() => new Date()))().getTime();
    for (const bankId of bankIds) {
        let offset = 0;
        let deleted = 0;
        try {
            while (deleted < CLEANUP_PAGE_SIZE) {
                const page = await client.listCompletedExportOperations(bankId, {
                    limit: CLEANUP_PAGE_SIZE,
                    offset,
                });
                if (page.length === 0)
                    break;
                let kept = 0;
                for (const operation of page) {
                    // An unparseable completion time compares false: keep it, never sweep it.
                    const age = now - operation.completedAt.getTime();
                    if (!(age > CLEANUP_GRACE_MS)) {
                        kept += 1;
                        continue;
                    }
                    if (deleted >= CLEANUP_PAGE_SIZE)
                        break;
                    await client.deleteOperation(bankId, operation.id);
                    deleted += 1;
                }
                // Deleting shifts the page: only the entries kept hold their offset. A
                // full page of recent operations is walked past, not a stop, so the
                // stale backlog behind it still drains.
                offset += kept;
                if (page.length < CLEANUP_PAGE_SIZE)
                    break;
            }
        }
        catch (error) {
            if (isCleanupUnavailable(error)) {
                report(options, `archive cleanup unavailable: ${messageOf(error)}`);
                return false;
            }
            report(options, `archive sweep for bank "${bankId}" failed: ${messageOf(error)}`);
        }
    }
    return true;
}
/**
 * Delete one bank's transfer archive. The archive is a transfer copy, not the
 * durable export, so a failed delete is reported and retried by the next sweep
 * instead of changing the cycle outcome. False when the server cannot clean up.
 */
async function deleteArchive(options, client, bankId, operationId) {
    try {
        await client.deleteOperation(bankId, operationId);
        return true;
    }
    catch (error) {
        if (isCleanupUnavailable(error)) {
            report(options, `archive cleanup unavailable: ${messageOf(error)}`);
            return false;
        }
        report(options, `archive cleanup for bank "${bankId}" failed: ${messageOf(error)}`);
        return true;
    }
}
/**
 * One full export cycle: list banks, export each through the transfer API,
 * write the snapshot, commit it when the content changed, and push when a
 * remote is configured. Only the configured directory is touched, and every
 * failure is reported and retried by the next cycle.
 */
export async function runExportCycle(options) {
    const { config } = options;
    if (!config.enabled)
        return { ...IDLE, outcome: 'disabled' };
    if (isForbiddenExportDir(config.dir)) {
        report(options, `refusing export directory ${config.dir}: it is inside the Harness home or pg0`);
        return { ...IDLE, outcome: 'forbidden', reason: 'forbidden directory' };
    }
    let lock;
    try {
        const gitOptions = { timeoutMs: options.git?.timeoutMs, env: options.git?.env };
        await bootstrapRepository({ dir: config.dir, remote: config.remote, ...gitOptions });
        lock = acquireSnapshotLock(config.dir);
        const client = new TransferClient({
            apiUrl: options.apiUrl,
            ...options.client,
        });
        const bankIds = await client.listBanks();
        if (bankIds.length === 0) {
            if (config.importOnEmpty) {
                report(options, `the Hindsight server lists no banks; restore one with restore-hindsight.ps1 -Repo <private remote>`);
            }
            return { ...IDLE, outcome: 'unchanged' };
        }
        // Export every bank before touching the tree: a failed export must not
        // publish a snapshot that silently drops that bank.
        let cleanup = await sweepArchives(options, client, bankIds);
        const now = options.now ?? (() => new Date());
        const banks = [];
        for (const bankId of bankIds) {
            const transferred = await client.exportBank(bankId, {
                includeHistory: config.includeHistory,
            });
            // Drop the server-side archive before anything that can fail: a malformed
            // archive, a failed commit, or a failed push must not keep it alive.
            if (cleanup) {
                cleanup = await deleteArchive(options, client, bankId, transferred.operationId);
            }
            banks.push({
                bankId,
                operationId: transferred.operationId,
                exportedAt: now().toISOString(),
                entries: unpackArchive(transferred.zip),
            });
        }
        return await snapshotAndPublish(options, banks, now);
    }
    catch (error) {
        const reason = messageOf(error);
        if (error instanceof ExportError && error.code === 'lock') {
            report(options, reason);
            return { ...IDLE, outcome: 'locked', reason };
        }
        report(options, `cycle failed: ${reason}`);
        return { ...IDLE, outcome: 'failed', reason };
    }
    finally {
        lock?.release();
    }
}
async function snapshotAndPublish(options, banks, now) {
    const { config } = options;
    const snapshot = writeSnapshot(config.dir, banks, {
        includeHistory: config.includeHistory,
        includeAttachments: config.includeAttachments,
        now,
    });
    let committed = false;
    if (snapshot.changed && config.autoCommit) {
        const commit = await commitSnapshot(config.dir, {
            message: `snapshot: ${banks.length} bank(s) at ${now().toISOString()}`,
            timeoutMs: options.git?.timeoutMs,
            env: options.git?.env,
        });
        committed = commit.committed;
    }
    // A failed push leaves local commits behind; retry them even when this cycle
    // exported identical content, otherwise the snapshot never reaches the remote.
    let pushed = false;
    let reason;
    if (config.autoPush && config.remote !== undefined && (await hasUnpushedCommits(config.dir))) {
        const push = await pushSnapshot(config.dir, {
            timeoutMs: options.git?.timeoutMs,
            env: options.git?.env,
        });
        pushed = push.pushed;
        reason = push.pushed ? undefined : push.reason;
        if (!push.pushed) {
            report(options, `snapshot not pushed (kept for the next cycle): ${reason ?? 'unknown error'}`);
        }
    }
    const outcome = snapshot.changed ? 'committed' : 'unchanged';
    const local = snapshot.changed && !committed && config.autoCommit;
    return {
        outcome: local ? 'local' : outcome,
        banks: banks.length,
        changed: snapshot.changed,
        committed,
        pushed,
        reason: reason ?? (local ? 'commit failed' : undefined),
    };
}
