import { CHANGE_NAME } from './command-parse.js'
import type { Definition, Step } from './definitions.js'
import {
  collectEvidencePaths,
  type Evidence,
  type EvidenceContext,
  verifyEvidence,
} from './evidence.js'
import type { HumanQuestionService } from './executors.js'
import type { HostAuth } from './host-auth.js'
import { openRunCount, type WorkflowRun } from './runs.js'

/**
 * The model-facing `workflows` tool. It is a bounded control surface: list,
 * start an allowed definition, resume, status, host-verified evidence, cancel.
 * It never accepts a script, a definition body, an install, an adoption, a
 * receipt write, or a text claim.
 */

export const WORKFLOWS_TOOL_ACTIONS = [
  'list',
  'start',
  'resume',
  'status',
  'evidence',
  'cancel',
] as const
export type WorkflowsToolAction = (typeof WORKFLOWS_TOOL_ACTIONS)[number]

export interface WorkflowsToolRequest {
  readonly action: WorkflowsToolAction
  readonly definitionId?: string
  readonly runId?: string
  readonly stepId?: string
  /** The host resolves and verifies the declared evidence; text is never it. */
  readonly evidence?: { readonly kind: string; readonly ref: string }
}

export interface WorkflowsToolHost {
  readonly workspace: string
  readonly session: string
  readonly definitions: readonly Definition[]
  readonly auth: HostAuth
  readonly questions?: HumanQuestionService
  readonly maxRuns?: number
  readonly now?: () => number
  /** The host-owned starter; it persists the run before returning. */
  startRun(
    definition: Definition,
    at: number,
  ): Promise<{ readonly run: WorkflowRun; readonly firstStep: string }>
  resumeRun(
    runId: string,
    at: number,
  ): Promise<{ readonly run: WorkflowRun; readonly stepId: string }>
  cancelRun(runId: string, at: number): Promise<WorkflowRun>
  /** Every authenticated run in the workspace. */
  listRuns(): Promise<readonly WorkflowRun[]>
  /** One authenticated run in the workspace, or undefined. */
  readRun(runId: string): Promise<WorkflowRun | undefined>
  /** Trusted session observations the evidence verifier may consume. */
  evidenceContext?(run: WorkflowRun, step: Step): Partial<EvidenceContext>
}

function fail(message: string): never {
  throw new Error(`workflows: ${message}`)
}

function objectArgs(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('the arguments must be an object')
  }
  return value as Record<string, unknown>
}

/** Parse and validate the tool arguments; an unknown field is refused. */
export function parseWorkflowsToolArgs(value: unknown): WorkflowsToolRequest {
  const args = objectArgs(value)
  const allowed = new Set(['action', 'definitionId', 'runId', 'stepId', 'evidence'])
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) {
      fail(`unknown field "${key}"; the tool has no raw script or definition input`)
    }
  }
  const action = args.action
  if (
    typeof action !== 'string' ||
    !WORKFLOWS_TOOL_ACTIONS.includes(action as WorkflowsToolAction)
  ) {
    fail(`action must be one of: ${WORKFLOWS_TOOL_ACTIONS.join(', ')}`)
  }
  const text = (field: string): string | undefined => {
    const entry = args[field]
    if (entry === undefined) return undefined
    if (typeof entry !== 'string' || entry.trim() === '')
      fail(`${field} must be a non-empty string`)
    return entry
  }
  let evidence: WorkflowsToolRequest['evidence']
  if (args.evidence !== undefined) {
    const raw = objectArgs(args.evidence)
    if (Object.keys(raw).some((key) => key !== 'kind' && key !== 'ref')) {
      fail('evidence has unknown fields; pass {kind, ref}')
    }
    if (
      typeof raw.kind !== 'string' ||
      typeof raw.ref !== 'string' ||
      raw.kind === '' ||
      raw.ref === ''
    ) {
      fail('evidence needs a kind and a workspace-relative ref')
    }
    evidence = { kind: raw.kind, ref: raw.ref }
  }
  const definitionId = text('definitionId')
  const runId = text('runId')
  const stepId = text('stepId')
  return {
    action: action as WorkflowsToolAction,
    ...(definitionId === undefined ? {} : { definitionId }),
    ...(runId === undefined ? {} : { runId }),
    ...(stepId === undefined ? {} : { stepId }),
    ...(evidence === undefined ? {} : { evidence }),
  }
}

/** Collect the host-verified references of one contract, including all children. */
async function verifiedReferences(evidence: Evidence, context: EvidenceContext): Promise<string[]> {
  const refs: string[] = []
  const visit = async (entry: Evidence): Promise<void> => {
    if (entry.kind === 'all') {
      for (const child of entry.items) await visit(child)
      return
    }
    const checked = await verifyEvidence(entry, context)
    if (!checked.ok) return
    if (checked.evidence.path !== undefined) {
      refs.push(checked.evidence.path.replaceAll('\\', '/'))
    }
    if (checked.evidence.callId !== undefined) refs.push(checked.evidence.callId)
    if (typeof checked.evidence.answer === 'string') refs.push(checked.evidence.answer)
  }
  await visit(evidence)
  return refs
}

function bounded(text: string, max = 1200): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

async function confirmHighRisk(host: WorkflowsToolHost, title: string): Promise<boolean> {
  if (host.questions === undefined) return false
  const asked = await host.questions.ask({
    question: `Start the high-risk workflow "${title}"?`,
    accepted: ['yes'],
    timeoutAction: 'block',
  })
  return asked.timedOut !== true && (asked.answer ?? '').trim().toLowerCase() === 'yes'
}

function definitionById(host: WorkflowsToolHost, id: string): Definition {
  const definition = host.definitions.find((entry) => entry.id === id)
  if (definition === undefined) fail(`no definition "${id}" is installed`)
  return definition
}

/** The run must authenticate and belong to this session before it is changed. */
async function sessionRun(host: WorkflowsToolHost, runId: string): Promise<WorkflowRun> {
  const run = await host.readRun(runId)
  if (run === undefined) fail(`run "${runId}" is unsigned, modified, or unreadable`)
  if (run.session !== host.session) {
    fail(`run "${runId}" belongs to another session; it can be viewed but not changed here`)
  }
  return run
}

/** Execute one tool action. */
export async function executeWorkflowsTool(
  value: unknown,
  host: WorkflowsToolHost,
): Promise<string> {
  const request = parseWorkflowsToolArgs(value)
  const at = host.now?.() ?? Date.now()
  switch (request.action) {
    case 'list': {
      const lines = host.definitions.map(
        (definition) =>
          `- ${definition.id} (${definition.settings.risk}, ${definition.trigger.mode}, model start ${
            definition.settings.allowModelStart ? 'allowed' : 'refused'
          })`,
      )
      return bounded(lines.length === 0 ? 'no definitions are installed' : lines.join('\n'))
    }
    case 'start': {
      if (request.definitionId === undefined) fail('start needs a definitionId')
      if (!CHANGE_NAME.test(request.definitionId))
        fail('definitionId must be a plain id, not a script or path')
      const definition = definitionById(host, request.definitionId)
      if (!definition.settings.allowModelStart) {
        fail(
          `definition "${definition.id}" refuses a model start; the user must run /workflows run ${definition.id}`,
        )
      }
      const runs = await host.listRuns()
      const maxRuns = host.maxRuns ?? 20
      if (openRunCount(runs) >= maxRuns) {
        fail(`the run limit (${String(maxRuns)}) is reached; finish or cancel an open run first`)
      }
      if (definition.settings.risk === 'high' && !(await confirmHighRisk(host, definition.name))) {
        fail(`the high-risk start of "${definition.id}" needs a direct user yes; nothing started`)
      }
      const started = await host.startRun(definition, at)
      return `run ${started.run.id} started at step "${started.firstStep}"`
    }
    case 'resume': {
      if (request.runId === undefined) fail('resume needs a runId')
      await sessionRun(host, request.runId)
      const resumed = await host.resumeRun(request.runId, at)
      return `run ${request.runId} resumed at step "${resumed.stepId}"`
    }
    case 'status': {
      if (request.runId === undefined) fail('status needs a runId')
      const run = await host.readRun(request.runId)
      if (run === undefined) fail(`run "${request.runId}" is not authenticated`)
      const current = run.steps.find((step) => step.state === 'open' || step.state === 'blocked')
      return bounded(
        `run ${run.id} [${run.status}] ${run.definition}; next ${current?.id ?? 'end'}; ${run.steps
          .map((step) => `${step.id}:${step.state}`)
          .join(' ')}`,
      )
    }
    case 'evidence': {
      if (
        request.runId === undefined ||
        request.stepId === undefined ||
        request.evidence === undefined
      ) {
        fail('evidence needs a runId, a stepId, and {kind, ref}; a text claim is not evidence')
      }
      const run = await sessionRun(host, request.runId)
      const step = host.definitions
        .find((definition) => definition.id === run.definition)
        ?.steps.find((entry) => entry.id === request.stepId)
      if (step === undefined || step.evidence === undefined)
        fail('the step has no evidence contract')
      if (request.evidence.kind !== step.evidence.kind) {
        fail(`the evidence kind must be "${step.evidence.kind}"`)
      }
      const context: EvidenceContext = {
        workspace: host.workspace,
        values: run.context,
        ...(host.evidenceContext === undefined ? {} : host.evidenceContext(run, step)),
      }
      const checked = await verifyEvidence(step.evidence, context)
      if (!checked.ok) {
        fail(
          `the host verifier refused the evidence: ${checked.failure.reason} (${checked.failure.detail})`,
        )
      }
      // The submitted reference must be the evidence the host just verified.
      const ref = request.evidence.ref.replaceAll('\\', '/').replace(/^\.\//u, '')
      if (
        ref === '' ||
        ref.startsWith('/') ||
        /^[A-Za-z]:\//u.test(ref) ||
        ref.split('/').some((part) => part === '..')
      ) {
        fail(`the evidence reference "${request.evidence.ref}" is not workspace-relative`)
      }
      const accepted = new Set<string>()
      for (const path of collectEvidencePaths(step.evidence, context)) {
        accepted.add(path.replaceAll('\\', '/').replace(/^\.\//u, ''))
      }
      for (const childRef of await verifiedReferences(step.evidence, context)) {
        accepted.add(childRef)
      }
      if (checked.evidence.path !== undefined) {
        accepted.add(checked.evidence.path.replaceAll('\\', '/'))
      }
      if (checked.evidence.callId !== undefined) accepted.add(checked.evidence.callId)
      if (typeof checked.evidence.answer === 'string') accepted.add(checked.evidence.answer)
      if (!accepted.has(ref)) {
        fail(
          `the submitted reference "${request.evidence.ref}" is not the host-verified evidence for step "${request.stepId}"`,
        )
      }
      return `evidence verified for step "${request.stepId}"`
    }
    case 'cancel': {
      if (request.runId === undefined) fail('cancel needs a runId')
      await sessionRun(host, request.runId)
      await host.cancelRun(request.runId, at)
      return `run ${request.runId} cancelled`
    }
  }
}
