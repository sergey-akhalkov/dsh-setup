import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EN, reasonLabel } from '../src/client/locale.ts'

/**
 * The dictionary guard: a literal `t('…')` in a client source that the
 * dictionary does not name would render its raw key in some view state.
 */

const CLIENT_DIR = fileURLToPath(new URL('../src/client', import.meta.url))
const LITERAL = /\bt\(\s*['"]([^'"\\]+)['"]\s*\)/gu

/** Every literal translate key in one source text, in source order. */
export function literalKeys(source: string): string[] {
  return [...source.matchAll(LITERAL)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  )
}

async function clientSources(directory: string = CLIENT_DIR): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...(await clientSources(path)))
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) found.push(path)
  }
  return found
}

describe('locale dictionary guard', () => {
  it('names every literal translate key used by a client source', async () => {
    const missing: string[] = []
    for (const file of await clientSources()) {
      const source = await readFile(file, 'utf8')
      for (const key of literalKeys(source)) {
        if (EN[key] === undefined) missing.push(`${file}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('fails on a planted missing key and passes a present one', () => {
    expect(literalKeys("t('planted.missing')")).toEqual(['planted.missing'])
    expect(EN['planted.missing']).toBeUndefined()
    expect(literalKeys("t('view.label')")).toEqual(['view.label'])
    expect(EN['view.label']).toBe('Workflows')
  })

  it('renders a recorded reason that has no copy yet as its data, not a raw key', () => {
    const identity = (key: string): string => key
    expect(reasonLabel('would-fire', identity)).toBe('would-fire')
    expect(reasonLabel('a-future-reason', identity)).toBe('a-future-reason')
    expect(reasonLabel('would-fire', (key) => EN[key] ?? key)).toBe('would fire')
  })
})
