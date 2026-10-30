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

describe('answer-page machine-path exception', () => {
  const vendoredSkill = 'packages/plugin-answer-page/assets/answer-me-with-html/SKILL.md'
  const vendoredSetupSkill =
    'packages/setup/node_modules/@dsh-setup/plugin-answer-page/assets/answer-me-with-html/SKILL.md'
  const upstreamExample = [
    'C',
    ':',
    '/',
    'Users',
    '/',
    'Name',
    '/',
    'My Pages',
    '/',
    'page.html',
  ].join('')

  it('accepts the upstream Windows example in a lock-listed vendored file', () => {
    expect(scanMachinePaths([file(vendoredSkill, `link: ${upstreamExample}`)])).toEqual([])
  })

  it('accepts the same lock-listed file in the generated setup copy', () => {
    expect(scanMachinePaths([file(vendoredSetupSkill, `link: ${upstreamExample}`)])).toEqual([])
  })

  it('still reports a machine path in an arbitrary file outside the lock', () => {
    const problems = scanMachinePaths([
      file('packages/plugin-answer-page/notes.md', `root: ${WINDOWS_PATH}`),
    ])
    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toContain('windows drive path')
  })

  it('still reports machine paths in the package source outside the lock', () => {
    const content = `const path = "${WINDOWS_PATH}"`
    expect(
      scanMachinePaths([file('packages/plugin-answer-page/src/host/index.ts', content)]),
    ).toHaveLength(1)
  })

  it('still scans lock-listed vendored files for secrets', () => {
    const marker = ['-----BEGIN', 'OPENSSH', 'PRIVATE KEY-----'].join(' ')
    expect(scanSecrets([file(vendoredSkill, marker)])).toHaveLength(1)
  })
})
