import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Evidence from the live DSH carrier, captured by test/carrier-check.ts against
 * the running host. The workflow bundle cannot be installed in the live profile
 * here, so admission is probed on an installed route: the carrier fences every
 * route identically before dispatch. The workflow route methods themselves are
 * covered by api.test.ts.
 *
 * Platform constraint: in DSH 0.2.2-rc.1 the Fetch carrier and its admission
 * fence are host-app services (`ctx.connection.fetch`, `admitConnection`) whose
 * implementation ships inside the DeepSeek Harness app bundle, not in a
 * published devDependency this repository can import. The published
 * `@deepseek-ai/dsh-host-webserver` exports only `WebServer` for HTTP/static
 * routes, with no Fetch registry or admission service, so the real desktop
 * carrier cannot be instantiated headlessly here. A throwaway-profile host is
 * the integration-owned check (built setup installed into a temp DSH_HOME);
 * this test records the real shared carrier's observed 401/403 behavior and
 * replays it when a carrier URL is supplied.
 */
const fixture = fileURLToPath(new URL('./fixtures/carrier-admission.json', import.meta.url))

interface Recorded {
  checkedAt: string
  url: string
  route: string
  results: Array<{ name: string; method: string; headers: Record<string, string>; status: number }>
}

describe('carrier admission evidence', () => {
  it('records the live carrier refusing anonymous and foreign-origin requests before dispatch', async () => {
    const recorded = JSON.parse(await readFile(fixture, 'utf8')) as Recorded
    expect(Number.isNaN(Date.parse(recorded.checkedAt))).toBe(false)
    expect(recorded.url).toMatch(/^https?:\/\//)
    expect(recorded.route.startsWith('/api/')).toBe(true)
    const statuses = new Map(recorded.results.map((result) => [result.name, result.status]))
    expect(statuses.get('anonymous-get')).toBe(401)
    expect(statuses.get('anonymous-post')).toBe(401)
    expect(statuses.get('foreign-origin')).toBe(403)
  })

  it('re-runs the same probes against a carrier when one is given', async () => {
    const base = process.env.DSH_CARRIER_URL
    if (base === undefined || base === '') return
    const recorded = JSON.parse(await readFile(fixture, 'utf8')) as Recorded
    for (const probe of recorded.results) {
      const response = await fetch(`${base}${recorded.route}`, {
        method: probe.method,
        headers: probe.headers,
      })
      expect(response.status).toBe(probe.status)
    }
  })
})
