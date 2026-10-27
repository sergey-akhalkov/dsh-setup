import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

interface FakeInputActions {
  setDraft(text: string): void
  submit(): void
  captureInsertion(): { draftRev: number }
  addAttachments(ids: readonly string[]): boolean
  removeAttachment(id: string): void
  pruneAttachments(ids: readonly string[]): void
}

interface FakeComposerInput {
  draft: string
  draftRev: number
  attachmentIds: readonly unknown[]
  occurrences: readonly unknown[]
  phase: string
}

interface FakeFetchResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

type FakeFetch = (
  path: string,
  init: { method: string; credentials: 'same-origin'; headers: { accept: string } },
) => Promise<FakeFetchResponse>

interface LoaderRegistration {
  id: string
  factory: (require: (id: string) => unknown) => {
    inject?: string[]
    apply?: (ctx: unknown) => void
    submitCommand?: (
      actions: FakeInputActions | undefined,
      command: string,
      input: FakeComposerInput,
    ) => boolean
    canRunAction?: (input: FakeComposerInput) => boolean
    menuAction?: (
      id: string,
      actions: FakeInputActions | undefined,
      input: FakeComposerInput,
    ) => 'shortcut' | 'restart' | 'none'
    confirmRestart?: (actions: FakeInputActions | undefined, input: FakeComposerInput) => boolean
    runAction?: (fetcher?: FakeFetch) => Promise<{ ok: boolean; text: string }>
    AdminIndicator?: (props: {
      t: (key: string) => string
      inputActions: FakeInputActions
      useInput: (selector: (state: FakeComposerInput) => FakeComposerInput) => FakeComposerInput
    }) => unknown
  }
}

interface FakeContextCalls {
  locale?: { namespace: string; locale: string; dictionary: Record<string, string> }
  injectKey?: string
  options?: { name: string; id: string; order?: number }
  component?: () => unknown
}

function loadClient(): LoaderRegistration {
  const file = join(packageDir, 'lib', 'client.js')
  if (!existsSync(file)) throw new Error('run `pnpm build` before this test')
  const code = readFileSync(file, 'utf8')
  let registration: LoaderRegistration | undefined
  const window = {
    __ModuleLoader__: {
      load(value: LoaderRegistration): void {
        registration = value
      },
    },
  }
  new Function('window', code)(window)
  if (registration === undefined) throw new Error('the client bundle did not register a module')
  return registration
}

function applyClient(): { registration: LoaderRegistration; calls: FakeContextCalls } {
  const registration = loadClient()
  const module = registration.factory(() => ({}))
  const calls: FakeContextCalls = {}
  const ctx = {
    locale: {
      register(namespace: string, locale: string, dictionary: Record<string, string>) {
        calls.locale = { namespace, locale, dictionary }
        return () => {}
      },
      bind() {
        return (key: string) => key
      },
    },
    slots: {
      inject(key: string, callback: () => () => void) {
        calls.injectKey = key
        callback()
        return () => {}
      },
      register(options: { name: string; id: string; order?: number }, component: () => unknown) {
        calls.options = options
        calls.component = component
        return () => {}
      },
    },
  }
  module.apply?.(ctx)
  return { registration, calls }
}

describe('admin indicator Client half', () => {
  it('registers the package module with the expected services', () => {
    const registration = loadClient()
    const module = registration.factory(() => ({}))
    expect(registration.id).toBe('@dsh-setup/plugin-admin-indicator')
    expect(module.inject).toEqual(['slots', 'locale'])
  })

  it('fails open when its client services are unavailable', () => {
    const registration = loadClient()
    const module = registration.factory(() => ({}))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => module.apply?.({})).not.toThrow()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('uses the native client primitives instead of a hand-built menu', () => {
    const registration = loadClient()
    const required: string[] = []
    registration.factory((id) => {
      required.push(id)
      return {}
    })
    expect(required).toContain('@deepseek-ai/dsh-client-ui-primitives')
  })

  it('registers the badge in conversation.input.left', () => {
    const { calls } = applyClient()
    expect(calls.locale).toMatchObject({
      namespace: 'dsh-setup-admin-indicator',
      locale: 'en',
    })
    expect(calls.locale?.dictionary['tooltip.admin']).toContain('Administrator')
    expect(calls.locale?.dictionary['label.administrator']).toBe('Administrator')
    expect(calls.locale?.dictionary['label.standard']).toBe('Standard User')
    expect(calls.locale?.dictionary['menu.create']).toBe('Create admin desktop shortcut')
    expect(calls.locale?.dictionary['menu.restart']).toBe('Restart DSH as Administrator')
    expect(calls.locale?.dictionary['menu.restartWarning']).toContain('closes DSH')
    expect(calls.locale?.dictionary['menu.standard.body']?.toLowerCase()).toContain('restart')
    expect(calls.injectKey).toBe('conversation.input.left')
    expect(calls.options).toMatchObject({
      name: 'conversation.input.left',
      id: 'dsh-setup-admin-indicator',
      order: 50,
    })
    expect(typeof calls.component).toBe('function')
  })

  it('never replaces a draft, reference, or attachment', () => {
    const registration = loadClient()
    const module = registration.factory(() => ({}))
    const base: FakeComposerInput = {
      draft: '',
      draftRev: 0,
      attachmentIds: [],
      occurrences: [],
      phase: 'plain',
    }
    expect(module.canRunAction?.(base)).toBe(true)
    expect(module.canRunAction?.({ ...base, draft: 'unsent message' })).toBe(false)
    expect(module.canRunAction?.({ ...base, attachmentIds: ['file'] })).toBe(false)
    expect(module.canRunAction?.({ ...base, occurrences: ['reference'] })).toBe(false)
    expect(module.canRunAction?.({ ...base, phase: 'submitting' })).toBe(false)
  })

  it('rechecks the current composer state before replacing the draft', async () => {
    const registration = loadClient()
    const module = registration.factory(() => ({}))
    let current: FakeComposerInput = {
      draft: '',
      draftRev: 0,
      attachmentIds: [],
      occurrences: [],
      phase: 'plain',
    }
    let captureRev = 0
    const drafted: string[] = []
    let submitted = 0
    const actions: FakeInputActions = {
      setDraft: (text) => {
        drafted.push(text)
        current = { ...current, draft: text }
      },
      submit: () => {
        submitted += 1
      },
      captureInsertion: () => ({ draftRev: captureRev }),
      addAttachments: () => true,
      removeAttachment: () => {},
      pruneAttachments: () => {},
    }
    expect(module.submitCommand?.(actions, '/admin-shortcut', current)).toBe(true)
    await Promise.resolve()
    expect(drafted).toEqual(['/admin-shortcut'])
    expect(submitted).toBe(1)

    current = { ...current, draft: 'unsent message', draftRev: 1 }
    captureRev = 1
    drafted.length = 0
    expect(module.submitCommand?.(actions, '/admin-restart confirm', current)).toBe(false)
    expect(drafted).toEqual([])
    expect(submitted).toBe(1)

    current = { ...current, draft: '', draftRev: 0 }
    captureRev = 2
    expect(module.submitCommand?.(actions, '/admin-shortcut', current)).toBe(false)
    expect(
      module.submitCommand?.(undefined, '/admin-shortcut', {
        draft: '',
        draftRev: 0,
        attachmentIds: [],
        occurrences: [],
        phase: 'plain',
      }),
    ).toBe(false)
  })

  it('runs the authenticated shortcut action and decodes its result', async () => {
    const registration = loadClient()
    const module = registration.factory(() => ({}))
    const calls: string[] = []
    const fetcher: FakeFetch = async (path, init) => {
      calls.push(`${init.method} ${path}`)
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, text: 'Created the shortcut.' }),
      }
    }
    await expect(module.runAction?.(fetcher)).resolves.toEqual({
      ok: true,
      text: 'Created the shortcut.',
    })
    expect(calls).toEqual(['POST /plugins/dsh-setup-admin-indicator/shortcut'])
    const forbidden: FakeFetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    })
    await expect(module.runAction?.(forbidden)).resolves.toEqual({
      ok: false,
      text: 'Forbidden',
    })
  })

  it('wires the registered menu and confirmation callbacks', async () => {
    const registration = loadClient()
    const states: unknown[] = []
    const refs: Array<{ current: unknown }> = []
    let effectsRan = false
    let cursor = 0
    let refCursor = 0
    const useState = <T>(initial: T): [T, (next: T | ((prev: T) => T)) => void] => {
      const index = cursor++
      if (!(index in states)) states[index] = initial
      return [
        states[index] as T,
        (next) => {
          states[index] =
            typeof next === 'function' ? (next as (prev: T) => T)(states[index] as T) : next
        },
      ]
    }
    const effects: Array<() => void | (() => void)> = []
    const useEffect = (callback: () => void | (() => void)) => {
      if (!effectsRan) effects.push(callback)
    }
    const useRef = <T>(initial: T): { current: T } => {
      const index = refCursor++
      if (!(index in refs)) refs[index] = { current: initial }
      return refs[index] as { current: T }
    }
    const jsx = (type: unknown, props: Record<string, unknown> | null) => ({
      type,
      props: props ?? {},
    })
    const jsxs = jsx
    const Fragment = Symbol('Fragment')
    const Menu = (props: Record<string, unknown>) => ({ type: 'Menu', props })
    const Modal = (props: Record<string, unknown>) => ({ type: 'Modal', props })
    const Button = (props: Record<string, unknown>) => ({ type: 'Button', props })
    const Toast = (props: Record<string, unknown>) => ({ type: 'Toast', props })

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_input: string, init?: { method?: string }) => {
      if (init?.method === 'POST') {
        return { ok: true, json: async () => ({ ok: true, text: 'Created the shortcut.' }) }
      }
      return {
        ok: true,
        json: async () => ({
          platform: 'win32',
          elevated: 'standard',
          desktop: true,
          restart: true,
        }),
      }
    }) as unknown as typeof fetch
    try {
      let current: FakeComposerInput = {
        draft: '',
        draftRev: 0,
        attachmentIds: [],
        occurrences: [],
        phase: 'plain',
      }
      const drafted: string[] = []
      let submitted = 0
      const attached = new Set<string>()
      const actions: FakeInputActions = {
        setDraft: (text) => {
          drafted.push(text)
          current = { ...current, draft: text }
        },
        submit: () => {
          submitted += 1
        },
        captureInsertion: () => ({ draftRev: current.draftRev }),
        addAttachments: (ids) => {
          for (const id of ids) attached.add(id)
          return true
        },
        removeAttachment: (id) => {
          attached.delete(id)
        },
        pruneAttachments: (ids) => {
          for (const id of ids) attached.delete(id)
        },
      }
      const originalAdd = actions.addAttachments
      const module = registration.factory((id) => {
        if (id === 'react') return { useState, useEffect, useRef }
        if (id === 'react/jsx-runtime') return { jsx, jsxs, Fragment }
        if (id === '@deepseek-ai/dsh-client-ui-primitives') {
          return { Menu, Modal, Button, Toast }
        }
        return {}
      })
      let tree: unknown
      const render = () => {
        cursor = 0
        refCursor = 0
        tree = module.AdminIndicator?.({
          t: (key) => key,
          inputActions: actions,
          useInput: () => current,
        })
      }

      render()
      for (const callback of effects) callback()
      effectsRan = true
      await new Promise((resolve) => setTimeout(resolve, 0))
      render()
      expect(module.AdminIndicator).toBeDefined()
      expect(actions.addAttachments).not.toBe(originalAdd)

      const find = (): Array<{ type: unknown; props: Record<string, unknown> }> => {
        const found: Array<{ type: unknown; props: Record<string, unknown> }> = []
        const walk = (node: unknown): void => {
          if (node === null || typeof node !== 'object') return
          if (Array.isArray(node)) {
            for (const child of node) walk(child)
            return
          }
          const element = node as { type?: unknown; props?: unknown }
          if (element.type === undefined || element.props === null) return
          const props = element.props as Record<string, unknown>
          found.push({ type: element.type, props })
          walk(props.children)
          walk(props.anchor)
          walk(props.footer)
        }
        walk(tree)
        return found
      }

      const menuElement = (): { type: unknown; props: Record<string, unknown> } => {
        const element = find().find((candidate) => candidate.type === Menu)
        if (element === undefined) throw new Error('menu missing')
        return element
      }
      const select = (id: string): void => {
        const onSelect = menuElement().props.onSelect
        if (typeof onSelect !== 'function') throw new Error('menu onSelect missing')
        ;(onSelect as (id: string) => void)(id)
      }
      const click = (label: string): void => {
        const element = find().find(
          (candidate) => candidate.type === Button && candidate.props.children === label,
        )
        if (element === undefined) throw new Error(`button ${label} missing`)
        const onClick = element.props.onClick
        if (typeof onClick !== 'function') throw new Error(`button ${label} onClick missing`)
        onClick()
      }
      const shortcutItem = (
        menuElement().props.items as Array<{ id?: string; disabled?: boolean }>
      ).find((item) => item.id === 'shortcut')
      expect(shortcutItem?.disabled).toBe(false)
      select('shortcut')
      await new Promise((resolve) => setTimeout(resolve, 0))
      render()
      expect(drafted).toEqual([])
      expect(submitted).toBe(0)
      const successToast = find().find((element) => element.type === Toast)
      expect(successToast?.props.tone).toBe('success')
      expect(successToast?.props.text).toContain('Created')

      current = { ...current, draft: '', draftRev: 0 }
      drafted.length = 0
      render()
      select('restart')
      render()
      expect(find().find((element) => element.type === Modal)?.props.open).toBe(true)
      click('menu.restartConfirm')
      await Promise.resolve()
      expect(drafted).toEqual(['/admin-restart confirm'])
      expect(submitted).toBe(1)

      current = { ...current, draft: '', draftRev: 0 }
      drafted.length = 0
      render()
      select('restart')
      render()
      click('menu.restartCancel')
      expect(drafted).toEqual([])
      expect(submitted).toBe(1)

      current = { ...current, draft: 'unsent message', draftRev: 1, occurrences: ['reference'] }
      drafted.length = 0
      render()
      select('restart')
      expect(drafted).toEqual([])
      expect(submitted).toBe(1)
      select('shortcut')
      await new Promise((resolve) => setTimeout(resolve, 0))
      render()
      expect(drafted).toEqual([])
      expect(submitted).toBe(1)
      expect(find().find((element) => element.type === Toast)?.props.tone).toBe('success')

      current = { ...current, draft: '', draftRev: 0, occurrences: [], attachmentIds: [] }
      drafted.length = 0
      render()
      select('restart')
      render()
      actions.addAttachments(['late-file'])
      click('menu.restartConfirm')
      expect(drafted).toEqual([])
      expect(submitted).toBe(1)
      actions.removeAttachment('late-file')

      current = { ...current, attachmentIds: ['file'] }
      render()
      select('shortcut')
      await new Promise((resolve) => setTimeout(resolve, 0))
      render()
      expect(drafted).toEqual([])
      expect(submitted).toBe(1)
      expect(find().find((element) => element.type === Toast)?.props.tone).toBe('success')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
