import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  inject,
  isLoopbackUrl,
  isManagedEndpoint,
  name,
  shouldAutostart,
} from '../lib/index.js'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

const originalMode = process.env.HINDSIGHT_SERVER_MODE
const originalUrl = process.env.HINDSIGHT_API_URL
const originalDisabled = process.env.HINDSIGHT_DISABLED
const originalConfig = process.env.HINDSIGHT_CONFIG
const originalExportConfig = process.env.HINDSIGHT_EXPORT_CONFIG

const exportConfigPath = join(
  mkdtempSync(join(tmpdir(), 'hindsight-export-host-')),
  'hindsight-export.json',
)

interface FakeContext {
  listeners: Map<string, Array<(payload: { status: string }) => void>>
  disposers: Array<() => void>
  on(name: string, listener: (payload: { status: string }) => void): void
  inject(): void
  effect(execute: () => (() => void) | void): void
}

function fakeContext(): FakeContext {
  const ctx: FakeContext = {
    listeners: new Map(),
    disposers: [],
    on(name, listener) {
      const list = ctx.listeners.get(name) ?? []
      list.push(listener)
      ctx.listeners.set(name, list)
    },
    inject: () => undefined,
    effect(execute) {
      const disposer = execute()
      if (typeof disposer === 'function') ctx.disposers.push(disposer)
    },
  }
  return ctx
}

function dispatchIdle(ctx: FakeContext): void {
  for (const listener of ctx.listeners.get('agent/status') ?? []) listener({ status: 'idle' })
}

beforeEach(() => {
  delete process.env.HINDSIGHT_SERVER_MODE
  delete process.env.HINDSIGHT_API_URL
  delete process.env.HINDSIGHT_DISABLED
  process.env.HINDSIGHT_EXPORT_CONFIG = exportConfigPath
  writeFileSync(exportConfigPath, JSON.stringify({ enabled: false }))
  vi.clearAllMocks()
})

afterEach(() => {
  if (originalMode === undefined) delete process.env.HINDSIGHT_SERVER_MODE
  else process.env.HINDSIGHT_SERVER_MODE = originalMode
  if (originalUrl === undefined) delete process.env.HINDSIGHT_API_URL
  else process.env.HINDSIGHT_API_URL = originalUrl
  if (originalDisabled === undefined) delete process.env.HINDSIGHT_DISABLED
  else process.env.HINDSIGHT_DISABLED = originalDisabled
  if (originalConfig === undefined) delete process.env.HINDSIGHT_CONFIG
  else process.env.HINDSIGHT_CONFIG = originalConfig
  if (originalExportConfig === undefined) delete process.env.HINDSIGHT_EXPORT_CONFIG
  else process.env.HINDSIGHT_EXPORT_CONFIG = originalExportConfig
  vi.unstubAllGlobals()
})

describe('plugin-hindsight', () => {
  it('exports the package identity and the agent lifecycle dependency', () => {
    expect(name).toBe('@dsh-setup/plugin-hindsight')
    expect(inject).toContain('agents')
    expect(typeof apply).toBe('function')
  })

  it('applies the row defaults only when the environment is unset', () => {
    apply(fakeContext() as never, {
      serverMode: 'self-hosted',
      apiUrl: 'http://127.0.0.1:8888',
      autostart: false,
    })
    expect(process.env.HINDSIGHT_SERVER_MODE).toBe('self-hosted')
    expect(process.env.HINDSIGHT_API_URL).toBe('http://127.0.0.1:8888')

    process.env.HINDSIGHT_SERVER_MODE = 'cloud'
    process.env.HINDSIGHT_API_URL = 'https://example.invalid'
    apply(fakeContext() as never, {
      serverMode: 'self-hosted',
      apiUrl: 'http://127.0.0.1:8888',
      autostart: false,
    })
    expect(process.env.HINDSIGHT_SERVER_MODE).toBe('cloud')
    expect(process.env.HINDSIGHT_API_URL).toBe('https://example.invalid')
  })

  it('recognizes loopback endpoints and the managed IPv4 default-profile endpoint', () => {
    expect(isLoopbackUrl('http://127.0.0.1:8888')).toBe(true)
    expect(isLoopbackUrl('http://localhost:8888')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:8888')).toBe(true)
    expect(isLoopbackUrl('https://example.invalid')).toBe(false)
    expect(isLoopbackUrl(undefined)).toBe(false)
    expect(isManagedEndpoint('http://127.0.0.1:8888')).toBe(true)
    expect(isManagedEndpoint('http://localhost:8888')).toBe(false)
    expect(isManagedEndpoint('http://[::1]:8888')).toBe(false)
    expect(isManagedEndpoint('http://127.0.0.1:9999')).toBe(false)
    expect(isManagedEndpoint('https://127.0.0.1:8888')).toBe(false)
    expect(isManagedEndpoint(undefined)).toBe(false)
  })

  it('autostarts only a self-hosted connection at the managed endpoint by default', () => {
    const local = { serverMode: 'self-hosted' as const, apiUrl: 'http://127.0.0.1:8888' }
    expect(shouldAutostart(local, {})).toBe(true)
    expect(shouldAutostart({ ...local, autostart: false }, {})).toBe(false)
    expect(shouldAutostart({ ...local, serverMode: 'cloud' }, {})).toBe(false)
    expect(shouldAutostart({ ...local, serverMode: 'daemon' }, {})).toBe(false)
    expect(shouldAutostart({ ...local, apiUrl: 'https://example.invalid' }, {})).toBe(false)
    expect(shouldAutostart({ ...local, apiUrl: 'http://localhost:8888' }, {})).toBe(false)
    expect(shouldAutostart({ ...local, apiUrl: 'http://[::1]:8888' }, {})).toBe(false)
    expect(shouldAutostart({ ...local, apiUrl: 'http://127.0.0.1:9999' }, {})).toBe(false)
    expect(shouldAutostart(local, { autostart: false })).toBe(false)
    expect(shouldAutostart(local, { disabled: true })).toBe(false)
    expect(shouldAutostart(local, { serverMode: 'cloud' })).toBe(false)
  })

  it('lets explicit environment values override row fallbacks', () => {
    const local = { serverMode: 'self-hosted' as const, apiUrl: 'http://127.0.0.1:8888' }
    process.env.HINDSIGHT_SERVER_MODE = 'cloud'
    expect(shouldAutostart(local, {})).toBe(false)
    process.env.HINDSIGHT_SERVER_MODE = 'self-hosted'
    process.env.HINDSIGHT_API_URL = 'https://example.invalid'
    expect(shouldAutostart(local, {})).toBe(false)
    process.env.HINDSIGHT_API_URL = 'http://127.0.0.1:8888'
    process.env.HINDSIGHT_DISABLED = ' true '
    expect(shouldAutostart(local, {})).toBe(false)
    process.env.HINDSIGHT_DISABLED = '0'
    expect(shouldAutostart(local, {})).toBe(true)
  })

  it('applies harness overrides and skips scoped path or bank overrides', () => {
    const local = { serverMode: 'self-hosted' as const, apiUrl: 'http://127.0.0.1:8888' }
    expect(shouldAutostart(local, { harnesses: { dsh: { serverMode: 'cloud' } } })).toBe(false)
    expect(shouldAutostart(local, { harnesses: { dsh: { disabled: true } } })).toBe(false)
    expect(shouldAutostart(local, { harnesses: { dsh: { autostart: false } } })).toBe(false)
    expect(
      shouldAutostart(local, { harnesses: { dsh: { apiUrl: 'https://example.invalid' } } }),
    ).toBe(false)
    expect(
      shouldAutostart(local, {
        paths: { 'remote-prefix': { apiUrl: 'https://example.invalid' } },
      }),
    ).toBe(false)
    expect(shouldAutostart(local, { banks: { 'coding-agent::repo': { disabled: true } } })).toBe(
      false,
    )
    expect(
      shouldAutostart(local, {
        harnesses: { dsh: { paths: { 'remote-prefix': { apiUrl: 'https://example.invalid' } } } },
      }),
    ).toBe(false)
    expect(
      shouldAutostart(local, {
        harnesses: { dsh: { banks: { 'coding-agent::repo': { disabled: true } } } },
      }),
    ).toBe(false)
  })

  it('probes health and starts no daemon when the managed daemon is healthy', async () => {
    process.env.HINDSIGHT_CONFIG = join(tmpdir(), 'hindsight-missing-config-test.json')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    apply(fakeContext() as never, {
      serverMode: 'self-hosted',
      apiUrl: 'http://127.0.0.1:8888',
      autostart: true,
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://127.0.0.1:8888/health')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('registers no export trigger when the effective configuration disables it', () => {
    // The machine-local file in beforeEach says enabled:false and outranks the row.
    const ctx = fakeContext()
    apply(ctx as never, { autostart: false, export: { enabled: true, intervalMinutes: 1 } })
    expect(ctx.listeners.has('agent/status')).toBe(false)
  })

  it('registers the interval timer and idle trigger only when export is enabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-export-apply-'))
    writeFileSync(exportConfigPath, JSON.stringify({ enabled: true, dir }))
    // A closed port keeps the fire-and-forget idle cycle from touching memory.
    process.env.HINDSIGHT_API_URL = 'http://127.0.0.1:1'
    const ctx = fakeContext()
    apply(ctx as never, { autostart: false })
    expect(ctx.listeners.get('agent/status')?.length).toBeGreaterThan(0)
    expect(ctx.disposers.length).toBeGreaterThan(0)
    expect(() => dispatchIdle(ctx)).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 30))
    for (const dispose of ctx.disposers) dispose()
  })
})
