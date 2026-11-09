/**
 * Load one definition's run list while discarding responses superseded by a
 * later load, so another definition's runs can never supply the overlay.
 */
export interface RunSelection<T> {
  load(definitionId: string, onChange: (runs: readonly T[]) => void): Promise<void>
  /** Drop any in-flight load; its response will not be applied. */
  invalidate(): void
}

export function createRunSelection<T>(
  read: (definitionId: string) => Promise<readonly T[]>,
): RunSelection<T> {
  let request = 0
  return {
    invalidate() {
      request += 1
    },
    async load(definitionId, onChange) {
      request += 1
      const token = request
      onChange([])
      let next: readonly T[]
      try {
        next = await read(definitionId)
      } catch {
        next = []
      }
      if (token === request) onChange(next)
    },
  }
}
