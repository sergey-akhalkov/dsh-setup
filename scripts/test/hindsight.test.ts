import { describe, expect, it } from 'vitest'
import { validateHindsightPin } from '../lib/hindsight.ts'

describe('Hindsight pin', () => {
  it('accepts one exact version in all three declarations', () => {
    expect(validateHindsightPin('0.8.2', '0.8.2', '0.8.2')).toEqual([])
  })

  it('rejects a range', () => {
    expect(validateHindsightPin('^0.8.2', '^0.8.2', '^0.8.2')).toEqual([
      'plugin version "^0.8.2" is not an exact version',
      'root version "^0.8.2" is not an exact version',
      'setup version "^0.8.2" is not an exact version',
    ])
  })

  it('rejects the latest tag', () => {
    expect(validateHindsightPin('latest', 'latest', 'latest')).toEqual([
      'plugin version "latest" is not an exact version',
      'root version "latest" is not an exact version',
      'setup version "latest" is not an exact version',
    ])
  })

  it('rejects null declarations', () => {
    const nullVersion = null as unknown as string
    expect(validateHindsightPin(nullVersion, nullVersion, nullVersion)).toEqual([
      'plugin is missing @vectorize-io/hindsight-coding-agents',
      'root is missing @vectorize-io/hindsight-coding-agents',
      'setup is missing @vectorize-io/hindsight-coding-agents',
    ])
  })

  it('rejects a mutable tag disguised as a prerelease', () => {
    expect(
      validateHindsightPin('0.8.2-preview..1', '0.8.2-preview..1', '0.8.2-preview..1'),
    ).toEqual([
      'plugin version "0.8.2-preview..1" is not an exact version',
      'root version "0.8.2-preview..1" is not an exact version',
      'setup version "0.8.2-preview..1" is not an exact version',
    ])
  })

  it('rejects a mismatched exact version', () => {
    expect(validateHindsightPin('0.8.2', '0.8.2', '0.8.1')).toEqual([
      'plugin, root, and setup versions differ (plugin=0.8.2, root=0.8.2, setup=0.8.1)',
    ])
  })

  it('reports a missing declaration', () => {
    expect(validateHindsightPin('0.8.2', undefined, '0.8.2')).toEqual([
      'root is missing @vectorize-io/hindsight-coding-agents',
    ])
  })
})
