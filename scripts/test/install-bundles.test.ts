import { describe, expect, it } from 'vitest'
import { availableBundles, classifyBundleLookup } from '../lib/install-bundles.ts'

/**
 * The shipped optional bundles are resolved against the installed DSH runtime,
 * not against the registry, so a DSH release inside the supported range can
 * drop one. The validation expects only the bundles that version provides.
 */

describe('shipped bundle availability', () => {
  it('keeps only the bundles the resolved DSH version provides', () => {
    const probes: string[] = []
    const available = availableBundles(
      ['@scope/alpha', '@scope/beta', '@scope/gamma'],
      '0.2.2-rc.2',
      (spec) => {
        probes.push(spec)
        return spec.startsWith('@scope/beta@') ? 'available' : 'missing'
      },
    )
    expect(available).toEqual(['@scope/beta'])
    expect(probes).toEqual([
      '@scope/alpha@0.2.2-rc.2',
      '@scope/beta@0.2.2-rc.2',
      '@scope/gamma@0.2.2-rc.2',
    ])
  })

  it('treats only a 404 as a missing bundle', () => {
    expect(classifyBundleLookup('npm error code E404')).toBe('missing')
    expect(classifyBundleLookup('npm error 404 Not Found - GET https://registry.npmjs.org/x')).toBe(
      'missing',
    )
    expect(classifyBundleLookup('npm error code ECONNRESET')).toBe('error')
    expect(classifyBundleLookup('')).toBe('error')
  })
})
