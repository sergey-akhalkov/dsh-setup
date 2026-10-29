import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { zipSync } from 'fflate'

/** One request the fake server answered; tests assert on the shape. */
export interface FakeRequest {
  method: string
  path: string
  query: URLSearchParams
}

/** A bank archive a fake server hands out; the test owns its content. */
export interface FakeBank {
  archive: Uint8Array
}

export interface FakeHindsightOptions {
  /** Bank ids the server lists and exports. */
  banks?: string[]
  /** Page size the list endpoint returns; smaller than 100 exercises pagination. */
  pageSize?: number
  /** Terminal status for one submitted export operation. */
  operationStatus?: 'completed' | 'failed' | 'cancelled'
  /** Answer this many polls with `pending` before the terminal status. */
  pendingPolls?: number
  /** Answer download_url as a path under the API origin instead of an absolute URL. */
  relativeDownloadUrl?: boolean
  /** Extra JSON body keys merged into a completed operation's result_metadata. */
  metadata?: Record<string, unknown>
}

export interface FakeHindsight {
  url: string
  requests: FakeRequest[]
  banks: Map<string, FakeBank>
  /** Replace a bank's archive between cycles. */
  setArchive(bankId: string, archive: Uint8Array): void
  close(): Promise<void>
}

const encoder = new TextEncoder()

/** A whole-bank transfer archive with one document, as Hindsight would produce it. */
export function fakeArchive(bankId: string, content: string): Uint8Array {
  return zipSync({
    'manifest.json': encoder.encode(
      JSON.stringify({
        schema_version: 1,
        source_bank_id: bankId,
        exported_at: '2026-10-29T12:00:00Z',
        archive_type: 'bank',
        document_count: 1,
        fact_count: 1,
        observation_count: 0,
        mental_model_count: 0,
        knowledge_page_count: 0,
        directive_count: 0,
        webhook_count: 0,
        attachment_count: 0,
        includes_history: false,
        scope: { data: true, bank_config: true, history: false },
      }),
    ),
    'documents/000000.json': encoder.encode(
      JSON.stringify({ id: 'doc-1', chunks: [{ chunk_index: 0, chunk_text: content }], facts: [] }),
    ),
    'observations.json': encoder.encode('[]'),
    'mental_models.json': encoder.encode('[]'),
    'knowledge_pages.json': encoder.encode('[]'),
  })
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

/**
 * A minimal stand-in for the Hindsight bank-transfer REST API. It serves the
 * documented endpoints only, so a test client can fail the way the real one
 * would and the archive bytes stay under test control.
 */
export async function startFakeHindsight(
  options: FakeHindsightOptions = {},
): Promise<FakeHindsight> {
  const operations = new Map<
    string,
    { status: string; result: Record<string, unknown>; error?: string; polls: number }
  >()
  const banks = new Map<string, FakeBank>()
  for (const bankId of options.banks ?? [])
    banks.set(bankId, { archive: fakeArchive(bankId, 'first') })
  const requests: FakeRequest[] = []
  const pageSize = options.pageSize ?? 100
  let baseUrl = ''
  let operationSeq = 0

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const method = request.method ?? 'GET'
      requests.push({ method, path: url.pathname, query: url.searchParams })
      const segments = url.pathname.split('/').filter((segment) => segment !== '')

      // GET /v1/default/banks?limit=&offset=
      if (method === 'GET' && segments.length === 3 && segments[2] === 'banks') {
        const offset = Number(url.searchParams.get('offset') ?? '0')
        const ids = [...banks.keys()].sort()
        sendJson(response, 200, {
          banks: ids.slice(offset, offset + pageSize).map((bank_id) => ({ bank_id })),
          total: ids.length,
          limit: pageSize,
          offset,
        })
        return
      }

      if (
        segments[0] === 'v1' &&
        segments[1] === 'default' &&
        segments[2] === 'banks' &&
        segments[3] !== undefined
      ) {
        const bankId = decodeURIComponent(segments[3] ?? '')
        // POST /v1/default/banks/{bank}/transfer/export
        if (method === 'POST' && segments[4] === 'transfer' && segments[5] === 'export') {
          if (!banks.has(bankId)) {
            sendJson(response, 404, { detail: `Bank '${bankId}' not found` })
            return
          }
          operationSeq += 1
          const operationId = `op-${operationSeq}`
          const status = options.operationStatus ?? 'completed'
          const key = `banks/${bankId}/exports/${operationId}/transfer.zip`
          const download =
            options.relativeDownloadUrl === true
              ? `/v1/default/files/download/${key}`
              : `${baseUrl}/v1/default/files/download/${key}`
          operations.set(operationId, {
            status,
            result:
              status === 'completed'
                ? {
                    download_url: download,
                    storage_key: key,
                    byte_size: 1,
                    filename: 'bank.zip',
                    ...options.metadata,
                  }
                : {},
            error:
              status === 'completed' ? undefined : `export of ${bankId} failed in the fake server`,
            polls: 0,
          })
          sendJson(response, 202, { operation_id: operationId, status: 'pending' })
          return
        }
        // GET /v1/default/banks/{bank}/operations/{id}
        if (method === 'GET' && segments[4] === 'operations' && segments[5] !== undefined) {
          const operation = operations.get(decodeURIComponent(segments[5] ?? ''))
          if (operation === undefined) {
            sendJson(response, 404, { detail: 'operation not found' })
            return
          }
          // Stay pending for a while so the client's polling loop is exercised.
          const pending = operation.polls < (options.pendingPolls ?? 0)
          operation.polls += 1
          const status = pending ? 'pending' : operation.status
          sendJson(response, 200, {
            operation_id: segments[5],
            status,
            result_metadata: status === 'completed' ? operation.result : null,
            error_message: operation.error ?? null,
          })
          return
        }
      }

      // GET /v1/default/files/download/{key...}
      if (method === 'GET' && url.pathname.startsWith('/v1/default/files/download/')) {
        const key = decodeURIComponent(url.pathname.slice('/v1/default/files/download/'.length))
        const match = /^banks\/([^/]+)\/exports\//u.exec(key)
        const bank = match?.[1] === undefined ? undefined : banks.get(match[1])
        if (bank === undefined) {
          sendJson(response, 404, { detail: 'file not found' })
          return
        }
        response.writeHead(200, {
          'content-type': 'application/zip',
          'content-length': bank.archive.byteLength,
        })
        response.end(Buffer.from(bank.archive))
        return
      }

      if (method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { status: 'healthy', database: 'connected' })
        return
      }

      await readBody(request)
      sendJson(response, 404, { detail: `no route for ${method} ${url.pathname}` })
    })()
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`

  return {
    url: baseUrl,
    requests,
    banks,
    setArchive: (bankId, archive) => {
      banks.set(bankId, { archive })
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      })
    },
  }
}
