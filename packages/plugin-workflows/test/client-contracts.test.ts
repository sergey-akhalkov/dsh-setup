import { describe, expect, it } from 'vitest'
import { openNew } from '../src/client/editor.ts'
import { ENGINE_GATES } from '../src/client/gates.ts'
import { type GraphDefinition, nodeIdOf } from '../src/client/graph.ts'
import { EN } from '../src/client/locale.ts'
import { reviewContract } from '../src/client/review-contract.ts'
import { call, elements, loadClientModules, shallowRender, text } from './client-harness.ts'

/**
 * Task 3.1/3.2 evidence: a review step renders its read-only contract in the
 * inspector and on the workflow page, and each engine-owned gate renders as one
 * read-only contract card outside every definition surface.
 */

const ui = loadClientModules(['overview.tsx', 'properties.tsx', 'rail.tsx'])

const translate = (key: string): string => key
const english = (key: string): string => EN[key] ?? key

const RECORD_PATH = '.dsh/workflows/records/spec-review/{name}/spec.json'

const REVIEW_DEFINITION: GraphDefinition = {
  v: 1,
  id: 'spec-review',
  name: 'Whole-spec review',
  version: 1,
  trigger: { kind: 'turn.stopping', match: {}, mode: 'active', dedupe: 'none' },
  settings: {
    allowModelStart: false,
    risk: 'low',
    gateOwnership: 'own',
    maxBlocks: 3,
    allowIntent: false,
    gate: 'review',
  },
  steps: [
    {
      id: 'review',
      title: 'Whole-spec review',
      executor: 'review',
      prompt: 'Review the change against its delta spec.',
      review: { target: 'codex', instruction: 'review-spec', scope: 'whole', phase: 'spec' },
      evidence: {
        kind: 'record',
        rule: 'spec-review',
        change: '{name}',
        scope: 'whole',
        phase: 'spec',
        verdicts: ['PASS', 'ERROR'],
        digest: 'current',
        path: RECORD_PATH,
      },
      next: 'end',
      blockTurnClose: true,
    },
  ],
}

describe('review contract view', () => {
  it('derives the instruction, scope, digest scope, and record path', () => {
    const step = REVIEW_DEFINITION.steps[0]
    if (step === undefined) throw new Error('the review fixture has no step')
    expect(reviewContract(REVIEW_DEFINITION.id, step)).toMatchObject({
      instruction: 'review-spec',
      promptKey: 'review.prompt.reviewSpec',
      scope: 'whole',
      phase: 'spec',
      recordPath: RECORD_PATH,
    })
    // Task scope is always phase task and uses the frozen-snapshot task path.
    const task = reviewContract('task-review', {
      executor: 'review',
      review: { instruction: 'review-task', scope: 'task' },
      evidence: { kind: 'record' },
    })
    expect(task).toMatchObject({
      instruction: 'review-task',
      promptKey: 'review.prompt.reviewTask',
      scope: 'task',
      recordPath: '.dsh/workflows/records/task-review/{name}/tasks/{taskId}.json',
    })
    expect(task?.phase).toBe('task')
    const defaults = reviewContract('spec-review', {
      executor: 'review',
      review: { target: 'codex', instruction: 'review-spec', scope: 'whole' },
    })
    expect(defaults?.phase).toBe('spec')
    expect(EN['review.verdictSchema.text']).toContain('PASS | FINDINGS')
    expect(EN['review.verdictSchema.text']).toContain('P0 | P1')
    expect(EN['review.verdictSchema.text']).not.toContain('P2')
    // A non-review executor has no contract; a malformed one still displays the dash.
    expect(reviewContract('x', { executor: 'main' })).toBeUndefined()
    expect(reviewContract('x', { executor: 'review' })).toMatchObject({
      instruction: '—',
      scope: 'whole',
    })
  })
})

describe('review contract surface', () => {
  it('renders the contract in the inspector with no editable verdict field', () => {
    const tree = call(ui, 'PropertyPanel', {
      state: openNew(REVIEW_DEFINITION),
      selected: nodeIdOf('review'),
      t: english,
      onDefinitionPatch: () => {},
      onPatch: () => {},
      onConnect: () => {},
      onDelete: () => {},
      onRename: () => {},
    })
    const rendered = elements(shallowRender(tree))
    const card = rendered.find((element) => element.props['data-group'] === 'review-contract')
    expect(card).toBeDefined()
    const body = text(card)
    expect(body).toContain(EN['review.contract'])
    expect(body).toContain('review-spec')
    expect(body).toContain(EN['review.prompt.reviewSpec'])
    expect(body).toContain('whole')
    expect(body).toContain('spec')
    expect(body).toContain(EN['review.digest.whole'])
    expect(body).toContain(EN['review.verdictSchema.text'])
    expect(body).toContain(EN['review.reuse.text'])
    expect(body).toContain(RECORD_PATH)
    // Display only: no input, textarea, select, checkbox, or button edits the card.
    const controls = elements(card).filter((element) =>
      ['input', 'textarea', 'select', 'checkbox', 'button'].includes(element.type as string),
    )
    expect(controls).toEqual([])
    // The settings card names the declared gate identity read-only.
    const identity = rendered.find((element) => element.props['data-gate-identity'] === 'review')
    expect(identity).toBeDefined()
    expect(text(identity)).toBe('review')
    // The newer executor keeps its own value in the closed executor select.
    const executor = rendered.find(
      (element) => element.type === 'select' && element.props['aria-label'] === 'Executor',
    )
    expect(executor?.props.value).toBe('review')
    expect(elements(executor).some((option) => option.props.value === 'review')).toBe(true)
  })

  it('renders the contract on the read-only page beside the ordered step table', () => {
    const page = call(ui, 'WorkflowPage', {
      definitionId: REVIEW_DEFINITION.id,
      phase: 'ready',
      document: REVIEW_DEFINITION,
      t: english,
      onBack: () => {},
      onOpenRun: () => {},
      onLoadRuns: () => {},
      onLoadHistory: () => {},
      onRetry: () => {},
    })
    const rendered = elements(shallowRender(page))
    const card = rendered.find((element) => element.props['data-contract'] === 'review')
    expect(card).toBeDefined()
    const body = text(card)
    expect(body).toContain('review-spec')
    expect(body).toContain(EN['review.prompt.reviewSpec'])
    expect(body).toContain(EN['review.digest.whole'])
    expect(body).toContain(EN['review.verdictSchema.text'])
    expect(body).toContain(EN['review.reuse.text'])
    expect(body).toContain(RECORD_PATH)
    // The canvas stays read-only and the ordered step table remains the fallback.
    const flow = rendered.find((element) => element.type === 'reactflow')
    expect(flow?.props.nodesDraggable).toBe(false)
    expect(flow?.props.nodesConnectable).toBe(false)
    expect(rendered.some((element) => element.props['data-step'] === 'review')).toBe(true)
    // No engine gate appears on a definition page.
    const pageText = text(shallowRender(page))
    for (const gate of ENGINE_GATES) expect(pageText).not.toContain(gate.gate)
  })
})

describe('engine-owned gate cards', () => {
  const definitions = [
    {
      id: 'change-intake',
      name: 'OpenSpec change intake',
      version: 1,
      trigger: { kind: 'tool.pre-execute', mode: 'active', match: {} },
    },
  ]

  it('renders one read-only contract card per gate and no gate definition', () => {
    const tree = call(ui, 'WorkflowOverview', {
      definitions,
      triggers: [],
      runs: [],
      t: english,
      onOpen: () => {},
    })
    const rendered = elements(shallowRender(tree))
    const cards = rendered.filter((element) => typeof element.props['data-gate'] === 'string')
    expect(cards.map((element) => element.props['data-gate'])).toEqual(
      ENGINE_GATES.map((gate) => gate.gate),
    )
    for (const [index, gate] of ENGINE_GATES.entries()) {
      const body = text(cards[index])
      expect(body).toContain(EN[gate.titleKey])
      expect(body).toContain(EN[gate.triggerKey])
      expect(body).toContain(EN[gate.evidenceKey])
      expect(body).toContain(EN[gate.recordKey])
      expect(body).toContain(EN[gate.steerKey])
      expect(elements(cards[index]).some((element) => element.type === 'button')).toBe(false)
    }
    // No gate leaks into a definition row or the ordered step table.
    const rows = rendered.filter((element) => element.props['data-workflow'] !== undefined)
    expect(rows.map((row) => row.props['data-workflow'])).toEqual(['change-intake'])
    for (const row of rows) {
      for (const gate of ENGINE_GATES) expect(text(row)).not.toContain(gate.gate)
    }
    expect(rendered.some((element) => element.props['data-step'] !== undefined)).toBe(false)
  })

  it('keeps the definition rail free of gate entries', () => {
    const rail = call(ui, 'WorkflowRail', {
      definitions: [
        {
          id: 'spec-review',
          name: 'Whole-spec review',
          version: 1,
          stepCount: 1,
          source: 'shipped',
          revision: null,
        },
      ],
      t: translate,
      onOpen: () => {},
      onTrigger: () => {},
      onExecutor: () => {},
    })
    const railText = text(shallowRender(rail))
    const rows = elements(shallowRender(rail)).filter(
      (element) => element.props['data-definition'] !== undefined,
    )
    // The rail lists installed definitions only; a gate is never one.
    expect(rows.map((row) => row.props['data-definition'])).toEqual(['spec-review'])
    for (const gate of ENGINE_GATES) expect(railText).not.toContain(gate.gate)
  })
})

describe('contract copy', () => {
  it('names every review and gate string in the locale', () => {
    for (const gate of ENGINE_GATES) {
      for (const key of [
        gate.titleKey,
        gate.triggerKey,
        gate.evidenceKey,
        gate.recordKey,
        gate.steerKey,
      ]) {
        expect(EN[key], key).toBeTypeOf('string')
      }
    }
    for (const key of [
      'review.contract',
      'review.contracts',
      'review.hint',
      'review.instruction',
      'review.prompt',
      'review.scope',
      'review.phase',
      'review.digestScope',
      'review.verdictSchema',
      'review.reuse',
      'review.record',
      'review.digest.whole',
      'review.digest.task',
      'review.verdictSchema.text',
      'review.reuse.text',
      'review.prompt.reviewSpec',
      'review.prompt.reviewTask',
      'review.prompt.reviewIntegration',
      'gates.heading',
      'gates.intro',
      'gates.readOnly',
      'gates.trigger',
      'gates.evidence',
      'gates.record',
      'gates.steer',
    ]) {
      expect(EN[key], key).toBeTypeOf('string')
    }
  })
})
