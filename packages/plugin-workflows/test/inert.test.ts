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
        useEffect: () => {},
        useState: (initial: unknown) => [
          typeof initial === 'function' ? (initial as () => unknown)() : initial,
          () => {},
        ],
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

  it('stays inert when only the filesystem service is missing', () => {
    const host = inertHost({
      agents: { get: () => undefined, list: () => [] },
      workingDirectory: { get: () => '/tmp' },
      connection: { fetch: { register: () => () => {} } },
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => apply(host.ctx as never)).not.toThrow()
    expect(host.registered).toEqual([])
    expect(errors).toHaveBeenCalledTimes(1)
    errors.mockRestore()
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
