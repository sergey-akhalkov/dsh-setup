import { describe, expect, it } from 'vitest'
import {
  BRICK_MIME,
  brickPayload,
  parseBrickPayload,
  STEP_BRICKS,
  TRIGGER_BRICKS,
} from '../src/client/bricks.ts'

/**
 * The palette/canvas contract: the catalog is the engine vocabulary, and the
 * drop payload either names one of those values or is ignored.
 */

describe('brick catalog', () => {
  it('lists the deterministic triggers and the executors in engine order', () => {
    expect(TRIGGER_BRICKS.map((brick) => brick.value)).toEqual([
      'turn.stopping',
      'tool.pre-execute',
      'tool.result',
      'fs.change',
      'subagent.end',
      'review.record',
    ])
    expect(STEP_BRICKS.map((brick) => brick.value)).toEqual([
      'main',
      'tool',
      'subagent',
      'human',
      'branch',
      'loop',
    ])
    // A trigger kind is its own visible label; a step block uses localized copy.
    expect(TRIGGER_BRICKS.every((brick) => brick.labelKey === undefined)).toBe(true)
    expect(STEP_BRICKS.every((brick) => brick.labelKey !== undefined)).toBe(true)
  })

  it('keeps the private drop payload stable', () => {
    expect(BRICK_MIME).toBe('application/x-dsh-wf-brick')
  })

  it('round-trips a payload and ignores malformed or unknown values', () => {
    expect(brickPayload('step', 'branch')).toBe('step:branch')
    expect(parseBrickPayload('step:branch')).toEqual({ kind: 'step', value: 'branch' })
    expect(parseBrickPayload('trigger:fs.change')).toEqual({
      kind: 'trigger',
      value: 'fs.change',
    })
    for (const payload of [
      '',
      ':branch',
      'step:',
      'step:unknown',
      'trigger:main',
      'other:branch',
      'step:branch:extra',
      'step: branch',
    ]) {
      expect(parseBrickPayload(payload), payload).toBeUndefined()
    }
  })
})
