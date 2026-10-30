import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
import { apply, type BundleConfig, type SettledRunState } from '../lib/index.js'

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
  /** `git ls-files` answer: the git-visible worktree paths a test declares. */
  files: string[] = []
  fail = false
  /** Make the snapshot guard fail, so a task review falls back to the live worktree. */
  failSnapshot = false
  /** Runs before a call returns, so a test can mutate the worktree mid-digest. */
  beforeReturn?: (args: readonly string[]) => Promise<void> | void
  calls: string[][] = []

  run: GitRunner = async (args, cwd, _signal) => {
    this.calls.push([...args])
    if (this.beforeReturn !== undefined) await this.beforeReturn(args)
    if (this.fail) throw new Error('git is not available in this test workspace')
    const command = args[0] === '-C' ? args[2] : args[0] === '-c' ? 'commit-tree' : args[0]
    if (command === 'rev-parse') {
      return Buffer.from(args.includes('--verify') ? 'b'.repeat(40) : cwd)
    }
    if (command === 'check-ignore') {
      if (this.failSnapshot) throw new Error('git check-ignore failed (test)')
      return Buffer.alloc(0)
    }
    if (command === 'ls-files') {
      // `-u` asks for unmerged entries; the rest is the review input set.
      return args.includes('-u') ? Buffer.alloc(0) : Buffer.from(this.files.join('\0'))
    }
    if (command === 'write-tree') {
      // A deterministic tree that follows the fake worktree state, so a change
      // in status/diff/input set produces a new task digest.
      return Buffer.from(
        createHash('sha256')
          .update(`${this.status}\u0000${this.diff}\u0000${this.files.join('\u0000')}`)
          .digest('hex'),
      )
    }
    if (command === 'worktree') {
      const path = args[3] ?? ''
      if (args[1] === 'add') await mkdir(path, { recursive: true })
      if (args[1] === 'remove') await rm(path, { recursive: true, force: true })
      return Buffer.alloc(0)
    }
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
  private readonly startWaiters: Array<{ count: number; resolve: () => void }> = []
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

  /** Resolve once at least `count` target starts have begun. */
  waitForStarts(count: number): Promise<void> {
    if (this.startCalls >= count) return Promise.resolve()
    return new Promise((resolve) => this.startWaiters.push({ count, resolve }))
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
    for (const waiter of [...this.startWaiters]) {
      if (waiter.count > this.startCalls) continue
      this.startWaiters.splice(this.startWaiters.indexOf(waiter), 1)
      waiter.resolve()
    }
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

/** One `tools/pre-execute` decision, for the archive gate tests. */
export interface PreExecuteResult {
  kind: string
  reason?: string
  nextCalled: boolean
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
  /** Override the git runner, for example with the real one against a real repository. */
  runGit?: GitRunner
  agents?: FakeSubagents
  now?: () => Date
  /** Set false to exercise the engine path with no settlement observer. */
  observeSettlements?: boolean
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
  /** Terminal review-run states reported by the engine, in completion order. */
  readonly settledRuns: Array<{ runId: string; state: SettledRunState }> = []
  private readonly settlementWaiters = new Map<string, Array<(state: SettledRunState) => void>>()
  private readonly cwdByAgent: Record<string, string>

  constructor(options: HarnessOptions) {
    this.cwd = options.cwd
    this.agent = createAgent()
    this.subagents = options.agents ?? new FakeSubagents()
    this.git = options.git ?? new FakeGit()
    this.cwdByAgent = options.cwdByAgent ?? {}
    const events = this.events
    const cwdByAgent = this.cwdByAgent
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
      runGit: options.runGit ?? this.git.run,
      now: options.now ?? (() => new Date('2026-10-26T12:00:00.000Z')),
      ...(options.observeSettlements === false
        ? {}
        : { onRunSettled: (runId, state) => this.recordSettlement(runId, state) }),
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

  /** Await the engine's settlement signal, then require that state in the durable run file. */
  async waitForRun(runId: string, _agent: FakeAgent = this.agent): Promise<string> {
    const signalled =
      this.settledRuns.find((entry) => entry.runId === runId)?.state ??
      (await new Promise<SettledRunState>((resolve) => {
        const waiters = this.settlementWaiters.get(runId) ?? []
        waiters.push(resolve)
        this.settlementWaiters.set(runId, waiters)
      }))
    const file = join(this.cwd, '.dsh', 'delegation', 'runs', `${runId}.json`)
    const run = JSON.parse(await readFile(file, 'utf8')) as { state?: unknown }
    if (run.state !== signalled) {
      throw new Error(
        `review run ${runId} settled as ${signalled} but its run file reports state=${String(run.state)}`,
      )
    }
    return `- run ${runId}: state=${signalled}`
  }

  private recordSettlement(runId: string, state: SettledRunState): void {
    this.settledRuns.push({ runId, state })
    const waiters = this.settlementWaiters.get(runId)
    this.settlementWaiters.delete(runId)
    for (const resolve of waiters ?? []) resolve(state)
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

  /** Fire `tools/pre-execute` and report the decision plus whether next() ran. */
  async preExecute(
    name: string,
    args: unknown,
    agent: FakeAgent = this.agent,
  ): Promise<PreExecuteResult> {
    const handlers = this.events.get('tools/pre-execute') ?? []
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    let decision: unknown = { kind: 'allow' }
    for (const handler of handlers) {
      decision = await handler(
        {
          agent,
          arguments: args,
          callId: 'call-1',
          name,
          rootCallId: 'root-1',
          signal: new AbortController().signal,
          token: Symbol('token'),
        },
        next,
      )
    }
    const record = typeof decision === 'object' && decision !== null ? decision : {}
    return {
      kind: String((record as { kind?: unknown }).kind ?? 'allow'),
      ...(typeof (record as { reason?: unknown }).reason === 'string'
        ? { reason: (record as { reason: string }).reason }
        : {}),
      nextCalled: next.mock.calls.length > 0,
    }
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

  cwdFor(agent: FakeAgent = this.agent): string {
    return this.cwdByAgent[String(agent.session.id)] ?? this.cwd
  }

  /** Fire one `tools/result` with a tool name, arguments, and canonical result value. */
  async toolOutcome(
    name: string,
    args: unknown,
    value: unknown,
    agent: FakeAgent = this.agent,
    isError = false,
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

  /** A first-party `edit`/`write` result with the canonical before/after contents. */
  async writeResult(
    filePath: string,
    before: string | null,
    after: string,
    agent: FakeAgent = this.agent,
    name: 'edit' | 'write' = 'write',
  ): Promise<void> {
    const absolute = resolve(this.cwdFor(agent), filePath)
    await this.toolOutcome(name, { file_path: filePath }, { path: absolute, before, after }, agent)
  }

  /** A successful shell call; only its command text is evidence. */
  async shellResult(
    command: string,
    agent: FakeAgent = this.agent,
    isError = false,
  ): Promise<void> {
    await this.toolOutcome('pwsh', { command }, { output: '', exitCode: 0 }, agent, isError)
  }

  involvementPath(sessionId: string = this.agent.id): string {
    const name = createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
    return join(this.cwd, '.dsh', 'delegation', 'sessions', `${name}.json`)
  }

  async readInvolvement(sessionId: string = this.agent.id): Promise<InvolvementFile | undefined> {
    try {
      return JSON.parse(await readFile(this.involvementPath(sessionId), 'utf8')) as InvolvementFile
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
}

export interface InvolvementFile {
  session: string
  changes: Record<
    string,
    { created: boolean; specChanged: boolean; tasks: string[]; completed: boolean }
  >
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

/** The engine's stable task id: normalized task text, sha256, 16 hex chars. */
export function taskIdFor(text: string): string {
  return createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16)
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
