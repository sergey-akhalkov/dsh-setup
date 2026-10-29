/** One export operation's terminal metadata. */
export type OperationMetadata = Record<string, unknown>;
/** A completed bank export: the operation, its metadata, and the archive bytes. */
export interface BankTransferResult {
    operationId: string;
    metadata: OperationMetadata;
    zip: Uint8Array;
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
}
