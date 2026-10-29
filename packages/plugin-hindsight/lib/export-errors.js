/** A typed exporter failure: the cycle catches it and reports instead of crashing the Host. */
export class ExportError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = 'ExportError';
        this.code = code;
    }
}
/** The message of an unknown throwable, for a report line. */
export function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
