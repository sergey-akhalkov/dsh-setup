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
        const now = options.now ?? (() => new Date());
        const banks = [];
        for (const bankId of bankIds) {
            const transferred = await client.exportBank(bankId, {
                includeHistory: config.includeHistory,
            });
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
