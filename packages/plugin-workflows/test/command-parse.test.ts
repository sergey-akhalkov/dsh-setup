import { describe, expect, it } from 'vitest'
import {
  CHANGE_NAME,
  parseArchiveCommand,
  parseOpenspecCommand,
} from '../src/host/command-parse.ts'

describe('OpenSpec command parser', () => {
  it('accepts the three documented invocation forms', () => {
    expect(parseOpenspecCommand('openspec new change auth')).toEqual({
      kind: 'create-change',
      name: 'auth',
    })
    expect(parseOpenspecCommand('rtk openspec new change auth')).toEqual({
      kind: 'create-change',
      name: 'auth',
    })
    expect(parseOpenspecCommand('pnpm exec openspec new change auth')).toEqual({
      kind: 'create-change',
      name: 'auth',
    })
    expect(parseOpenspecCommand('  openspec archive auth-v2  ')).toEqual({
      kind: 'archive',
      change: 'auth-v2',
    })
    expect(parseOpenspecCommand('rtk openspec archive auth')).toEqual({
      kind: 'archive',
      change: 'auth',
    })
    expect(parseOpenspecCommand('pnpm exec openspec archive auth')).toEqual({
      kind: 'archive',
      change: 'auth',
    })
  })

  it('accepts a single-quoted or double-quoted name', () => {
    expect(parseOpenspecCommand('openspec new change "auth-v2"')).toEqual({
      kind: 'create-change',
      name: 'auth-v2',
    })
    expect(parseOpenspecCommand("rtk openspec new change 'auth-v2'")).toEqual({
      kind: 'create-change',
      name: 'auth-v2',
    })
    expect(parseOpenspecCommand('openspec archive "auth"')).toEqual({
      kind: 'archive',
      change: 'auth',
    })
  })

  it('rejects a compound command', () => {
    for (const command of [
      'openspec new change auth && rm -rf openspec',
      'openspec new change auth; echo hi',
      'openspec new change auth | tee out',
      'openspec new change auth > log',
      'openspec archive auth &',
      'openspec new change $(whoami)',
      'openspec new change `whoami`',
      'openspec new change auth\nrm -rf openspec',
    ]) {
      expect(parseOpenspecCommand(command), command).toBeUndefined()
    }
  })

  it('rejects a missing or unparseable name', () => {
    for (const command of [
      'openspec new change',
      'openspec new change ',
      'openspec archive',
      'openspec new change ""',
      'openspec new change Auth',
      'openspec new change auth_v2',
      'openspec new change -auth',
      'openspec new change ../auth',
      'openspec new change "auth v2"',
      'openspec new change auth extra',
      'openspec new create auth',
      'openspec archive auth extra',
    ]) {
      expect(parseOpenspecCommand(command), command).toBeUndefined()
    }
  })

  it('leaves an unrelated command untouched', () => {
    expect(parseOpenspecCommand('git status')).toBeUndefined()
    expect(parseOpenspecCommand('pnpm test')).toBeUndefined()
    expect(parseOpenspecCommand('')).toBeUndefined()
    expect(parseOpenspecCommand('   ')).toBeUndefined()
  })

  it('exposes the exact name rule used by interpolation and drafts', () => {
    expect(CHANGE_NAME.test('auth')).toBe(true)
    expect(CHANGE_NAME.test('auth-v2')).toBe(true)
    expect(CHANGE_NAME.test('Auth')).toBe(false)
    expect(CHANGE_NAME.test('-auth')).toBe(false)
    expect(CHANGE_NAME.test('auth/v2')).toBe(false)
  })
})

describe('archive command parser', () => {
  it('accepts the documented archive form and the three archive move forms', () => {
    expect(parseArchiveCommand('openspec archive auth')).toEqual({
      kind: 'archive',
      change: 'auth',
      form: 'openspec',
    })
    for (const command of [
      'mv openspec/changes/auth openspec/changes/archive',
      'mv openspec/changes/auth openspec/changes/archive/',
      'mv "openspec/changes/auth" "openspec/changes/archive/"',
    ]) {
      expect(parseArchiveCommand(command), command).toEqual({
        kind: 'archive',
        change: 'auth',
        form: 'mv',
      })
    }
    expect(
      parseArchiveCommand('git mv openspec/changes/auth openspec/changes/archive/auth'),
    ).toEqual({
      kind: 'archive',
      change: 'auth',
      form: 'git',
    })
    expect(parseArchiveCommand('Move-Item openspec/changes/auth openspec/changes/archive')).toEqual(
      {
        kind: 'archive',
        change: 'auth',
        form: 'Move-Item',
      },
    )
    expect(
      parseArchiveCommand(
        'Move-Item -Path openspec/changes/auth -Destination openspec/changes/archive/',
      ),
    ).toEqual({ kind: 'archive', change: 'auth', form: 'Move-Item' })
    expect(
      parseArchiveCommand('git mv openspec/changes/auth openspec/changes/archive/2026-11-08-auth'),
    ).toEqual({ kind: 'archive', change: 'auth', form: 'git' })
    expect(parseArchiveCommand('mv openspec\\changes\\auth openspec\\changes\\archive\\')).toEqual({
      kind: 'archive',
      change: 'auth',
      form: 'mv',
    })
    expect(
      parseArchiveCommand(
        'Move-Item -LiteralPath openspec/changes/auth -Destination openspec/changes/archive/',
      ),
    ).toEqual({ kind: 'archive', change: 'auth', form: 'Move-Item' })
    expect(parseArchiveCommand('mv ./openspec/changes/auth ./openspec/changes/archive/')).toEqual({
      kind: 'archive',
      change: 'auth',
      form: 'mv',
    })
    expect(
      parseArchiveCommand('git mv ./openspec/changes/auth ./openspec/changes/archive/'),
    ).toEqual({ kind: 'archive', change: 'auth', form: 'git' })
    expect(
      parseArchiveCommand(
        'Move-Item -LiteralPath ./openspec/changes/auth -Destination ./openspec/changes/archive/',
      ),
    ).toEqual({ kind: 'archive', change: 'auth', form: 'Move-Item' })
    expect(
      parseArchiveCommand(
        'Move-Item -LiteralPath openspec/changes/auth -Destination openspec/changes/archive/ -Force',
      ),
    ).toEqual({ kind: 'archive', change: 'auth', form: 'Move-Item' })
    expect(
      parseArchiveCommand('git mv -- openspec/changes/auth openspec/changes/archive/'),
    ).toEqual({
      kind: 'archive',
      change: 'auth',
      form: 'git',
    })
    expect(
      parseArchiveCommand('Move-Item openspec/changes/auth openspec/changes/archive/ -Force'),
    ).toEqual({ kind: 'archive', change: 'auth', form: 'Move-Item' })
    for (const command of [
      'mv openspec/changes/auth openspec/changes/archive/renamed-auth',
      'git mv openspec/changes/auth openspec/changes/archive/2026-11-08-renamed-auth',
      'Move-Item openspec/changes/auth openspec/changes/archive/renamed-auth',
    ]) {
      expect(parseArchiveCommand(command), command).toEqual({
        kind: 'archive',
        change: 'auth',
        form: command.startsWith('git') ? 'git' : command.startsWith('mv') ? 'mv' : 'Move-Item',
      })
    }
  })

  it('rejects another destination, a compound move, and an unparseable name', () => {
    for (const command of [
      'mv openspec/changes/auth openspec/changes/other',
      'mv openspec/changes/auth openspec/changes/archive/../other',
      'mv openspec/changes/auth openspec/changes/archive && echo done',
      'git mv openspec/changes/auth openspec/changes/archive; rm -rf .',
      'Move-Item openspec/changes/auth',
      'Move-Item -Destination openspec/changes/archive',
      'mv openspec/changes/Bad_Name openspec/changes/archive',
      'mv openspec/changes/auth openspec/changes/archive/ extra',
    ]) {
      expect(parseArchiveCommand(command), command).toBeUndefined()
    }
  })
})
it('accepts ordinary archive and move options', () => {
  expect(parseArchiveCommand('openspec archive auth --yes')).toEqual({
    kind: 'archive',
    change: 'auth',
    form: 'openspec',
  })
  expect(
    parseArchiveCommand('git mv -f openspec/changes/auth openspec/changes/archive/auth'),
  ).toEqual({
    kind: 'archive',
    change: 'auth',
    form: 'git',
  })
  expect(parseArchiveCommand('mv -f openspec/changes/auth openspec/changes/archive/')).toEqual({
    kind: 'archive',
    change: 'auth',
    form: 'mv',
  })
})
it('resolves named and absolute move operands against the workspace', () => {
  expect(
    parseArchiveCommand(
      'Move-Item -LiteralPath openspec/changes/auth openspec/changes/archive/',
      '/workspace',
    ),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'Move-Item' })
  expect(
    parseArchiveCommand(
      'Move-Item -LiteralPath /workspace/openspec/changes/auth -Destination /workspace/openspec/changes/archive/',
      '/workspace',
    ),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'Move-Item' })
  expect(
    parseArchiveCommand(
      'mv /workspace/openspec/changes/auth /workspace/openspec/changes/archive/',
      '/workspace',
    ),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'mv' })
  expect(
    parseArchiveCommand(
      'git mv /workspace/openspec/changes/auth /workspace/openspec/changes/archive/auth',
      '/workspace',
    ),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'git' })
  expect(
    parseArchiveCommand(
      'mv /elsewhere/openspec/changes/auth /elsewhere/openspec/changes/archive/',
      '/workspace',
    ),
  ).toBeUndefined()
})
it('tokenizes quoted paths with spaces and resolves a subdirectory workdir', () => {
  const workspace = '/tmp/My Workspace/repo'
  expect(
    parseArchiveCommand(
      `mv "${workspace}/openspec/changes/auth" "${workspace}/openspec/changes/archive/"`,
      workspace,
    ),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'mv' })
  expect(
    parseArchiveCommand(
      `git mv "${workspace}/openspec/changes/auth" "${workspace}/openspec/changes/archive/auth"`,
      workspace,
    ),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'git' })
  expect(
    parseArchiveCommand(
      `Move-Item -LiteralPath "${workspace}/openspec/changes/auth" -Destination "${workspace}/openspec/changes/archive/"`,
      workspace,
    ),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'Move-Item' })
  expect(
    parseArchiveCommand('mv auth archive/', '/workspace', '/workspace/openspec/changes'),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'mv' })
  expect(
    parseArchiveCommand('git mv auth archive/auth', '/workspace', '/workspace/openspec/changes'),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'git' })
})
it('resolves parent-relative move operands against the workdir', () => {
  for (const command of [
    'mv ../openspec/changes/auth ../openspec/changes/archive/',
    'git mv ../openspec/changes/auth ../openspec/changes/archive/auth',
    'Move-Item -LiteralPath ../openspec/changes/auth -Destination ../openspec/changes/archive/',
  ]) {
    expect(parseArchiveCommand(command, '/workspace', '/workspace/docs'), command).toEqual({
      kind: 'archive',
      change: 'auth',
      form: command.startsWith('git') ? 'git' : command.startsWith('mv') ? 'mv' : 'Move-Item',
    })
  }
})
it.skipIf(process.platform !== 'win32')('matches Windows archive paths case-insensitively', () => {
  expect(
    parseArchiveCommand('mv openspec/changes/auth openspec/changes/ARCHIVE/', '/workspace'),
  ).toEqual({
    kind: 'archive',
    change: 'auth',
    form: 'mv',
  })
  expect(
    parseArchiveCommand('mv OpenSpec/Changes/auth OpenSpec/Changes/Archive/auth', '/workspace'),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'mv' })
})
it('accepts a PowerShell switch with an explicit boolean value', () => {
  expect(
    parseArchiveCommand(
      'Move-Item -LiteralPath openspec/changes/auth -Destination openspec/changes/archive/ -Confirm:$false',
    ),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'Move-Item' })
})
it('accepts the remaining Move-Item switch parameters', () => {
  for (const suffix of ['-PassThru', '-Debug']) {
    expect(
      parseArchiveCommand(
        `Move-Item -LiteralPath openspec/changes/auth -Destination openspec/changes/archive/ ${suffix}`,
      ),
      suffix,
    ).toEqual({ kind: 'archive', change: 'auth', form: 'Move-Item' })
  }
})
it('parses destination options and named source parameters for moves', () => {
  expect(parseArchiveCommand('mv -t openspec/changes/archive/ openspec/changes/auth')).toEqual({
    kind: 'archive',
    change: 'auth',
    form: 'mv',
  })
  expect(
    parseArchiveCommand(
      'mv -Destination openspec/changes/archive/ -LiteralPath openspec/changes/auth',
    ),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'mv' })
})
it('accepts PowerShell switches through the mv alias', () => {
  expect(parseArchiveCommand('mv -Force openspec/changes/auth openspec/changes/archive/')).toEqual({
    kind: 'archive',
    change: 'auth',
    form: 'mv',
  })
})
it('recognizes switch values through mv and refuses multi-source archive moves', () => {
  expect(
    parseArchiveCommand(
      'mv -LiteralPath openspec/changes/auth -Destination openspec/changes/archive/ -Confirm:$false',
    ),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'mv' })
  expect(
    parseArchiveCommand(
      'git mv openspec/changes/auth openspec/changes/beta openspec/changes/archive/',
    ),
  ).toMatchObject({ kind: 'archive', multipleSources: true })
})
it('handles named multi-source moves and inline parameter values', () => {
  expect(
    parseArchiveCommand(
      'mv -t openspec/changes/archive/ openspec/changes/auth openspec/changes/beta',
    ),
  ).toMatchObject({ kind: 'archive', multipleSources: true })
  expect(
    parseArchiveCommand(
      'Move-Item -Path openspec/changes/auth,openspec/changes/beta -Destination openspec/changes/archive/',
    ),
  ).toMatchObject({ kind: 'archive', multipleSources: true })
  expect(
    parseArchiveCommand(
      'Move-Item -Path:openspec/changes/auth -Destination:openspec/changes/archive/',
    ),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'Move-Item' })
  expect(
    parseArchiveCommand('mv --target-directory=openspec/changes/archive/ openspec/changes/auth'),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'mv' })
})
it('accepts PowerShell common parameters in moves', () => {
  expect(
    parseArchiveCommand('Move-Item openspec/changes/auth openspec/changes/archive/ -Verbose'),
  ).toEqual({
    kind: 'archive',
    change: 'auth',
    form: 'Move-Item',
  })
  expect(
    parseArchiveCommand(
      'Move-Item openspec/changes/auth openspec/changes/archive/ -ErrorAction Stop',
    ),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'Move-Item' })
  expect(
    parseArchiveCommand(
      'Move-Item openspec/changes/auth openspec/changes/archive/ -ErrorAction:Stop',
    ),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'Move-Item' })
})
it('accepts git keep-going and the PowerShell LiteralPath alias', () => {
  expect(parseArchiveCommand('git mv -k openspec/changes/auth openspec/changes/archive/')).toEqual({
    kind: 'archive',
    change: 'auth',
    form: 'git',
  })
  expect(
    parseArchiveCommand(
      'Move-Item -LP openspec/changes/auth -Destination openspec/changes/archive/',
    ),
  ).toEqual({ kind: 'archive', change: 'auth', form: 'Move-Item' })
})
