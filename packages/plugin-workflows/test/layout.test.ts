import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { editorLayoutUrl } from '../src/client/editor-client.ts'
import { definitionToGraph, type GraphDefinition } from '../src/client/graph.ts'
import { layoutOf, moveNode, parseLayout, withLayout } from '../src/client/layout.ts'
import { installDefinition, loadApprovedDefinitions } from '../src/host/approval-store.ts'
import { validateDefinition } from '../src/host/definitions.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { createRun } from '../src/host/runs.ts'

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-layout-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    }),
  )
})

const DEFINITION = {
  v: 1,
  id: 'layout-demo',
  name: 'Layout demo',
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
      id: 'one',
      title: 'One',
      executor: 'main',
      prompt: 'One.',
      evidence: { kind: 'declaration' },
      nonCritical: true,
      next: 'two',
    },
    {
      id: 'two',
      title: 'Two',
      executor: 'main',
      prompt: 'Two.',
      evidence: { kind: 'declaration' },
      nonCritical: true,
      next: 'end',
    },
  ],
} as unknown as GraphDefinition

describe('layout sidecar', () => {
  it('keeps saved positions across a reload and drops unknown steps', () => {
    const graph = definitionToGraph(DEFINITION)
    const moved = moveNode(graph, 'one', { x: 40, y: 80 })
    const saved = layoutOf(moved)
    expect(saved).toMatchObject({ v: 1, id: 'layout-demo', positions: { one: { x: 40, y: 80 } } })
    const reopened = withLayout(definitionToGraph(DEFINITION), parseLayout(saved, 'layout-demo'))
    expect(reopened.nodes.find((node) => node.id === 'one')?.position).toEqual({ x: 40, y: 80 })
    expect(reopened.nodes.find((node) => node.id === 'two')?.position).not.toEqual({ x: 40, y: 80 })
  })

  it('is stable across two renders when no layout exists', () => {
    const first = withLayout(definitionToGraph(DEFINITION))
    const second = withLayout(definitionToGraph(DEFINITION))
    expect(first.nodes.map((node) => node.position)).toEqual(
      second.nodes.map((node) => node.position),
    )
    for (const node of first.nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true)
      expect(Number.isFinite(node.position.y)).toBe(true)
    }
  })

  it('ignores an unusable sidecar and the synthetic trigger position', () => {
    expect(parseLayout({ v: 2, id: 'layout-demo', positions: {} }, 'layout-demo')).toBeUndefined()
    expect(parseLayout({ v: 1, id: 'other', positions: {} }, 'layout-demo')).toBeUndefined()
    const raw = {
      v: 1,
      id: 'layout-demo',
      positions: {
        one: { x: 1, y: 2 },
        __trigger: { x: 9, y: 9 },
        broken: { x: 'nope', y: 2 },
      },
    }
    const parsed = parseLayout(raw, 'layout-demo')
    expect(parsed?.positions).toEqual({ one: { x: 1, y: 2 } })
    const layoutUrl = editorLayoutUrl('session-1', 'layout-demo')
    expect(layoutUrl).toContain('session=session-1')
  })

  it('does not change the definition the engine loads or the run it starts', async () => {
    const workspace = await tempWorkspace()
    const auth = HostAuth.fromKey('layout-host-key-0123456789')
    const source = join(workspace, 'draft-definition.json')
    await writeFile(source, `${JSON.stringify(DEFINITION, null, 2)}\n`, 'utf8')
    await installDefinition(workspace, source, auth)
    const before = await loadApprovedDefinitions(workspace, { auth })
    const original = await readFile(
      join(workspace, '.dsh', 'workflows', 'definitions', 'layout-demo.json'),
      'utf8',
    )
    await mkdir(join(workspace, '.dsh', 'workflows', 'layout'), { recursive: true })
    await writeFile(
      join(workspace, '.dsh', 'workflows', 'layout', 'layout-demo.json'),
      `${JSON.stringify(layoutOf(definitionToGraph(DEFINITION)), null, 2)}\n`,
      'utf8',
    )
    const after = await loadApprovedDefinitions(workspace, { auth })
    expect(after.definitions).toEqual(before.definitions)
    const runBefore = createRun({
      definition: 'layout-demo',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: before.definitions[0]?.steps.map((step) => step.id) ?? [],
      now: 1,
    })
    const runAfter = createRun({
      definition: 'layout-demo',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: after.definitions[0]?.steps.map((step) => step.id) ?? [],
      now: 1,
      id: runBefore.id,
    })
    expect(JSON.stringify(runAfter)).toBe(JSON.stringify(runBefore))
    // The layout write never touched the definition file the engine reads.
    expect(
      await readFile(
        join(workspace, '.dsh', 'workflows', 'definitions', 'layout-demo.json'),
        'utf8',
      ),
    ).toBe(original)
    expect(validateDefinition(JSON.parse(original)).id).toBe('layout-demo')
  })
})
