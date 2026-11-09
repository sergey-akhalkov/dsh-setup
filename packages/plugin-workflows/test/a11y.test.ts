import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  CLIENT_MODULE_FAILURE_NOTE,
  defaultMode,
  fallbackIsClientOnly,
  fallbackNotice,
  isAddKey,
  isConnectKey,
  NARROW_WIDTH,
  paletteLabel,
  resolveSurface,
  summaryText,
  TAB_ORDER,
} from '../src/client/a11y.ts'
import { connectChoices, EDGE_LABELS } from '../src/client/edges.ts'
import { addStep, blankDefinition, connectSteps, openNew, save } from '../src/client/editor.ts'
import { END_NODE, type GraphDefinition } from '../src/client/graph.ts'
import { overlayFor } from '../src/client/overlay.ts'
import { call, elements, fire, loadClientModules, packageDir } from './client-harness.ts'

const ui = loadClientModules(['canvas.tsx', 'palette.tsx'])

const DEFINITION = JSON.parse(
  readFileSync(join(packageDir, 'assets', 'definitions', 'change-intake.json'), 'utf8'),
) as GraphDefinition

describe('mode and fallback', () => {
  it('defaults to the list below the breakpoint and keeps the canvas available', () => {
    expect(NARROW_WIDTH).toBe(720)
    expect(defaultMode(600)).toBe('list')
    expect(defaultMode(1200)).toBe('canvas')
    expect(resolveSurface('canvas', false, 600)).toBe('list')
    expect(resolveSurface('canvas', false, 1200)).toBe('canvas')
    expect(resolveSurface('canvas', true, 1200)).toBe('list')
    expect(resolveSurface('list', false, 1200)).toBe('list')
    expect(fallbackNotice(true)).toContain('list editor is showing')
    expect(fallbackNotice(false)).toBeUndefined()
  })

  it('renders the list when the canvas render throws, with a bounded notice', () => {
    const boundary = new (
      ui.CanvasBoundary as unknown as new (
        props: Record<string, unknown>,
      ) => {
        state: Record<string, unknown>
        render: () => unknown
        componentDidCatch: (error: unknown) => void
      }
    )({ fallback: 'list-editor', onError: () => {} })
    expect(boundary.render()).toBeUndefined()
    const derived = (
      ui.CanvasBoundary as unknown as { getDerivedStateFromError: () => Record<string, unknown> }
    ).getDerivedStateFromError()
    boundary.state = { ...boundary.state, ...derived }
    expect(boundary.render()).toBe('list-editor')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onError = vi.fn()
    const watching = new (
      ui.CanvasBoundary as unknown as new (
        props: Record<string, unknown>,
      ) => {
        componentDidCatch: (error: unknown) => void
      }
    )({ fallback: 'list-editor', onError })
    watching.componentDidCatch(new Error('React Flow failed'))
    expect(onError).toHaveBeenCalledTimes(1)
    errors.mockRestore()
    expect(fallbackIsClientOnly()).toBe(true)
    // The fallback is a client-only state; a module evaluation failure happens
    // before render and is reported by the Harness loader instead.
    expect(CLIENT_MODULE_FAILURE_NOTE).toContain('Harness loader')
  })
})

describe('summary and keyboard', () => {
  it('summarises the trigger, step count, selection, and run state', () => {
    const overlay = overlayFor(
      {
        id: 'workflow:run-1',
        source: 'workflow',
        title: 'run',
        attribution: 'local',
        startedAt: 1,
        status: 'blocked',
        steps: [{ id: 'requirements', title: 'requirements', state: 'blocked' }],
      },
      DEFINITION,
    )
    const base = summaryText(DEFINITION, undefined, overlay)
    expect(base).toContain('Trigger tool.pre-execute')
    expect(base).toContain(`${String(DEFINITION.steps.length)} steps`)
    expect(base).toContain('run blocked')
    expect(summaryText(DEFINITION, 'Requirements')).toContain('Selected: Requirements')
    expect(summaryText(DEFINITION)).toContain('no run selected')
  })

  it('recognises the keyboard add and connect keys', () => {
    expect(isAddKey('Enter')).toBe(true)
    expect(isAddKey(' ')).toBe(true)
    expect(isAddKey('a')).toBe(false)
    expect(isConnectKey('c')).toBe(true)
    expect(isConnectKey('C')).toBe(true)
    expect(isConnectKey('Enter')).toBe(false)
    expect(paletteLabel('step')).toBe('Add step')
    expect(paletteLabel('branch')).toBe('Add branch')
    expect(TAB_ORDER).toEqual(['palette', 'canvas', 'properties'])
  })

  it('creates a two-step definition with the keyboard add and connect list only', async () => {
    const kinds: string[] = []
    const palette = call(ui, 'Palette', { onAdd: (kind: string) => kinds.push(kind) })
    const buttons = elements(palette).filter((element) => element.type === 'button')
    fire(
      buttons.find((button) => button.props['data-kind'] === 'step'),
      'onKeyDown',
      'Enter',
    )
    // The palette handler only reports the choice; the container applies it.
    expect(kinds).toEqual(['step'])
    let state = openNew(blankDefinition(new Set(['new-workflow'])))
    state = addStep(state, 'step')
    const choices = connectChoices(state.diagram.nodes, 'step-1').find(
      (choice) => choice.kind === 'next',
    )
    expect(choices?.targets.map((target) => target.id)).toEqual(
      expect.arrayContaining(['step-2', END_NODE]),
    )
    expect(EDGE_LABELS.next).toBe('next')
    // Keyboard connect: choose the labelled target, then connect.
    state = connectSteps(state, 'step-1', 'step-2', 'next')
    state = connectSteps(state, 'step-2', END_NODE, 'next')
    expect(state.issues).toEqual([])
    const saved = await save(
      { ...state, document: { ...state.document, revision: 'rev-1' } },
      {
        api: {
          list: async () => ({ definitions: [] }),
          templates: async () => [],
          drafts: async () => [],
          read: async () => ({
            definition: state.document.definition,
            revision: 'rev-1',
            source: 'local',
          }),
          readDraft: async () => state.document.definition,
          readLayout: async () => ({ layout: null, revision: null }),
          saveDefinition: async () => ({ ok: true, revision: 'rev-2' }),
          deleteDefinition: async () => ({ ok: true, revision: 'rev-2' }),
          saveLayout: async () => ({ ok: true, revision: 'layout-1' }),
          runs: async () => [],
        },
        taken: new Set(['new-workflow', 'step-1', 'step-2']),
      },
    )
    expect(saved.status).toBe('saved')
    expect(saved.document.definition.steps).toHaveLength(2)
  })
})
