/**
 * External carrier admission check. The live DSH host owns admission before a
 * route handler runs; this script probes the running host and records the
 * observed statuses so the workflow package has reproducible evidence without
 * installing the plugin into the live profile. Run:
 *
 *   node --experimental-strip-types packages/plugin-workflows/test/carrier-check.ts \
 *     http://127.0.0.1:59730 > test/fixtures/carrier-admission.json
 *
 * The workflow routes cannot be probed here unless the bundle is installed in
 * the live profile (forbidden for this change); the shared carrier's admission
 * fence and the registered method list are covered by api.test.ts.
 */

const base = process.argv[2] ?? process.env.DSH_CARRIER_URL ?? 'http://127.0.0.1:59730'
const route = '/api/plugins/dsh-setup-openspec/changes?session=carrier-probe'

interface Probe {
  readonly name: string
  readonly method: string
  readonly headers: Record<string, string>
}

const probes: Probe[] = [
  { name: 'anonymous-get', method: 'GET', headers: {} },
  { name: 'anonymous-post', method: 'POST', headers: {} },
  { name: 'foreign-origin', method: 'GET', headers: { origin: 'http://evil.example' } },
]

const results = []
for (const probe of probes) {
  const response = await fetch(`${base}${route}`, {
    method: probe.method,
    headers: probe.headers,
  })
  results.push({ ...probe, status: response.status })
}
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      url: base,
      route,
      results,
    },
    null,
    2,
  ),
)
