/** One export operation's terminal metadata. */
export type OperationMetadata = Record<string, unknown>;
/** A completed bank export: the operation, its metadata, and the archive bytes. */
export interface BankTransferResult {
    operationId: string;
    metadata: OperationMetadata;
    zip: Uint8Array;
}
/** One completed whole-bank export, as the stale-archive sweep sees it. */
export interface CompletedExportOperation {
    id: string;
    /** Completion time: `updated_at`, falling back to `created_at`. */
    completedAt: Date;
}
/** Connection and polling knobs; production defaults keep one cycle short. */
export interface TransferClientOptions {
    apiUrl: string;
    fetchImpl?: typeof fetch;
    requestTimeoutMs?: number;
    pollIntervalMs?: number;
    operationTimeoutMs?: number;
}
/**
 * The local Hindsight REST surface the exporter needs: list banks, submit an
 * async export, poll it, and download the resulting archive. Every failure is a
 * typed {@link ExportError}, so the caller can fail open with a reason.
 */
export declare class TransferClient {
    #private;
    constructor(options: TransferClientOptions);
    /** The endpoint this client talks to; reported by a failure line. */
    get apiUrl(): string;
    /** Every bank id the server lists, one page at a time. */
    listBanks(): Promise<string[]>;
    /** Submit a whole-bank export, wait for it, and download the archive. */
    exportBank(bankId: string, options: {
        includeHistory: boolean;
    }): Promise<BankTransferResult>;
    /**
     * Delete one terminal operation. The server treats the row as the archive's
     * only handle, so this is what drops the stored transfer ZIP. A 404 that names
     * the operation is an operation already gone and counts as deleted; the
     * framework's bare 404 means the route itself is missing.
     */
    deleteOperation(bankId: string, operationId: string): Promise<void>;
    /** One page of completed whole-bank export operations, newest first. */
    listCompletedExportOperations(bankId: string, page?: {
        limit?: number;
        offset?: number;
    }): Promise<CompletedExportOperation[]>;
}
