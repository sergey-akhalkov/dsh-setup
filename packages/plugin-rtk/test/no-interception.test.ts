import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const source = readFileSync(join(packageDir, 'src', 'host', 'index.ts'), 'utf8')
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  bin?: unknown
  scripts?: unknown
}

const INTERCEPTION =
  /child_process|\bspawn\b|\bexecFile\b|\bctx\.shell\b|tools\/(?:pre|post)-execute/

describe('rtk plugin guidance boundary', () => {
  it('contains no shell patch, tool hook, or child-process path in the Host module', () => {
    expect(source).not.toMatch(INTERCEPTION)
  })

  it('does not depend on an rtk package and ships no executable', () => {
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    }
    expect(Object.keys(dependencies)).not.toContain('rtk')
    expect(Object.keys(dependencies).filter((name) => name.startsWith('rtk'))).toEqual([])
    expect(manifest.bin).toBeUndefined()
    expect(manifest.scripts).toBeUndefined()
  })

  it('has no runtime DSH imports in the built module', () => {
    const builtPath = join(packageDir, 'lib', 'index.js')
    if (!existsSync(builtPath)) throw new Error('run `pnpm build` before this test')
    const built = readFileSync(builtPath, 'utf8')
    expect(built).not.toMatch(/from ['"]@deepseek-ai\//)
    expect(built).not.toMatch(INTERCEPTION)
  })
})
