import { describe, expect, it } from 'vitest'
import { CHANGE_NAME, parseOpenspecCommand } from '../src/host/command-parse.ts'

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
