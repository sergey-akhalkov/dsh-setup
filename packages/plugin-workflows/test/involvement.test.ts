import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readInvolvement, writeInvolvement } from '../src/host/involvement.ts'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'workflows-involvement-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('session involvement', () => {
  it('round-trips the change for a session', async () => {
    const root = await workspace()
    await writeInvolvement(root, 'session-1', 'auth')
    expect(await readInvolvement(root, 'session-1')).toBe('auth')
  })

  it('returns undefined for a missing session or an invalid id', async () => {
    const root = await workspace()
    expect(await readInvolvement(root, 'session-missing')).toBeUndefined()
    expect(await readInvolvement(root, '../escape')).toBeUndefined()
    await writeInvolvement(root, '../escape', 'auth')
    expect(await readInvolvement(root, '../escape')).toBeUndefined()
  })
})
