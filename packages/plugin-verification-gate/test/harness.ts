import type { Context } from '@deepseek-ai/cordis'
import { apply, type Config } from '../lib/index.js'

/**
 * Test doubles for the verification gate: a fake agent that records steering
 * and notices, and a fake Cordis context that records the event names the
 * plugin subscribes to. Only the built `lib/index.js` is imported, so every
 * behaviour test also proves the emitted Host entry works.
 */

export interface FakeAgent {
  id: string
  session: { id: string; header: { origin?: 'subagent' } }
  steers: unknown[]
  injected: unknown[]
  steer(message: unknown): void
  inject(message: unknown): void
}

export function createAgent(origin?: 'subagent'): FakeAgent {
  const steers: unknown[] = []
  const injected: unknown[] = []
  return {
    id: 'agent-1',
    session: { id: 'agent-1', header: origin === undefined ? {} : { origin } },
    steers,
    injected,
    steer(message: unknown): void {
      steers.push(message)
    },
    inject(message: unknown): void {
      injected.push(message)
    },
  }
}

type ContextEvent = (...args: unknown[]) => unknown

export interface WriteOptions {
  isError?: boolean
  /** Result value overrides; omitted keeps the canonical `{ path }`. */
  value?: unknown
}

export interface ShellOptions {
  isError?: boolean
  tool?: 'pwsh' | 'bash'
}

/** Canonical foreground shell result, matching the installed shell tool's output schema. */
export function shellResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'foreground',
    cwd: 'repo',
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 120_000,
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
    ...overrides,
  }
}

/** Text of one steering or notice message. */
export function messageText(message: unknown): string {
  const content =
    (message as { content?: readonly { type?: string; text?: string }[] }).content ?? []
  return content.map((block) => block.text ?? '').join('\n')
}

/** Source kind of one steering or notice message. */
export function messageSourceKind(message: unknown): unknown {
  return (message as { source?: { kind?: unknown } }).source?.kind
}

export class Harness {
  readonly agent: FakeAgent
  readonly events = new Map<string, ContextEvent[]>()
  readonly eventNames: string[] = []

  constructor(config?: Config, agent: FakeAgent = createAgent()) {
    this.agent = agent
    const events = this.events
    const ctx = {
      on: (name: string, handler: ContextEvent) => {
        this.eventNames.push(name)
        const list = events.get(name) ?? []
        list.push(handler)
        events.set(name, list)
        return () => undefined
      },
    }
    apply(ctx as unknown as Context, config)
  }

  /** Fire one recorded event; the plugin's listeners are synchronous. */
  async fire(name: string, args: unknown[]): Promise<void> {
    for (const handler of this.events.get(name) ?? []) await handler(...args)
  }

  async preStep(turn = 1, agent: FakeAgent = this.agent): Promise<void> {
    await this.fire('agent/pre-step', [
      { agent, turn, step: 1, messages: [], signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [] }),
    ])
  }

  async stop(turn = 1, agent: FakeAgent = this.agent): Promise<void> {
    await this.fire('agent/turn-stopping', [{ agent, turn, signal: new AbortController().signal }])
  }

  /** One successful or failed `write` result whose canonical value carries the path. */
  async write(
    path: string,
    options: WriteOptions = {},
    agent: FakeAgent = this.agent,
  ): Promise<void> {
    await this.toolOutcome(
      'write',
      { file_path: path },
      options.value ?? { path },
      options.isError ?? false,
      agent,
    )
  }

  /** One successful or failed `edit` result whose canonical value carries the path. */
  async edit(
    path: string,
    options: WriteOptions = {},
    agent: FakeAgent = this.agent,
  ): Promise<void> {
    await this.toolOutcome(
      'edit',
      { file_path: path },
      options.value ?? { path },
      options.isError ?? false,
      agent,
    )
  }

  /** One shell result; `value` is the canonical result value the tool returns. */
  async shell(
    command: string,
    value: unknown,
    options: ShellOptions = {},
    agent: FakeAgent = this.agent,
  ): Promise<void> {
    await this.toolOutcome(
      options.tool ?? 'pwsh',
      { command },
      value,
      options.isError ?? false,
      agent,
    )
  }

  async toolOutcome(
    name: string,
    args: unknown,
    value: unknown,
    isError: boolean,
    agent: FakeAgent = this.agent,
  ): Promise<void> {
    await this.fire('tools/result', [
      {
        agent,
        arguments: args,
        callId: 'call-1',
        name,
        rootCallId: 'root-1',
        signal: new AbortController().signal,
        token: Symbol('token'),
      },
      { isError, value, content: [] },
    ])
  }

  steerTexts(): string[] {
    return this.agent.steers.map(messageText)
  }

  noticeTexts(): string[] {
    return this.agent.injected.map(messageText)
  }
}
