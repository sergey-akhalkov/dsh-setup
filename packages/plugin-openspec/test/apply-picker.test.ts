import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, CHANGES_PATH, inject } from '../src/client/index.ts'
import {
  MALFORMED_MESSAGE,
  MISSING_CLI_MESSAGE,
  NO_LOCAL_ROOT_MESSAGE,
  TIMEOUT_MESSAGE,
} from '../src/host/change-list.ts'

interface Option {
  id: string
  label: string
  detail?: string
}

interface Registered {
  name: string
  label: () => string
  description: () => string
  available: (session: { sessionId: string }) => boolean
  ui: {
    kind: string
    options: (session: { sessionId: string }) => Promise<Option[]>
    onSelect: (option: Option, session: { sessionId: string }) => Promise<void>
  }
}

interface Picker {
  readonly registered: Registered[]
  readonly drafts: string[]
  readonly submits: string[]
  readonly ctx: { get(name: string): unknown; effect(callback: () => () => void): () => void }
}

function picker(withServices = true): Picker {
  const registered: Registered[] = []
  const drafts: string[] = []
  const submits: string[] = []
  const actx = { remote: {} }
  const ctx = {
    effect(callback: () => () => void) {
      callback()
      return () => {}
    },
    get(name: string): unknown {
      if (!withServices) return undefined
      if (name === 'commandUi') {
        return {
          register(contribution: Registered) {
            registered.push(contribution)
            return () => {}
          },
        }
      }
      if (name === 'sessions') {
        return {
          scope(id: string) {
            return id === 's1' ? actx : undefined
          },
        }
      }
      if (name === 'conversation') {
        return {
          input: {
            for(received: unknown) {
              expect(received).toBe(actx)
              return {
                setDraft(text: string) {
                  drafts.push(text)
                },
                submit() {
                  submits.push('submit')
                },
              }
            },
          },
        }
      }
      return undefined
    },
  }
  return { registered, drafts, submits, ctx }
}

function contributionOf(target: Picker): Registered {
  apply(target.ctx as never)
  const registeredCommand = target.registered[0]
  if (registeredCommand === undefined) throw new Error('command was not registered')
  return registeredCommand
}

function contribution(): Registered {
  return contributionOf(picker())
}

function changesResponse(changes: unknown[]): Response {
  return {
    ok: true,
    json: async () => ({ changes }),
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openspec apply picker', () => {
  it('registers the native popupSelect command over the command service', () => {
    const { registered, ctx } = picker()
    apply(ctx as never)
    expect(registered).toHaveLength(1)
    const command = registered[0]
    expect(command?.name).toBe('openspec-apply')
    expect(command?.ui.kind).toBe('popupSelect')
    expect(command?.available({ sessionId: 's1' })).toBe(true)
    expect(inject).toEqual(['commandUi', 'sessions', 'conversation'])
  })

  it('registers nothing and raises nothing without the client services', () => {
    const { registered, ctx } = picker(false)
    expect(() => apply(ctx as never)).not.toThrow()
    expect(registered).toEqual([])
  })

  it('lists one unfinished row per change with its progress detail', async () => {
    const fetchMock = vi.fn(async () =>
      changesResponse([
        {
          name: 'done-change',
          completedTasks: 4,
          totalTasks: 4,
          status: 'complete',
        },
        {
          name: 'add-auth',
          completedTasks: 3,
          totalTasks: 14,
          status: 'in-progress',
        },
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const rows = await contribution().ui.options({ sessionId: 's1' })
    expect(rows).toEqual([{ id: 'add-auth', label: 'add-auth', detail: '3/14' }])
    expect(fetchMock).toHaveBeenCalledWith(
      `${CHANGES_PATH}?session=s1`,
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })

  it('shows the empty list when no unfinished change remains', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        changesResponse([{ name: 'done', completedTasks: 1, totalTasks: 1, status: 'complete' }]),
      ),
    )
    await expect(contribution().ui.options({ sessionId: 's1' })).resolves.toEqual([])
  })

  it('surfaces every readable Host error unchanged', async () => {
    for (const message of [
      MISSING_CLI_MESSAGE,
      NO_LOCAL_ROOT_MESSAGE,
      TIMEOUT_MESSAGE,
      MALFORMED_MESSAGE,
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: false,
          status: 500,
          json: async () => ({ error: message }),
        })),
      )
      await expect(contribution().ui.options({ sessionId: 's1' })).rejects.toThrow(message)
    }
  })

  it('writes the skill line into the draft without submitting', async () => {
    const target = picker()
    const command = contributionOf(target)
    await command.ui.onSelect({ id: 'add-auth', label: 'add-auth' }, { sessionId: 's1' })
    expect(target.drafts).toEqual(['/openspec-apply-change add-auth'])
    expect(target.submits).toEqual([])
  })

  it('rejects a pick whose session scope is no longer retained', async () => {
    await expect(
      contribution().ui.onSelect({ id: 'add-auth', label: 'add-auth' }, { sessionId: 'unknown' }),
    ).rejects.toThrow(/not open/)
  })
})
