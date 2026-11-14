import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildConditionContext,
  evaluateCondition,
  evaluateConditions,
} from '../src/host/condition.ts'
import { validateCondition } from '../src/host/condition-schema.ts'
import { type Definition, validateDefinition } from '../src/host/definitions.ts'
import { currentSpecDigest } from '../src/host/evidence.ts'
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
    await writeFile(join(specDir, 'spec.json'), JSON.stringify({ verdict: 'PASS', digest }), 'utf8')
    const taskDir = join(root, '.dsh', 'workflows', 'records', 'task-review', 'auth', 'tasks')
    await mkdir(taskDir, { recursive: true })
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const taskId = taskIdOf('Add the engine')
    await writeFile(
      join(taskDir, `${taskId}.json`),
      JSON.stringify({ verdict: 'PASS', digest: 'b'.repeat(64) }),
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
      JSON.stringify({ verdict: 'PASS', digest }),
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
