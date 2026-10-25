import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const packageName = '@dsh-setup/plugin-composer-clock'

interface LoadedEntry {
  id: string
  factory: (require: (id: string) => unknown) => Record<string, unknown>
}

interface Registration {
  options: Record<string, unknown>
  component: (props: object) => unknown
}

function loadClientBundle(): LoadedEntry {
  const file = join(packageDir, 'lib', 'client.js')
  if (!existsSync(file)) throw new Error('run `pnpm build` before this test')
  const captured: LoadedEntry[] = []
  const window = {
    __ModuleLoader__: {
      load(entry: LoadedEntry): void {
        captured.push(entry)
      },
    },
  }
  const run = new Function('window', readFileSync(file, 'utf8'))
  run(window)
  const entry = captured[0]
  if (entry === undefined) throw new Error('client bundle registered no module')
  return entry
}

function requireFromModuleTable(id: string): unknown {
  if (id === 'react/jsx-runtime') {
    return {
      Fragment: 'Fragment',
      jsx: (type: unknown, props: unknown) => ({ type, props }),
      jsxs: (type: unknown, props: unknown) => ({ type, props }),
    }
  }
  if (id === 'react') return {}
  throw new Error(`client bundle imported "${id}", which is not in the fake module table`)
}

describe('client bundle', () => {
  it('registers a factory whose id equals the package name', () => {
    const entry = loadClientBundle()
    expect(entry.id).toBe(packageName)
    expect(typeof entry.factory).toBe('function')
  })

  it('returns a plugin object that registers into the composer dock', () => {
    const pluginModule = loadClientBundle().factory(requireFromModuleTable)
    expect(pluginModule.inject).toEqual(['slots'])
    expect(typeof pluginModule.apply).toBe('function')

    const registrations: Registration[] = []
    const ctx = {
      slots: {
        inject(key: string, callback: () => void): void {
          expect(key).toBe('conversation.composer.dock')
          callback()
        },
        register(
          options: Record<string, unknown>,
          component: Registration['component'],
        ): () => void {
          registrations.push({ options, component })
          return () => {}
        },
      },
    }
    ;(pluginModule.apply as (value: unknown) => void)(ctx)

    expect(registrations).toHaveLength(1)
    const registration = registrations[0]
    expect(registration?.options.name).toBe('conversation.composer.dock')
    const node = registration?.component({})
    expect(node).toMatchObject({ type: 'span' })
  })

  it('ships the compiled host entry', () => {
    expect(existsSync(join(packageDir, 'lib', 'index.js'))).toBe(true)
  })
})
