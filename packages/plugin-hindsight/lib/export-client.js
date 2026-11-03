import { ExportError, messageOf } from './export-errors.js';
/** The server's own 404 for an operation row that is already gone. */
const MISSING_OPERATION = /^Operation .+ not found for bank /u;
const DEFAULTS = {
    requestTimeoutMs: 8_000,
    pollIntervalMs: 500,
    operationTimeoutMs: 120_000,
};
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
async function detailOf(response) {
    try {
        const parsed = await response.json();
        if (!isRecord(parsed))
            return undefined;
        for (const key of ['detail', 'message', 'error']) {
            const value = parsed[key];
            if (typeof value === 'string' && value.trim() !== '')
                return value.trim();
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * The local Hindsight REST surface the exporter needs: list banks, submit an
 * async export, poll it, and download the resulting archive. Every failure is a
 * typed {@link ExportError}, so the caller can fail open with a reason.
 */
export class TransferClient {
    #apiUrl;
    #fetch;
    #requestTimeoutMs;
    #pollIntervalMs;
    #operationTimeoutMs;
    constructor(options) {
        this.#apiUrl = options.apiUrl.replace(/\/+$/u, '');
        this.#fetch = options.fetchImpl ?? fetch;
        this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;
        this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULTS.pollIntervalMs;
        this.#operationTimeoutMs = options.operationTimeoutMs ?? DEFAULTS.operationTimeoutMs;
    }
    /** The endpoint this client talks to; reported by a failure line. */
    get apiUrl() {
        return this.#apiUrl;
    }
    async #send(target, init) {
        const url = /^https?:\/\//iu.test(target) ? target : `${this.#apiUrl}${target}`;
        try {
            return await this.#fetch(url, {
                ...init,
                signal: AbortSignal.timeout(this.#requestTimeoutMs),
            });
        }
        catch (error) {
            throw new ExportError('unreachable', `Hindsight is unreachable at ${this.#apiUrl}: ${messageOf(error)}`, {
                cause: error,
            });
        }
    }
    async #json(response, what) {
        try {
            const parsed = await response.json();
            if (!isRecord(parsed))
                throw new ExportError('http', `${what} did not return a JSON object`);
            return parsed;
        }
        catch (error) {
            if (error instanceof ExportError)
                throw error;
            throw new ExportError('http', `${what} did not return JSON: ${messageOf(error)}`, {
                cause: error,
            });
        }
    }
    async #failure(response, what, notFound) {
        const detail = await detailOf(response);
        const code = response.status === 404 ? notFound : 'http';
        return new ExportError(code, detail ?? `${what} answered HTTP ${response.status}`);
    }
    /** Every bank id the server lists, one page at a time. */
    async listBanks() {
        const banks = [];
        for (let offset = 0, pages = 0; pages < 1_000; pages += 1) {
            const response = await this.#send(`/v1/default/banks?limit=100&offset=${offset}`);
            if (!response.ok)
                throw await this.#failure(response, 'bank list', 'http');
            const document = await this.#json(response, 'bank list');
            const listed = Array.isArray(document.banks) ? document.banks : [];
            const ids = listed
                .map((entry) => isRecord(entry) && typeof entry.bank_id === 'string' ? entry.bank_id : undefined)
                .filter((id) => id !== undefined);
            banks.push(...ids);
            const total = typeof document.total === 'number' ? document.total : banks.length;
            if (ids.length === 0 || banks.length >= total)
                break;
            offset += ids.length;
        }
        return banks;
    }
    /** Submit a whole-bank export, wait for it, and download the archive. */
    async exportBank(bankId, options) {
        const query = new URLSearchParams({
            include_data: 'true',
            include_bank_config: 'true',
            include_history: String(options.includeHistory),
        });
        const path = `/v1/default/banks/${encodeURIComponent(bankId)}/transfer/export?${query.toString()}`;
        const response = await this.#send(path, { method: 'POST' });
        if (!response.ok) {
            throw await this.#failure(response, `export of bank "${bankId}"`, 'bank-not-found');
        }
        const submitted = await this.#json(response, 'export submit');
        const operationId = submitted.operation_id;
        if (typeof operationId !== 'string' || operationId === '') {
            throw new ExportError('http', 'export submit returned no operation id');
        }
        const metadata = await this.#waitForOperation(bankId, operationId);
        const zip = await this.#download(metadata, bankId);
        return { operationId, metadata, zip };
    }
    async #waitForOperation(bankId, operationId) {
        const deadline = Date.now() + this.#operationTimeoutMs;
        while (Date.now() < deadline) {
            const path = `/v1/default/banks/${encodeURIComponent(bankId)}/operations/${encodeURIComponent(operationId)}`;
            const response = await this.#send(path);
            if (!response.ok) {
                const error = await this.#failure(response, `export operation ${operationId}`, 'http');
                throw new ExportError('operation-failed', error.message);
            }
            const document = await this.#json(response, `export operation ${operationId}`);
            const status = document.status;
            if (status === 'completed') {
                const metadata = document.result_metadata;
                if (!isRecord(metadata)) {
                    throw new ExportError('operation-failed', `export of bank "${bankId}" completed without metadata`);
                }
                return metadata;
            }
            if (status === 'failed' || status === 'cancelled') {
                const reason = typeof document.error_message === 'string' && document.error_message !== ''
                    ? `: ${document.error_message}`
                    : '';
                throw new ExportError('operation-failed', `export of bank "${bankId}" was ${status}${reason}`);
            }
            await sleep(this.#pollIntervalMs);
        }
        throw new ExportError('operation-failed', `export of bank "${bankId}" timed out after ${this.#operationTimeoutMs} ms`);
    }
    async #download(metadata, bankId) {
        const downloadUrl = typeof metadata.download_url === 'string' ? metadata.download_url : undefined;
        const storageKey = typeof metadata.storage_key === 'string' ? metadata.storage_key : undefined;
        const target = downloadUrl ??
            (storageKey === undefined
                ? undefined
                : `/v1/default/files/download/${storageKey.split('/').map(encodeURIComponent).join('/')}`);
        if (target === undefined) {
            throw new ExportError('operation-failed', `export of bank "${bankId}" carried no download handle`);
        }
        const response = await this.#send(target);
        if (!response.ok)
            throw await this.#failure(response, `archive download for bank "${bankId}"`, 'http');
        return new Uint8Array(await response.arrayBuffer());
    }
    /**
     * Delete one terminal operation. The server treats the row as the archive's
     * only handle, so this is what drops the stored transfer ZIP. Only the
     * server's own "Operation <id> not found for bank <bank>" 404 counts as
     * already deleted; any other 404 (a bare framework one, a proxy page, an empty
     * body) means the route is not there and must be reported, not swallowed.
     */
    async deleteOperation(bankId, operationId) {
        const path = `/v1/default/banks/${encodeURIComponent(bankId)}/operations/${encodeURIComponent(operationId)}/delete`;
        const response = await this.#send(path, { method: 'DELETE' });
        if (response.status === 404) {
            const detail = await detailOf(response);
            if (detail !== undefined && MISSING_OPERATION.test(detail))
                return;
            throw new ExportError('cleanup-unavailable', `Hindsight at ${this.#apiUrl} does not offer operation deletion`);
        }
        if (response.ok)
            return;
        if (response.status === 405) {
            throw new ExportError('cleanup-unavailable', `Hindsight at ${this.#apiUrl} does not offer operation deletion`);
        }
        throw await this.#failure(response, `delete of operation ${operationId}`, 'http');
    }
    /** One page of completed whole-bank export operations, newest first. */
    async listCompletedExportOperations(bankId, page = {}) {
        const query = new URLSearchParams({
            type: 'export_bank',
            status: 'completed',
            limit: String(page.limit ?? 100),
            offset: String(page.offset ?? 0),
        });
        const path = `/v1/default/banks/${encodeURIComponent(bankId)}/operations?${query.toString()}`;
        const response = await this.#send(path);
        if (response.status === 404 || response.status === 405) {
            throw new ExportError('cleanup-unavailable', `Hindsight at ${this.#apiUrl} does not offer operation listing`);
        }
        if (!response.ok) {
            throw await this.#failure(response, `operation list for bank "${bankId}"`, 'http');
        }
        const document = await this.#json(response, 'operation list');
        const listed = Array.isArray(document.operations) ? document.operations : [];
        return listed.flatMap((entry) => {
            if (!isRecord(entry) || typeof entry.id !== 'string')
                return [];
            const completedAt = entry.updated_at ?? entry.created_at;
            return typeof completedAt === 'string'
                ? [{ id: entry.id, completedAt: new Date(completedAt) }]
                : [];
        });
    }
}
