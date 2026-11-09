import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CHANGE_NAME } from './command-parse.js';
import { isInside } from './fs-change.js';
import { readAuthenticatedRun, sameWorkspace } from './runs.js';
/**
 * Host-authenticated completion and adoption receipts. A receipt is the durable
 * authorization that survives run-history pruning; it is signed with the host
 * key outside the workspace, so a model-written receipt is refused even after a
 * reload and even when the run it names is gone.
 */
export const RECEIPT_VERSION = 1;
/** Domain separation for a receipt signature. */
const RECEIPT_DOMAIN = 'workflows/receipt/v1';
const DIGEST = /^[a-f0-9]{64}$/u;
/** The receipts directory for one workspace. */
export function receiptsDirectory(workspace) {
    return join(workspace, '.dsh', 'workflows', 'receipts');
}
/** The receipt file for one change name. */
export function receiptPath(workspace, change) {
    return join(receiptsDirectory(workspace), `${change}.json`);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
async function writeAtomic(file, text, workspace) {
    await mkdir(dirname(file), { recursive: true });
    const root = await realpath(workspace);
    const realDirectory = await realpath(dirname(file));
    if (!isInside(root, realDirectory)) {
        throw new Error('receipt refused: the receipts directory escapes the workspace');
    }
    const temporary = `${file}.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temporary, text, 'utf8');
    try {
        await rename(temporary, file);
    }
    catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}
function bodyOf(kind, change, digest, issuedAt, workspaceKey) {
    return { v: RECEIPT_VERSION, kind, change, digest, issuedAt, workspaceKey };
}
/** Write one signed receipt atomically; the caller has already verified. */
export async function writeReceipt(workspace, input) {
    if (!CHANGE_NAME.test(input.change)) {
        throw new Error(`receipt refused: "${input.change}" is not a valid change name`);
    }
    if (!DIGEST.test(input.digest)) {
        throw new Error('receipt refused: the verified spec digest must be 64 hex characters');
    }
    const body = bodyOf(input.kind, input.change, input.digest, input.now ?? Date.now(), workspace);
    const receipt = {
        ...body,
        signature: input.auth.sign(RECEIPT_DOMAIN, body),
    };
    await writeAtomic(receiptPath(workspace, input.change), `${JSON.stringify(receipt, null, 2)}\n`, workspace);
    return receipt;
}
function parseReceipt(value) {
    if (!isRecord(value))
        return undefined;
    if (value.v !== RECEIPT_VERSION ||
        (value.kind !== 'intake' && value.kind !== 'adoption') ||
        typeof value.change !== 'string' ||
        typeof value.digest !== 'string' ||
        !DIGEST.test(value.digest) ||
        typeof value.issuedAt !== 'number' ||
        typeof value.workspaceKey !== 'string' ||
        typeof value.signature !== 'string') {
        return undefined;
    }
    return value;
}
/**
 * Read and verify one receipt. A missing, unsigned, forged, or modified file
 * reads as absent, so the archive gate stays refused.
 */
export async function readReceipt(workspace, change, auth) {
    let raw;
    try {
        const root = await realpath(workspace);
        const target = await realpath(receiptPath(workspace, change));
        if (!isInside(root, target))
            return undefined;
        raw = await readFile(target, 'utf8');
    }
    catch {
        return undefined;
    }
    let receipt;
    try {
        receipt = parseReceipt(JSON.parse(raw));
    }
    catch {
        return undefined;
    }
    if (receipt === undefined || receipt.change !== change)
        return undefined;
    const { signature, ...body } = receipt;
    if (!auth.verify(RECEIPT_DOMAIN, body, signature))
        return undefined;
    return sameWorkspace(receipt.workspaceKey, workspace) ? receipt : undefined;
}
/** Every verified receipt in one workspace, newest first. */
export async function listReceipts(workspace, auth) {
    let names;
    try {
        names = await readdir(receiptsDirectory(workspace));
    }
    catch {
        return [];
    }
    const receipts = [];
    for (const name of names.sort()) {
        if (!name.endsWith('.json'))
            continue;
        const receipt = await readReceipt(workspace, name.slice(0, -'.json'.length), auth);
        if (receipt !== undefined)
            receipts.push(receipt);
    }
    return receipts.sort((left, right) => right.issuedAt - left.issuedAt);
}
/**
 * Issue the completion receipt for a completed `change-intake` run. The run is
 * re-read and authenticated first: a forged, unsigned, or modified run, or one
 * that did not complete, issues nothing.
 */
export async function issueCompletionReceipt(workspace, runId, digest, auth, now) {
    const run = await readAuthenticatedRun(workspace, runId, auth);
    if (run === undefined) {
        throw new Error('receipt refused: the intake run is unsigned, modified, or unreadable; no receipt was issued');
    }
    if (run.definition.id !== 'change-intake' || run.status !== 'completed') {
        throw new Error(`receipt refused: run "${run.id}" is not a completed change-intake run; no receipt was issued`);
    }
    const name = run.context.name;
    if (typeof name !== 'string' || !CHANGE_NAME.test(name)) {
        throw new Error('receipt refused: the completed run carries no valid change name');
    }
    return writeReceipt(workspace, {
        kind: 'intake',
        change: name,
        digest,
        auth,
        ...(now === undefined ? {} : { now }),
    });
}
/** Issue the adoption receipt after the host verified the existing artifacts. */
export async function issueAdoptionReceipt(workspace, change, digest, auth, now) {
    return writeReceipt(workspace, {
        kind: 'adoption',
        change,
        digest,
        auth,
        ...(now === undefined ? {} : { now }),
    });
}
/** A bounded one-line receipt failure for a caller's message. */
export function receiptFailure(error) {
    return errorMessage(error).slice(0, 300);
}
