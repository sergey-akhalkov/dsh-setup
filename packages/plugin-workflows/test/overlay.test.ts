import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { definitionToGraph, type GraphDefinition } from '../src/client/graph.ts'
import { overlayFor, withOverlay } from '../src/client/overlay.ts'
import type { RunView } from '../src/client/panel.tsx'
import { createRunSelection } from '../src/client/run-selection.ts'
import { packageDir } from './client-harness.ts'

const DEFINITION = JSON.parse(
  readFileSync(join(packageDir, 'assets', 'definitions', 'change-intake.json'), 'utf8'),
) as GraphDefinition

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    id: 'workflow:run-1',
    source: 'workflow',
    session: 'session-1',
    attribution: 'local',
    title: 'change-intake intake',
    startedAt: 1_000,
    status: 'running',
    definition: { id: 'change-intake', name: 'OpenSpec change intake', version: 1 },
    steps: [
      {
        id: 'requirements',
        title: 'requirements',
        state: 'done',
        at: 1_100,
        evidenceRef: { kind: 'file', ref: '.dsh/x.md', at: 1_050 },
      },
      {
        id: 'architecture',
        title: 'architecture',
        state: 'blocked',
        failureClass: 'missing-file',
        reason: 'the file is missing',
      },
    ],
    violations: [{ stepId: 'architecture', at: 1_200, reason: 'bypassed' }],
    ...overrides,
  }
}

describe('run overlay', () => {
  it('maps each recorded state, evidence, failure class, and violation to its node', () => {
    const overlay = overlayFor(run(), DEFINITION)
    expect(overlay.steps.requirements?.state).toBe('done')
    expect(overlay.steps.requirements?.evidence).toEqual({
      kind: 'file',
      ref: '.dsh/x.md',
      at: 1_050,
    })
    expect(overlay.steps.architecture?.state).toBe('blocked')
    expect(overlay.steps.architecture?.failureClass).toBe('missing-file')
    expect(overlay.steps.architecture?.violations).toEqual(['bypassed'])
    expect(overlay.versionsDiffer).toBe(false)
    expect(overlay.recordedName).toBe('OpenSpec change intake')
    expect(overlay.recordedVersion).toBe(1)
  })

  it('maps every recorded step state verbatim', () => {
    const states = overlayFor(
      run({
        status: 'failed',
        steps: [
          { id: 'requirements', title: 'requirements', state: 'running' },
          {
            id: 'architecture',
            title: 'architecture',
            state: 'failed',
            failureClass: 'check-failed',
          },
        ],
      }),
      DEFINITION,
    )
    expect(states.run?.status).toBe('failed')
    expect(states.steps.requirements?.state).toBe('running')
    expect(states.steps.architecture).toMatchObject({
      state: 'failed',
      failureClass: 'check-failed',
    })
    const completed = overlayFor(
      run({
        status: 'done',
        steps: [
          { id: 'requirements', title: 'requirements', state: 'done' },
          { id: 'architecture', title: 'architecture', state: 'done' },
        ],
        violations: [],
      }),
      DEFINITION,
    )
    expect(completed.run?.status).toBe('done')
    expect(completed.steps.architecture?.failureClass).toBeUndefined()
  })

  it('leaves a definition step missing from the run without a state and marks orphans', () => {
    const overlay = overlayFor(
      run({
        steps: [
          { id: 'requirements', title: 'requirements', state: 'done' },
          { id: 'ghost', title: 'ghost', state: 'failed', failureClass: 'no-call' },
        ],
      }),
      DEFINITION,
    )
    expect(overlay.steps.architecture).toBeUndefined()
    expect(overlay.orphans).toEqual([{ id: 'ghost', state: 'failed', failureClass: 'no-call' }])
    const graph = definitionToGraph(DEFINITION)
    const drawn = withOverlay(graph.nodes, overlay)
    expect(drawn).toHaveLength(graph.nodes.length)
    expect(drawn.some((node) => node.id === 'ghost')).toBe(false)
  })

  it('turns a violation for an unknown step into a run-level notice', () => {
    const overlay = overlayFor(
      run({ violations: [{ stepId: 'ghost-step', at: 5, reason: 'unknown step' }] }),
      DEFINITION,
    )
    expect(overlay.notices).toEqual(['step "ghost-step": unknown step'])
    expect(overlay.steps.requirements?.violations).toEqual([])
  })

  it('keeps the recorded name and version after the definition changes', () => {
    const changed = { ...DEFINITION, name: 'Renamed', version: 4 }
    const overlay = overlayFor(run(), changed)
    expect(overlay.recordedName).toBe('OpenSpec change intake')
    expect(overlay.recordedVersion).toBe(1)
    expect(overlay.versionsDiffer).toBe(true)
  })

  it('switches only the overlay when another run is selected', () => {
    const first = run()
    const second = run({
      id: 'workflow:run-2',
      status: 'done',
      startedAt: 2_000,
      steps: [
        { id: 'requirements', title: 'requirements', state: 'done' },
        { id: 'architecture', title: 'architecture', state: 'done' },
      ],
      violations: [],
    })
    const before = JSON.stringify(DEFINITION)
    const overlayA = overlayFor(first, DEFINITION)
    const overlayB = overlayFor(second, DEFINITION)
    expect(overlayA.steps.architecture?.state).toBe('blocked')
    expect(overlayB.steps.architecture?.state).toBe('done')
    expect(JSON.stringify(DEFINITION)).toBe(before)
  })

  it('is read-only: no fetch, no mutation, no invented node', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const input = run()
    const snapshot = JSON.stringify(input)
    const overlay = overlayFor(input, DEFINITION)
    const graph = definitionToGraph(DEFINITION)
    const nodes = withOverlay(graph.nodes, overlay)
    expect(JSON.stringify(input)).toBe(snapshot)
    expect(nodes).toHaveLength(graph.nodes.length)
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('shows no run state before a run is selected', () => {
    const overlay = overlayFor(undefined, DEFINITION)
    expect(overlay.run).toBeUndefined()
    expect(overlay.steps).toEqual({})
    expect(overlay.summary).toContain('No run selected')
    expect(
      withOverlay(definitionToGraph(DEFINITION).nodes, overlay).every(
        (node) => node.runState === undefined,
      ),
    ).toBe(true)
  })

  it('keeps a real step whose id starts with violation:', () => {
    const definition: GraphDefinition = {
      ...DEFINITION,
      steps: DEFINITION.steps.map((step, index) =>
        index === 0 ? { ...step, id: 'violation:approval' } : step,
      ),
    }
    const graph = definitionToGraph(definition)
    const overlay = overlayFor(
      run({
        steps: [
          {
            id: 'violation:approval',
            title: 'approval',
            state: 'blocked',
            failureClass: 'no-answer',
            evidenceRef: { kind: 'figma', ref: 'v1' },
            reason: 'no answer was recorded',
          },
        ],
        violations: [{ stepId: 'violation:approval', at: 1_200, reason: 'bypassed' }],
      }),
      definition,
    )
    expect(overlay.steps['violation:approval']).toMatchObject({
      state: 'blocked',
      failureClass: 'no-answer',
      evidence: { kind: 'figma', ref: 'v1' },
      violations: ['bypassed'],
    })
    const node = withOverlay(graph.nodes, overlay).find(
      (entry) => entry.step?.id === 'violation:approval',
    )
    expect(node).toMatchObject({
      runState: 'blocked',
      failureClass: 'no-answer',
      evidence: { kind: 'figma', ref: 'v1' },
      violations: ['bypassed'],
    })
  })

  it('does not crash on inherited object keys before a run is selected', () => {
    const definition: GraphDefinition = {
      ...DEFINITION,
      steps: DEFINITION.steps.map((step) =>
        step.id === 'requirements' ? { ...step, id: 'constructor' } : step,
      ),
    }
    const graph = definitionToGraph(definition)
    expect(() => withOverlay(graph.nodes, overlayFor(undefined, definition))).not.toThrow()
    const overlay = overlayFor(
      run({ steps: [{ id: 'constructor', title: 'constructor', state: 'running' }] }),
      definition,
    )
    expect(overlay.steps['constructor']?.state).toBe('running')
    expect(
      withOverlay(graph.nodes, overlay).find((node) => node.step?.id === 'constructor')?.runState,
    ).toBe('running')
  })

  it('discards a superseded definition run response', async () => {
    const resolvers = new Map<string, (runs: string[]) => void>()
    const selection = createRunSelection<string>(
      (definitionId) =>
        new Promise((resolve) => {
          resolvers.set(definitionId, resolve)
        }),
    )
    const applied: (readonly string[])[] = []
    const alpha = selection.load('alpha', (next) => applied.push(next))
    const beta = selection.load('beta', (next) => applied.push(next))
    resolvers.get('beta')?.(['beta-run'])
    resolvers.get('alpha')?.(['alpha-run'])
    await Promise.all([alpha, beta])
    // Both loads clear first; only the latest definition's response lands.
    expect(applied).toEqual([[], [], ['beta-run']])
  })

  it('invalidates an in-flight run load when the document changes', async () => {
    let resolveAlpha: ((runs: string[]) => void) | undefined
    const selection = createRunSelection<string>(
      () =>
        new Promise((resolve) => {
          resolveAlpha = resolve
        }),
    )
    const applied: (readonly string[])[] = []
    const alpha = selection.load('alpha', (next) => applied.push(next))
    selection.invalidate()
    resolveAlpha?.(['alpha-run'])
    await alpha
    expect(applied).toEqual([[]])
  })
})
