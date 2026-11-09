import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/host/index.ts'

interface InertHost {
  readonly ctx: Record<string, unknown>
  readonly registered: string[]
}

/** A host with the given subset of services and nothing else. */
function inertHost(services: Readonly<Record<string, unknown>>): InertHost {
  const registered: string[] = []
  const ctx = {
    get: (name: string) => services[name],
    on(name: string): () => void {
      registered.push(name)
      return () => {}
    },
    effect: (callback: () => () => void) => {
      callback()
      return () => {}
    },
  }
  return { ctx, registered }
}

function loadClient(): { apply?: (ctx: unknown) => void } {
  const packageDir = fileURLToPath(new URL('..', import.meta.url))
  const result = buildSync({
    stdin: {
      contents: `export * from './src/client/index.tsx'\n`,
      resolveDir: packageDir,
      sourcefile: 'workflows-inert-entry.tsx',
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    external: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
    logLevel: 'silent',
  })
  const output = result.outputFiles?.[0]
  if (output === undefined) throw new Error('the client source did not bundle')
  let registration:
    | { factory: (require: (id: string) => unknown) => { apply?: (ctx: unknown) => void } }
    | undefined
  const window = {
    __ModuleLoader__: {
      load(value: typeof registration): void {
        registration = value
      },
    },
  }
  new Function(
    'window',
    `window.__ModuleLoader__.load({
  id: 'workflows-inert',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${output.text}
    return module.exports;
  },
});`,
  )(window)
  if (registration === undefined) throw new Error('the client did not register')
  return registration.factory((id) => {
    if (id === 'react/jsx-runtime')
      return {
        jsx: (type: unknown, props: unknown) => ({ type, props }),
        jsxs: (type: unknown, props: unknown) => ({ type, props }),
        Fragment: Symbol('Fragment'),
      }
    if (id === 'react') {
      return {
        Component: class {},
        createContext: (value: unknown) => ({
          Provider: (props: unknown) => props,
          Consumer: () => null,
          _currentValue: value,
        }),
        createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
          type,
          props: { ...(props as Record<string, unknown>), children },
        }),
        forwardRef: (render: unknown) => render,
        memo: (component: unknown) => component,
        useCallback: (callback: unknown) => callback,
        useContext: (context: { _currentValue?: unknown }) => context?._currentValue,
        useEffect: () => {},
        useId: () => 'id',
        useLayoutEffect: () => {},
        useMemo: (factory: () => unknown) => factory(),
        useRef: (value: unknown) => ({ current: value }),
        useState: (initial: unknown) => [
          typeof initial === 'function' ? (initial as () => unknown)() : initial,
          () => {},
        ],
        useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
      }
    }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return { Tag: (props: Record<string, unknown>) => ({ type: 'span', props }) }
    }
    return {}
  })
}

describe('inert without host services', () => {
  it('registers nothing and logs one bounded diagnostic when Host services are missing', () => {
    const host = inertHost({})
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => apply(host.ctx as never)).not.toThrow()
    expect(host.registered).toEqual([])
    expect(errors).toHaveBeenCalledTimes(1)
    expect(String(errors.mock.calls[0]?.[0]).length).toBeLessThan(200)
    errors.mockRestore()
  })

  it('stays inert when only the filesystem service is missing and registers no route', () => {
    const routes: string[] = []
    const host = inertHost({
      agents: { get: () => undefined, list: () => [] },
      workingDirectory: { get: () => '/tmp' },
      connection: {
        fetch: {
          register: (route: { path: string }) => {
            routes.push(route.path)
            return () => {}
          },
        },
      },
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => apply(host.ctx as never)).not.toThrow()
    expect(host.registered).toEqual([])
    expect(routes).toEqual([])
    expect(errors).toHaveBeenCalledTimes(1)
    errors.mockRestore()
  })

  it('registers no Workflows tab when only the resource service is missing', () => {
    const module = loadClient()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const locales: string[] = []
    const slots: string[] = []
    expect(() =>
      module.apply?.({
        get: () => undefined,
        effect: (callback: () => () => void) => callback(),
        locale: {
          register: (namespace: string) => {
            locales.push(namespace)
            return () => {}
          },
          bind: () => () => 'label',
        },
        slots: {
          inject: (key: string, callback: () => () => void) => {
            slots.push(key)
            callback()
            return () => {}
          },
          register: () => () => {},
        },
      }),
    ).not.toThrow()
    expect(locales).toEqual([])
    expect(slots).toEqual([])
    expect(errors).toHaveBeenCalledTimes(1)
    errors.mockRestore()
  })

  it('stays inert with slots or locale missing independently while resources exist', () => {
    const module = loadClient()
    const cases = ['slots', 'locale'] as const
    for (const missing of cases) {
      const locales: string[] = []
      const slots: string[] = []
      const views: string[] = []
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      const locale = {
        register: (namespace: string) => {
          locales.push(namespace)
          return () => {}
        },
        bind: () => () => 'label',
      }
      const slotService = {
        inject: (key: string, callback: () => () => void) => {
          slots.push(key)
          callback()
          return () => {}
        },
        register: (options: { id: string }) => {
          views.push(options.id)
          return () => {}
        },
      }
      expect(() =>
        module.apply?.({
          get: () => ({}),
          effect: (callback: () => () => void) => callback(),
          ...(missing === 'locale' ? {} : { locale }),
          ...(missing === 'slots' ? {} : { slots: slotService }),
        }),
      ).not.toThrow()
      expect(locales).toEqual([])
      expect(slots).toEqual([])
      expect(views).toEqual([])
      expect(errors).toHaveBeenCalledTimes(1)
      expect(String(errors.mock.calls[0]?.[0]).length).toBeLessThan(200)
      errors.mockRestore()
    }
  })

  it('registers no Workflows tab without the conversation or locale services', () => {
    const module = loadClient()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      module.apply?.({ effect: (callback: () => () => void) => callback() }),
    ).not.toThrow()
    expect(errors).toHaveBeenCalledTimes(1)
    const registrations: string[] = []
    module.apply?.({
      effect: (callback: () => () => void) => callback(),
      slots: {
        inject: () => () => {},
        register: () => {
          registrations.push('view')
          return () => {}
        },
      },
    })
    expect(registrations).toEqual([])
    expect(errors).toHaveBeenCalledTimes(2)
    errors.mockRestore()
  })
})
