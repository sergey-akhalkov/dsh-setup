import type {
  DefinitionDocument,
  DraftEntry,
  EditorApi,
  EditorListEntry,
  SaveResult,
  TemplateEntry,
} from './editor.ts'
import type { GraphDefinition } from './graph.ts'
import type { Layout } from './layout.ts'
import type { RunView } from './panel.tsx'

/**
 * The Design mode's fetch client. Every request carries the live session id;
 * the host resolves the workspace from it, and revisions are opaque hashes the
 * editor sends back unchanged.
 */

export const EDITOR_BASE = '/api/workflows/editor'

export function editorDefinitionsUrl(session: string): string {
  return `${EDITOR_BASE}/definitions?${new URLSearchParams({ session }).toString()}`
}

export function editorDefinitionUrl(session: string, id?: string): string {
  const query = new URLSearchParams({ session })
  if (id !== undefined) query.set('id', id)
  return `${EDITOR_BASE}/definition?${query.toString()}`
}

export function editorTemplatesUrl(session: string): string {
  return `${EDITOR_BASE}/templates?${new URLSearchParams({ session }).toString()}`
}

export function editorDraftsUrl(session: string): string {
  return `${EDITOR_BASE}/drafts?${new URLSearchParams({ session }).toString()}`
}

export function editorDraftUrl(session: string, name: string): string {
  return `${EDITOR_BASE}/draft?${new URLSearchParams({ session, name }).toString()}`
}

export function editorLayoutUrl(session: string, id?: string): string {
  const query = new URLSearchParams({ session })
  if (id !== undefined) query.set('id', id)
  return `${EDITOR_BASE}/layout?${query.toString()}`
}

interface CallResult {
  readonly status: number
  readonly body: Record<string, unknown>
}

async function call(url: string, init?: RequestInit): Promise<CallResult> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...init,
  })
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = { error: `the request failed (${String(response.status)})` }
  }
  return {
    status: response.status,
    body: typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {},
  }
}

function text(body: Record<string, unknown>, key: string, fallback: string): string {
  const value = body[key]
  return typeof value === 'string' && value !== '' ? value : fallback
}

function saveResult(result: CallResult): SaveResult {
  if (result.status === 200) {
    return { ok: true, revision: text(result.body, 'revision', '') }
  }
  if (result.status === 409) {
    const revision = result.body.revision
    const runs = Array.isArray(result.body.runs)
      ? result.body.runs.filter((entry): entry is string => typeof entry === 'string')
      : undefined
    return {
      ok: false,
      kind: 'conflict',
      status: result.status,
      revision: typeof revision === 'string' ? revision : null,
      ...(runs === undefined ? {} : { runs }),
    }
  }
  if (result.status === 400) {
    const errors = Array.isArray(result.body.errors)
      ? result.body.errors.filter(
          (entry): entry is { path: string; message: string } =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as Record<string, unknown>).message === 'string',
        )
      : [{ path: '', message: text(result.body, 'error', 'the host refused the write') }]
    return { ok: false, kind: 'invalid', status: result.status, errors }
  }
  return {
    ok: false,
    kind: 'error',
    status: result.status,
    error: text(result.body, 'error', `the request failed (${String(result.status)})`),
  }
}

function failed(result: CallResult): Error {
  return new Error(text(result.body, 'error', `the request failed (${String(result.status)})`))
}

/** The fetch-backed API the Design mode uses. */
export function fetchEditorApi(session: string): EditorApi {
  return {
    async list() {
      const result = await call(editorDefinitionsUrl(session))
      if (result.status !== 200) throw failed(result)
      const definitions = Array.isArray(result.body.definitions)
        ? (result.body.definitions as EditorListEntry[])
        : []
      const errors = Array.isArray(result.body.errors)
        ? result.body.errors.filter((entry): entry is string => typeof entry === 'string')
        : undefined
      return { definitions, ...(errors === undefined ? {} : { errors }) }
    },
    async templates() {
      const result = await call(editorTemplatesUrl(session))
      if (result.status !== 200) throw failed(result)
      return Array.isArray(result.body.templates) ? (result.body.templates as TemplateEntry[]) : []
    },
    async drafts() {
      const result = await call(editorDraftsUrl(session))
      if (result.status !== 200) throw failed(result)
      return Array.isArray(result.body.drafts) ? (result.body.drafts as DraftEntry[]) : []
    },
    async read(id) {
      const result = await call(editorDefinitionUrl(session, id))
      if (result.status !== 200) throw failed(result)
      return result.body as unknown as DefinitionDocument
    },
    async readDraft(name) {
      const result = await call(editorDraftUrl(session, name))
      if (result.status !== 200) throw failed(result)
      return result.body.definition as GraphDefinition
    },
    async readLayout(id) {
      const result = await call(editorLayoutUrl(session, id))
      if (result.status !== 200) throw failed(result)
      const layout = result.body.layout
      return {
        layout: typeof layout === 'object' && layout !== null ? (layout as Layout) : null,
        revision: typeof result.body.revision === 'string' ? result.body.revision : null,
      }
    },
    async saveDefinition(id, definition, expectedRevision) {
      const result = await call(editorDefinitionUrl(session), {
        method: 'PUT',
        body: JSON.stringify({ id, definition, expectedRevision }),
      })
      return saveResult(result)
    },
    async deleteDefinition(id, expectedRevision) {
      const result = await call(editorDefinitionUrl(session), {
        method: 'DELETE',
        body: JSON.stringify({ id, expectedRevision }),
      })
      return saveResult(result)
    },
    async saveLayout(layout, expectedRevision) {
      const result = await call(editorLayoutUrl(session), {
        method: 'PUT',
        body: JSON.stringify({ id: layout.id, layout, expectedRevision }),
      })
      return saveResult(result)
    },
    async runs(definitionId) {
      const query = new URLSearchParams({
        session,
        source: 'workflow',
        definition: definitionId,
        limit: '5',
      })
      const result = await call(`/api/workflows/runs?${query.toString()}`)
      if (result.status !== 200) throw failed(result)
      return Array.isArray(result.body.runs) ? (result.body.runs as RunView[]) : []
    },
  }
}
