import { describe, expect, it } from 'vitest'
import { selectCiVersions } from '../ci-versions.ts'

const RANGE = '>=0.2.1-rc.3 <0.3.0'

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
