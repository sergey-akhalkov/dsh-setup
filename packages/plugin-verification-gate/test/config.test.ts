import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, DEFAULT_MAX_BLOCKS, name, ROW_ID, resolveConfig } from '../lib/index.js'

/**
 * Configuration is a trust boundary: the row is loaded from a profile patch a
 * user may have written by hand. Every accepted value is checked once, at
 * load, and every rejection names the row id, the offending value, and the
 * accepted shape.
 */

/** Require a configuration error and return its message. */
function configErrorMessage(raw: unknown): string {
  try {
    resolveConfig(raw)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error(`expected resolveConfig(${JSON.stringify(raw)}) to throw`)
}

describe('verification gate configuration', () => {
  it('applies the documented inert default', () => {
    expect(DEFAULT_MAX_BLOCKS).toBe(8)
    expect(resolveConfig(undefined)).toEqual({ commands: [], maxBlocks: 8 })
    expect(resolveConfig({})).toEqual({ commands: [], maxBlocks: 8 })
    expect(resolveConfig({ commands: [] })).toEqual({ commands: [], maxBlocks: 8 })
  })

  it('accepts a command list and a positive maxBlocks', () => {
    expect(resolveConfig({ commands: ['pnpm check', 'rtk pnpm test'], maxBlocks: 3 })).toEqual({
      commands: ['pnpm check', 'rtk pnpm test'],
      maxBlocks: 3,
    })
  })

  it('trims configured command edges and returns a frozen value', () => {
    const resolved = resolveConfig({ commands: ['  pnpm check  '] })
    expect(resolved.commands).toEqual(['pnpm check'])
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.commands)).toBe(true)
  })

  it('rejects a non-object config', () => {
    for (const value of [null, [], 'config', 4]) {
      expect(configErrorMessage(value)).toContain('config must be an object')
    }
  })

  it('rejects unknown fields and names the row id and accepted shape', () => {
    const message = configErrorMessage({ command: ['pnpm check'] })
    expect(message).toContain(ROW_ID)
    expect(message).toContain('unknown field "command"')
    expect(message).toContain('["pnpm check"]')
    expect(message).toContain('accepted shape: { commands?: string[]')
  })

  it('rejects a commands value that is not an array', () => {
    const message = configErrorMessage({ commands: 'pnpm check' })
    expect(message).toContain(ROW_ID)
    expect(message).toContain('"pnpm check"')
    expect(message).toContain('accepted shape')
  })

  it('rejects every invalid command entry and shows the offending value', () => {
    for (const entry of ['', '   ', 4, null, {}, []]) {
      const message = configErrorMessage({ commands: ['pnpm check', entry] })
      expect(message).toContain(ROW_ID)
      expect(message).toContain(`offending value: ${JSON.stringify(entry)}`)
      expect(message).toContain('accepted shape')
    }
  })

  it('rejects every invalid maxBlocks value', () => {
    for (const value of [0, -1, 1.5, '2', Number.NaN, Number.POSITIVE_INFINITY]) {
      const message = configErrorMessage({ commands: ['pnpm check'], maxBlocks: value })
      expect(message).toContain(ROW_ID)
      expect(message).toContain('maxBlocks')
      expect(message).toContain('accepted shape')
    }
  })

  it('rejects an invalid maxBlocks even when commands are absent', () => {
    expect(configErrorMessage({ maxBlocks: 0 })).toContain('maxBlocks')
    expect(configErrorMessage({ commands: [], maxBlocks: 0 })).toContain('maxBlocks')
  })

  it('fails the plugin load on an invalid row config', () => {
    const ctx = {} as Context
    expect(() => apply(ctx, { maxBlocks: 0 } as never)).toThrow(new RegExp(ROW_ID, 'u'))
    expect(() => apply(ctx, { commands: [''] })).toThrow(/every `commands` entry/u)
  })

  it('does not execute or expand a configured command', () => {
    // A shell-syntax command is configuration data; it only participates in
    // exact matching and never reaches a shell from this plugin.
    const resolved = resolveConfig({ commands: ['pnpm check; echo not-a-proof'] })
    expect(resolved.commands).toEqual(['pnpm check; echo not-a-proof'])
    expect(name).toBe('@dsh-setup/plugin-verification-gate')
  })
})
