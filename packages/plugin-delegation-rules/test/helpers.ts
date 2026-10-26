import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SkillProvider } from '@deepseek-ai/dsh-skill'
import type {
  SubagentActivation,
  SubagentActivationSpec,
  SubagentCapabilities,
  SubagentProvider,
  SubagentResult,
} from '@deepseek-ai/dsh-subagent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { expect, vi } from 'vitest'
import { apply, type BundleConfig } from '../lib/index.js'

export type GitRunner = (
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
) => Promise<Buffer>

export type BundleConfigLike = BundleConfig

export interface RunRecord {
  provider: string
  label: string
  prompt: string
  cwd?: string
  agentOptions?: unknown
}

/** Programmable fixed-argument git for digest, worktree, and status paths. */
export class FakeGit {
  status = ''
  diff = ''
  fail = false
  calls: string[][] = []

  run: GitRunner = async (args, cwd, _signal) => {
    this.calls.push([...args])
    if (this.fail) throw new Error('git is not available in this test workspace')
    const command = args[0] === '-C' ? args[2] : args[0]
    if (command === 'rev-parse') return Buffer.from(cwd)
    if (command === 'status') return Buffer.from(this.status)
    if (command === 'diff') return Buffer.from(this.diff)
    return Buffer.alloc(0)
  }
}

function textOf(blocks: readonly ContentBlock[]): string {
  return blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
    .trim()
}

function digestIn(prompt: string): string {
  const match = /- Digest: ([0-9a-f]{64})/.exec(prompt)
  return match?.[1] ?? '0'.repeat(64)
}

export function passResult(): SubagentResult {
  return {
    output: [{ type: 'text', text: 'plain placeholder' }],
    stopReason: 'completed',
  }
}

/** Default fake target: echoes the prompt digest as a PASS verdict. */
export function passResponder(run: RunRecord): SubagentResult {
  const verdict = {
    digest: digestIn(run.prompt),
    verdict: 'PASS',
    findings: [],
  }
  const text = run.prompt.includes('- Digest:')
    ? `Reviewed.\n\n\`\`\`json\n${JSON.stringify(verdict)}\n\`\`\``
    : 'Answer with evidence and sources.'
  return { output: [{ type: 'text', text }], stopReason: 'completed' }
}

/** A target runtime fake: providers plus a recorder; never starts a real child. */
export class FakeSubagents {
  readonly providers = new Map<string, SubagentProvider>()
  readonly runs: RunRecord[] = []
  startCalls = 0
  /** Simulates a provider rejecting the start request before a child exists. */
  startError?: Error
  respond: (run: RunRecord) => SubagentResult | Promise<SubagentResult> = passResponder
  private readonly responders = new Map<
    string,
    (run: RunRecord) => SubagentResult | Promise<SubagentResult>
  >()

  addProvider(
    name: string,
    capabilities: Partial<SubagentCapabilities> = {},
    respond?: (run: RunRecord) => SubagentResult | Promise<SubagentResult>,
  ): void {
    const provider: SubagentProvider = {
      name,
      capabilities: {
        agentOptions: false,
        agentPreset: false,
        outputSchema: false,
        depthLimit: false,
        ...capabilities,
      },
      inheritsParentContext: true,
    }
    this.providers.set(name, provider)
    if (respond !== undefined) this.responders.set(name, respond)
  }

  list(): string[] {
    return [...this.providers.keys()]
  }

  getProvider(name: string): SubagentProvider | undefined {
    return this.providers.get(name)
  }

  async startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation> {
    this.startCalls += 1
    if (this.startError !== undefined) throw this.startError
    const run: RunRecord = {
      provider: spec.provider,
      label: spec.label,
      prompt: textOf(spec.request.prompt),
      ...(spec.request.cwd === undefined ? {} : { cwd: spec.request.cwd }),
      ...(spec.request.agentOptions === undefined
        ? {}
        : { agentOptions: spec.request.agentOptions }),
    }
    this.runs.push(run)
    const responder = this.responders.get(spec.provider) ?? this.respond
    const result = Promise.resolve().then(() => responder(run))
    return {
      childId: 'child-1' as never,
      result,
      dispose: async () => undefined,
    }
  }
}

export interface FakeAgent {
  id: string
  session: { id: string; header: { origin?: 'subagent' } }
  steer: ReturnType<typeof vi.fn>
}

export function createAgent(id = 'agent-1', origin?: 'subagent'): FakeAgent {
  return {
    id,
    session: { id, header: origin === undefined ? {} : { origin } },
    steer: vi.fn(),
  }
}

export function steerTexts(agent: FakeAgent): string[] {
  return agent.steer.mock.calls.map((call: unknown[]) => {
    const message = call[0] as { content: Array<{ text?: string }>; source: { kind: string } }
    expect(message.source.kind).toBe('delegation-rules')
    return message.content.map((block) => block.text ?? '').join('\n')
  })
}

export function toolResultText(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'text' in value) {
    return String((value as { text: unknown }).text)
  }
  throw new Error(`tool result has no text: ${JSON.stringify(value)}`)
}

export function runIdFrom(text: string): string {
  const match = /^run: (\S+)$/m.exec(text)
  if (match?.[1] === undefined) throw new Error(`tool result has no background run id:\n${text}`)
  return match[1]
}

export interface HarnessOptions {
  cwd: string
  /** Per-agent working directory override, keyed by the fake session id. */
  cwdByAgent?: Record<string, string>
  config?: BundleConfig
  git?: FakeGit
  agents?: FakeSubagents
  now?: () => Date
}

type ContextEvent = (...args: unknown[]) => unknown

/** Structural view of a skill provider; the DSH surface has extra optional overloads. */
export interface SkillProviderLike {
  name: string
  list: () => Promise<readonly SkillCandidateLike[]>
  get: (
    candidate: SkillCandidateLike,
    options: { signal?: AbortSignal },
  ) => Promise<{ content: string; name: string; description: string } | undefined>
}

export interface SkillCandidateLike {
  name: string
  description: string
  provider: string
  rank: number
  source: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  resourceBase?: { kind: string; path: string }
  locator?: unknown
}

/** One fake Cordis context plus the registrations this plugin made. */
export class Harness {
  readonly cwd: string
  readonly agent: FakeAgent
  readonly subagents: FakeSubagents
  readonly git: FakeGit
  readonly tools = new Map<string, ToolDefinition>()
  readonly events = new Map<string, ContextEvent[]>()
  readonly skillProviders: SkillProviderLike[] = []

  constructor(options: HarnessOptions) {
    this.cwd = options.cwd
    this.agent = createAgent()
    this.subagents = options.agents ?? new FakeSubagents()
    this.git = options.git ?? new FakeGit()
    const events = this.events
    const cwdByAgent = options.cwdByAgent ?? {}
    const ctx = {
      subagents: this.subagents,
      workingDirectory: { get: (session: { id: string }) => cwdByAgent[session.id] ?? this.cwd },
      tools: {
        register: (definition: ToolDefinition) => {
          this.tools.set(definition.name, definition)
          return () => undefined
        },
      },
      skills: {
        registerProvider: (create: () => SkillProvider) => {
          this.skillProviders.push(create() as unknown as SkillProviderLike)
          return () => undefined
        },
      },
      on: (name: string, handler: ContextEvent) => {
        const list = events.get(name) ?? []
        list.push(handler)
        events.set(name, list)
        return () => undefined
      },
    }
    apply(ctx as unknown as Context, options.config ?? {}, {
      runGit: this.git.run,
      now: options.now ?? (() => new Date('2026-10-26T12:00:00.000Z')),
    })
  }

  async callTool(name: string, args: unknown, agent: FakeAgent = this.agent): Promise<unknown> {
    const tool = this.tools.get(name)
    if (tool === undefined) throw new Error(`tool ${name} is not registered`)
    return tool.execute(args, {
      agent: agent as unknown as Agent,
      signal: new AbortController().signal,
    } as never)
  }

  /** Tool result text for the three delegation tools. */
  async toolText(name: string, args: unknown, agent: FakeAgent = this.agent): Promise<string> {
    return toolResultText(await this.callTool(name, args, agent))
  }

  /** Run a review delegate and return its background run id. */
  async startReview(args: unknown, agent: FakeAgent = this.agent): Promise<string> {
    return runIdFrom(await this.toolText('delegate', args, agent))
  }

  /** Poll the durable run file until the run reaches a terminal state. */
  async waitForRun(runId: string, _agent: FakeAgent = this.agent): Promise<string> {
    const file = join(this.cwd, '.dsh', 'delegation', 'runs', `${runId}.json`)
    for (let attempt = 0; attempt < 400; attempt += 1) {
      try {
        const run = JSON.parse(await readFile(file, 'utf8')) as { state?: unknown }
        const state = String(run.state)
        if (state === 'completed' || state === 'failed' || state === 'discarded') {
          return `- run ${runId}: state=${state}`
        }
      } catch {
        // The run file is not written yet; keep polling.
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`review run ${runId} did not settle`)
  }

  private async fire(name: string, args: unknown[]): Promise<void> {
    for (const handler of this.events.get(name) ?? []) {
      await handler(...args)
    }
  }

  async preStep(turn = 1, agent: FakeAgent = this.agent): Promise<void> {
    const decision = { kind: 'enter', messages: [] }
    const next = vi.fn(async () => decision)
    await this.fire('agent/pre-step', [
      { agent, turn, step: 1, messages: [], signal: new AbortController().signal },
      next,
    ])
    expect(next).toHaveBeenCalledTimes(1)
  }

  async turnStopping(turn = 1, agent: FakeAgent = this.agent): Promise<void> {
    await this.fire('agent/turn-stopping', [{ agent, turn, signal: new AbortController().signal }])
  }

  async toolResult(isError: boolean, agent: FakeAgent = this.agent): Promise<void> {
    await this.fire('tools/result', [
      {
        agent,
        arguments: {},
        callId: 'call-1',
        signal: new AbortController().signal,
      },
      { isError },
    ])
  }
}

export async function makeWorkspace(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-delegation-'))
  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true })
    },
  }
}

export interface TaskFixture {
  number: string
  text: string
  checked?: boolean
}

/** Write a minimal review-ready OpenSpec change into `root/openspec/changes/<name>`. */
export async function writeChange(
  root: string,
  name: string,
  tasks: TaskFixture[],
  spec = '# Spec\n\nA requirement.\n',
): Promise<string> {
  const dir = join(root, 'openspec', 'changes', name)
  await mkdir(join(dir, 'specs', 'capability'), { recursive: true })
  await writeFile(join(dir, 'proposal.md'), '# Proposal\n\nWhy.\n', 'utf8')
  await writeFile(join(dir, 'design.md'), '# Design\n\nDecisions.\n', 'utf8')
  const body = tasks
    .map((task) => `- [${task.checked === true ? 'x' : ' '}] ${task.number} ${task.text}`)
    .join('\n')
  await writeFile(join(dir, 'tasks.md'), `# Tasks\n\n${body}\n`, 'utf8')
  await writeFile(join(dir, 'specs', 'capability', 'spec.md'), spec, 'utf8')
  return dir
}

/** A useful default config: two Codex targets, the shipped rule shapes. */
export function defaultTestConfig(overrides: Partial<BundleConfig> = {}): BundleConfig {
  return {
    targets: {
      codex: { provider: 'codex-subagent' },
      'codex-write': { provider: 'codex-subagent-write', write: true },
    },
    rules: [
      {
        id: 'spec-review',
        when: 'spec-ready',
        to: 'codex',
        contract: 'review',
        phase: 'spec',
        scope: 'whole',
        gate: 'strict',
        instruction: 'bundled:review-spec',
      },
      {
        id: 'task-review',
        when: 'spec-task-ready',
        to: 'codex',
        contract: 'review',
        scope: 'task',
        gate: 'strict',
        instruction: 'bundled:review-task',
      },
      { id: 'task-progress', when: 'implementation-work', contract: 'note', gate: 'strict' },
    ],
    ...overrides,
  }
}
