import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  autoPositions,
  type DiagramEdge,
  type DiagramNode,
  definitionToGraph,
  END_NODE,
  type GraphDefinition,
  GraphError,
  graphToDefinition,
  nodeIdOf,
  precheckGraph,
  TRIGGER_NODE,
} from '../src/client/graph.ts'

const packageDir = join(import.meta.dirname, '..')

function template(name: string): GraphDefinition {
  return JSON.parse(
    readFileSync(join(packageDir, 'assets', 'definitions', `${name}.json`), 'utf8'),
  ) as GraphDefinition
}

function baseDefinition(overrides: Partial<GraphDefinition> = {}): GraphDefinition {
  return {
    v: 1,
    id: 'graph-demo',
    name: 'Graph demo',
    version: 1,
    trigger: { kind: 'turn.stopping', match: {}, mode: 'active', dedupe: 'turn' },
    settings: {
      allowModelStart: false,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
    },
    steps: [],
    ...overrides,
  }
}

function step(
  id: string,
  executor: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id, title: id, executor, ...extra }
}

describe('definition to graph', () => {
  it('renders the trigger first, then the steps, and the terminal end node', () => {
    const definition = baseDefinition({
      steps: [
        step('one', 'main', { next: 'two', evidence: { kind: 'declaration' } }),
        step('two', 'human', { next: 'end', human: { timeoutAction: 'block' } }),
      ],
    }) as GraphDefinition
    const graph = definitionToGraph(definition)
    expect(graph.nodes[0]?.id).toBe(TRIGGER_NODE)
    expect(graph.nodes[0]?.kind).toBe('trigger')
    expect(graph.nodes.map((node) => node.id)).toEqual([
      TRIGGER_NODE,
      nodeIdOf('one'),
      nodeIdOf('two'),
      END_NODE,
    ])
    expect(graph.edges).toEqual([
      {
        id: `${TRIGGER_NODE}:start`,
        source: TRIGGER_NODE,
        target: nodeIdOf('one'),
        kind: 'start',
        label: 'start',
      },
      {
        id: `${nodeIdOf('one')}:next`,
        source: nodeIdOf('one'),
        target: nodeIdOf('two'),
        kind: 'next',
        label: 'next',
      },
      {
        id: `${nodeIdOf('two')}:next`,
        source: nodeIdOf('two'),
        target: END_NODE,
        kind: 'next',
        label: 'next',
      },
    ])
  })

  it('labels branch outputs true and false and loop outputs body and exit', () => {
    const definition = baseDefinition({
      steps: [
        step('choose', 'branch', {
          // biome-ignore lint/suspicious/noThenProperty: a branch target, not a thenable
          branch: { predicate: { flag: true }, then: 'left', else: 'right' },
        }),
        step('left', 'main', { next: 'end' }),
        step('right', 'main', { next: 'end' }),
        step('repeat', 'loop', { loop: { maxIterations: 2, stop: { '==': [1, 1] }, next: 'end' } }),
      ],
    }) as GraphDefinition
    const graph = definitionToGraph(definition)
    const labels = graph.edges.map((edge) => edge.label)
    expect(labels).toContain('true')
    expect(labels).toContain('false')
    expect(labels).toContain('body')
    expect(labels).toContain('exit')
    const body = graph.edges.find((edge) => edge.kind === 'body')
    expect(body?.source).toBe(nodeIdOf('repeat'))
    expect(body?.target).toBe(nodeIdOf('repeat'))
  })

  it('round-trips every shipped template byte-identically', () => {
    for (const name of ['change-intake', 'task-review', 'retro']) {
      const original = template(name)
      const graph = definitionToGraph(original)
      expect(JSON.stringify(graphToDefinition(original, graph.nodes, graph.edges))).toBe(
        JSON.stringify(original),
      )
    }
  })

  it('round-trips a hand-built graph and reorders the trigger target first', () => {
    const definition = baseDefinition({
      steps: [step('one', 'main', { next: 'two' }), step('two', 'main', { next: 'end' })],
    }) as GraphDefinition
    const graph = definitionToGraph(definition)
    expect(JSON.stringify(graphToDefinition(definition, graph.nodes, graph.edges))).toBe(
      JSON.stringify(definition),
    )
    const reordered: DiagramEdge[] = graph.edges.map((edge) =>
      edge.kind === 'start' ? { ...edge, target: nodeIdOf('two') } : edge,
    )
    const converted = graphToDefinition(definition, graph.nodes, reordered)
    expect(converted.steps.map((entry) => entry.id)).toEqual(['two', 'one'])
    // Every non-positional field is preserved.
    expect(converted.steps[1]).toEqual(definition.steps[0])
  })

  it('refuses an edge that points outside the graph', () => {
    const definition = baseDefinition({
      steps: [step('one', 'main', { next: 'end' })],
    }) as GraphDefinition
    const graph = definitionToGraph(definition)
    const broken: DiagramEdge[] = [
      ...graph.edges,
      { id: 'ghost', source: nodeIdOf('one'), target: 'ghost', kind: 'next' },
    ]
    expect(() => graphToDefinition(definition, graph.nodes, broken)).toThrow(GraphError)
  })

  it('refuses unknown node data', () => {
    const definition = baseDefinition({
      steps: [step('one', 'main', { next: 'end' })],
    }) as GraphDefinition
    const graph = definitionToGraph(definition)
    const nodes: DiagramNode[] = graph.nodes.map((node) =>
      node.id === nodeIdOf('one') ? { ...node, kind: 'mystery' as never } : node,
    )
    expect(() => graphToDefinition(definition, nodes, graph.edges)).toThrow(/kind does not match/)
  })

  it('keeps valid steps named __trigger and __end distinct from the synthetic nodes', () => {
    const definition = baseDefinition({
      steps: [
        step('__trigger', 'main', {
          prompt: 'One.',
          evidence: { kind: 'declaration' },
          nonCritical: true,
          next: '__end',
        }),
        step('__end', 'main', {
          prompt: 'Two.',
          evidence: { kind: 'declaration' },
          nonCritical: true,
          next: 'end',
        }),
      ],
    }) as GraphDefinition
    const graph = definitionToGraph(definition)
    const ids = graph.nodes.map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(nodeIdOf('__trigger'))
    expect(ids).toContain(nodeIdOf('__end'))
    expect(JSON.stringify(graphToDefinition(definition, graph.nodes, graph.edges))).toBe(
      JSON.stringify(definition),
    )
  })

  it('refuses a trigger that bypasses the steps and a step mislabeled as end', () => {
    const definition = baseDefinition({
      steps: [step('one', 'main', { next: 'end' })],
    }) as GraphDefinition
    const graph = definitionToGraph(definition)
    const bypass: DiagramEdge[] = graph.edges.map((edge) =>
      edge.kind === 'start' ? { ...edge, target: END_NODE } : edge,
    )
    expect(() => graphToDefinition(definition, graph.nodes, bypass)).toThrow(
      /trigger must point at a definition step/u,
    )
    const mislabeled: DiagramNode[] = graph.nodes.map((node) =>
      node.id === nodeIdOf('one') ? { ...node, kind: 'end' as never } : node,
    )
    expect(() => graphToDefinition(definition, mislabeled, graph.edges)).toThrow(
      /only the synthetic end node/u,
    )
  })
})

describe('structural pre-check', () => {
  it('finds a dangling edge, a duplicate id, and a missing next', () => {
    const definition = baseDefinition({
      steps: [step('one', 'main', { next: 'end' }), step('two', 'main', { next: 'end' })],
    }) as GraphDefinition
    const graph = definitionToGraph(definition)
    const first = graph.nodes.find((node) => node.id === nodeIdOf('one')) as DiagramNode
    const nodes: DiagramNode[] = [...graph.nodes, { ...first }]
    const edges: DiagramEdge[] = [
      ...graph.edges.filter((entry) => entry.source !== nodeIdOf('two')),
      { id: 'dangling', source: nodeIdOf('one'), target: 'ghost', kind: 'next' },
    ]
    const issues = precheckGraph(nodes, edges)
    const messages = issues.map((issue) => issue.message)
    expect(messages.some((message) => message.includes('dangling'))).toBe(true)
    expect(messages.some((message) => message.includes('duplicated'))).toBe(true)
    expect(messages.some((message) => message.includes('needs one next'))).toBe(true)
  })

  it('accepts a complete branch and loop graph', () => {
    const definition = baseDefinition({
      steps: [
        // biome-ignore lint/suspicious/noThenProperty: a branch target, not a thenable
        step('choose', 'branch', { branch: { predicate: {}, then: 'end', else: 'end' } }),
        step('repeat', 'loop', { loop: { maxIterations: 1, stop: {}, next: 'end' } }),
      ],
    }) as GraphDefinition
    const graph = definitionToGraph(definition)
    expect(precheckGraph(graph.nodes, graph.edges)).toEqual([])
  })
})

describe('deterministic auto layout', () => {
  it('gives every node a finite position and the same result twice', () => {
    const definition = template('change-intake')
    const graph = definitionToGraph(definition)
    const first = autoPositions(graph.nodes, graph.edges)
    const second = autoPositions(graph.nodes, graph.edges)
    expect(first).toEqual(second)
    for (const node of graph.nodes) {
      expect(first[node.id]).toBeDefined()
      expect(Number.isFinite(first[node.id]?.x)).toBe(true)
      expect(Number.isFinite(first[node.id]?.y)).toBe(true)
    }
  })
})
