/** Failure codes the exporter reports; every exporter path throws one of these. */
export type ExportErrorCode =
  | 'config'
  | 'zip'
  | 'archive'
  | 'http'
  | 'bank-not-found'
  | 'operation-failed'
  | 'unreachable'
  | 'lock'
  | 'git'

/** A typed exporter failure: the cycle catches it and reports instead of crashing the Host. */
export class ExportError extends Error {
  readonly code: ExportErrorCode

  constructor(code: ExportErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ExportError'
    this.code = code
  }
}

/** The message of an unknown throwable, for a report line. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
