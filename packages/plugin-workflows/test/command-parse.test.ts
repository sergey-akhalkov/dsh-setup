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
  })

  it('rejects another destination, a compound move, and an unparseable name', () => {
    for (const command of [
      'mv openspec/changes/auth openspec/changes/other',
      'mv openspec/changes/auth openspec/changes/archive/other',
      'mv openspec/changes/auth openspec/changes/archive && echo done',
      'git mv openspec/changes/auth openspec/changes/archive; rm -rf .',
      'Move-Item openspec/changes/auth',
      'Move-Item -Destination openspec/changes/archive',
      'mv openspec/changes/Auth openspec/changes/archive',
      'mv openspec/changes/auth openspec/changes/archive/ extra',
    ]) {
      expect(parseArchiveCommand(command), command).toBeUndefined()
    }
  })
})
