import { describe, expect, it } from 'vitest'
import {
  attributedChangeName,
  attributedSpecWrite,
  normalizedWorkspacePath,
} from '../src/host/write-attribution.ts'

const WORKSPACE = 'C:\\repo'

function call(
  raw: string,
  overrides: Partial<{ ok: boolean; turn: number; name: string }> = {},
): {
  readonly callId: string
  readonly name: string
  readonly arguments: Readonly<Record<string, unknown>>
  readonly ok: boolean
  readonly turn?: number
} {
  return {
    callId: 'c1',
    name: overrides.name ?? 'write',
    arguments: { file_path: raw },
    ok: overrides.ok ?? true,
    ...(overrides.turn === undefined ? {} : { turn: overrides.turn }),
  }
}

describe('normalizedWorkspacePath', () => {
  it('normalizes relative, dot-relative, and absolute paths inside the workspace', () => {
    expect(normalizedWorkspacePath(WORKSPACE, 'openspec/changes/auth/design.md')).toBe(
      'openspec/changes/auth/design.md',
    )
    expect(normalizedWorkspacePath(WORKSPACE, './openspec/changes/auth/design.md')).toBe(
      'openspec/changes/auth/design.md',
    )
    expect(normalizedWorkspacePath(WORKSPACE, 'C:/repo/openspec/changes/auth/design.md')).toBe(
      'openspec/changes/auth/design.md',
    )
    expect(normalizedWorkspacePath(WORKSPACE, 'C:\\repo\\openspec\\changes\\auth\\design.md')).toBe(
      'openspec/changes/auth/design.md',
    )
  })

  it('refuses an outside or escaping path', () => {
    expect(normalizedWorkspacePath(WORKSPACE, 'C:/other/design.md')).toBeUndefined()
    expect(normalizedWorkspacePath(WORKSPACE, '../design.md')).toBeUndefined()
  })
})

describe('attributedSpecWrite', () => {
  it('attributes a successful artifact write in any path form', () => {
    expect(
      attributedSpecWrite(WORKSPACE, [call('C:/repo/openspec/changes/auth/design.md')], 1),
    ).toBe('openspec/changes/auth/design.md')
    expect(
      attributedSpecWrite(WORKSPACE, [call('./openspec/changes/auth/specs/x/spec.md')], 1),
    ).toBe('openspec/changes/auth/specs/x/spec.md')
  })

  it('ignores failed, review, non-spec, outside, and other-turn writes', () => {
    expect(
      attributedSpecWrite(WORKSPACE, [call('openspec/changes/auth/design.md', { ok: false })], 1),
    ).toBeUndefined()
    expect(
      attributedSpecWrite(
        WORKSPACE,
        [call('openspec/changes/auth/reviews/0123456789abcdef.json')],
        1,
      ),
    ).toBeUndefined()
    expect(attributedSpecWrite(WORKSPACE, [call('packages/x.txt')], 1)).toBeUndefined()
    expect(attributedSpecWrite(WORKSPACE, [call('C:/other/auth/design.md')], 1)).toBeUndefined()
    expect(
      attributedSpecWrite(WORKSPACE, [call('openspec/changes/auth/design.md', { turn: 2 })], 1),
    ).toBeUndefined()
  })

  it('returns the newest matching write', () => {
    const calls = [
      call('openspec/changes/first/design.md'),
      call('openspec/changes/second/design.md'),
    ]
    expect(attributedSpecWrite(WORKSPACE, calls, undefined)).toBe(
      'openspec/changes/second/design.md',
    )
  })
})

describe('attributedChangeName', () => {
  function shell(
    command: string,
    ok = true,
  ): {
    readonly callId: string
    readonly name: string
    readonly arguments: Readonly<Record<string, unknown>>
    readonly ok: boolean
  } {
    return { callId: 'c', name: 'pwsh', arguments: { command }, ok }
  }

  it('attributes a successful change creation command in each normalized form', () => {
    expect(attributedChangeName(WORKSPACE, [shell('openspec new change auth')], 1)).toBe('auth')
    expect(attributedChangeName(WORKSPACE, [shell('rtk openspec new change auth')], 1)).toBe('auth')
    expect(attributedChangeName(WORKSPACE, [shell('pnpm exec openspec new change auth')], 1)).toBe(
      'auth',
    )
  })

  it('ignores a failed creation command', () => {
    expect(attributedChangeName(WORKSPACE, [shell('openspec new change auth', false)], 1)).toBe(
      undefined,
    )
  })

  it('prefers the artifact path when one was written', () => {
    const written = call('openspec/changes/auth/design.md')
    expect(attributedChangeName(WORKSPACE, [shell('openspec new change auth'), written], 1)).toBe(
      'auth',
    )
  })
})

describe('shell write attribution', () => {
  function shell(
    command: string,
    ok = true,
  ): {
    readonly callId: string
    readonly name: string
    readonly arguments: Readonly<Record<string, unknown>>
    readonly ok: boolean
  } {
    return { callId: 'c', name: 'pwsh', arguments: { command }, ok }
  }

  it('attributes supported successful shell writes to the change', () => {
    expect(
      attributedChangeName(
        WORKSPACE,
        [shell('Set-Content -Path openspec/changes/auth/design.md -Value x')],
        1,
      ),
    ).toBe('auth')
    expect(
      attributedChangeName(
        WORKSPACE,
        [shell('"# x" | Out-File openspec/changes/auth/design.md')],
        1,
      ),
    ).toBe('auth')
    expect(
      attributedChangeName(WORKSPACE, [shell('echo x > openspec/changes/auth/design.md')], 1),
    ).toBe('auth')
  })

  it('ignores a failed shell write and a review target', () => {
    expect(
      attributedChangeName(
        WORKSPACE,
        [shell('Set-Content -Path openspec/changes/auth/design.md -Value x', false)],
        1,
      ),
    ).toBeUndefined()
    expect(
      attributedChangeName(
        WORKSPACE,
        [shell('echo x > openspec/changes/auth/reviews/0123456789abcdef.json')],
        1,
      ),
    ).toBeUndefined()
  })
})
