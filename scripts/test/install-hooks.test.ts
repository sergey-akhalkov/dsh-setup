import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installHooks } from '../install-hooks.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    if (cleanup !== undefined) await cleanup()
  }
})

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-hooks-'))
  cleanups.push(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const init = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' })
  expect(init.status, init.stderr).toBe(0)
  return root
}

describe('hooks:install', () => {
  it('keeps the pre-push hook a LF shell script that runs the audit', async () => {
    const path = join(import.meta.dirname, '..', '..', '.githooks', 'pre-push')
    const text = await readFile(path, 'utf8')
    expect(text.startsWith('#!/bin/sh\n')).toBe(true)
    expect(text).not.toContain('\r')
    expect(text).toContain('pnpm reviews:check --push')
    expect(text).toContain('fails closed')
  })

  it('selects .githooks as the repository hooks path', async () => {
    const root = await tempRepo()
    expect(installHooks(root)).toBe('.githooks')
    const recorded = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(recorded.stdout.trim()).toBe('.githooks')
  })
})
