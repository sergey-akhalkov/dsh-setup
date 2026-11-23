import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkCli,
  cliFailureMessage,
  cliShimContent,
  cliShimPath,
  cliSpawnLine,
  installedCliPath,
  quoteShellArgument,
  resolveDshCli,
} from '../lib/cli.ts'

const homes: string[] = []

function makeHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cli-'))
  homes.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('resolveDshCli', () => {
  it('uses an existing DSH_CLI path verbatim', () => {
    const home = makeHome()
    const resolution = resolveDshCli('1.2.3', {
      home,
      env: { DSH_CLI: '/tools/dsh.exe' },
      exists: (file) => file === '/tools/dsh.exe',
    })
    expect(resolution).toEqual({
      commandLine: '/tools/dsh.exe',
      executable: '/tools/dsh.exe',
      source: 'override',
    })
  })

  it('wraps a DSH_CLI command line into a shim that forwards arguments', () => {
    const home = makeHome()
    const written: Array<[string, string]> = []
    const resolution = resolveDshCli('1.2.3', {
      home,
      env: { DSH_CLI: '  pnpm dlx custom@9  ' },
      exists: () => false,
      writeFile: (file, content) => {
        written.push([file, content])
        writeFileSync(file, content, 'utf8')
      },
      chmod: () => {},
    })
    expect(resolution.commandLine).toBe('pnpm dlx custom@9')
    expect(resolution.source).toBe('override')
    expect(resolution.executable).toBe(cliShimPath(home))
    expect(written).toEqual([[cliShimPath(home), cliShimContent('pnpm dlx custom@9')]])
  })

  it('treats an empty override as unset and uses the installed CLI', () => {
    const home = makeHome()
    const localAppData = '/local/appdata'
    const installed = installedCliPath(localAppData)
    const resolution = resolveDshCli('1.2.3', {
      home,
      env: { DSH_CLI: '   ', LOCALAPPDATA: localAppData },
      exists: (file) => file === installed,
    })
    expect(resolution).toEqual({
      commandLine: installed,
      executable: installed,
      source: 'installed',
    })
  })

  it('falls back to pnpm dlx with the repository runtime version', () => {
    const home = makeHome()
    const resolution = resolveDshCli('0.2.2-rc.2', { home, env: {}, exists: () => false })
    expect(resolution.commandLine).toBe('pnpm dlx @deepseek-ai/dsh@0.2.2-rc.2')
    expect(resolution.source).toBe('dlx')
    expect(resolution.executable).toBe(cliShimPath(home))
    expect(readFileSync(cliShimPath(home), 'utf8')).toContain('@deepseek-ai/dsh@0.2.2-rc.2')
  })

  it('executes a generated shim and forwards its arguments to the wrapped command', () => {
    const home = makeHome()
    const fake = join(home, 'fake-cli.mjs')
    writeFileSync(fake, "console.log(process.argv.slice(2).join(' '))\n", 'utf8')
    const resolution = resolveDshCli('1.2.3', {
      home,
      env: {
        DSH_CLI: `${quoteShellArgument(process.execPath)} ${quoteShellArgument(fake)}`,
      },
      exists: () => false,
    })
    expect(resolution.executable).toBe(cliShimPath(home))
    const run = spawnSync(cliSpawnLine(resolution, ['--profile', 'dev']), {
      encoding: 'utf8',
      shell: true,
    })
    expect(run.status).toBe(0)
    expect(run.stdout.trim()).toBe('--profile dev')
  })
})

describe('cliSpawnLine', () => {
  it('quotes the executable and every argument for the shell', () => {
    const resolution = {
      commandLine: '/program-files/DeepSeek Harness/dsh.cmd',
      executable: '/program-files/DeepSeek Harness/dsh.cmd',
      source: 'installed' as const,
    }
    const line = cliSpawnLine(resolution, ['--profile', 'dev'])
    expect(line).toBe([resolution.executable, '--profile', 'dev'].map(quoteShellArgument).join(' '))
    expect(line).toContain(resolution.executable)
    expect(line).toContain('--profile')
  })
})

describe('checkCli', () => {
  it('accepts a command that reports its version', () => {
    const resolution = { commandLine: 'dsh', executable: 'dsh', source: 'installed' as const }
    expect(checkCli(resolution, () => ({ status: 0, stdout: '0.2.2-rc.5\n' }))).toEqual({
      ok: true,
      version: '0.2.2-rc.5',
    })
  })

  it('rejects an unusable command with both remedies', () => {
    const resolution = {
      commandLine: 'broken-cli',
      executable: 'broken-cli',
      source: 'override' as const,
    }
    const check = checkCli(resolution, () => ({ status: 1, stderr: 'command not found' }))
    expect(check.ok).toBe(false)
    if (!check.ok) {
      expect(check.message).toContain('broken-cli')
      expect(check.message).toContain('DSH_CLI')
      expect(check.message).toContain('install DeepSeek Harness')
    }
  })
})

describe('cliFailureMessage', () => {
  it('names the resolved line, DSH_CLI and the install remedy', () => {
    const message = cliFailureMessage(
      { commandLine: 'dsh', executable: 'dsh', source: 'installed' },
      'boom',
    )
    expect(message).toContain('dsh')
    expect(message).toContain('DSH_CLI')
    expect(message).toContain('install DeepSeek Harness')
  })
})
