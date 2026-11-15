import { describe, expect, it } from 'vitest'
import {
  attributedChangeName,
  attributedChangeNames,
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

describe('shell attribution boundaries', () => {
  function call(
    args: Record<string, unknown>,
    ok = true,
  ): {
    readonly callId: string
    readonly name: string
    readonly arguments: Readonly<Record<string, unknown>>
    readonly ok: boolean
  } {
    return { callId: 'c', name: 'pwsh', arguments: args, ok }
  }

  it('does not attribute a printed command example', () => {
    expect(
      attributedChangeName(
        WORKSPACE,
        [call({ command: "Write-Output 'Set-Content openspec/changes/auth/design.md -Value x'" })],
        1,
      ),
    ).toBeUndefined()
  })

  it('attributes a creation only from an in-workspace working directory', () => {
    expect(
      attributedChangeName(
        WORKSPACE,
        [call({ command: 'openspec new change auth', workdir: 'C:/other' })],
        1,
      ),
    ).toBeUndefined()
    expect(
      attributedChangeName(
        WORKSPACE,
        [call({ command: 'openspec new change auth', workdir: 'C:/repo/packages' })],
        1,
      ),
    ).toBe('auth')
  })
})

describe('quoted destinations and root workdir', () => {
  function call(
    args: Record<string, unknown>,
    ok = true,
  ): {
    readonly callId: string
    readonly name: string
    readonly arguments: Readonly<Record<string, unknown>>
    readonly ok: boolean
  } {
    return { callId: 'c', name: 'pwsh', arguments: args, ok }
  }

  it('accepts the workspace root as the working directory', () => {
    expect(
      attributedChangeName(
        WORKSPACE,
        [call({ command: 'openspec new change auth', workdir: 'C:/repo' })],
        1,
      ),
    ).toBe('auth')
  })

  it('keeps a quoted write destination', () => {
    expect(
      attributedChangeName(
        WORKSPACE,
        [call({ command: 'Set-Content -Path "openspec/changes/auth/design.md" -Value x' })],
        1,
      ),
    ).toBe('auth')
    expect(
      attributedChangeName(
        WORKSPACE,
        [call({ command: 'echo x > "openspec/changes/auth/design.md"' })],
        1,
      ),
    ).toBe('auth')
  })

  it('still ignores a printed quoted command', () => {
    expect(
      attributedChangeName(
        WORKSPACE,
        [call({ command: 'Write-Output "Set-Content openspec/changes/auth/design.md"' })],
        1,
      ),
    ).toBeUndefined()
  })
})

describe('unexecuted shell text', () => {
  function call(
    args: Record<string, unknown>,
    ok = true,
  ): {
    readonly callId: string
    readonly name: string
    readonly arguments: Readonly<Record<string, unknown>>
    readonly ok: boolean
  } {
    return { callId: 'c', name: 'pwsh', arguments: args, ok }
  }

  it('ignores a comment-only command and a quoted assignment', () => {
    expect(
      attributedChangeName(
        WORKSPACE,
        [call({ command: '# Set-Content openspec/changes/auth/design.md -Value x' })],
        1,
      ),
    ).toBeUndefined()
    expect(
      attributedChangeName(
        WORKSPACE,
        [call({ command: "$x = 'Set-Content openspec/changes/auth/design.md'" })],
        1,
      ),
    ).toBeUndefined()
  })
})

describe('shell destination arguments', () => {
  function call(command: string): {
    readonly callId: string
    readonly name: string
    readonly arguments: Readonly<Record<string, unknown>>
    readonly ok: boolean
  } {
    return { callId: 'c', name: 'pwsh', arguments: { command }, ok: true }
  }

  it('uses -Path over a -Value argument and keeps a positional destination', () => {
    expect(
      attributedChangeName(
        WORKSPACE,
        [
          call(
            'Set-Content -Value "openspec/changes/fake/design.md" -Path openspec/changes/real/design.md',
          ),
        ],
        1,
      ),
    ).toBe('real')
    expect(
      attributedChangeName(
        WORKSPACE,
        [call('Set-Content "openspec/changes/real/design.md" -Value openspec/changes/fake/x.md')],
        1,
      ),
    ).toBe('real')
  })
})

describe('multi-change attribution', () => {
  it('collects a direct write and a shell creation in one turn', () => {
    const calls = [
      {
        callId: 'w',
        name: 'write',
        arguments: { file_path: 'openspec/changes/auth/design.md' },
        ok: true,
      },
      {
        callId: 'c',
        name: 'pwsh',
        arguments: { command: 'openspec new change billing' },
        ok: true,
      },
    ]
    expect(attributedChangeNames(WORKSPACE, calls, 1)).toEqual(['auth', 'billing'])
    expect(
      attributedChangeName(
        WORKSPACE,
        [
          {
            callId: 'e',
            name: 'pwsh',
            arguments: {
              command: 'Set-Content -Encoding utf8 openspec/changes/auth/design.md -Value x',
            },
            ok: true,
          },
        ],
        1,
      ),
    ).toBe('auth')
  })
})

describe('multi-write shell attribution', () => {
  it('collects every destination in one shell observation', () => {
    const calls = [
      {
        callId: 'c',
        name: 'pwsh',
        arguments: {
          command:
            'Set-Content -Path openspec/changes/auth/design.md -Value x; Set-Content -Path openspec/changes/billing/design.md -Value y',
        },
        ok: true,
      },
    ]
    expect(attributedChangeNames(WORKSPACE, calls, 1)).toEqual(['auth', 'billing'])
    expect(
      attributedChangeName(
        WORKSPACE,
        [
          {
            callId: 'e',
            name: 'pwsh',
            arguments: {
              command: 'Set-Content -Encoding utf8 openspec/changes/auth/design.md -Value x',
            },
            ok: true,
          },
        ],
        1,
      ),
    ).toBe('auth')
  })
})

describe('quoted shell examples', () => {
  it('does not treat a quoted example as an executed write', () => {
    const calls = [
      {
        callId: 'c',
        name: 'pwsh',
        arguments: {
          command:
            "Write-Output 'Example; Set-Content -Path openspec/changes/auth/design.md -Value x'",
        },
        ok: true,
      },
    ]
    expect(attributedChangeNames(WORKSPACE, calls, 1)).toEqual([])
  })
})

describe('multiline shell attribution', () => {
  it('recognizes a write after a read and writes on separate lines', () => {
    expect(
      attributedChangeNames(
        WORKSPACE,
        [
          {
            callId: 'a',
            name: 'pwsh',
            arguments: {
              command:
                'Get-Content README.md\nSet-Content -Path openspec/changes/auth/design.md -Value x',
            },
            ok: true,
          },
        ],
        1,
      ),
    ).toEqual(['auth'])
    expect(
      attributedChangeNames(
        WORKSPACE,
        [
          {
            callId: 'b',
            name: 'pwsh',
            arguments: {
              command:
                'Set-Content -Path openspec/changes/auth/design.md -Value x\r\nSet-Content -Path openspec/changes/billing/design.md -Value y',
            },
            ok: true,
          },
        ],
        1,
      ),
    ).toEqual(['auth', 'billing'])
  })
})

describe('inline shell comments', () => {
  it('ignores a command after an inline comment', () => {
    expect(
      attributedChangeNames(
        WORKSPACE,
        [
          {
            callId: 'c',
            name: 'pwsh',
            arguments: {
              command: 'Write-Output ok # example; openspec new change auth',
            },
            ok: true,
          },
        ],
        1,
      ),
    ).toEqual([])
  })

  it('keeps a command on a later line after a comment-only line', () => {
    expect(
      attributedChangeNames(
        WORKSPACE,
        [
          {
            callId: 'c',
            name: 'pwsh',
            arguments: { command: '# note\nopenspec new change auth' },
            ok: true,
          },
        ],
        1,
      ),
    ).toEqual(['auth'])
  })
})

describe('quoted value text', () => {
  it('ignores a fake -Path inside a quoted value', () => {
    expect(
      attributedChangeName(
        WORKSPACE,
        [
          {
            callId: 'c',
            name: 'pwsh',
            arguments: {
              command:
                'Set-Content -Value "example -Path openspec/changes/example/design.md" -Path openspec/changes/auth/design.md',
            },
            ok: true,
          },
        ],
        1,
      ),
    ).toBe('auth')
  })

  it('treats a doubled backtick as a literal before the closing quote', () => {
    const command = 'Set-Content -Value "ends with ``" -Path openspec/changes/auth/design.md'
    expect(
      attributedChangeName(
        WORKSPACE,
        [{ callId: 'c', name: 'pwsh', arguments: { command }, ok: true }],
        1,
      ),
    ).toBe('auth')
  })
  it('keeps an escaped quote inside a value and finds the real destination', () => {
    const command =
      'Set-Content -Value "example `" -Path openspec/changes/fake/design.md `" tail" -Path openspec/changes/auth/design.md'
    expect(
      attributedChangeName(
        WORKSPACE,
        [{ callId: 'c', name: 'pwsh', arguments: { command }, ok: true }],
        1,
      ),
    ).toBe('auth')
  })
  it('resolves a quoted redirection destination', () => {
    expect(
      attributedChangeName(
        WORKSPACE,
        [
          {
            callId: 'c',
            name: 'pwsh',
            arguments: {
              command: 'echo x > "openspec/changes/auth/design.md"',
            },
            ok: true,
          },
        ],
        1,
      ),
    ).toBe('auth')
  })
})
