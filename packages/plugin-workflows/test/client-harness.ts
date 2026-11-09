import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

/**
 * Load browser Client modules in the Node test runner. React and React Flow are
 * replaced by tiny stubs so a presentational component can be called and its
 * element tree inspected without a DOM; the real bundle is measured separately.
 */

export const packageDir = fileURLToPath(new URL('..', import.meta.url))

export type Element = { type: unknown; props: Record<string, unknown> }

const Fragment = Symbol('Fragment')

export function jsx(type: unknown, props: Record<string, unknown> | null): Element {
  return { type, props: props ?? {} }
}

class StubComponent {
  props: Record<string, unknown>
  state: Record<string, unknown> = {}

  constructor(props: Record<string, unknown>) {
    this.props = props
  }

  setState(next: Record<string, unknown>): void {
    this.state = { ...this.state, ...next }
  }
}

export interface LoadedClient {
  [key: string]: unknown
}

export function loadClientModules(
  modules: readonly string[],
  stubs: Record<string, Record<string, unknown>> = {},
): LoadedClient {
  const result = buildSync({
    stdin: {
      contents: modules.map((name) => `export * from './src/client/${name}'`).join('\n'),
      resolveDir: packageDir,
      sourcefile: 'client-test-entry.tsx',
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
      '@xyflow/react',
    ],
    logLevel: 'silent',
  })
  const output = result.outputFiles?.[0]
  if (output === undefined) throw new Error('the client modules did not bundle')
  interface Registration {
    factory: (require: (id: string) => unknown) => LoadedClient
  }
  let registration: Registration | undefined
  const window = {
    __ModuleLoader__: {
      load(value: Registration): void {
        registration = value
      },
    },
  }
  new Function(
    'window',
    `window.__ModuleLoader__.load({
  id: 'workflows-test',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${output.text}
    return module.exports;
  },
});`,
  )(window)
  if (registration === undefined) throw new Error('the modules did not register')
  return registration.factory((id) => {
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment }
    if (id === 'react') {
      return {
        Component: StubComponent,
        useEffect: () => {},
        useMemo: (factory: () => unknown) => factory(),
        useState: (initial: unknown) => [
          typeof initial === 'function' ? (initial as () => unknown)() : initial,
          () => {},
        ],
      }
    }
    if (id === '@xyflow/react') {
      return {
        Handle: (props: Record<string, unknown>) => jsx('handle', props),
        Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
        ReactFlow: (props: Record<string, unknown>) => jsx('reactflow', props),
      }
    }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return { Tag: (props: Record<string, unknown>) => jsx('tag', props) }
    }
    return stubs[id] ?? {}
  })
}

export function call(module: LoadedClient, name: string, props: Record<string, unknown>): unknown {
  const component = module[name]
  if (typeof component !== 'function') throw new Error(`${name} is not a component`)
  return (component as (props: Record<string, unknown>) => unknown)(props)
}

export function elements(node: unknown, found: Element[] = []): Element[] {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found)
    return found
  }
  const element = node as Element
  if (typeof element.type === 'function') {
    elements((element.type as (props: Record<string, unknown>) => unknown)(element.props), found)
    return found
  }
  if (element.type !== undefined && element.props !== undefined) {
    found.push(element)
    for (const value of Object.values(element.props)) elements(value, found)
  }
  return found
}

export function text(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (node === null || typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(text).join('')
  const element = node as Element
  if (typeof element.type === 'function') {
    return text((element.type as (props: Record<string, unknown>) => unknown)(element.props))
  }
  return text(element.props?.children)
}

/** Call an element's handler as React would with a synthetic event. */
export function fire(element: Element | undefined, handler: string, value?: unknown): void {
  const callback = element?.props[handler]
  if (typeof callback !== 'function') throw new Error(`no ${handler} handler`)
  ;(callback as (event: unknown) => void)({
    ...(value === undefined ? {} : { currentTarget: { value } }),
    key: value,
    preventDefault: () => {},
  })
}
