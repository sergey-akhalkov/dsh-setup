import { readdirSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { definitionToGraph, type GraphDefinition, graphToDefinition } from '../src/client/graph.ts'
import { loadApprovedDefinitions } from '../src/host/approval-store.ts'
import {
  createEditorRoutes,
  EDITOR_DEFINITION_ROUTE,
  EDITOR_DEFINITIONS_ROUTE,
  type EditorApiServices,
} from '../src/host/editor-api.ts'
import { HostAuth } from '../src/host/host-auth.ts'

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-editor-security-'))
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

const AUTH = HostAuth.fromKey('security-host-key-0123456789')

const DEFINITION = {
  v: 1,
  id: 'safe-demo',
  name: 'Safe demo',
  version: 1,
  trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
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
      next: 'end',
    },
  ],
}

function services(sessions: Record<string, string>): EditorApiServices {
  return {
    agents: { get: (id) => (id in sessions ? { session: { id } } : undefined) },
    workingDirectory: {
      get: (session) => {
        const id = (session as { id: string }).id
        const workspace = sessions[id]
        if (workspace === undefined) throw new Error('unknown session')
        return workspace
      },
    },
    auth: async () => AUTH,
  }
}

async function call(
  routes: ReturnType<typeof createEditorRoutes>,
  path: string,
  options: { session: string; method?: string; body?: unknown; query?: Record<string, string> },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const query = new URLSearchParams({ session: options.session, ...options.query })
  const request = new Request(`http://localhost${path}?${query.toString()}`, {
    method: options.method ?? 'GET',
    ...(options.body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.body) }),
  })
  const route = routes.find((entry) => entry.path === path)
  if (route === undefined) throw new Error(`no route ${path}`)
  const response = await route.fetch(request)
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe('editor trust boundary', () => {
  it('refuses a path escape and leaves no file outside the workspace', async () => {
    const workspace = await tempWorkspace()
    const routes = createEditorRoutes(services({ s1: workspace }))
    const driveEscape = ['C', ':', '/escape'].join('')
    const escapes = ['../escape', '..\\escape', 'a/b', 'a\\b', driveEscape, 'Upper']
    for (const id of escapes) {
      const refused = await call(routes, EDITOR_DEFINITION_ROUTE, {
        session: 's1',
        method: 'PUT',
        body: { id, definition: { ...DEFINITION, id }, expectedRevision: null },
      })
      expect(refused.status).toBe(400)
    }
    const parent = await readdirSync(join(workspace, '..'))
    expect(parent).not.toContain('escape.json')
    const definitions = await readFile(
      join(workspace, '.dsh', 'workflows', 'definitions', 'safe-demo.json'),
      'utf8',
    ).catch(() => undefined)
    expect(definitions).toBeUndefined()
  })

  it('refuses to delete through a linked definitions directory', async () => {
    const workspace = await tempWorkspace()
    const external = await tempWorkspace()
    const externalDirectory = join(external, 'definitions')
    await mkdir(externalDirectory, { recursive: true })
    const externalFile = join(externalDirectory, 'linked-demo.json')
    await writeFile(
      externalFile,
      `${JSON.stringify({ ...DEFINITION, id: 'linked-demo' }, null, 2)}\n`,
      'utf8',
    )
    const definitions = join(workspace, '.dsh', 'workflows', 'definitions')
    await mkdir(join(workspace, '.dsh', 'workflows'), { recursive: true })
    try {
      await symlink(externalDirectory, definitions, 'junction')
    } catch (error) {
      // A locked-down Windows account cannot create junctions; the containment
      // check is still exercised by the realpath branch on hosts that can.
      if (['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return
      }
      throw error
    }
    const routes = createEditorRoutes(services({ s1: workspace }))
    const deleted = await call(routes, EDITOR_DEFINITION_ROUTE, {
      session: 's1',
      method: 'DELETE',
      body: { id: 'linked-demo', expectedRevision: 'a'.repeat(64) },
    })
    expect(deleted.status).not.toBe(200)
    expect(await readFile(externalFile, 'utf8')).toContain('linked-demo')
  })

  it('writes only the workspace owned by the requesting session', async () => {
    const first = await tempWorkspace()
    const second = await tempWorkspace()
    const routes = createEditorRoutes(services({ one: first, two: second }))
    const created = await call(routes, EDITOR_DEFINITION_ROUTE, {
      session: 'one',
      method: 'PUT',
      body: { id: 'safe-demo', definition: DEFINITION, expectedRevision: null },
    })
    expect(created.status).toBe(200)
    expect(
      await readFile(join(first, '.dsh', 'workflows', 'definitions', 'safe-demo.json'), 'utf8'),
    ).toContain('safe-demo')
    expect(
      await readFile(
        join(second, '.dsh', 'workflows', 'definitions', 'safe-demo.json'),
        'utf8',
      ).catch(() => undefined),
    ).toBeUndefined()
    const foreignRead = await call(routes, EDITOR_DEFINITION_ROUTE, {
      session: 'two',
      query: { id: 'safe-demo' },
    })
    expect(foreignRead.status).toBe(404)
    const foreignList = await call(routes, EDITOR_DEFINITIONS_ROUTE, { session: 'two' })
    expect(
      (foreignList.body.definitions as { id: string }[]).some((entry) => entry.id === 'safe-demo'),
    ).toBe(false)
  })

  it('refuses a credential-shaped definition and writes nothing', async () => {
    const workspace = await tempWorkspace()
    const routes = createEditorRoutes(services({ s1: workspace }))
    const credential = {
      ...DEFINITION,
      steps: [
        {
          ...DEFINITION.steps[0],
          prompt: 'Use api_key=sk-1234567890abcdef1234567890abcdef to call the service.',
        },
      ],
    }
    const refused = await call(routes, EDITOR_DEFINITION_ROUTE, {
      session: 's1',
      method: 'PUT',
      body: { id: 'safe-demo', definition: credential, expectedRevision: null },
    })
    expect(refused.status).toBe(400)
    expect(JSON.stringify(refused.body.errors)).toContain('credential')
    expect(
      await readFile(
        join(workspace, '.dsh', 'workflows', 'definitions', 'safe-demo.json'),
        'utf8',
      ).catch(() => undefined),
    ).toBeUndefined()
  })

  it('never activates a model draft without the user save', async () => {
    const workspace = await tempWorkspace()
    const directory = join(workspace, '.dsh', 'workflows', 'drafts', 'model-draft')
    await mkdir(directory, { recursive: true })
    const draft = { ...DEFINITION, id: 'model-draft', name: 'Model draft' }
    await writeFile(join(directory, 'definition.json'), `${JSON.stringify(draft, null, 2)}\n`)
    const loaded = await loadApprovedDefinitions(workspace, { auth: AUTH })
    expect(loaded.definitions.some((entry) => entry.id === 'model-draft')).toBe(false)
    const routes = createEditorRoutes(services({ s1: workspace }))
    const list = await call(routes, EDITOR_DEFINITIONS_ROUTE, { session: 's1' })
    expect(
      (list.body.definitions as { id: string }[]).some((entry) => entry.id === 'model-draft'),
    ).toBe(false)
    // A user save is still create-only and approved; the draft path never
    // writes the definitions directory itself.
    const installed = await call(routes, EDITOR_DEFINITION_ROUTE, {
      session: 's1',
      method: 'PUT',
      body: { id: 'model-draft', definition: draft, expectedRevision: null },
    })
    expect(installed.status).toBe(200)
    const after = await loadApprovedDefinitions(workspace, { auth: AUTH })
    expect(after.definitions.find((entry) => entry.id === 'model-draft')?.version).toBe(1)
  })

  it('keeps JSONLogic conditions as data and never evaluates them in the client', () => {
    const predicate = { and: [{ '==': [{ var: 'x' }, 1] }, { '!': [{ var: 'y' }] }] }
    const definition = {
      ...DEFINITION,
      steps: [
        {
          ...DEFINITION.steps[0],
          executor: 'branch',
          // biome-ignore lint/suspicious/noThenProperty: a branch target, not a thenable
          branch: { predicate, then: 'end', else: 'end' },
        },
      ],
    } as unknown as GraphDefinition
    const graph = definitionToGraph(definition)
    const converted = graphToDefinition(definition, graph.nodes, graph.edges)
    expect((converted.steps[0]?.branch as { predicate?: unknown } | undefined)?.predicate).toEqual(
      predicate,
    )
    const clientDir = fileURLToPath(new URL('../src/client', import.meta.url))
    const files = readdirSync(clientDir)
    for (const file of files) {
      const body = readFileSync(join(clientDir, file), 'utf8')
      expect(body).not.toMatch(/\beval\s*\(/u)
      expect(body).not.toMatch(/new\s+Function\s*\(/u)
      expect(body).not.toMatch(/\bFunction\s*\(/u)
    }
  })
})
