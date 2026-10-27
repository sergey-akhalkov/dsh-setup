import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  type LoopDetection,
  LoopDetector,
  type ResolvedConfig,
  resolveConfig,
} from '../lib/index.js'

/** Resolve one complete detector configuration from overrides. */
function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return Object.freeze({ ...DEFAULT_CONFIG, ...overrides })
}

/** Build a reasoning stream with one delta per supplied line. */
function reasoningStream(lines: string[]): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    ...lines.map((line) => ({ type: 'reasoning-delta' as const, index: 0, text: `${line}\n` })),
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Feed chunks and return the first detection plus the chunk position that produced it. */
function scan(
  chunks: readonly StreamChunk[],
  resolved: ResolvedConfig = config(),
): { detection: LoopDetection | undefined; position: number } {
  const detector = new LoopDetector(resolved)
  detector.beginRequest()
  for (let index = 0; index < chunks.length; index += 1) {
    const detection = detector.observe(chunks[index] as StreamChunk)
    if (detection !== undefined) return { detection, position: index }
  }
  detector.endRequest()
  return { detection: undefined, position: -1 }
}

const REPEATED = 'The 5.1. The final.'

describe('loop detector', () => {
  it('fires on the fifth repetition of one normalized line within a request', () => {
    const { detection } = scan(reasoningStream([REPEATED, REPEATED, REPEATED, REPEATED, REPEATED]))
    expect(detection).toMatchObject({
      line: REPEATED,
      count: 5,
      kind: 'reasoning',
      acrossBlocks: false,
    })
  })

  it('does not fire on four repetitions', () => {
    const { detection } = scan(reasoningStream([REPEATED, REPEATED, REPEATED, REPEATED]))
    expect(detection).toBeUndefined()
  })

  it('normalizes surrounding and internal whitespace before comparing lines', () => {
    const { detection } = scan(
      reasoningStream([
        `  ${REPEATED}  `,
        REPEATED.replaceAll(' ', '   '),
        REPEATED,
        `\t${REPEATED}`,
        REPEATED,
      ]),
    )
    expect(detection).toMatchObject({ line: REPEATED, count: 5 })
  })

  it('reports the incident-shaped early fifth repeat before a long tail', () => {
    const tail = 'x'.repeat(40_000)
    const chunks = reasoningStream([REPEATED, REPEATED, REPEATED, REPEATED, REPEATED, tail])
    const { detection, position } = scan(chunks)
    expect(detection).toMatchObject({ line: REPEATED, count: 5 })
    expect(position).toBe(5)
  })

  it('leaves ordinary prose, blank lines, and short lines alone', () => {
    const prose = [
      '',
      'Planning the next step.',
      'ok',
      'Reading the latest tool result before acting.',
      '',
      'The project layout is clear now.',
      'I will update the test fixture next.',
      'That completes the review of the request handling.',
      'short',
      'Now writing the final answer.',
    ]
    expect(scan(reasoningStream(prose)).detection).toBeUndefined()
  })

  it('ignores fenced code but keeps detecting after the fence closes', () => {
    const fenced = [
      'Here is the failing snippet:',
      '```ts',
      ...Array.from({ length: 8 }, () => REPEATED),
      '```',
    ]
    expect(scan(reasoningStream(fenced)).detection).toBeUndefined()

    const afterFence = [...fenced, REPEATED, REPEATED, REPEATED, REPEATED, REPEATED]
    expect(scan(reasoningStream(afterFence)).detection).toMatchObject({ count: 5 })
  })

  it('ignores short lines until the minimum line length admits them', () => {
    const short = Array.from({ length: 10 }, () => 'todo')
    expect(scan(reasoningStream(short)).detection).toBeUndefined()
    expect(scan(reasoningStream(short), config({ minLineChars: 2 })).detection).toMatchObject({
      count: 5,
    })
  })

  it('fires when one line appears in the configured number of recent reasoning blocks', () => {
    const detector = new LoopDetector(config({ crossBlockRepeats: 4, crossBlockWindow: 10 }))
    detector.resetTurn()
    let detection: LoopDetection | undefined
    for (let request = 1; request <= 4; request += 1) {
      detector.beginRequest()
      detection = detector.observe({ type: 'block-start', index: 0, blockType: 'reasoning' })
      detection ??= detector.observe({ type: 'reasoning-delta', index: 0, text: `${REPEATED}\n` })
      detector.endRequest()
    }
    expect(detection).toMatchObject({
      line: REPEATED,
      count: 4,
      acrossBlocks: true,
    })
  })

  it('clears the recent-block window at a new turn', () => {
    const detector = new LoopDetector(config({ crossBlockRepeats: 4 }))
    detector.resetTurn()
    for (let request = 1; request <= 4; request += 1) {
      detector.beginRequest()
      detector.observe({ type: 'block-start', index: 0, blockType: 'reasoning' })
      detector.observe({ type: 'reasoning-delta', index: 0, text: `${REPEATED}\n` })
      detector.endRequest()
    }
    detector.resetTurn()
    detector.beginRequest()
    detector.observe({ type: 'block-start', index: 0, blockType: 'reasoning' })
    const detection = detector.observe({
      type: 'reasoning-delta',
      index: 0,
      text: `${REPEATED}\n`,
    })
    expect(detection).toBeUndefined()
  })

  it('ignores a block-end for another block and reports only the active block', () => {
    const detector = new LoopDetector(config())
    detector.beginRequest()
    detector.observe({ type: 'block-start', index: 0, blockType: 'tool-call' })
    detector.observe({ type: 'block-start', index: 1, blockType: 'reasoning' })
    for (let count = 0; count < 4; count += 1) {
      detector.observe({ type: 'reasoning-delta', index: 1, text: `${REPEATED}\n` })
    }
    detector.observe({ type: 'reasoning-delta', index: 1, text: REPEATED })
    expect(
      detector.observe({
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: 'call-1' as never, name: 'read', arguments: '{}' },
      }),
    ).toBeUndefined()
    expect(
      detector.observe({
        type: 'block-end',
        index: 1,
        block: { type: 'reasoning', text: REPEATED },
      }),
    ).toMatchObject({ line: REPEATED, count: 5 })
  })

  it('advances the cross-block window through empty reasoning blocks', () => {
    const detector = new LoopDetector(config({ crossBlockWindow: 4, crossBlockRepeats: 4 }))
    detector.resetTurn()
    for (let request = 0; request < 3; request += 1) {
      detector.beginRequest()
      detector.observe({ type: 'block-start', index: 0, blockType: 'reasoning' })
      detector.observe({ type: 'reasoning-delta', index: 0, text: `${REPEATED}\n` })
      detector.endRequest()
    }
    for (let request = 0; request < 5; request += 1) {
      detector.beginRequest()
      detector.observe({ type: 'block-start', index: 0, blockType: 'reasoning' })
      detector.observe({ type: 'reasoning-delta', index: 0, text: 'ok\n' })
      detector.endRequest()
    }
    detector.beginRequest()
    detector.observe({ type: 'block-start', index: 0, blockType: 'reasoning' })
    expect(
      detector.observe({ type: 'reasoning-delta', index: 0, text: `${REPEATED}\n` }),
    ).toBeUndefined()
  })

  it('closes a fence only with a matching marker of sufficient length', () => {
    const detector = new LoopDetector(config())
    detector.beginRequest()
    detector.observe({ type: 'block-start', index: 0, blockType: 'reasoning' })
    detector.observe({ type: 'reasoning-delta', index: 0, text: '````\n' })
    for (let count = 0; count < 5; count += 1) {
      expect(
        detector.observe({ type: 'reasoning-delta', index: 0, text: `${REPEATED}\n` }),
      ).toBeUndefined()
    }
    detector.observe({ type: 'reasoning-delta', index: 0, text: '```\n' })
    detector.observe({ type: 'reasoning-delta', index: 0, text: '~~~\n' })
    for (let count = 0; count < 5; count += 1) {
      expect(
        detector.observe({ type: 'reasoning-delta', index: 0, text: `${REPEATED}\n` }),
      ).toBeUndefined()
    }
    detector.observe({ type: 'reasoning-delta', index: 0, text: '````\n' })
    let detection: LoopDetection | undefined
    for (let count = 0; count < 5 && detection === undefined; count += 1) {
      detection = detector.observe({
        type: 'reasoning-delta',
        index: 0,
        text: `${REPEATED}\n`,
      })
    }
    expect(detection).toMatchObject({ line: REPEATED, count: 5, acrossBlocks: false })
  })

  it('keeps detecting reasoning while an unrelated text block is open', () => {
    const detector = new LoopDetector(config())
    detector.beginRequest()
    detector.observe({ type: 'block-start', index: 0, blockType: 'text' })
    detector.observe({ type: 'block-start', index: 1, blockType: 'reasoning' })
    let detection: LoopDetection | undefined
    for (let count = 0; count < 5 && detection === undefined; count += 1) {
      detection = detector.observe({
        type: 'reasoning-delta',
        index: 1,
        text: `${REPEATED}\n`,
      })
    }
    expect(detection).toMatchObject({ line: REPEATED, count: 5, kind: 'reasoning' })
  })

  it('treats a matching fence marker followed by code as fenced content', () => {
    const detector = new LoopDetector(config())
    detector.beginRequest()
    detector.observe({ type: 'block-start', index: 0, blockType: 'reasoning' })
    detector.observe({ type: 'reasoning-delta', index: 0, text: '~~~js\n' })
    detector.observe({ type: 'reasoning-delta', index: 0, text: '~~~value\n' })
    for (let count = 0; count < 5; count += 1) {
      expect(
        detector.observe({ type: 'reasoning-delta', index: 0, text: `${REPEATED}\n` }),
      ).toBeUndefined()
    }
    detector.observe({ type: 'reasoning-delta', index: 0, text: '~~~\n' })
    let detection: LoopDetection | undefined
    for (let count = 0; count < 5 && detection === undefined; count += 1) {
      detection = detector.observe({
        type: 'reasoning-delta',
        index: 0,
        text: `${REPEATED}\n`,
      })
    }
    expect(detection).toMatchObject({ line: REPEATED, count: 5, acrossBlocks: false })
  })

  it('restarts request counts for each model request', () => {
    const detector = new LoopDetector(config())
    detector.resetTurn()
    detector.beginRequest()
    detector.observe({ type: 'block-start', index: 0, blockType: 'reasoning' })
    for (let count = 1; count <= 4; count += 1) {
      expect(
        detector.observe({ type: 'reasoning-delta', index: 0, text: `${REPEATED}\n` }),
      ).toBeUndefined()
    }
    detector.endRequest()

    detector.beginRequest()
    detector.observe({ type: 'block-start', index: 0, blockType: 'reasoning' })
    let detection: LoopDetection | undefined
    for (let count = 1; count <= 5 && detection === undefined; count += 1) {
      detection = detector.observe({
        type: 'reasoning-delta',
        index: 0,
        text: `${REPEATED}\n`,
      })
    }
    expect(detection).toMatchObject({ count: 5, acrossBlocks: false })
  })

  it('ignores visible text unless text scope is enabled', () => {
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      ...Array.from({ length: 5 }, () => ({
        type: 'text-delta' as const,
        index: 0,
        text: `${REPEATED}\n`,
      })),
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    expect(scan(chunks).detection).toBeUndefined()
    expect(scan(chunks, config({ text: true })).detection).toMatchObject({ kind: 'text', count: 5 })
  })
})

describe('config validation', () => {
  it('applies the documented defaults', () => {
    expect(resolveConfig(undefined)).toEqual({
      reasoning: true,
      text: false,
      subagents: false,
      minRepeats: 5,
      minLineChars: 12,
      crossBlockWindow: 10,
      crossBlockRepeats: 4,
      maxInterventionsPerTurn: 3,
      maxResetsPerSession: 2,
      previewChars: 80,
      finalFallback: 'stop',
    })
  })

  it('accepts a complete valid override', () => {
    expect(
      resolveConfig({
        reasoning: false,
        text: true,
        subagents: true,
        minRepeats: 2,
        minLineChars: 4,
        crossBlockWindow: 3,
        crossBlockRepeats: 2,
        maxInterventionsPerTurn: 1,
        maxResetsPerSession: 0,
        previewChars: 10,
        finalFallback: 'stop',
      }),
    ).toMatchObject({ minRepeats: 2, text: true, subagents: true, maxResetsPerSession: 0 })
  })

  it.each([
    [{ minRepeats: 1 }, 'minRepeats'],
    [{ minRepeats: 2.5 }, 'minRepeats'],
    [{ minLineChars: 0 }, 'minLineChars'],
    [{ crossBlockWindow: 0 }, 'crossBlockWindow'],
    [{ crossBlockWindow: 2, crossBlockRepeats: 3 }, 'crossBlockRepeats'],
    [{ crossBlockWindow: 1 }, 'crossBlockRepeats'],
    [{ crossBlockWindow: 3 }, 'crossBlockRepeats'],
    [{ maxInterventionsPerTurn: 0 }, 'maxInterventionsPerTurn'],
    [{ maxResetsPerSession: -1 }, 'maxResetsPerSession'],
    [{ previewChars: 0 }, 'previewChars'],
    [{ reasoning: false }, 'reasoning'],
    [{ reasoning: 'yes' }, 'reasoning'],
    [{ finalFallback: 'retry' }, 'finalFallback'],
    [{ unknownField: true }, 'unknownField'],
  ])('fails loud and names the field for %j', (raw, field) => {
    expect(() => resolveConfig(raw)).toThrow(new RegExp(field))
  })

  it('rejects a non-object configuration', () => {
    expect(() => resolveConfig('reasoning')).toThrow(/config must be an object/u)
  })
})
