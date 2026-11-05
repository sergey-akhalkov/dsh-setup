import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveCiVersions, selectCiVersions } from '../ci-versions.ts'

const RANGE = '>=0.2.1-rc.3 <0.3.0'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('selectCiVersions', () => {
  it('includes the range floor', () => {
    expect(selectCiVersions(RANGE, '0.2.1-rc.3', [])).toEqual(['0.2.1-rc.3'])
  })

  it('includes the runtime only when it satisfies the range', () => {
    expect(selectCiVersions(RANGE, '0.2.5', [])).toEqual(['0.2.1-rc.3', '0.2.5'])
    expect(selectCiVersions(RANGE, '0.3.0', [])).toEqual(['0.2.1-rc.3'])
  })

  it('selects the newest published version satisfying the range', () => {
    expect(selectCiVersions(RANGE, '0.2.1-rc.5', ['0.2.1-rc.5', '0.2.2-rc.1', '0.3.0'])).toEqual([
      '0.2.1-rc.3',
      '0.2.1-rc.5',
      '0.2.2-rc.1',
    ])
  })

  it('filters out published versions outside the range', () => {
    expect(
      selectCiVersions(RANGE, '0.2.1-rc.5', ['0.2.0-rc.2', '0.2.1-rc.2', '0.3.0', '0.3.1']),
    ).toEqual(['0.2.1-rc.3', '0.2.1-rc.5'])
  })

  it('dedupes the floor, runtime, and newest version', () => {
    expect(selectCiVersions(RANGE, '0.2.1-rc.3', ['0.2.1-rc.3'])).toEqual(['0.2.1-rc.3'])
  })

  it('sorts prereleases around the floor and ceiling by semver precedence', () => {
    expect(
      selectCiVersions(RANGE, '0.2.1-rc.5', ['0.2.1-rc.2', '0.2.1-rc.5', '0.3.0', '0.2.2-rc.1']),
    ).toEqual(['0.2.1-rc.3', '0.2.1-rc.5', '0.2.2-rc.1'])
  })
})

describe('resolveCiVersions', () => {
  it('uses the published versions when the lookup succeeds', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(resolveCiVersions(RANGE, '0.2.1-rc.5', () => ['0.2.2-rc.1'])).toEqual({
      versions: ['0.2.1-rc.3', '0.2.1-rc.5', '0.2.2-rc.1'],
      degraded: false,
    })
    expect(error).not.toHaveBeenCalled()
  })

  it('falls back to the floor and runtime with a reported degradation', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(
      resolveCiVersions(RANGE, '0.2.1-rc.5', () => {
        throw new Error('registry unreachable')
      }),
    ).toEqual({ versions: ['0.2.1-rc.3', '0.2.1-rc.5'], degraded: true })
    expect(error).toHaveBeenCalledWith(expect.stringContaining('falling back'))
  })

  it('does not hide an invalid engines range behind the fallback', () => {
    expect(() => resolveCiVersions('not-a-range', '0.2.1-rc.5', () => [])).toThrow(
      /invalid DSH engines range/,
    )
  })
})
