import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { ExportError, TransferClient, unpackArchive } from '../lib/index.js'
import { type FakeHindsight, fakeArchive, startFakeHindsight } from './fake-hindsight.js'

const servers: FakeHindsight[] = []

async function fake(
  options: Parameters<typeof startFakeHindsight>[0] = {},
): Promise<FakeHindsight> {
  const server = await startFakeHindsight(options)
  servers.push(server)
  return server
}

function client(url: string): TransferClient {
  return new TransferClient({
    apiUrl: url,
    pollIntervalMs: 5,
    requestTimeoutMs: 2_000,
    operationTimeoutMs: 5_000,
  })
}

/** A port nothing listens on: bind, read, and close immediately. */
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

describe('Hindsight transfer client', () => {
  it('lists every bank across pages', async () => {
    const server = await fake({ banks: ['a', 'b', 'c'], pageSize: 2 })
    expect(await client(server.url).listBanks()).toEqual(['a', 'b', 'c'])
    const lists = server.requests.filter((request) => request.path === '/v1/default/banks')
    expect(lists.map((request) => request.query.get('offset'))).toEqual(['0', '2'])
  })

  it('exports a bank, polls the operation, and downloads the archive', async () => {
    const server = await fake({ banks: ['coding-agent::repo'] })
    server.setArchive('coding-agent::repo', fakeArchive('coding-agent::repo', 'hello'))
    const result = await client(server.url).exportBank('coding-agent::repo', {
      includeHistory: true,
    })
    expect(result.operationId).toBe('op-1')
    expect(result.metadata.download_url).toContain('/v1/default/files/download/')
    const entries = unpackArchive(result.zip)
    expect(
      new TextDecoder()
        .decode(entries.get('manifest.json'))
        .includes('"source_bank_id":"coding-agent::repo"'),
    ).toBe(true)
    const submit = server.requests.find((request) => request.path.endsWith('/transfer/export'))
    expect(submit?.method).toBe('POST')
    expect(submit?.query.get('include_data')).toBe('true')
    expect(submit?.query.get('include_bank_config')).toBe('true')
    expect(submit?.query.get('include_history')).toBe('true')
  })

  it('keeps polling a pending operation until it completes', async () => {
    const server = await fake({ banks: ['b'], pendingPolls: 2 })
    const result = await client(server.url).exportBank('b', { includeHistory: false })
    expect(unpackArchive(result.zip).has('manifest.json')).toBe(true)
    const polls = server.requests.filter((request) => request.path.includes('/operations/'))
    expect(polls).toHaveLength(3)
  })

  it('follows a relative download path under the API origin', async () => {
    const server = await fake({ banks: ['b'], relativeDownloadUrl: true })
    const result = await client(server.url).exportBank('b', { includeHistory: false })
    expect(unpackArchive(result.zip).has('manifest.json')).toBe(true)
  })

  it('reports a missing bank as a typed bank-not-found error', async () => {
    const server = await fake({ banks: ['present'] })
    await expect(
      client(server.url).exportBank('gone', { includeHistory: false }),
    ).rejects.toMatchObject({
      name: 'ExportError',
      code: 'bank-not-found',
    })
  })

  it('surfaces the operation error when an export fails', async () => {
    const server = await fake({ banks: ['b'], operationStatus: 'failed' })
    let error: unknown
    try {
      await client(server.url).exportBank('b', { includeHistory: false })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(ExportError)
    expect((error as ExportError).code).toBe('operation-failed')
    expect((error as ExportError).message).toContain('failed in the fake server')
  })

  it('reports an unreachable daemon without leaking a raw fetch error', async () => {
    const port = await closedPort()
    let error: unknown
    try {
      await client(`http://127.0.0.1:${port}`).listBanks()
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(ExportError)
    expect((error as ExportError).code).toBe('unreachable')
    expect((error as ExportError).message).toContain('Hindsight is unreachable')
  })
})
