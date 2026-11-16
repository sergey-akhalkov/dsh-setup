import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import { apply as applyDelegation } from '../../plugin-delegation-rules/src/host/index.ts'
import { currentSpecDigest } from '../src/host/evidence.ts'
import { apply } from '../src/host/index.ts'
import { writeInvolvement } from '../src/host/involvement.ts'

/**
 * The composed Release A host: the delegation row and the workflows row mounted
 * from the generated setup patch on one fake host. `openComposed` seeds a
 * current whole-spec PASS so a test isolates the gate it exercises, and the
 * caller drives the real pre-execute chain with `callTool` and the real
 * turn-close listeners with `closeTurn`.
 */

type Listener = (...args: unknown[]) => unknown

interface PatchRow {
  id?: string
  disabled?: boolean
  config?: Record<string, unknown>
}

interface Activation {
  readonly rule: string
  readonly prompt: string
}

interface Steer {
  readonly kind: string
  readonly text: string
}

export interface FakeHost {
  readonly ctx: Record<string, unknown>
  readonly agent: Record<string, unknown>
  readonly watch: Array<() => void>
  readonly activations: Activation[]
  readonly steers: Steer[]
  readonly tools: Map<string, ToolLike>
  emit(name: string, ...args: unknown[]): Promise<unknown>
  /** Run one model tool through the real pre-execute middleware chain. */
  callTool(name: string, args: unknown): Promise<unknown>
}

interface ToolLike {
  readonly name: string
  execute(
    args: unknown,
    exec: { agent: unknown; callId: string; signal: AbortSignal },
  ): Promise<unknown>
}

export const KEY = 'c'.repeat(64)
export const SESSION = 'session-1'
export const CHANGE = 'auth'
const REPO = join(import.meta.dirname, '..', '..', '..')

/** The composed config of one setup row: its last patch entry with a config. */
export async function composedConfig(id: string): Promise<Record<string, unknown>> {
  const text = await readFile(join(REPO, 'packages', 'setup', 'cordis.patch.yml'), 'utf8')
  const parsed = parse(text) as Array<{ insert?: PatchRow[] } | PatchRow>
  const rows = parsed.flatMap((entry) => ('insert' in entry ? (entry.insert ?? []) : []))
  const overrides = parsed.filter((entry): entry is PatchRow => !('insert' in entry))
  const last = [...rows, ...overrides]
    .filter((row) => row.id === id)
    .filter((row) => row.config !== undefined)
    .at(-1)
  if (last?.config === undefined) throw new Error(`row "${id}" has no composed config`)
  return last.config
}

export function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const started = Date.now()
  return (async () => {
    while (!(await check())) {
      if (Date.now() - started > timeoutMs) throw new Error('the composed profile did not settle')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  })()
}

export async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * One host context carrying both runtimes' services: the delegation plugin
 * reads its direct properties, the workflows plugin its `get` services.
 */
export function fakeHost(workspace: string): FakeHost {
  const listeners = new Map<string, Listener[]>()
  const provided = new Map<string, unknown>()
  const watch: Array<() => void> = []
  const activations: Activation[] = []
  const steers: Steer[] = []
  const tools = new Map<string, ToolLike>()
  const toolsService = {
    register(definition: ToolLike) {
      tools.set(definition.name, definition)
      return () => undefined
    },
    get(name: string) {
      return tools.get(name)
    },
  }
  const subagents = {
    getProvider(provider: string) {
      return provider === 'codex-subagent'
        ? { name: provider, capabilities: { agentOptions: true } }
        : undefined
    },
    async startActivation(spec: { prompt: ReadonlyArray<{ readonly text: string }> }) {
      const prompt = spec.prompt.map((block) => block.text).join('\n')
      const digest = /- Digest: ([a-f0-9]{64})/u.exec(prompt)?.[1] ?? ''
      const rule = /- Rule: ([a-z0-9-]+)/u.exec(prompt)?.[1] ?? ''
      activations.push({ rule, prompt })
      return {
        childId: `child-${String(activations.length)}`,
        result: Promise.resolve({
          output: [
            {
              type: 'text' as const,
              text: `\`\`\`json\n${JSON.stringify({ digest, verdict: 'PASS', findings: [] })}\n\`\`\``,
            },
          ],
          stopReason: 'completed',
        }),
        dispose: async () => undefined,
      }
    },
  }
  const agent = {
    id: SESSION,
    session: { id: SESSION, header: { origin: 'root' } },
    ctx: { on: () => () => undefined },
    steer(message: {
      readonly content?: ReadonlyArray<{ readonly text?: string }>
      readonly source?: { readonly kind?: string }
    }) {
      steers.push({
        kind: message.source?.kind ?? '',
        text: (message.content ?? []).map((block) => block.text ?? '').join('\n'),
      })
    },
    inject: () => undefined,
  }
  const services: Record<string, unknown> = {
    agents: { get: (id: string) => (id === SESSION ? agent : undefined), list: () => [agent] },
    workingDirectory: { get: () => workspace },
    fs: {
      resolve: async (path: string) => ({ targetKey: path }),
      watch: async (_target: unknown, changed: (error?: Error) => void) => {
        watch.push(() => changed())
        return async () => undefined
      },
    },
    connection: { fetch: { register: () => () => undefined } },
    subagents,
    tools: toolsService,
  }
  const ctx: Record<string, unknown> = {
    subagents,
    workingDirectory: services.workingDirectory,
    tools: toolsService,
    skills: { registerProvider: () => () => undefined },
    get(name: string) {
      return provided.has(name) ? provided.get(name) : services[name]
    },
    provide(name: string, value: unknown) {
      provided.set(name, value)
      return () => provided.delete(name)
    },
    on(name: string, listener: Listener) {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => undefined
    },
    effect(work: () => unknown) {
      const dispose = work()
      return () => {
        if (typeof dispose === 'function') (dispose as () => void)()
      }
    },
  }
  const emit = async (name: string, ...args: unknown[]): Promise<unknown> => {
    let result: unknown
    for (const listener of [...(listeners.get(name) ?? [])]) result = await listener(...args)
    return result
  }
  let toolCalls = 0
  const callTool = async (name: string, args: unknown): Promise<unknown> => {
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`no tool "${name}" is registered`)
    const chain = [...(listeners.get('tools/pre-execute') ?? [])]
    const callId = `composed-call-${String(++toolCalls)}`
    const exec = { agent, callId, name, arguments: args }
    const step = async (index: number): Promise<unknown> => {
      const listener = chain[index]
      if (listener === undefined) {
        return await tool.execute(args, {
          agent,
          callId,
          signal: new AbortController().signal,
        })
      }
      return await listener(exec, () => step(index + 1))
    }
    return await step(0)
  }
  return { ctx, agent, watch, activations, steers, tools, emit, callTool }
}

export function closeTurn(host: FakeHost, turn: number): Promise<unknown> {
  return host.emit('agent/turn-stopping', {
    agent: host.agent,
    turn,
    signal: new AbortController().signal,
  })
}

export async function openComposed(
  workspace: string,
  gates: Record<string, boolean>,
  options: {
    seedInvolvement?: boolean
    dropProgressNoteRule?: boolean
    /** The change the seeded involvement attributes; defaults to `CHANGE`. */
    change?: string
    /** The session's directory when it is nested inside the OpenSpec workspace. */
    sessionDir?: string
    /** Extra legacy rules on top of the composed row, such as lane-boundary. */
    extraRules?: Array<Record<string, unknown>>
    /** Turn the composed task-review rule off so the workflows runtime owns it. */
    disableTaskReviewRule?: boolean
  } = {},
): Promise<FakeHost> {
  const change = options.change ?? CHANGE
  process.env.DSH_WORKFLOWS_HOST_KEY = KEY
  const delegation = await composedConfig('dsh-setup-delegation-rules')
  const workflows = await composedConfig('dsh-setup-workflows')
  const host = fakeHost(options.sessionDir ?? workspace)
  // A worker-start tool must be visible for the legacy lane gate to act.
  ;(host.ctx.tools as { register(definition: unknown): unknown }).register({
    name: 'subagent',
    execute: async () => ({ text: 'started' }),
  })
  // A progress switch with no covering note rule cannot steer, so the resolved
  // legacy signal is off even while the raw switch is on.
  const composedRules = options.dropProgressNoteRule
    ? (delegation.rules as Array<Record<string, unknown>>).filter(
        (rule) => !(rule.when === 'implementation-work' && rule.contract === 'note'),
      )
    : (delegation.rules as Array<Record<string, unknown>>)
  const rules = [...composedRules, ...(options.extraRules ?? [])].map((rule) =>
    options.disableTaskReviewRule === true &&
    rule.when === 'spec-task-ready' &&
    rule.contract === 'review' &&
    rule.scope === 'task'
      ? { ...rule, gate: 'none' }
      : rule,
  )
  applyDelegation(host.ctx as never, { ...delegation, rules, gates } as never)
  apply(host.ctx as never, workflows as never)
  await waitFor(() => host.watch.length > 0)
  if (options.seedInvolvement !== false) {
    // Both runtimes need the session attributed to the change.
    const legacyName = createHash('sha256').update(SESSION).digest('hex').slice(0, 16)
    await mkdir(join(workspace, '.dsh', 'delegation', 'sessions'), { recursive: true })
    await writeFile(
      join(workspace, '.dsh', 'delegation', 'sessions', `${legacyName}.json`),
      JSON.stringify({
        session: SESSION,
        changes: { [change]: { created: true, specChanged: true, tasks: [], completed: false } },
      }),
      'utf8',
    )
    await writeInvolvement(workspace, SESSION, [change])
  }
  // A current whole-spec PASS settles the owned spec-review run on this close
  // so only the two gates under test decide.
  const specDigest = await currentSpecDigest(workspace, change)
  if (specDigest !== undefined) {
    const records = join(workspace, '.dsh', 'workflows', 'records', 'spec-review', change)
    await mkdir(records, { recursive: true })
    await writeFile(
      join(records, 'spec.json'),
      JSON.stringify({
        definition: 'spec-review',
        rule: 'spec-review',
        change,
        phase: 'spec',
        scope: 'whole',
        digest: specDigest,
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        time: '2026-11-14T10:00:00.000Z',
      }),
      'utf8',
    )
  }
  await host.emit(
    'agent/pre-step',
    {
      agent: host.agent,
      turn: 1,
      step: 1,
      messages: [],
      signal: new AbortController().signal,
      modelSelection: { provider: 'p', model: 'm' },
    },
    async () => ({ kind: 'continue' }),
  )
  return host
}
