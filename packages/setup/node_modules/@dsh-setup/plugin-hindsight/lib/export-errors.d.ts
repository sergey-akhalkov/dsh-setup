/** Failure codes the exporter reports; every exporter path throws one of these. */
export type ExportErrorCode = 'config' | 'zip' | 'archive' | 'http' | 'bank-not-found' | 'operation-failed' | 'unreachable' | 'lock' | 'git';
/** A typed exporter failure: the cycle catches it and reports instead of crashing the Host. */
export declare class ExportError extends Error {
    readonly code: ExportErrorCode;
    constructor(code: ExportErrorCode, message: string, options?: {
        cause?: unknown;
    });
}
/** The message of an unknown throwable, for a report line. */
export declare function messageOf(error: unknown): string;
