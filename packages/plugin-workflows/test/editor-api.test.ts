import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installDefinition, loadApprovedDefinitions } from '../src/host/approval-store.ts'
import { loadShippedDefinitions, validateDefinition } from '../src/host/definitions.ts'
import {
  createEditorRoutes,
  EDITOR_DEFINITION_ROUTE,
  EDITOR_DEFINITIONS_ROUTE,
  EDITOR_DRAFT_ROUTE,
  EDITOR_DRAFTS_ROUTE,
  EDITOR_LAYOUT_ROUTE,
  EDITOR_TEMPLATES_ROUTE,
  type EditorApiServices,
  layoutPath,
  validateLayout,
} from '../src/host/editor-api.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { createRun, setRunStatus, writeRun } from '../src/host/runs.ts'

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-editor-'))
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

const AUTH = HostAuth.fromKey('editor-host-key-0123456789')

const DEFINITION = {
  v: 1,
  id: 'editor-demo',
  name: 'Editor demo',
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

function services(
  workspace: string,
  overrides: Partial<EditorApiServices> = {},
): EditorApiServices {
  return {
    agents: { get: (id) => (id === 'session-1' ? { session: { id } } : undefined) },
    workingDirectory: { get: () => workspace },
    auth: async () => AUTH,
    ...overrides,
  }
}

type Routes = ReturnType<typeof createEditorRoutes>

function routeOf(routes: Routes, path: string) {
  const route = routes.find((entry) => entry.path === path)
  if (route === undefined) throw new Error(`no route ${path}`)
  return route
}

async function call(
  routes: Routes,
  path: string,
  options: {
    session?: string
    method?: string
    body?: unknown
    query?: Record<string, string>
  } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const query = new URLSearchParams({ session: options.session ?? 'session-1', ...options.query })
  const request = new Request(`http://localhost${path}?${query.toString()}`, {
    method: options.method ?? 'GET',
    ...(options.body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(options.body),
        }),
  })
  const response = await routeOf(routes, path).fetch(request)
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

async function install(routes: Routes, definition: unknown = DEFINITION): Promise<string> {
  const created = await call(routes, EDITOR_DEFINITION_ROUTE, {
    method: 'PUT',
    body: { id: (definition as { id: string }).id, definition, expectedRevision: null },
  })
  if (created.status !== 200) throw new Error(`install failed: ${JSON.stringify(created.body)}`)
  return String(created.body.revision)
}

function writtenBytes(definition: unknown): string {
  // The host writes the validator's normalized definition, not the raw request.
  return `${JSON.stringify(validateDefinition(definition), null, 2)}\n`
}

function revision(definition: unknown): string {
  return createHash('sha256').update(writtenBytes(definition)).digest('hex')
}

describe('editor read API', () => {
  it('lists shipped and local definitions, templates, one document, and layouts', async () => {
    const workspace = await tempWorkspace()
    const routes = createEditorRoutes(services(workspace))
    const listed = await call(routes, EDITOR_DEFINITIONS_ROUTE)
    expect(listed.status).toBe(200)
    const shipped = (listed.body.definitions as { source: string }[]).filter(
      (entry) => entry.source === 'shipped',
    )
    expect(shipped.length).toBeGreaterThanOrEqual(3)

    const installedRevision = await install(routes)
    const after = await call(routes, EDITOR_DEFINITIONS_ROUTE)
    const local = (
      after.body.definitions as { id: string; revision: string; source: string }[]
    ).find((entry) => entry.id === 'editor-demo')
    expect(local).toMatchObject({ source: 'local', revision: installedRevision })

    const templates = await call(routes, EDITOR_TEMPLATES_ROUTE)
    expect(templates.status).toBe(200)
    const templateIds = (templates.body.templates as { id: string; stepCount: number }[]).map(
      (entry) => entry.id,
    )
    expect(templateIds).toEqual(expect.arrayContaining(['change-intake', 'task-review', 'retro']))
    expect(templates.body.templates).toEqual(
      expect.arrayContaining([expect.objectContaining({ stepCount: expect.any(Number) })]),
    )

    const one = await call(routes, EDITOR_DEFINITION_ROUTE, { query: { id: 'editor-demo' } })
    expect(one.status).toBe(200)
    expect(one.body).toMatchObject({ revision: installedRevision, source: 'local' })
    expect(one.body.definition).toEqual(validateDefinition(DEFINITION))
    const missing = await call(routes, EDITOR_DEFINITION_ROUTE, { query: { id: 'nope' } })
    expect(missing.status).toBe(404)
    const shippedRead = await call(routes, EDITOR_DEFINITION_ROUTE, {
      query: { id: 'change-intake' },
    })
    expect(shippedRead.body).toMatchObject({ revision: null, source: 'shipped' })
    expect(shippedRead.body.definition).toEqual(
      loadShippedDefinitions().find((entry) => entry.id === 'change-intake'),
    )
    expect(templates.body.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'change-intake',
          definition: expect.objectContaining({ id: 'change-intake', steps: expect.any(Array) }),
        }),
      ]),
    )

    const emptyLayout = await call(routes, EDITOR_LAYOUT_ROUTE, { query: { id: 'editor-demo' } })
    expect(emptyLayout.body).toEqual({ layout: null, revision: null })

    const refused = await call(routes, EDITOR_DEFINITIONS_ROUTE, { session: 'foreign' })
    expect(refused.status).toBe(400)
    expect(refused.body).toMatchObject({ error: expect.stringContaining('not live') })
    const unauthenticated = await call(routes, EDITOR_DEFINITIONS_ROUTE, { session: '' })
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.body).toMatchObject({ error: expect.stringContaining('session id') })
  })
})

describe('editor definition writes', () => {
  it('creates through the shared install/approve path and reloads after a restart', async () => {
    const workspace = await tempWorkspace()
    const routes = createEditorRoutes(services(workspace))
    const createdRevision = await install(routes)
    expect(createdRevision).toBe(revision(DEFINITION))
    // A fresh load (the "restart") sees the approved definition.
    const loaded = await loadApprovedDefinitions(workspace, { auth: AUTH })
    expect(loaded.definitions.some((entry) => entry.id === 'editor-demo')).toBe(true)
    const bytes = await readFile(
      join(workspace, '.dsh', 'workflows', 'definitions', 'editor-demo.json'),
      'utf8',
    )
    expect(bytes).toBe(writtenBytes(DEFINITION))

    const updatedDefinition = { ...DEFINITION, name: 'Editor demo v2', version: 2 }
    const updated = await call(routes, EDITOR_DEFINITION_ROUTE, {
      method: 'PUT',
      body: {
        id: 'editor-demo',
        definition: updatedDefinition,
        expectedRevision: createdRevision,
      },
    })
    expect(updated.status).toBe(200)
    expect(updated.body.revision).toBe(revision(updatedDefinition))
    const reloaded = await loadApprovedDefinitions(workspace, { auth: AUTH })
    expect(reloaded.definitions.find((entry) => entry.id === 'editor-demo')?.name).toBe(
      'Editor demo v2',
    )
  })

  it('refuses an invalid schema and a stale revision, writing nothing', async () => {
    const workspace = await tempWorkspace()
    const routes = createEditorRoutes(services(workspace))
    const before = await readFile(
      join(workspace, '.dsh', 'workflows', 'definitions', 'editor-demo.json'),
      'utf8',
    ).catch(() => undefined)
    const invalid = await call(routes, EDITOR_DEFINITION_ROUTE, {
      method: 'PUT',
      body: {
        id: 'editor-demo',
        definition: { ...DEFINITION, unknownField: true },
        expectedRevision: null,
      },
    })
    expect(invalid.status).toBe(400)
    expect(invalid.body.errors).toEqual([
      expect.objectContaining({
        path: 'unknownField',
        message: expect.stringContaining('known field'),
      }),
    ])

    const createdRevision = await install(routes)
    const conflict = await call(routes, EDITOR_DEFINITION_ROUTE, {
      method: 'PUT',
      body: {
        id: 'editor-demo',
        definition: { ...DEFINITION, name: 'Stale' },
        expectedRevision: 'f'.repeat(64),
      },
    })
    expect(conflict.status).toBe(409)
    expect(conflict.body.revision).toBe(createdRevision)
    const bytes = await readFile(
      join(workspace, '.dsh', 'workflows', 'definitions', 'editor-demo.json'),
      'utf8',
    )
    expect(bytes).toBe(writtenBytes(DEFINITION))
    expect(before).toBeUndefined()
  })

  it('creates atomically: a collision returns 409 and leaves the existing file and approval', async () => {
    const workspace = await tempWorkspace()
    const routes = createEditorRoutes(services(workspace))
    await install(routes)
    const file = join(workspace, '.dsh', 'workflows', 'definitions', 'editor-demo.json')
    const approvals = join(workspace, '.dsh', 'workflows', 'approved.json')
    const beforeFile = await readFile(file, 'utf8')
    const beforeApprovals = await readFile(approvals, 'utf8')
    const collision = await call(routes, EDITOR_DEFINITION_ROUTE, {
      method: 'PUT',
      body: {
        id: 'editor-demo',
        definition: { ...DEFINITION, name: 'Different' },
        expectedRevision: null,
      },
    })
    expect(collision.status).toBe(409)
    expect(collision.body.revision).toBe(revision(DEFINITION))
    expect(await readFile(file, 'utf8')).toBe(beforeFile)
    expect(await readFile(approvals, 'utf8')).toBe(beforeApprovals)
  })

  it('leaves both the definition and the approval unchanged when the approval write fails', async () => {
    const workspace = await tempWorkspace()
    const routes = createEditorRoutes(
      services(workspace, {
        install: (target, source, auth) =>
          installDefinition(target, source, auth, {
            writeApprovals: async () => {
              throw new Error('the approval store could not be written')
            },
          }),
      }),
    )
    const failed = await call(routes, EDITOR_DEFINITION_ROUTE, {
      method: 'PUT',
      body: { id: 'editor-demo', definition: DEFINITION, expectedRevision: null },
    })
    expect(failed.status).toBe(400)
    await expect(
      readFile(join(workspace, '.dsh', 'workflows', 'definitions', 'editor-demo.json')),
    ).rejects.toThrow()
    await expect(readFile(join(workspace, '.dsh', 'workflows', 'approved.json'))).rejects.toThrow()
  })

  it('refuses a path escape and an id mismatch', async () => {
    const workspace = await tempWorkspace()
    const routes = createEditorRoutes(services(workspace))
    for (const id of ['../escape', 'a/b', 'Upper', '']) {
      const refused = await call(routes, EDITOR_DEFINITION_ROUTE, {
        method: 'PUT',
        body: { id, definition: { ...DEFINITION, id }, expectedRevision: null },
      })
      expect(refused.status).toBe(400)
    }
    const mismatch = await call(routes, EDITOR_DEFINITION_ROUTE, {
      method: 'PUT',
      body: {
        id: 'editor-demo',
        definition: { ...DEFINITION, id: 'other' },
        expectedRevision: null,
      },
    })
    expect(mismatch.status).toBe(400)
    expect(mismatch.body.errors).toEqual([
      expect.objectContaining({ path: 'id', message: expect.stringContaining('match') }),
    ])
    expect(
      await readFile(
        join(workspace, '.dsh', 'workflows', 'definitions', 'other.json'),
        'utf8',
      ).catch(() => undefined),
    ).toBeUndefined()
  })

  it('deletes only with the loaded revision and refuses while a run is active', async () => {
    const workspace = await tempWorkspace()
    const routes = createEditorRoutes(services(workspace))
    const createdRevision = await install(routes)
    const run = createRun({
      definition: 'editor-demo',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['one'],
      now: 1,
    })
    await writeRun(workspace, run, AUTH)
    const inUse = await call(routes, EDITOR_DEFINITION_ROUTE, {
      method: 'DELETE',
      body: { id: 'editor-demo', expectedRevision: createdRevision },
    })
    expect(inUse.status).toBe(409)
    expect(inUse.body.runs).toEqual([run.id])
    await writeRun(workspace, setRunStatus(run, 'completed', 2), AUTH)
    const stale = await call(routes, EDITOR_DEFINITION_ROUTE, {
      method: 'DELETE',
      body: { id: 'editor-demo', expectedRevision: 'a'.repeat(64) },
    })
    expect(stale.status).toBe(409)
    const deleted = await call(routes, EDITOR_DEFINITION_ROUTE, {
      method: 'DELETE',
      body: { id: 'editor-demo', expectedRevision: createdRevision },
    })
    expect(deleted.status).toBe(200)
    const loaded = await loadApprovedDefinitions(workspace, { auth: AUTH })
    expect(loaded.definitions.some((entry) => entry.id === 'editor-demo')).toBe(false)
  })
})

describe('editor layout writes', () => {
  it('creates with null, then checks the layout revision independently of the definition', async () => {
    const workspace = await tempWorkspace()
    const routes = createEditorRoutes(services(workspace))
    const definitionRevision = await install(routes)
    const layout = { v: 1, id: 'editor-demo', positions: { one: { x: 10, y: 20 } } }
    const created = await call(routes, EDITOR_LAYOUT_ROUTE, {
      method: 'PUT',
      body: { id: 'editor-demo', layout, expectedRevision: null },
    })
    expect(created.status).toBe(200)
    const layoutRevision = String(created.body.revision)
    expect(layoutRevision).toMatch(/^[a-f0-9]{64}$/u)
    expect(layoutRevision).not.toBe(definitionRevision)

    const read = await call(routes, EDITOR_LAYOUT_ROUTE, { query: { id: 'editor-demo' } })
    expect(read.body).toMatchObject({ revision: layoutRevision })

    const secondCreate = await call(routes, EDITOR_LAYOUT_ROUTE, {
      method: 'PUT',
      body: { id: 'editor-demo', layout, expectedRevision: null },
    })
    expect(secondCreate.status).toBe(409)
    expect(secondCreate.body.revision).toBe(layoutRevision)

    const wrong = await call(routes, EDITOR_LAYOUT_ROUTE, {
      method: 'PUT',
      body: { id: 'editor-demo', layout, expectedRevision: 'b'.repeat(64) },
    })
    expect(wrong.status).toBe(409)
    expect(wrong.body.revision).toBe(layoutRevision)

    const moved = { ...layout, positions: { one: { x: 50, y: 60 } } }
    const updated = await call(routes, EDITOR_LAYOUT_ROUTE, {
      method: 'PUT',
      body: { id: 'editor-demo', layout: moved, expectedRevision: layoutRevision },
    })
    expect(updated.status).toBe(200)
    expect(updated.body.revision).not.toBe(layoutRevision)
    // The definition revision never changed.
    const document = await call(routes, EDITOR_DEFINITION_ROUTE, {
      query: { id: 'editor-demo' },
    })
    expect(document.body.revision).toBe(definitionRevision)
    expect(await readFile(layoutPath(workspace, 'editor-demo'), 'utf8')).toContain('"x": 50')
  })

  it('accepts engine-valid step ids and prototype-named position keys', async () => {
    const workspace = await tempWorkspace()
    const routes = createEditorRoutes(services(workspace))
    const definition = {
      ...DEFINITION,
      id: 'edge-layout',
      steps: [{ ...DEFINITION.steps[0], id: 'step_one' }],
    }
    await install(routes, definition)
    const layout = {
      v: 1,
      id: 'edge-layout',
      positions: {
        step_one: { x: 10, y: 20 },
        ['__proto__']: { x: 30, y: 40 },
      },
    }
    const created = await call(routes, EDITOR_LAYOUT_ROUTE, {
      method: 'PUT',
      body: { id: 'edge-layout', layout, expectedRevision: null },
    })
    expect(created.status).toBe(200)
    const read = await call(routes, EDITOR_LAYOUT_ROUTE, { query: { id: 'edge-layout' } })
    expect(read.status).toBe(200)
    const positions = (read.body.layout as { positions: Record<string, { x: number; y: number }> })
      .positions
    expect(positions.step_one).toEqual({ x: 10, y: 20 })
    expect(Object.hasOwn(positions, '__proto__')).toBe(true)
    expect(positions['__proto__']).toEqual({ x: 30, y: 40 })
  })

  it('never returns a revision for a layout symlink outside the workspace', async () => {
    const workspace = await tempWorkspace()
    const external = await tempWorkspace()
    const externalFile = join(external, 'layout.json')
    await writeFile(
      externalFile,
      `${JSON.stringify({ v: 1, id: 'linked', positions: {} }, null, 2)}\n`,
      'utf8',
    )
    const layoutDirectory = join(workspace, '.dsh', 'workflows', 'layout')
    await mkdir(layoutDirectory, { recursive: true })
    try {
      await symlink(externalFile, join(layoutDirectory, 'linked.json'), 'file')
    } catch (error) {
      // Creating a file symlink needs developer mode on Windows; skip only the
      // host that cannot express the attack.
      if (['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return
      }
      throw error
    }
    const routes = createEditorRoutes(services(workspace))
    const read = await call(routes, EDITOR_LAYOUT_ROUTE, { query: { id: 'linked' } })
    expect(read.status).toBe(200)
    expect(read.body.layout).toBeNull()
    expect(read.body.revision).toBeNull()
    expect(read.body.errors).toEqual([
      expect.objectContaining({ message: expect.stringContaining('link') }),
    ])
  })

  it('refuses a malformed layout', () => {
    expect(() =>
      validateLayout({ v: 1, id: 'a', positions: { one: { x: 1, y: 2 } }, extra: 1 }, 'a'),
    ).toThrow()
    // A position key is only a JSON name, never a filesystem path; it may hold
    // an engine-valid step id such as "step_one" or "../x". Only an empty id is
    // meaningless.
    expect(() =>
      validateLayout({ v: 1, id: 'a', positions: { ' ': { x: 1, y: 2 } } }, 'a'),
    ).toThrow()
    expect(() =>
      validateLayout({ v: 1, id: 'a', positions: { one: { x: 1, y: '2' } } }, 'a'),
    ).toThrow()
  })
})

describe('draft install', () => {
  async function writeDraft(workspace: string, name: string, definition: unknown): Promise<void> {
    const directory = join(workspace, '.dsh', 'workflows', 'drafts', name)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'definition.json'), `${JSON.stringify(definition, null, 2)}\n`)
  }

  it('lists a draft, never loads it as active, and installs it create-only on a save', async () => {
    const workspace = await tempWorkspace()
    const routes = createEditorRoutes(services(workspace))
    const draft = { ...DEFINITION, id: 'draft-demo', name: 'Draft demo' }
    await writeDraft(workspace, 'intake-draft', draft)
    const listed = await call(routes, EDITOR_DRAFTS_ROUTE)
    expect(listed.body.drafts).toEqual([
      { name: 'intake-draft', id: 'draft-demo', title: 'Draft demo', stepCount: 1 },
    ])
    const read = await call(routes, EDITOR_DRAFT_ROUTE, { query: { name: 'intake-draft' } })
    expect(read.status).toBe(200)
    expect((read.body.definition as { id: string }).id).toBe('draft-demo')

    const before = await loadApprovedDefinitions(workspace, { auth: AUTH })
    expect(before.definitions.some((entry) => entry.id === 'draft-demo')).toBe(false)

    const installed = await call(routes, EDITOR_DEFINITION_ROUTE, {
      method: 'PUT',
      body: {
        id: 'draft-demo',
        definition: { ...draft, version: 1 },
        expectedRevision: null,
      },
    })
    expect(installed.status).toBe(200)
    const after = await loadApprovedDefinitions(workspace, { auth: AUTH })
    expect(after.definitions.find((entry) => entry.id === 'draft-demo')?.version).toBe(1)
    const approvals = await readFile(join(workspace, '.dsh', 'workflows', 'approved.json'), 'utf8')
    expect(approvals).toContain('draft-demo')

    const collision = await call(routes, EDITOR_DEFINITION_ROUTE, {
      method: 'PUT',
      body: {
        id: 'draft-demo',
        definition: { ...draft, name: 'Other draft' },
        expectedRevision: null,
      },
    })
    expect(collision.status).toBe(409)
    expect(collision.body.revision).toBe(revision({ ...draft, version: 1 }))
    const unchanged = await readFile(join(workspace, '.dsh', 'workflows', 'approved.json'), 'utf8')
    expect(unchanged).toBe(approvals)

    const next = await call(routes, EDITOR_DEFINITION_ROUTE, {
      method: 'PUT',
      body: {
        id: 'draft-demo',
        definition: { ...draft, version: 2 },
        expectedRevision: installed.body.revision,
      },
    })
    expect(next.status).toBe(200)
  })

  it('refuses an unsafe draft name', async () => {
    const workspace = await tempWorkspace()
    const routes = createEditorRoutes(services(workspace))
    const refused = await call(routes, EDITOR_DRAFT_ROUTE, { query: { name: '../x' } })
    expect(refused.status).toBe(400)
  })
})
