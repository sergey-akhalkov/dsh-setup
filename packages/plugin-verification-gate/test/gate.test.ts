import { describe, expect, it } from 'vitest'
import { createAgent, type FakeAgent, Harness, shellResult } from './harness.js'

/** One fresh harness with a started turn, a source write, and no check run yet. */
async function dirtyTurn(
  config: { commands?: string[]; maxBlocks?: number } = { commands: ['pnpm check'] },
): Promise<Harness> {
  const harness = new Harness(config)
  await harness.preStep(1)
  await harness.write('src/app.ts')
  return harness
}

describe('verification gate turn detection', () => {
  it('refuses a code-changing turn with no check', async () => {
    const harness = await dirtyTurn()
    await harness.stop()
    const text = harness.steerTexts()[0] ?? ''
    expect(text).toContain('"pnpm check"')
    expect(text).toContain('src/app.ts')
    expect(text).toContain('Next:')
    expect(text).toContain('A text claim does not satisfy the gate.')
  })

  it('does not accept a text claim in place of a matching result', async () => {
    const harness = await dirtyTurn()
    // The turn's assistant text is not an observation this gate reads.
    await harness.stop()
    expect(harness.steerTexts()[0]).toContain('A text claim does not satisfy the gate.')
  })

  it('marks a successful edit as a code write', async () => {
    const harness = new Harness({ commands: ['pnpm check'] })
    await harness.edit('src/edited.ts')
    await harness.stop()
    expect(harness.steerTexts()).toHaveLength(1)
    expect(harness.steerTexts()[0]).toContain('src/edited.ts')
  })

  it('does not mark a failed write', async () => {
    const harness = new Harness({ commands: ['pnpm check'] })
    await harness.write('src/app.ts', { isError: true })
    await harness.stop()
    expect(harness.steerTexts()).toEqual([])
  })

  it('does not mark a write without a canonical path', async () => {
    const harness = new Harness({ commands: ['pnpm check'] })
    await harness.write('src/app.ts', { value: {} })
    await harness.stop()
    expect(harness.steerTexts()).toEqual([])
  })

  it('does not mark Markdown files', async () => {
    for (const path of ['README.md', 'docs/page.MD', 'src/notes.md']) {
      const harness = new Harness({ commands: ['pnpm check'] })
      await harness.write(path)
      await harness.stop()
      expect(harness.steerTexts()).toEqual([])
    }
  })

  it('does not mark planning scratch roots', async () => {
    const paths = [
      'openspec/changes/x/implementation.ts',
      '.dsh/state/notes.json',
      '.tmp/build/output.ts',
      'node_modules/pkg/index.js',
      ['repo', 'openspec', 'changes', 'x', 'implementation.ts'].join('\\'),
      ['repo', 'node_modules', 'pkg', 'index.js'].join('\\'),
    ]
    for (const path of paths) {
      const harness = new Harness({ commands: ['pnpm check'] })
      await harness.write(path)
      await harness.stop()
      expect(harness.steerTexts()).toEqual([])
    }
  })

  it('does not infer a shell-mediated write', async () => {
    const harness = new Harness({ commands: ['pnpm check'] })
    await harness.shell('git checkout -- src/app.ts', shellResult())
    await harness.stop()
    expect(harness.steerTexts()).toEqual([])
  })

  it('excludes subagent-origin sessions', async () => {
    const subagent = createAgent('subagent')
    const harness = new Harness({ commands: ['pnpm check'] }, subagent)
    await harness.write('src/app.ts', {}, subagent)
    await harness.stop(1, subagent)
    expect(harness.steerTexts()).toEqual([])
    expect(harness.noticeTexts()).toEqual([])
  })
})

describe('verification gate command recognition', () => {
  it('accepts a direct exact match', async () => {
    const harness = await dirtyTurn()
    await harness.shell('pnpm check', shellResult())
    await harness.stop()
    expect(harness.steerTexts()).toEqual([])
  })

  it('accepts one leading rtk token', async () => {
    for (const command of ['rtk pnpm check', '  rtk   pnpm check  ']) {
      const harness = await dirtyTurn()
      await harness.shell(command, shellResult())
      await harness.stop()
      expect(harness.steerTexts()).toEqual([])
    }
  })

  it('accepts a configured rtk form as an exact match', async () => {
    const harness = await dirtyTurn({ commands: ['rtk pnpm check'] })
    await harness.shell('rtk pnpm check', shellResult())
    await harness.stop()
    expect(harness.steerTexts()).toEqual([])
  })

  it('rejects extra arguments and the watch script', async () => {
    for (const command of ['pnpm check --watch', 'pnpm check:watch', 'rtk pnpm check --watch']) {
      const harness = await dirtyTurn()
      await harness.shell(command, shellResult())
      await harness.stop()
      expect(harness.steerTexts()).toHaveLength(1)
    }
  })

  it('rejects masked failures', async () => {
    for (const command of ['pnpm check || true', 'pnpm check ; exit 0']) {
      const harness = await dirtyTurn()
      await harness.shell(command, shellResult())
      await harness.stop()
      expect(harness.steerTexts()).toHaveLength(1)
    }
  })

  it('preserves internal whitespace in quoted arguments', async () => {
    const configured = 'node -e "console.log(\'a b\')"'
    const same = await dirtyTurn({ commands: [configured] })
    await same.shell(configured, shellResult())
    await same.stop()
    expect(same.steerTexts()).toEqual([])

    const different = configured.replace('a b', 'a  b')
    const spaced = await dirtyTurn({ commands: [configured] })
    await spaced.shell(different, shellResult())
    await spaced.stop()
    expect(spaced.steerTexts()).toHaveLength(1)
  })

  it('is case-sensitive', async () => {
    const harness = await dirtyTurn()
    await harness.shell('PNPM check', shellResult())
    await harness.stop()
    expect(harness.steerTexts()).toHaveLength(1)
  })

  it('ignores a matching command argument on a non-shell tool', async () => {
    const harness = await dirtyTurn()
    await harness.toolOutcome('delegate', { command: 'pnpm check' }, shellResult(), false)
    await harness.stop()
    expect(harness.steerTexts()).toHaveLength(1)
  })

  it('recognizes both foreground shell tools', async () => {
    for (const tool of ['pwsh', 'bash'] as const) {
      const harness = await dirtyTurn()
      await harness.shell('pnpm check', shellResult(), { tool })
      await harness.stop()
      expect(harness.steerTexts()).toEqual([])
    }
  })
})

describe('verification gate success rule', () => {
  it('refuses a stale success before the last write', async () => {
    const harness = new Harness({ commands: ['pnpm check'] })
    await harness.preStep(1)
    await harness.shell('pnpm check', shellResult())
    await harness.write('src/app.ts')
    await harness.stop()
    expect(harness.steerTexts()).toHaveLength(1)
  })

  it('refuses a failed exit', async () => {
    const harness = await dirtyTurn()
    await harness.shell('pnpm check', shellResult({ exitCode: 1 }))
    await harness.stop()
    const text = harness.steerTexts()[0] ?? ''
    expect(text).toContain('"pnpm check"')
    expect(text).not.toContain('could not be read')
  })

  it('refuses a null exit without a signal', async () => {
    const harness = await dirtyTurn()
    await harness.shell('pnpm check', shellResult({ exitCode: null }))
    await harness.stop()
    expect(harness.steerTexts()).toHaveLength(1)
  })

  it('refuses an interrupted run', async () => {
    const variants = [
      shellResult({ signal: 'SIGKILL' }),
      shellResult({ timedOut: true }),
      shellResult({ aborted: true }),
      shellResult({ sandbox: { mode: 'workspace-write', denied: true } }),
      shellResult({ sandbox: { mode: 'workspace-write', denied: false, runnerFailed: true } }),
    ]
    for (const value of variants) {
      const harness = await dirtyTurn()
      await harness.shell('pnpm check', value)
      await harness.stop()
      expect(harness.steerTexts()).toHaveLength(1)
    }
  })

  it('refuses a background or promoted handle and names the unreadable exit state', async () => {
    const values = [
      { kind: 'background', jobId: 'job-1', cwd: 'repo' },
      { kind: 'promoted', jobId: 'job-1', cwd: 'repo', timeoutMs: 1_000, output: '' },
    ]
    for (const value of values) {
      const harness = await dirtyTurn()
      await harness.shell('pnpm check', value)
      await harness.stop()
      const text = harness.steerTexts()[0] ?? ''
      expect(text).toContain('exit state could not be read')
    }
  })

  it('refuses an unknown or incomplete result shape', async () => {
    const values = [
      { output: '', exitCode: 0 },
      { kind: 'foreground' },
      shellResult({ signal: undefined }),
      shellResult({ timedOut: undefined }),
      shellResult({ aborted: undefined }),
      shellResult({ sandbox: {} }),
    ]
    for (const value of values) {
      const harness = await dirtyTurn()
      await harness.shell('pnpm check', value)
      await harness.stop()
      const text = harness.steerTexts()[0] ?? ''
      expect(text).toContain('could not be read')
    }
  })

  it('refuses a tool-error result', async () => {
    const harness = await dirtyTurn()
    await harness.shell('pnpm check', undefined, { isError: true })
    await harness.stop()
    expect(harness.steerTexts()).toHaveLength(1)
  })

  it('accepts a clean confined run and clears the gate', async () => {
    const harness = await dirtyTurn()
    await harness.shell(
      'pnpm check',
      shellResult({ sandbox: { mode: 'workspace-write', denied: false } }),
    )
    await harness.stop()
    expect(harness.steerTexts()).toEqual([])
  })

  it('allows the close after a refusal and a later success', async () => {
    const harness = await dirtyTurn()
    await harness.stop()
    expect(harness.steerTexts()).toHaveLength(1)
    await harness.shell('pnpm check', shellResult())
    await harness.stop()
    expect(harness.steerTexts()).toHaveLength(1)
  })

  it('requires a fresh success after a later write', async () => {
    const harness = await dirtyTurn()
    await harness.shell('pnpm check', shellResult())
    await harness.write('src/later.ts')
    await harness.stop()
    expect(harness.steerTexts()).toHaveLength(1)
    expect(harness.steerTexts()[0]).toContain('src/later.ts')
  })
})

describe('verification gate block cap', () => {
  it('steers maxBlocks times then allows an unverified close', async () => {
    const harness = await dirtyTurn()
    for (let index = 0; index < 8; index += 1) await harness.stop()
    expect(harness.steerTexts()).toHaveLength(8)
    expect(harness.noticeTexts()).toEqual([])

    await harness.stop()
    expect(harness.steerTexts()).toHaveLength(8)
    expect(harness.noticeTexts()).toHaveLength(1)
    const notice = harness.noticeTexts()[0] ?? ''
    expect(notice).toContain('UNVERIFIED')
    expect(notice).toContain('"pnpm check"')
    expect(notice).not.toMatch(/check passed/iu)

    await harness.stop()
    expect(harness.steerTexts()).toHaveLength(8)
    expect(harness.noticeTexts()).toHaveLength(1)
  })

  it('does not reset the counter after an intermediate step in the same turn', async () => {
    const harness = await dirtyTurn({ commands: ['pnpm check'], maxBlocks: 2 })
    await harness.stop()
    await harness.preStep(1)
    await harness.stop()
    expect(harness.steerTexts()).toHaveLength(2)

    await harness.stop()
    expect(harness.steerTexts()).toHaveLength(2)
    expect(harness.noticeTexts()).toHaveLength(1)
  })

  it('resets the counter and the cap when the turn identity changes', async () => {
    const harness = await dirtyTurn({ commands: ['pnpm check'], maxBlocks: 2 })
    await harness.stop()
    await harness.stop()
    await harness.stop()
    expect(harness.noticeTexts()).toHaveLength(1)

    await harness.stop(2)
    expect(harness.steerTexts()).toHaveLength(3)
    expect(harness.noticeTexts()).toHaveLength(1)
  })

  it('refuses again in a new turn because the dirty state survives', async () => {
    const harness = await dirtyTurn({ commands: ['pnpm check'], maxBlocks: 1 })
    await harness.stop()
    await harness.stop()
    expect(harness.noticeTexts()).toHaveLength(1)
    expect(harness.steerTexts()).toHaveLength(1)

    await harness.preStep(2)
    await harness.stop(2)
    expect(harness.steerTexts()).toHaveLength(2)
  })
})

describe('verification gate message bounds', () => {
  it('bounds the message and strips control characters', async () => {
    const harness = new Harness({ commands: ['pnpm check'] })
    const path = `src/${'a'.repeat(2_000)}\u0007${'\u0001'.repeat(5)}.ts`
    await harness.write(path)
    await harness.stop()
    const text = harness.steerTexts()[0] ?? ''
    expect(text.length).toBeLessThanOrEqual(800)
    for (const character of text) {
      const code = character.codePointAt(0) ?? 0
      // Newlines are the deliberate line separator; no other control character survives.
      expect(code === 0x0a || (code >= 0x20 && code !== 0x7f)).toBe(true)
    }
    expect(text).toContain('…')
  })

  it('never includes file contents in a refusal', async () => {
    const harness = await dirtyTurn()
    await harness.write('src/app.ts', {
      value: { path: 'src/app.ts', after: 'SECRET_FILE_CONTENT' },
    })
    await harness.stop()
    expect(harness.steerTexts()[0]).not.toContain('SECRET_FILE_CONTENT')
  })
})

describe('verification gate observation order', () => {
  it('keeps state per agent', async () => {
    const first: FakeAgent = createAgent()
    const second: FakeAgent = createAgent()
    const firstHarness = new Harness({ commands: ['pnpm check'] }, first)
    await firstHarness.write('src/first.ts', {}, first)
    await firstHarness.stop(1, first)
    expect(firstHarness.steerTexts()).toHaveLength(1)

    const secondHarness = new Harness({ commands: ['pnpm check'] }, second)
    await secondHarness.write('src/second.ts', {}, second)
    await secondHarness.stop(1, second)
    expect(secondHarness.steerTexts()).toHaveLength(1)
    expect(firstHarness.steerTexts()).toHaveLength(1)
  })

  it('allows a turn with only a successful check and no write', async () => {
    const harness = new Harness({ commands: ['pnpm check'] })
    await harness.preStep(1)
    await harness.shell('pnpm check', shellResult())
    await harness.stop()
    expect(harness.steerTexts()).toEqual([])
  })
})
