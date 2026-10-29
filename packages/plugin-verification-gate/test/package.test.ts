import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, DEFAULT_MAX_BLOCKS, inject, name, ROW_ID } from '../lib/index.js'
import { Harness, messageSourceKind } from './harness.js'

/**
 * The package test loads the built module and pins the zero model-facing
 * surface: the gate subscribes to three events only, registers no prompt
 * section, tool, or skill, and stays silent until it refuses a close.
 */

describe('verification gate package', () => {
  it('emits the bundle identity and one row', () => {
    expect(name).toBe('@dsh-setup/plugin-verification-gate')
    expect(ROW_ID).toBe('dsh-setup-verification-gate')
    expect(inject).toEqual([])
    expect(DEFAULT_MAX_BLOCKS).toBe(8)
  })

  it('registers only the three observation events and touches no other service', () => {
    const registered: string[] = []
    const target = {
      on(eventName: string) {
        registered.push(eventName)
        return () => undefined
      },
    }
    const ctx = new Proxy(target, {
      get(object, property) {
        if (property === 'on') return object.on
        throw new Error(`verification-gate must not access ctx.${String(property)}`)
      },
    })
    expect(() => apply(ctx as unknown as Context, { commands: ['pnpm check'] })).not.toThrow()
    expect(registered).toEqual(['agent/pre-step', 'tools/result', 'agent/turn-stopping'])
  })

  it('is inert with no commands: registers no listener and gates no turn', async () => {
    const harness = new Harness({})
    expect(harness.eventNames).toEqual([])
    await harness.write('src/app.ts')
    await harness.stop()
    expect(harness.steerTexts()).toEqual([])
    expect(harness.noticeTexts()).toEqual([])

    const empty = new Harness({ commands: [] })
    expect(empty.eventNames).toEqual([])
    await empty.write('src/app.ts')
    await empty.stop()
    expect(empty.steerTexts()).toEqual([])
  })

  it('emits no text until a stop is refused', async () => {
    const harness = new Harness({ commands: ['pnpm check'] })
    expect(harness.steerTexts()).toEqual([])
    expect(harness.noticeTexts()).toEqual([])
    await harness.write('src/app.ts')
    expect(harness.steerTexts()).toEqual([])
    expect(harness.noticeTexts()).toEqual([])

    await harness.stop()
    expect(harness.steerTexts()).toHaveLength(1)
    expect(harness.noticeTexts()).toEqual([])
  })

  it('attributes every message to the verification gate', async () => {
    const harness = new Harness({ commands: ['pnpm check'], maxBlocks: 1 })
    await harness.write('src/app.ts')
    await harness.stop()
    await harness.stop()
    expect(harness.steerTexts()).toHaveLength(1)
    expect(harness.noticeTexts()).toHaveLength(1)
    for (const message of [...harness.agent.steers, ...harness.agent.injected]) {
      expect(messageSourceKind(message)).toBe('verification-gate')
    }
  })
})
