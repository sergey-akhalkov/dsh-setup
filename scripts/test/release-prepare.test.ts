import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const workspace = vi.hoisted(() => ({
  rootDir: '',
  setupDir: '',
  listPackages: (): unknown[] => [],
}))

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '') }))
vi.mock('../lib/workspace.ts', () => workspace)

describe('release-prepare closeout preview', () => {
  it('prints the offline dry-run plan before naming the next step', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-release-prepare-'))
    const argv = process.argv
    const exitCode = process.exitCode
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await writeFile(join(root, 'package.json'), '{"name":"fixture","version":"0.1.0"}\n', 'utf8')
      workspace.rootDir = root
      workspace.setupDir = join(root, 'packages', 'setup')
      vi.mocked(execFileSync).mockImplementation(((...args: unknown[]) => {
        const commandArgs = args[1] as string[]
        return commandArgs.some((arg) => arg.endsWith('close-issues.ts'))
          ? 'no issues to close\n'
          : ''
      }) as never)

      process.argv = ['node', 'scripts/release-prepare.ts', '--version', '9.9.9']
      await import('../release-prepare.ts')

      const output = log.mock.calls.flat().join('\n')
      expect(output).toContain('release closeout plan (previous tag .. HEAD):')
      expect(output).toContain('no issues to close')
      expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
        process.execPath,
        [join(root, 'scripts', 'close-issues.ts')],
        { cwd: root, encoding: 'utf8' },
      )
      expect(output.indexOf('no issues to close')).toBeLessThan(output.indexOf('next: pnpm build'))
    } finally {
      process.argv = argv
      process.exitCode = exitCode
      log.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  })
})
