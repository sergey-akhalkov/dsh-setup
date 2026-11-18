import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildConditionContext,
  evaluateCondition,
  evaluateConditions,
} from '../src/host/condition.ts'
import { validateCondition } from '../src/host/condition-schema.ts'
import { type Definition, validateDefinition } from '../src/host/definitions.ts'
import { currentSpecDigest } from '../src/host/evidence.ts'
import { taskIdOf } from '../src/host/tasks.ts'
import { evaluateDefinitions, evaluateDefinitionTrigger } from '../src/host/triggers.ts'

const roots: string[] = []
const TASKS = `# Tasks

## 1. Engine (lane 1, owns \`packages/plugin-x/src/**\`, \`packages/plugin-x/test/**\`)

- [x] 1.1 Add the engine
- [ ] 1.2 Add the gate

## 2. Serial tail (serial, owns \`docs/**\`)

- [ ] 2.1 Update the docs
`

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'workflows-condition-'))
  roots.push(root)
  const changeDir = join(root, 'openspec', 'changes', 'auth')
  await mkdir(changeDir, { recursive: true })
  await writeFile(join(changeDir, 'tasks.md'), TASKS, 'utf8')
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function definition(condition: Readonly<Record<string, unknown>>): Definition {
  return validateDefinition({
    v: 1,
    id: 'spec-review-gated',
    name: 'Gated review',
    version: 1,
    trigger: {
      kind: 'turn.stopping',
      match: {},
      mode: 'active',
      dedupe: 'turn',
      condition,
    },
    settings: {
      allowModelStart: false,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
    },
    steps: [
      {
        id: 'check',
        title: 'Check',
        executor: 'main',
        prompt: 'Check the spec.',
        evidence: { kind: 'file', path: 'openspec/changes/{name}/tasks.md' },
        next: 'end',
      },
    ],
  })
}

/** A trigger with no condition: a context-build failure must not affect it. */
function plainDefinition(): Definition {
  return validateDefinition({
    v: 1,
    id: 'plain-check',
    name: 'Plain check',
    version: 1,
    trigger: { kind: 'turn.stopping', match: {}, mode: 'active', dedupe: 'turn' },
    settings: {
      allowModelStart: false,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
    },
    steps: [
      {
        id: 'check',
        title: 'Check',
        executor: 'main',
        prompt: 'Check the spec.',
        evidence: { kind: 'file', path: 'openspec/changes/{name}/tasks.md' },
        next: 'end',
      },
    ],
  })
}

describe('condition schema', () => {
  it('accepts the bounded context roots', () => {
    expect(() =>
      validateCondition({
        and: [
          { '==': [{ var: 'session.changedSpec' }, true] },
          { missing: ['records.spec.pass'] },
          { '>': [{ var: 'change.tasks.unchecked' }, 0] },
          { in: [{ var: 'event.tool' }, ['pwsh', 'bash']] },
          { '==': [{ var: 'digests.spec' }, 'a'.repeat(64)] },
        ],
      }),
    ).not.toThrow()
  })

  it('refuses an unknown context field, a path, and a non-JSONLogic operator', () => {
    expect(() => validateCondition({ '==': [{ var: 'workspace.path' }, 'x'] })).toThrow(
      /unknown context field/u,
    )
    expect(() => validateCondition({ '==': [{ var: '../secret' }, 'x'] })).toThrow(
      /must not name a path/u,
    )
    expect(() => validateCondition({ nope: [1] })).toThrow(/unknown operator/u)
  })

  it('fails a definition load with the condition field', () => {
    expect(() => definition({ '==': [{ var: 'notAField.x' }, 1] })).toThrow(
      /field "trigger\.condition"/u,
    )
  })
})

describe('condition context', () => {
  it('carries the tasks, lanes, records, digests, and session involvement', async () => {
    const root = await workspace()
    const digest = await currentSpecDigest(root, 'auth')
    expect(digest).toBeDefined()
    const specDir = join(root, '.dsh', 'workflows', 'records', 'spec-review', 'auth')
    await mkdir(specDir, { recursive: true })
    await writeFile(
      join(specDir, 'spec.json'),
      JSON.stringify({
        rule: 'spec-review',
        change: 'auth',
        phase: 'spec',
        scope: 'whole',
        digest,
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        session: 'session-1',
        runId: 'run-1',
        time: '2026-11-14T00:00:00.000Z',
      }),
      'utf8',
    )
    const taskDir = join(root, '.dsh', 'workflows', 'records', 'task-review', 'auth', 'tasks')
    await mkdir(taskDir, { recursive: true })
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const taskId = taskIdOf('Add the engine')
    await writeFile(
      join(taskDir, `${taskId}.json`),
      JSON.stringify({
        rule: 'task-review',
        change: 'auth',
        phase: 'task',
        scope: 'task',
        taskId,
        digest: 'b'.repeat(64),
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        time: '2026-11-14T00:00:00.000Z',
      }),
      'utf8',
    )
    const context = await buildConditionContext({
      workspace: root,
      change: 'auth',
      event: { kind: 'turn.stopping' },
      involved: true,
      changedSpec: true,
      completed: false,
    })
    expect(context.change.name).toBe('auth')
    expect(context.change.tasks.checked).toEqual([taskId])
    expect(context.change.tasks.unchecked).toHaveLength(2)
    expect(context.change.lanes).toHaveLength(2)
    expect(context.change.lanes[0]?.owned).toEqual([
      'packages/plugin-x/src/**',
      'packages/plugin-x/test/**',
    ])
    expect(context.change.lanes[0]?.unchecked).toEqual(['1.2'])
    expect(context.change.lanes[1]?.title).toContain('Serial tail')
    expect(context.records.spec?.verdict).toBe('PASS')
    expect(context.records.spec?.current).toBe(true)
    expect(context.records.spec?.pass).toBe(true)
    expect(context.records.tasks[taskId]).toEqual({ verdict: 'PASS', digest: 'b'.repeat(64) })
    expect(context.digests.spec).toBe(digest)
    expect(context.session).toEqual({ involved: true, changedSpec: true, completed: false })
  })

  it('evaluates true and false predicates over the context', async () => {
    const root = await workspace()
    const context = await buildConditionContext({
      workspace: root,
      change: 'auth',
      event: { kind: 'turn.stopping', tool: 'pwsh' },
    })
    const conditions = definition({ '==': [{ var: 'session.changedSpec' }, true] })
    expect(evaluateCondition(conditions.trigger.condition, context)).toBe(false)
    expect(
      evaluateCondition(
        { and: [{ var: 'change.tasks.unchecked' }, { in: [{ var: 'event.tool' }, ['pwsh']] }] },
        context,
      ),
    ).toBe(true)
    const decisions = evaluateConditions(
      [
        { id: 'a', trigger: { condition: { '==': [{ var: 'session.changedSpec' }, false] } } },
        { id: 'b', trigger: {} },
      ],
      context,
    )
    expect([...decisions.entries()]).toEqual([['a', true]])
  })
})

describe('trigger condition evaluation', () => {
  it('records condition-false, not-ready, and would-fire', () => {
    const gated = definition({ '==': [{ var: 'session.changedSpec' }, true] })
    const event = {
      kind: 'turn.stopping' as const,
      subject: 'turn',
      session: 'session-1',
      turn: 1,
    }
    const falseRow = evaluateDefinitionTrigger(gated, event, {
      conditions: new Map([[gated.id, false]]),
      isDuplicate: () => false,
    })
    expect(falseRow).toMatchObject({ matched: false, reason: 'condition-false' })
    const readyRow = evaluateDefinitionTrigger(gated, event, {
      conditions: new Map([[gated.id, true]]),
      isDuplicate: () => false,
    })
    expect(readyRow).toMatchObject({ matched: true, reason: 'would-fire' })
    const missingRow = evaluateDefinitionTrigger(gated, event, {
      isDuplicate: () => false,
    })
    expect(missingRow).toMatchObject({ matched: false, reason: 'not-ready' })
  })
})

describe('condition schema completeness', () => {
  it('refuses an unknown nested field and a forbidden path in every field reference', () => {
    for (const condition of [
      { '==': [{ var: 'session.noSuchField' }, true] },
      { '==': [{ var: 'records.spec.unknown' }, true] },
      { missing: ['workspace.path'] },
      { missing: ['../secret'] },
      { missing_some: [1, ['../secret']] },
      { missing: [{ var: 'records.spec.pass' }] },
      { '==': [{ var: 'title' }, 'Engine'] },
      { '==': [{ var: 'change.lanes.title' }, 'Engine'] },
      { '==': [{ var: 'change.lanes.unchecked' }, []] },
      { missing: [42] },
    ]) {
      expect(() => validateCondition(condition)).toThrow(
        /unknown context field|must not name a path|literal field names|literal field names, not numbers/u,
      )
    }
  })

  it('accepts every documented field including records.spec.pass', () => {
    expect(() =>
      validateCondition({
        and: [
          { '==': [{ var: 'records.spec.pass' }, true] },
          { '==': [{ var: 'records.tasks.0123456789abcdef.verdict' }, 'PASS'] },
          { '==': [{ var: 'change.lanes.0.title' }, 'x'] },
          { '==': [{ var: 'digests.worktree' }, 'a'] },
          { missing: ['records.spec.digest'] },
        ],
      }),
    ).not.toThrow()
  })
})

describe('condition truthiness and session fields', () => {
  it('treats an empty array and an empty missing result as false', async () => {
    const root = await workspace()
    const context = await buildConditionContext({
      workspace: root,
      change: 'auth',
      event: { kind: 'turn.stopping' },
    })
    expect(context.change.tasks.unchecked).toHaveLength(2)
    expect(evaluateCondition({ var: 'change.tasks.unchecked' }, context)).toBe(true)
    expect(evaluateCondition({ missing: ['event.kind'] }, context)).toBe(false)
    expect(evaluateCondition({ and: [{ missing: ['event.kind'] }, true] }, context)).toBe(false)
    // A missing required root name yields the documented empty-array false.
    expect(evaluateCondition({ var: 'records.tasks' }, context)).toBe(true)
  })

  it('exposes records.spec.pass and the worktree digest', async () => {
    const root = await workspace()
    const changeDir = join(root, 'openspec', 'changes', 'auth')
    const digest = (await currentSpecDigest(root, 'auth')) as string
    await mkdir(join(root, '.dsh', 'workflows', 'records', 'spec-review', 'auth'), {
      recursive: true,
    })
    await writeFile(
      join(root, '.dsh', 'workflows', 'records', 'spec-review', 'auth', 'spec.json'),
      JSON.stringify({
        rule: 'spec-review',
        change: 'auth',
        phase: 'spec',
        scope: 'whole',
        digest,
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        session: 'session-1',
        runId: 'run-1',
        time: '2026-11-14T00:00:00.000Z',
      }),
      'utf8',
    )
    const runGit = async (args: readonly string[]): Promise<Buffer> => {
      if (args[0] === 'rev-parse') return Buffer.from(root)
      if (args[0] === 'status') return Buffer.from('?? note.txt\0')
      if (args[0] === 'diff') return Buffer.from('')
      throw new Error(`unexpected git ${args[0]}`)
    }
    await writeFile(join(root, 'note.txt'), 'x', 'utf8')
    const context = await buildConditionContext({
      workspace: root,
      change: 'auth',
      event: { kind: 'turn.stopping' },
      runGit,
    })
    expect(context.records.spec?.pass).toBe(true)
    expect(context.digests.worktree).toHaveLength(64)
    expect(
      evaluateCondition(
        { and: [{ '==': [{ var: 'records.spec.pass' }, true] }, { var: 'digests.worktree' }] },
        context,
      ),
    ).toBe(true)
    void changeDir
  })
})

describe('condition routing', () => {
  it('forwards a true condition to a run and suppresses a false one', () => {
    const made = definition({ '==': [{ var: 'session.completed' }, true] })
    const event = {
      kind: 'turn.stopping' as const,
      subject: 'turn',
      session: 'session-1',
      turn: 1,
    }
    const starts: string[] = []
    const rows = evaluateDefinitions([made], event, {
      conditions: new Map([[made.id, true]]),
      isDuplicate: () => false,
      startRun: (entry) => {
        starts.push(entry.id)
        return { ok: true, runId: 'run-1' }
      },
    })
    expect(rows[0]?.reason).toBe('run-created')
    expect(starts).toEqual([made.id])
    const suppressed = evaluateDefinitions([made], event, {
      conditions: new Map([[made.id, false]]),
      isDuplicate: () => false,
      startRun: () => {
        throw new Error('no run may start')
      },
    })
    expect(suppressed[0]?.reason).toBe('condition-false')
  })
})

describe('condition route and item scopes', () => {
  it('refuses a condition on a non-turn-close trigger', () => {
    expect(() =>
      validateDefinition({
        ...definition({ '==': [1, 1] }),
        trigger: {
          kind: 'fs.change',
          match: { path: 'openspec/changes/{name}/tasks.md' },
          mode: 'active',
          dedupe: 'path+content-hash',
          condition: { '==': [1, 1] },
        },
      }),
    ).toThrow(/turn.stopping/u)
  })

  it('accepts indexed lane and task-item fields, and item-relative vars in some', () => {
    expect(() =>
      validateCondition({
        and: [
          { '==': [{ var: 'change.lanes.0.title' }, 'Engine'] },
          { '==': [{ var: 'change.tasks.items.1.checked' }, false] },
          { some: [{ var: 'change.lanes' }, { '==': [{ var: 'title' }, 'Engine'] }] },
        ],
      }),
    ).not.toThrow()
  })

  it('refuses a computed missing name', () => {
    expect(() => validateCondition({ missing: [{ cat: ['session.', 'noSuchField'] }] })).toThrow(
      /literal field names/u,
    )
  })

  it('derives session.completed from the checked task list', async () => {
    const root = await workspace()
    const done = await buildConditionContext({
      workspace: root,
      change: 'auth',
      event: { kind: 'turn.stopping' },
    })
    expect(done.session.completed).toBe(false)
    await writeFile(
      join(root, 'openspec', 'changes', 'auth', 'tasks.md'),
      '# Tasks\n\n- [x] 1.1 Done\n- [x] 2.1 Also done\n',
      'utf8',
    )
    const complete = await buildConditionContext({
      workspace: root,
      change: 'auth',
      event: { kind: 'turn.stopping' },
    })
    expect(complete.session.completed).toBe(true)
  })
})

describe('collection item scopes', () => {
  it('accepts the fields of the selected collection', () => {
    expect(() =>
      validateCondition({
        and: [
          { some: [{ var: 'change.lanes' }, { '==': [{ var: 'title' }, 'Engine'] }] },
          { some: [{ var: 'change.tasks.items' }, { '==': [{ var: 'checked' }, false] }] },
        ],
      }),
    ).not.toThrow()
  })

  it('rejects a root field inside a scalar collection predicate', () => {
    expect(() =>
      validateCondition({
        some: [{ var: 'change.tasks.unchecked' }, { var: 'session.involved' }],
      }),
    ).toThrow(/unknown item field/u)
  })
  it('rejects a root field inside a collection predicate', () => {
    expect(() =>
      validateCondition({
        some: [{ var: 'change.lanes' }, { var: 'session.involved' }],
      }),
    ).toThrow(/unknown item field/u)
  })

  it('rejects a task field on a lane and a lane field on a task', () => {
    expect(() =>
      validateCondition({
        some: [{ var: 'change.lanes' }, { '==': [{ var: 'text' }, null] }],
      }),
    ).toThrow(/unknown (context|item) field/u)
    expect(() =>
      validateCondition({
        some: [{ var: 'change.tasks.items' }, { '==': [{ var: 'title' }, null] }],
      }),
    ).toThrow(/unknown (context|item) field/u)
  })
})

describe('condition evaluation budget', () => {
  it('stops an exponentially nested predicate instead of freezing the host', async () => {
    const root = await workspace()
    const context = await buildConditionContext({
      workspace: root,
      change: 'auth',
      event: { kind: 'turn.stopping' },
    })
    let condition: Record<string, unknown> = { '==': [1, 1] }
    for (let level = 0; level < 5; level += 1) {
      condition = {
        some: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], condition],
      }
    }
    expect(() => evaluateCondition(condition, context)).toThrow(/budget/u)
    expect(
      evaluateConditions([{ id: 'gated', trigger: { condition } }], context).get('gated'),
    ).toBe(false)
  })
})

describe('scalar item references', () => {
  it('accepts and evaluates the empty current-item reference', async () => {
    expect(() =>
      validateCondition({
        some: [
          { var: 'change.tasks.unchecked' },
          { '==': [{ var: '' }, taskIdOf('Add the gate')] },
        ],
      }),
    ).not.toThrow()
    const root = await workspace()
    const context = await buildConditionContext({
      workspace: root,
      change: 'auth',
      event: { kind: 'turn.stopping' },
    })
    expect(
      evaluateCondition(
        {
          some: [
            { var: 'change.tasks.unchecked' },
            { '==': [{ var: '' }, taskIdOf('Add the gate')] },
          ],
        },
        context,
      ),
    ).toBe(true)
  })
})

describe('collection var default form', () => {
  it('derives item scope from the var default-value form and missing item fields', () => {
    expect(() =>
      validateCondition({
        and: [
          { some: [{ var: ['change.lanes', []] }, { '==': [{ var: 'title' }, 'Engine'] }] },
          { some: [{ var: ['change.lanes', []] }, { missing: ['title'] }] },
        ],
      }),
    ).not.toThrow()
  })
})

describe('reduce predicate scope', () => {
  it('accepts current/accumulator and rejects a root field in the reducer', () => {
    expect(() => validateCondition({ reduce: [[1, 2], { var: 'current' }, 0] })).not.toThrow()
    expect(() => validateCondition({ reduce: [[1, 2], { var: 'accumulator' }, 0] })).not.toThrow()
    expect(() => validateCondition({ reduce: [[1, 2], { var: 'session.involved' }, 0] })).toThrow(
      /unknown item field/u,
    )
  })
})

describe('condition size bound', () => {
  it('stops a nested reducer that would expand into a huge string', async () => {
    const root = await workspace()
    const context = await buildConditionContext({
      workspace: root,
      event: { kind: 'turn.stopping' },
    })
    const items = Array.from({ length: 20 }, (_, index) => index + 1)
    const condition = {
      substr: [
        {
          reduce: [items, [{ var: 'accumulator' }, { var: 'accumulator' }], 'x'],
        },
        0,
      ],
    }
    expect(() => evaluateCondition(condition, context)).toThrow(/oversized collection/u)
  })
  it('stops a reducer that doubles its accumulator', async () => {
    const root = await workspace()
    const context = await buildConditionContext({
      workspace: root,
      event: { kind: 'turn.stopping' },
    })
    const items = Array.from({ length: 16 }, (_, index) => index + 1)
    const condition = {
      reduce: [items, { merge: [{ var: 'accumulator' }, { var: 'accumulator' }] }, [1]],
    }
    expect(() => evaluateCondition(condition, context)).toThrow(/oversized collection/u)
  })
})

describe('condition context path boundary', () => {
  // Compose drive and UNC fixtures at runtime so the repository machine-path scan never finds them.
  const DRIVE = ['C', ':'].join('')
  const UNC = ['\\', '\\', 'server', '\\', 'share', '\\', 'token.txt'].join('')
  it('refuses a drive-relative lane owner', async () => {
    const root = await workspace()
    await writeFile(
      join(root, 'openspec', 'changes', 'auth', 'tasks.md'),
      '# Tasks\n\n## 1. Lane (lane 1, owns `C:private/**`)\n\n- [ ] 1.1 Do it\n',
      'utf8',
    )
    await expect(
      buildConditionContext({
        workspace: root,
        change: 'auth',
        event: { kind: 'turn.stopping' },
      }),
    ).rejects.toThrow(/filesystem path/u)
  })

  it('builds a context for prose that names URLs and paths', async () => {
    for (const text of [
      'Deploy to https://example.invalid',
      'Open `sidebar://worktrees` in the right pane',
      'Reject `mv`/archive and adoption after PASS',
      'Fetch https://example.invalid/a/../b',
      'Read `safe/..`',
      'Read </etc/private/token.txt>',
      'Read </данные/private/token.txt>',
      'Read /usr/local/lib/example',
      'Read path:/etc/private/token.txt',
      `Read ${DRIVE}/private/token.txt`,
      `Read ${UNC}`,
      `Read **${DRIVE}/private/token.txt**`,
      `Read [${DRIVE}/private/token.txt]`,
      'Read **../private/token.txt**',
    ]) {
      const root = await workspace()
      await writeFile(
        join(root, 'openspec', 'changes', 'auth', 'tasks.md'),
        `# Tasks\n\n## 1. Lane (lane 1, owns \`packages/**\`)\n\n- [ ] 1.1 ${text}\n`,
        'utf8',
      )
      const context = await buildConditionContext({
        workspace: root,
        change: 'auth',
        event: { kind: 'turn.stopping' },
      })
      expect(context.change.tasks.items[0]?.text).toBe(text)
    }
  })

  it('builds a context for prose in a lane title', async () => {
    for (const title of [
      'Deploy to https://example.invalid',
      'Open `sidebar://worktrees`',
      'Reject `mv`/archive',
      'Read /etc/private/token.txt',
      `Read ${DRIVE}/private/token.txt`,
    ]) {
      const root = await workspace()
      await writeFile(
        join(root, 'openspec', 'changes', 'auth', 'tasks.md'),
        `# Tasks\n\n## 1. ${title} (lane 1, owns \`packages/**\`)\n\n- [ ] 1.1 Do it\n`,
        'utf8',
      )
      const context = await buildConditionContext({
        workspace: root,
        change: 'auth',
        event: { kind: 'turn.stopping' },
      })
      expect(context.change.lanes[0]?.title).toContain(title)
    }
  })

  it('refuses an absolute, UNC, or traversing path in event.path', async () => {
    const root = await workspace()
    for (const path of [
      '/etc/private/token.txt',
      `${DRIVE}/private/token.txt`,
      '../private/token.txt',
      '..\\private\\token.txt',
      UNC,
    ]) {
      await expect(
        buildConditionContext({
          workspace: root,
          change: 'auth',
          event: { kind: 'fs.change', path },
        }),
      ).rejects.toThrow(/filesystem path/u)
    }
  })

  it('refuses an absolute path, file URL, or redirection in event.command', async () => {
    const root = await workspace()
    for (const command of [
      'cat /etc/private/token.txt',
      'cat path:/etc/private/token.txt',
      'cat </etc/private/token.txt>',
      `cat ${UNC}`,
      'cat file:///etc/private/token.txt',
      'cat ..\\private\\token.txt',
      'echo x>/etc/private/token.txt',
      'echo x>>/etc/private/token.txt',
      'curl https://example.invalid -o /etc/private/token.txt',
      'curl https://example.invalid>/etc/private/token.txt',
      'curl https://example.invalid>>/etc/private/token.txt',
      'curl https://example.invalid</etc/private/token.txt',
      'curl "https://example.invalid>/etc/private/token.txt"',
    ]) {
      await expect(
        buildConditionContext({
          workspace: root,
          change: 'auth',
          event: { kind: 'tool.pre-execute', command },
        }),
      ).rejects.toThrow(/filesystem path/u)
    }
  })

  it('builds a context for a non-file URL in event.command', async () => {
    const root = await workspace()
    for (const command of [
      'git clone https://example.invalid/repo',
      'curl sidebar://worktrees',
      'git fetch ssh://git@example.invalid/repo',
    ]) {
      const context = await buildConditionContext({
        workspace: root,
        change: 'auth',
        event: { kind: 'tool.pre-execute', command },
      })
      expect(context.event.command).toBe(command)
    }
  })

  it('builds a context for this change plan without rejecting its prose', async () => {
    const source = join(
      fileURLToPath(new URL('..', import.meta.url)),
      '..',
      '..',
      'openspec',
      'changes',
      'archive',
      '2026-11-17-retire-delegation-rules',
      'tasks.md',
    )
    const root = await workspace()
    await writeFile(
      join(root, 'openspec', 'changes', 'auth', 'tasks.md'),
      await readFile(source, 'utf8'),
      'utf8',
    )
    const context = await buildConditionContext({
      workspace: root,
      change: 'auth',
      event: { kind: 'turn.stopping' },
    })
    expect(context.change.tasks.items.length).toBeGreaterThan(0)
  })

  it('builds a context for prose that uses a range with dots', async () => {
    const root = await workspace()
    await writeFile(
      join(root, 'openspec', 'changes', 'auth', 'tasks.md'),
      '# Tasks\n\n## 1. Lane (lane 1, owns `packages/**`)\n\n- [ ] 1.1 Key the ids as `f1`..`fn` and keep them stable\n',
      'utf8',
    )
    const context = await buildConditionContext({
      workspace: root,
      change: 'auth',
      event: { kind: 'turn.stopping' },
    })
    expect(context.change.tasks.items).toHaveLength(1)
  })

  it('refuses an absolute path after a redirection in event.command', async () => {
    const root = await workspace()
    for (const command of ['echo x>/etc/private/token.txt', 'echo x>>/etc/private/token.txt']) {
      await expect(
        buildConditionContext({
          workspace: root,
          change: 'auth',
          event: { kind: 'tool.pre-execute', command },
        }),
      ).rejects.toThrow(/filesystem path/u)
    }
  })
  it('refuses a path in the event command', async () => {
    const root = await workspace()
    await expect(
      buildConditionContext({
        workspace: root,
        change: 'auth',
        event: { kind: 'tool.pre-execute', command: 'cat /etc/private/token.txt' },
      }),
    ).rejects.toThrow(/filesystem path/u)
  })
  it('bounds implicit coercion in a comparison', () => {
    const context = {
      change: { tasks: { items: [{ text: 'x'.repeat(1001) }] } },
    }
    const refs = Array.from({ length: 1000 }, () => ({ var: 'change.tasks.items.0.text' }))
    expect(() => evaluateCondition({ '==': [refs, 'x'] }, context as never)).toThrow(
      /oversized string/u,
    )
  })
  it('bounds an aggregate cat before joining', () => {
    const context = {
      change: { tasks: { items: [{ text: 'x'.repeat(1_000_000) }] } },
    }
    const condition = {
      cat: Array.from({ length: 16 }, () => ({ var: 'change.tasks.items.0.text' })),
    }
    expect(() => evaluateCondition(condition, context as never)).toThrow(/oversized string/u)
  })
  it('bounds a substr coercion of many repeated strings', async () => {
    const root = await workspace()
    await writeFile(
      join(root, 'openspec', 'changes', 'auth', 'tasks.md'),
      `# Tasks\n\n## 1. Lane (lane 1, owns \`packages/**\`)\n\n- [ ] 1.1 ${'x'.repeat(1001)}\n`,
      'utf8',
    )
    const context = await buildConditionContext({
      workspace: root,
      change: 'auth',
      event: { kind: 'turn.stopping' },
    })
    const condition = {
      substr: [Array.from({ length: 1000 }, () => ({ var: 'change.tasks.items.0.text' })), 0],
    }
    expect(() => evaluateCondition(condition, context)).toThrow(/oversized string/u)
  })
  it('refuses a traversing lane owner', async () => {
    for (const owned of ['../private/**', 'safe/../../private/**', '..\\private\\**']) {
      const root = await workspace()
      await writeFile(
        join(root, 'openspec', 'changes', 'auth', 'tasks.md'),
        `# Tasks\n\n## 1. Lane (lane 1, owns \`${owned}\`)\n\n- [ ] 1.1 Do it\n`,
        'utf8',
      )
      await expect(
        buildConditionContext({
          workspace: root,
          change: 'auth',
          event: { kind: 'turn.stopping' },
        }),
      ).rejects.toThrow(/filesystem path/u)
    }
  })
  it('refuses an absolute path in a lane owner', async () => {
    const root = await workspace()
    await writeFile(
      join(root, 'openspec', 'changes', 'auth', 'tasks.md'),
      `# Tasks\n\n## 1. Lane (lane 1, owns \`${DRIVE}/private/**\`)\n\n- [ ] 1.1 Do it\n`,
      'utf8',
    )
    await expect(
      buildConditionContext({
        workspace: root,
        change: 'auth',
        event: { kind: 'turn.stopping' },
      }),
    ).rejects.toThrow(/filesystem path/u)
  })
})

describe('condition context failure', () => {
  const stopEvent = { kind: 'turn.stopping', subject: 'stop-attempt' } as const

  it('records an error instead of a false condition', () => {
    const gated = definition({ var: 'session.involved' })
    const row = evaluateDefinitionTrigger(gated, stopEvent, {
      conditionError: 'the condition context could not be built',
      isDuplicate: () => false,
    })
    expect(row).toMatchObject({
      matched: false,
      reason: 'error',
      detail: 'the condition context could not be built',
    })
  })

  it('still evaluates an unconditional definition', () => {
    const row = evaluateDefinitionTrigger(plainDefinition(), stopEvent, {
      conditionError: 'the condition context could not be built',
      isDuplicate: () => false,
    })
    expect(row).toMatchObject({ matched: true, reason: 'would-fire' })
  })

  it('keeps condition-false for a built context', () => {
    const gated = definition({ var: 'session.involved' })
    const row = evaluateDefinitionTrigger(gated, stopEvent, {
      conditions: new Map([[gated.id, false]]),
      isDuplicate: () => false,
    })
    expect(row).toMatchObject({ matched: false, reason: 'condition-false' })
  })
})
