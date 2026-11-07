import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HEALTH_STALE_MS,
  type HealthFile,
  REQUIRED_LISTENERS,
  SELF_CHECK_MS,
  WorkflowHealth,
} from '../src/host/health.ts'

interface Harness {
  readonly health: WorkflowHealth
  readonly writes: Array<{ file: string; value: HealthFile }>
  readonly scheduled: Array<{ callback: () => void; intervalMs: number }>
  readonly disposed: boolean[]
  readonly probes: number[]
  advance(ms: number): void
  setProbe(available: boolean): void
  now(): number
}

function harness(): Harness {
  let now = 1_700_000_000_000
  let available = true
  const writes: Array<{ file: string; value: HealthFile }> = []
  const scheduled: Array<{ callback: () => void; intervalMs: number }> = []
  const disposed: boolean[] = []
  const probes: number[] = []
  const health = new WorkflowHealth({
    root: '/workspace/.dsh/workflows',
    triggerCount: 9,
    now: () => now,
    intervalMs: SELF_CHECK_MS,
    schedule(callback, intervalMs) {
      scheduled.push({ callback, intervalMs })
      return {
        dispose: () => {
          disposed.push(true)
        },
      }
    },
    probe: async () => {
      probes.push(now)
      return available
    },
    write: async (file, text) => {
      writes.push({ file, value: JSON.parse(text) as HealthFile })
    },
  })
  return {
    health,
    writes,
    scheduled,
    disposed,
    probes,
    advance: (ms) => {
      now += ms
    },
    setProbe: (value) => {
      available = value
    },
    now: () => now,
  }
}

describe('workflow health', () => {
  it('writes the required fields and arms the 60-second self-check', async () => {
    const test = harness()
    await test.health.start()
    expect(test.scheduled).toHaveLength(1)
    expect(test.scheduled[0]?.intervalMs).toBe(SELF_CHECK_MS)
    expect(test.writes.at(-1)?.value).toMatchObject({
      listenerCount: 0,
      journalWritable: true,
      triggerCount: 9,
      lastCheckAt: test.now(),
    })
    expect(test.writes.at(-1)?.file).toContain('health.json')
  })

  it('distinguishes listener-down, journal-readonly, waiting, and healthy', async () => {
    const test = harness()
    await test.health.start()
    expect(test.health.stateFor(false, true)).toBe('listener-down')
    test.health.setListenerCount(6)
    expect(test.health.stateFor(false, true)).toBe('waiting')
    test.health.markEvent(test.now())
    expect(test.health.stateFor(true, true)).toBe('healthy')
    test.setProbe(false)
    await test.health.selfCheck()
    expect(test.health.stateFor(true, true)).toBe('journal-readonly')
    test.setProbe(true)
    await test.health.selfCheck()
    expect(test.health.stateFor(true, true)).toBe('healthy')
  })

  it('runs the scheduled self-check at the literal 60-second boundary', async () => {
    const test = harness()
    await test.health.start()
    expect(test.scheduled[0]?.intervalMs).toBe(60_000)
    expect(test.probes).toHaveLength(1)
    const firstCheck = test.health.snapshot().lastCheckAt
    test.advance(60_000)
    test.setProbe(false)
    test.scheduled[0]?.callback()
    await test.health.flush()
    expect(test.probes).toHaveLength(2)
    expect(test.health.snapshot().lastCheckAt).toBe(test.now())
    expect(test.health.snapshot().journalWritable).toBe(false)
    expect(firstCheck).toBeLessThan(test.now())
  })

  it('probes the actual journal destination and reports a blocked events directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflows-health-'))
    try {
      const workflows = join(root, '.dsh', 'workflows')
      await mkdir(workflows, { recursive: true })
      await writeFile(join(workflows, 'events'), 'blocked', 'utf8')
      const health = new WorkflowHealth({
        root: workflows,
        triggerCount: 1,
        schedule: () => ({ dispose: () => {} }),
      })
      await health.selfCheck()
      expect(health.snapshot().journalWritable).toBe(false)
      await rm(join(workflows, 'events'))
      await health.selfCheck()
      expect(health.snapshot().journalWritable).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('classifies a missing required listener as listener-down', async () => {
    const test = harness()
    await test.health.start()
    test.health.setListenerCount(REQUIRED_LISTENERS - 1)
    expect(test.health.stateFor(false, true)).toBe('listener-down')
    test.health.setListenerCount(REQUIRED_LISTENERS)
    expect(test.health.stateFor(false, true)).toBe('waiting')
  })

  it('reports a stale heartbeat as listener-down only while a session is running', async () => {
    const test = harness()
    await test.health.start()
    test.health.setListenerCount(6)
    test.advance(HEALTH_STALE_MS + 1)
    expect(test.health.stateFor(false, true)).toBe('listener-down')
    expect(test.health.stateFor(false, false)).toBe('waiting')
  })

  it('records a bounded last error and never throws on a failed write', async () => {
    const test = harness()
    await test.health.start()
    test.health.recordError(new Error('x'.repeat(1000)))
    await expect(test.health.flush()).resolves.toBeUndefined()
    const last = test.health.snapshot()
    expect(last.lastErrorAt).toBe(test.now())
    expect(last.lastError?.length).toBeLessThanOrEqual(300)
    const throwing = new WorkflowHealth({
      root: '/workspace/.dsh/workflows',
      triggerCount: 1,
      probe: async () => true,
      write: async () => {
        throw new Error('disk full')
      },
    })
    await expect(throwing.selfCheck()).resolves.toBeUndefined()
  })

  it('disposes the self-check timer', async () => {
    const test = harness()
    await test.health.start()
    test.health.dispose()
    expect(test.disposed).toEqual([true])
  })
})
