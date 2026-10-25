import { describe, expect, it } from 'vitest'
import { scanMachinePaths, scanSecrets } from '../lib/scan.ts'

function file(path: string, content: string) {
  return { path, content }
}

// Compose machine-path fixtures at runtime so the repository scan never finds
// the fixture text inside this test file.
const WINDOWS_PATH = ['C', ':', '\\', 'Users', '\\', 'Someone', '\\', 'repo'].join('')
const POSIX_HOME_PATH = ['/', 'home', '/', 'someone', '/', 'project'].join('')

describe('scanMachinePaths', () => {
  it('accepts portable content', () => {
    expect(
      scanMachinePaths([
        file('a.md', 'Install with dsh plugin add git+https://example.com/repo.git#sha'),
        file('b.yml', 'path: !!js dshHomePath("sessions")'),
        file('c.ts', 'const ratio = 1; const time = "12:30";'),
      ]),
    ).toEqual([])
  })

  it('reports a Windows drive path', () => {
    const problems = scanMachinePaths([file('a.yml', `root: ${WINDOWS_PATH}`)])
    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toContain('windows drive path')
  })

  it('reports a POSIX home path', () => {
    expect(scanMachinePaths([file('a.md', `see ${POSIX_HOME_PATH}`)])).toHaveLength(1)
  })

  it('does not treat a URL as a drive path', () => {
    expect(scanMachinePaths([file('a.md', 'https://example.com/x')])).toEqual([])
  })
})

describe('scanSecrets', () => {
  it('reports a credentials file', () => {
    expect(scanSecrets([file('.dsh/.credentials.yaml', 'token: x')])).toHaveLength(1)
  })

  it('reports private key material', () => {
    const marker = ['-----BEGIN', 'OPENSSH', 'PRIVATE KEY-----'].join(' ')
    expect(scanSecrets([file('docs/key.md', marker)])).toHaveLength(1)
  })

  it('accepts ordinary documentation', () => {
    expect(scanSecrets([file('README.md', 'No credentials live here.')])).toEqual([])
  })
})
